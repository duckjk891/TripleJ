// [ShareCompose] v3.237 곡 공유 문구 화면 — ⋯ 시트 '공유하기' → 안 선택·수정 → [공유하기] OS 공유 시트.
//  · 흐름(요청서 §4): 안 칩(가로 스크롤) → 바치는 노래면 받는 사람 입력(최대 20자, 비우면 '소중한 당신', 실시간 치환)
//    → 편집 영역(①②③, 200자 카운터·초과 시 공유 비활성) → 고정 영역(④ 혜택 — 서버가 준 경우만, ⑤ 링크) 회색 미리보기
//    → 최종 = 본문 + 빈 줄 없이 ④ + ⑤(링크 ?s=공유ID).
//  · 안 순서: 곡 테마 안들 → 바치는 노래 → default 첫 안 / 테마 없으면 default 안들 → 바치는 노래(utils/shareMessage.orderTemplates).
//  · 수정 중 안 전환·화면 이탈 = "수정한 내용이 사라져요" 확인(showAlert, D7). [원래 문구로] = 선택 안 렌더값으로 복원.
//  · 문구·안·혜택 = 서버 설정(GET /api/share/track/{id}) — 실패·구서버 = 내장 기본값(constants/shareMessages.ts).
//  · 칩 표기 = 서버 설정 emoji + label(대표 D4 변경). 버튼·안내 등 앱 UI 문구는 텍스트만.
//  · 측정: share_compose_open·share_sent(안 id·테마·수정 여부·길이 등 플래그만 — 본문·받는 사람 이름 전송 금지).
//  · 웹 사용자 활성화: [공유하기] 탭 핸들러에서 await 없이 곧장 deliverShareText(navigator.share/복사) 호출.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Button } from '../components/ui';
import { TrackCover } from '../components/TrackRow';
import { showAlert } from '../utils/appAlert';
import { deliverShareText, ShareableTrack } from '../utils/trackShare';
import { TRACK_ID_RE } from '../utils/trackLink';
import { trackEvent } from '../utils/screenAnalytics';
import { fetchShareData } from '../services/shareService';
import {
  assembleShareMessage,
  chipLabel,
  countChars,
  headLine,
  isEdited,
  newShareId,
  normalizeRecipient,
  oneLine,
  orderTemplates,
  renderShareBody,
  replaceRecipient,
  RECIPIENT_REPLACE_MIN,
  ShareData,
  ShareTemplate,
} from '../utils/shareMessage';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';

const log = (event: string, extra?: Record<string, any>) => console.info(`[ShareCompose] ${event}`, extra || {});
const DISCARD_TITLE = '수정한 내용이 사라져요. 바꿀까요?';
const LEAVE_TITLE = '수정한 내용이 사라져요. 나갈까요?';

export default function ShareComposeScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const params = route?.params || {};
  const track: ShareableTrack = params.track || { id: '' };
  const isOwn = !!params.isOwn;
  const src = oneLine(params.src).slice(0, 24) || 'unknown';
  const trackId = String(track?.id || '');

  const [data, setData] = useState<ShareData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState('');
  const [recipientInput, setRecipientInput] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const aliveRef = useRef(true);
  const allowLeaveRef = useRef(false);
  const editedRef = useRef(false);
  const overRef = useRef(false);
  // 연타 방지 — state(sending)는 다음 렌더 전까지 반영되지 않아 동기 연타 2회를 못 막는다
  const sendingRef = useRef(false);
  // 본문에 들어가 있는 받는 사람 이름(렌더 시점 값) — 수정 후 이름 변경 치환의 '이전 이름'
  const bodyNameRef = useRef('');

  const ordered = useMemo(() => (data ? orderTemplates(data.templates, data.theme.key) : []), [data]);
  const selected: ShareTemplate | null = ordered.find((t) => t.id === selectedId) || ordered[0] || null;
  const recipient = data ? normalizeRecipient(recipientInput, data.recipient_default, data.limits.recipient) : '';
  const rendered = data && selected ? renderShareBody(selected, data, recipient) : '';
  const edited = !!selected && isEdited(body, rendered);
  const bodyLen = countChars(body);
  const bodyLimit = data?.limits.body ?? 200;
  const over = bodyLen > bodyLimit;
  const head = data ? headLine(data.track.title, data.track.artist_name, data.limits.head_title) : '';
  editedRef.current = edited;

  const leave = useCallback(() => {
    allowLeaveRef.current = true;
    navigation.goBack();
  }, [navigation]);

  // 로드 — API-1(3초) → 실패·구서버 = 내장 기본값, 404 = 안내 후 닫기
  useEffect(() => {
    aliveRef.current = true;
    if (!TRACK_ID_RE.test(trackId)) {
      console.error('[ShareCompose] fail — 공유할 수 없는 id', { id: trackId, src });
      showAlert('알림', '이 곡은 공유할 수 없어요.');
      leave();
      return () => { aliveRef.current = false; };
    }
    log('open', { id: trackId, src, own: isOwn });
    fetchShareData(track, isOwn)
      .then((res) => {
        if (!aliveRef.current) return;
        if (res.status === 'not_found' || !res.data) {
          showAlert('알림', '비공개로 바뀌었거나 삭제된 곡이에요.');
          leave();
          return;
        }
        const d = res.data;
        const first = orderTemplates(d.templates, d.theme.key)[0];
        setData(d);
        setSelectedId(first?.id || '');
        bodyNameRef.current = d.recipient_default;
        setBody(first ? renderShareBody(first, d, normalizeRecipient('', d.recipient_default, d.limits.recipient)) : '');
        setLoading(false);
        log(res.status === 'server' ? 'loaded' : 'fallback', {
          id: trackId, theme: d.theme.key, source: d.theme.source, aud: d.audience,
          templates: d.templates.length, benefit: !!d.benefit, ver: d.config_version, reason: res.reason,
        });
        trackEvent('share_compose_open', {
          track_id: trackId, theme: d.theme.key, theme_source: d.theme.source, audience: d.audience, src,
        });
      })
      .catch((err: any) => {
        // fetchShareData 는 폴백으로 흡수 — 여기는 예기치 못한 예외만
        console.error('[ShareCompose] fail — load', { id: trackId, message: err?.message });
        if (!aliveRef.current) return;
        showAlert('오류', '공유 화면을 열지 못했어요. 잠시 후 다시 시도해 주세요.');
        leave();
      });
    return () => { aliveRef.current = false; };
    // 진입 1회
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 수정 후 화면 이탈(뒤로가기·헤더·제스처) 확인(D7)
  useEffect(() => {
    const unsub = navigation.addListener?.('beforeRemove', (e: any) => {
      if (allowLeaveRef.current || !editedRef.current) return;
      e.preventDefault();
      showAlert(LEAVE_TITLE, undefined, [
        { text: '취소', style: 'cancel' },
        {
          text: '나가기',
          onPress: () => {
            allowLeaveRef.current = true;
            navigation.dispatch(e.data.action);
          },
        },
      ]);
    });
    return () => { try { unsub?.(); } catch { /* noop */ } };
  }, [navigation]);

  // 200자 초과 진입 시 1회 로그
  useEffect(() => {
    if (over && !overRef.current) log('over-limit', { id: trackId, len: bodyLen, limit: bodyLimit });
    overRef.current = over;
  }, [over, bodyLen, bodyLimit, trackId]);

  const applyTemplate = (tpl: ShareTemplate) => {
    if (!data) return;
    log('switch', { id: trackId, from: selected?.id, to: tpl.id, edited });
    setSelectedId(tpl.id);
    bodyNameRef.current = recipient;
    setBody(renderShareBody(tpl, data, recipient));
  };

  const onSelect = (tpl: ShareTemplate) => {
    if (!data || tpl.id === selected?.id) return;
    if (edited) {
      showAlert(DISCARD_TITLE, undefined, [
        { text: '취소', style: 'cancel' },
        { text: '바꾸기', onPress: () => applyTemplate(tpl) },
      ]);
      return;
    }
    applyTemplate(tpl);
  };

  const onReset = () => {
    if (!edited) return;
    log('reset', { id: trackId, template: selected?.id });
    bodyNameRef.current = recipient;
    setBody(rendered);
  };

  // 받는 사람 실시간 치환(D6·오케스트레이터 판정 4) — 미수정 = 템플릿 재렌더,
  // 수정 후 = 본문 속 이전 이름 전체 일치만 새 이름으로(이전 이름 2자 미만이면 중단 — replaceRecipient).
  // 수정 후에는 새 이름이 2자 이상이 될 때까지 본문을 건드리지 않는다(한 글자 입력 중 '나' 같은 짧은 이름이
  // 본문에 박혀 이후 치환이 막히는 것 방지).
  const onRecipientChange = (v: string) => {
    setRecipientInput(v);
    if (!data || !selected) return;
    const next = normalizeRecipient(v, data.recipient_default, data.limits.recipient);
    if (next === recipient) return;
    if (!edited) {
      bodyNameRef.current = next;
      setBody(renderShareBody(selected, data, next));
      return;
    }
    if (countChars(next) < RECIPIENT_REPLACE_MIN) return;
    const replaced = replaceRecipient(body, bodyNameRef.current, next);
    if (replaced !== body) {
      bodyNameRef.current = next;
      setBody(replaced);
    }
  };

  const onShare = () => {
    if (!data || !selected || over || sendingRef.current) return;
    sendingRef.current = true;
    const shareId = newShareId();
    const msg = assembleShareMessage({ body, head, benefit: data.benefit?.text ?? null, link: data.link, shareId });
    const props = {
      track_id: trackId,
      share_id: shareId,
      template_id: selected.id,
      theme: data.theme.key,
      theme_source: data.theme.source,
      audience: data.audience,
      edited,
      recipient_custom: selected.kind === 'dedication' && !!oneLine(recipientInput),
      body_len: countChars(msg.bodyFinal),
    };
    log('send', { id: trackId, template: selected.id, edited, len: props.body_len, s: shareId, benefit: !!data.benefit });
    setSending(true);
    // 웹 활성화: 이 호출 앞에 await 금지
    deliverShareText({ trackId, text: msg.text, url: msg.url })
      .then((outcome) => {
        trackEvent('share_sent', { ...props, outcome: outcome === 'shared' || outcome === 'copied' || outcome === 'manual' || outcome === 'cancelled' ? outcome : 'failed' });
        if (!aliveRef.current) return;
        if (outcome === 'shared' || outcome === 'copied') leave();
      })
      .catch((err: any) => console.error('[ShareCompose] fail — send', { id: trackId, message: err?.message }))
      .finally(() => {
        sendingRef.current = false;
        if (aliveRef.current) setSending(false);
      });
  };

  if (loading || !data) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.accent.primary} />
      </View>
    );
  }

  const coverTrack = {
    id: trackId,
    title: data.track.title || oneLine(track.title),
    // 앱 안 표시 행은 차트와 같은 표기(서버 아티스트 없으면 곡 객체 값) — 외부 문구는 data.track.artist_name 만 사용
    artist_name: data.track.artist_name || oneLine(track.artist_name),
    cover_image: track.cover_image,
    cover_image_url: track.cover_image_url,
  };
  const isDedication = selected?.kind === 'dedication';

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.trackRow}>
          <TrackCover track={coverTrack} left />
          <View style={{ flex: 1, marginLeft: spacing.md }}>
            <AppText variant="bodyStrong" numberOfLines={1}>{coverTrack.title || '제목 없는 곡'}</AppText>
            <AppText variant="footnote" tone="secondary" numberOfLines={1}>{coverTrack.artist_name || '알 수 없는 아티스트'}</AppText>
          </View>
        </View>

        {/* 안 선택 — 가로 스크롤 칩 */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
          {ordered.map((t) => {
            const on = t.id === selected?.id;
            return (
              <TouchableOpacity
                key={t.id}
                style={[styles.chip, on && styles.chipOn]}
                onPress={() => onSelect(t)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`문구 ${t.label}`}
              >
                <AppText variant="bodyStrong" tone={on ? 'primary' : 'secondary'}>{chipLabel(t)}</AppText>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* 바치는 노래 — 받는 사람 */}
        {isDedication ? (
          <View style={styles.block}>
            <View style={styles.blockHead}>
              <AppText variant="footnote" tone="secondary">누구에게 바칠까요?</AppText>
              <AppText variant="footnote" tone="muted">{countChars(oneLine(recipientInput))}/{data.limits.recipient}</AppText>
            </View>
            <TextInput
              style={styles.recipientInput}
              value={recipientInput}
              onChangeText={onRecipientChange}
              placeholder={data.recipient_default}
              placeholderTextColor={colors.text.muted}
              maxLength={data.limits.recipient}
              returnKeyType="done"
              accessibilityLabel="받는 사람"
            />
          </View>
        ) : null}

        {/* 편집 영역(①②③) */}
        <View style={styles.block}>
          <View style={styles.blockHead}>
            <AppText variant="footnote" tone="secondary">문구</AppText>
            <View style={styles.headRight}>
              <AppText variant="footnote" style={{ color: over ? colors.status.error : colors.text.muted }}>
                {bodyLen}/{bodyLimit}
              </AppText>
              <TouchableOpacity
                style={styles.resetBtn}
                onPress={onReset}
                disabled={!edited}
                accessibilityRole="button"
                accessibilityLabel="원래 문구로"
              >
                <Feather name="rotate-ccw" size={14} color={edited ? colors.accent.primary : colors.text.muted} />
                <AppText variant="footnote" tone={edited ? 'accent' : 'muted'}>원래 문구로</AppText>
              </TouchableOpacity>
            </View>
          </View>
          <TextInput
            style={[styles.bodyInput, over && styles.bodyInputOver]}
            value={body}
            onChangeText={setBody}
            multiline
            textAlignVertical="top"
            placeholder={head}
            placeholderTextColor={colors.text.muted}
            accessibilityLabel="공유 문구"
          />
          {over ? (
            <AppText variant="footnote" style={styles.overHint}>{bodyLimit}자까지 쓸 수 있어요</AppText>
          ) : !body.trim() ? (
            <AppText variant="footnote" tone="muted" style={styles.hint}>비워 두면 {head} 한 줄로 보내요</AppText>
          ) : null}
        </View>

        {/* 고정 영역(④⑤) — 편집 불가 미리보기 */}
        <View style={styles.fixedBox}>
          <AppText variant="caption" tone="muted" style={{ marginBottom: spacing.xs }}>자동으로 붙어요</AppText>
          {data.benefit ? <AppText variant="footnote" tone="muted">{data.benefit.text}</AppText> : null}
          <AppText variant="footnote" tone="muted" numberOfLines={1}>{data.link}</AppText>
        </View>
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button label="공유하기" onPress={onShare} disabled={over || !selected} loading={sending} fullWidth />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  trackRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg },
  chips: { gap: spacing.sm, paddingBottom: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill,
    backgroundColor: colors.bg.surface1, borderWidth: 1, borderColor: colors.border.subtle,
  },
  chipOn: { backgroundColor: colors.bg.surface2, borderColor: colors.border.accent },
  block: { marginTop: spacing.lg },
  blockHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  headRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  resetBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs },
  recipientInput: {
    backgroundColor: colors.bg.surface1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    color: colors.text.primary, borderWidth: 1, borderColor: colors.border.subtle, fontSize: 14,
  },
  bodyInput: {
    minHeight: 160, backgroundColor: colors.bg.surface1, borderRadius: radius.md, padding: spacing.md,
    color: colors.text.primary, borderWidth: 1, borderColor: colors.border.subtle, fontSize: 14, lineHeight: 21,
  },
  bodyInputOver: { borderColor: colors.status.error },
  overHint: { color: colors.status.error, marginTop: spacing.xs },
  hint: { marginTop: spacing.xs },
  fixedBox: {
    marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md,
    backgroundColor: colors.bg.surface1, opacity: 0.7, gap: spacing.xxs,
  },
  bottomBar: {
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, backgroundColor: colors.bg.deepest,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border.subtle,
  },
});
