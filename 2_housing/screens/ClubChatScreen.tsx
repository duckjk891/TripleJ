// [ClubChatScreen] v3.252 크루 단톡방 — 크루 멤버 전용 실시간 채팅(계약 fixed).
// 진입: ClubHome 채팅 탭(멤버) → navigate('ClubChat', { clubId, name, isOwner }). 별도 풀스크린
// (DmChat 관행 — keyboard-controller KAV 키보드 처리, 탭바·미니플레이어 없음).
// 목록: GET /clubs/{id}/chat?before= 역방향 커서(위로 과거 무한스크롤, inverted FlatList).
// 송신: POST /clubs/{id}/chat (≤1000자) — 429 rate_limited·403 분기 문구는 clubService 단일화.
// 실시간: dmSocketSubscribeClubChat('club_chat') — 열린 방 club_id 일치 시 append(전체 재조회 금지,
//   DmChat load() 안티패턴 답습 금지), 재연결('open') 시 마지막 id 이후 after 캐치업 1회.
// 읽음: 진입·신규 수신 시 POST /clubs/{id}/chat/read (실패 무시).
// 롱프레스(showAlert): 본인·owner=삭제(소프트 — '삭제된 메시지예요' 회색), 타인=신고(ReportModal 'club_message').
// 어린이: 서버 403 child_restricted 계약 — useIsChild 로 입력바 숨김+안내(403 왕복 자체를 없앰).
// 차단(dm_blocks) 상대 메시지 클라 필터: 차단 목록 조회 API 부재로 이번 버전 생략(서버 필터 위임) — 보고 항목.
// 팝업은 전부 앱 내 다이얼로그(showAlert). 구서버(라우트 404) → 안내 강등, 크래시 금지.
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, FlatList, TouchableOpacity, TextInput, ActivityIndicator, StyleSheet } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { AppText, Button, EmptyState } from '../components/ui';
import ReportModal from '../components/ReportModal';
import { showAlert, type AppAlertButton } from '../utils/appAlert';
import { useAuthStore } from '../stores/authStore';
import { useIsChild, isChildRestrictedError } from '../utils/kidsMode';
import { dmSocketSubscribeClubChat } from '../services/dmSocket';
import {
  CLUB_LABEL, CHAT_TEXT_MAX, ClubChatMessage, getClubErrorCode,
  listClubChat, sendClubChat, deleteClubChatMessage, markClubChatRead, chatSendErrorMessage,
} from '../services/clubService';

const CHAT_LIMIT = 50;

// 서버 시각은 타임존 표기 없는 UTC — 'Z' 보정(DmChat 관행)
const parseUtc = (iso: string) => new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z');
const fmtClock = (iso?: string) => {
  if (!iso) return '';
  const d = parseUtc(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default function ClubChatScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { clubId, name, isOwner } = route.params || {};
  const user = useAuthStore((s) => s.user);
  const isChild = useIsChild();

  // messages: 최신순(index 0 = 최신) — inverted FlatList 데이터 그대로
  const [messages, setMessages] = useState<ClubChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<'forbidden' | 'failed' | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [reportMsg, setReportMsg] = useState<ClubChatMessage | null>(null);
  // 최신 메시지 id — 소켓 콜백·캐치업이 상태 스냅샷에 갇히지 않게 ref 로 별도 추적
  const latestIdRef = useRef<string | null>(null);

  const setLatest = (list: ClubChatMessage[]) => {
    if (list.length) latestIdRef.current = list[0].id;
  };

  const load = useCallback(async () => {
    if (!clubId) return;
    try {
      const page = await listClubChat(String(clubId), { limit: CHAT_LIMIT });
      setMessages(page.messages);
      setNextBefore(page.next_before);
      setLatest(page.messages);
      setLoadError(null);
      markClubChatRead(String(clubId)); // 진입 시 읽음
    } catch (err: any) {
      const status = err?.response?.status;
      console.error('[Club] 채팅 조회 실패', { clubId, status });
      // 403(비멤버 레이스·강퇴 직후) 만 구분 — 404 구서버·네트워크는 공통 안내 강등(크래시 0)
      setLoadError(status === 403 ? 'forbidden' : 'failed');
    } finally {
      setLoading(false);
    }
  }, [clubId]);

  useEffect(() => { load(); }, [load]);

  // 위(과거)로 무한스크롤 — inverted 목록의 onEndReached = 최상단 도달
  const loadOlder = useCallback(async () => {
    if (!nextBefore || loadingMore || loading) return;
    setLoadingMore(true);
    if (__DEV__) console.info('[Club] 채팅 과거 loadMore', { clubId, before: nextBefore });
    try {
      const page = await listClubChat(String(clubId), { limit: CHAT_LIMIT, before: nextBefore });
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        return [...prev, ...page.messages.filter((m) => !seen.has(m.id))];
      });
      setNextBefore(page.next_before);
    } catch (err: any) {
      console.error('[Club] 채팅 loadMore 실패', { clubId, status: err?.response?.status });
      setNextBefore(null); // 반복 실패 방지 — 재진입으로 복구
    } finally {
      setLoadingMore(false);
    }
  }, [clubId, nextBefore, loadingMore, loading]);

  // 신규 수신 append(중복 id 방어) + 읽음 — 소켓·송신 응답 공용
  const appendMessage = useCallback((m: ClubChatMessage) => {
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [m, ...prev]));
    if (m.id) latestIdRef.current = m.id;
  }, []);

  // 실시간 — club_chat: 이 방(club_id 일치)이면 append(전체 재조회 금지) + 읽음.
  // 재연결('open'): 마지막 id 이후 after 캐치업 1회(놓친 구간만).
  useEffect(() => {
    if (!clubId) return;
    const unsub = dmSocketSubscribeClubChat(async (ev) => {
      if (ev.type === 'club_chat') {
        if (String(ev.club_id) !== String(clubId) || !ev.message) return;
        if (__DEV__) console.info('[Club] 소켓 채팅 수신', { clubId, messageId: ev.message?.id });
        appendMessage({ ...ev.message, id: String(ev.message.id ?? ''), sender_id: String(ev.message.sender_id ?? '') });
        markClubChatRead(String(clubId));
        return;
      }
      if (ev.type === 'open' && latestIdRef.current) {
        if (__DEV__) console.info('[Club] 재접속 캐치업', { clubId, after: latestIdRef.current });
        try {
          const page = await listClubChat(String(clubId), { after: latestIdRef.current, limit: CHAT_LIMIT });
          if (page.messages.length) {
            setMessages((prev) => {
              const seen = new Set(prev.map((m) => m.id));
              return [...page.messages.filter((m) => !seen.has(m.id)), ...prev];
            });
            setLatest(page.messages);
            markClubChatRead(String(clubId));
          }
        } catch (err: any) {
          console.error('[Club] 캐치업 실패', { clubId, status: err?.response?.status });
        }
      }
    });
    return unsub;
  }, [clubId, appendMessage]);

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      const m = await sendClubChat(String(clubId), t);
      setText('');
      if (m) appendMessage(m);
    } catch (err: any) {
      const status = err?.response?.status;
      const code = getClubErrorCode(err);
      console.error('[Club] 채팅 송신 실패', { clubId, status, code });
      // 어린이 403 child_restricted 는 api 인터셉터가 서버 문구로 안내(이중 팝업 방지)
      if (isChildRestrictedError(err)) return;
      showAlert('알림', chatSendErrorMessage(code, status));
    } finally {
      setSending(false);
    }
  };

  const doDelete = async (m: ClubChatMessage) => {
    try {
      await deleteClubChatMessage(String(clubId), m.id);
      console.info('[Club] 채팅 메시지 삭제', { clubId, messageId: m.id });
      // 소프트 삭제 반영 — 자리 유지 + '삭제된 메시지예요'
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, deleted: true, text: null } : x)));
    } catch (err: any) {
      console.error('[Club] 채팅 삭제 실패', { clubId, messageId: m.id, status: err?.response?.status });
      showAlert('오류', '메시지를 삭제하지 못했어요. 잠시 후 다시 시도해주세요.');
    }
  };

  // 롱프레스 메뉴 — 본인·owner=삭제 / 타인=신고 (deleted 는 메뉴 없음)
  const openMessageMenu = (m: ClubChatMessage) => {
    if (m.deleted) return;
    const mine = !!user && String(m.sender_id) === String(user.id);
    const buttons: AppAlertButton[] = [];
    if (!mine) buttons.push({ text: '신고하기', onPress: () => setReportMsg(m) });
    if (mine || isOwner) {
      buttons.push({
        text: '삭제', style: 'destructive',
        onPress: () => showAlert('메시지 삭제', '이 메시지를 삭제할까요? 모두에게 삭제된 메시지로 보여요.', [
          { text: '취소', style: 'cancel' },
          { text: '삭제', style: 'destructive', onPress: () => doDelete(m) },
        ]),
      });
    }
    if (!buttons.length) return;
    buttons.push({ text: '취소', style: 'cancel' });
    if (__DEV__) console.info('[Club] 채팅 메시지 메뉴', { messageId: m.id, mine, isOwner: !!isOwner });
    showAlert('메시지', `${m.sender_nickname || '멤버'}님의 메시지`, buttons);
  };

  const renderMsg = ({ item }: { item: ClubChatMessage }) => {
    const mine = !!user && String(item.sender_id) === String(user.id);
    return (
      <View style={[styles.msgRow, mine ? styles.msgRowMine : styles.msgRowPeer]}>
        {/* 발신자 — 아바타 없음, 닉네임 텍스트(타인만) */}
        {!mine ? (
          <AppText variant="caption" tone="muted" style={styles.senderName} numberOfLines={1}>
            {item.sender_nickname || '멤버'}
          </AppText>
        ) : null}
        <TouchableOpacity
          activeOpacity={0.8}
          onLongPress={() => openMessageMenu(item)}
          delayLongPress={350}
          accessibilityLabel={`채팅 메시지 ${item.sender_nickname || '멤버'}`}
        >
          <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubblePeer, item.deleted && styles.bubbleDeleted]}>
            {item.deleted ? (
              <AppText variant="footnote" tone="muted">삭제된 메시지예요</AppText>
            ) : (
              <AppText variant="footnote" style={mine ? styles.textMine : null}>{item.text || ''}</AppText>
            )}
          </View>
        </TouchableOpacity>
        <AppText variant="caption" tone="muted" style={styles.msgClock}>{fmtClock(item.created_at)}</AppText>
      </View>
    );
  };

  // 본문 — 로딩/강등/목록 (403: 비멤버 게이트 문구, 404 구서버·네트워크: 공통 안내)
  const body = loading ? (
    <ActivityIndicator size="large" color={colors.accent.primary} style={{ marginTop: 60 }} />
  ) : loadError === 'forbidden' ? (
    <EmptyState
      icon={<Feather name="lock" size={44} color={colors.text.muted} />}
      title={`${CLUB_LABEL} 멤버만 채팅에 참여할 수 있어요`}
      hint={`${CLUB_LABEL} 홈에서 가입 신청 후 다시 들어와주세요.`}
      action={<Button label="돌아가기" variant="tonal" onPress={() => navigation.goBack()} />}
    />
  ) : loadError === 'failed' ? (
    <EmptyState
      icon={<Feather name="cloud-off" size={44} color={colors.text.muted} />}
      title="채팅을 불러오지 못했어요"
      hint="잠시 후 다시 시도해주세요."
      action={<Button label="다시 시도" variant="tonal" onPress={() => { setLoading(true); load(); }} />}
    />
  ) : messages.length === 0 ? (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <AppText variant="footnote" tone="muted" center>
        아직 메시지가 없어요.{'\n'}멤버들과 첫 인사를 나눠보세요!
      </AppText>
    </View>
  ) : (
    <FlatList
      data={messages}
      inverted
      keyExtractor={(m) => m.id}
      renderItem={renderMsg}
      contentContainerStyle={{ padding: spacing.lg }}
      style={{ flex: 1 }}
      onEndReached={loadOlder}
      onEndReachedThreshold={0.4}
      ListFooterComponent={loadingMore
        ? <ActivityIndicator size="small" color={colors.accent.primary} style={{ marginVertical: spacing.md }} />
        : null}
    />
  );

  return (
    // DmChat v3.207(⑤) 관행 그대로 — keyboard-controller KAV(behavior='padding') + 내부 insets.bottom
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior="padding"
      keyboardVerticalOffset={-insets.bottom}
    >
      <View style={{ flex: 1, paddingBottom: insets.bottom }}>
        {/* 헤더 — 네이티브 상단바 규격(높이 56, DmChat 관행) */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="뒤로" style={{ padding: 4 }}>
            <Feather name="arrow-left" size={22} color={colors.text.primary} />
          </TouchableOpacity>
          <View style={styles.headerIcon}>
            <Feather name="message-circle" size={16} color={colors.accent.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong" numberOfLines={1}>{name || `${CLUB_LABEL} 채팅`}</AppText>
            <AppText variant="caption" tone="muted">{`${CLUB_LABEL} 채팅`}</AppText>
          </View>
        </View>

        {body}

        {/* 입력바 — 어린이는 숨김+안내(서버 403 child_restricted 계약, 왕복 자체 제거) */}
        {loadError ? null : isChild ? (
          <View style={styles.childNotice}>
            <Feather name="info" size={14} color={colors.text.muted} />
            <AppText variant="caption" tone="secondary" style={{ flex: 1 }}>
              어린이 계정은 채팅 메시지를 보낼 수 없어요. 대화는 볼 수 있어요.
            </AppText>
          </View>
        ) : (
          <View style={styles.inputBar}>
            <TextInput
              style={styles.input}
              placeholder="메시지 입력..."
              placeholderTextColor={colors.text.muted}
              value={text}
              onChangeText={setText}
              maxLength={CHAT_TEXT_MAX}
              multiline
              editable={!loading}
            />
            <TouchableOpacity
              onPress={send}
              disabled={sending || !text.trim()}
              accessibilityLabel="보내기"
              style={{ padding: 6 }}
            >
              <Feather name="send" size={20} color={text.trim() ? colors.accent.primary : colors.text.muted} />
            </TouchableOpacity>
          </View>
        )}

        {/* 타인 메시지 신고 — 기존 ReportModal 재사용(targetType 'club_message' + 크루 컨텍스트) */}
        <ReportModal
          visible={!!reportMsg}
          targetType="club_message"
          targetId={reportMsg?.id || ''}
          clubId={String(clubId ?? '')}
          onClose={() => setReportMsg(null)}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  // 자체 헤더 — 네이티브 상단바 규격 56 고정(DmChat v3.216 ② 관행, 고정 paddingTop 금지)
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    height: 56, paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  headerIcon: {
    width: 28, height: 28, borderRadius: radius.md,
    backgroundColor: colors.bg.surface2, alignItems: 'center', justifyContent: 'center',
  },
  msgRow: { marginBottom: spacing.md, maxWidth: '80%' },
  msgRowMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  msgRowPeer: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  senderName: { marginBottom: 2, maxWidth: 200 },
  bubble: { borderRadius: radius.lg, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  bubbleMine: { backgroundColor: colors.accent.primary },
  bubblePeer: { backgroundColor: colors.bg.surface1 },
  // 삭제 메시지 — 회색 톤(배경 유지·보더만 미묘하게)
  bubbleDeleted: { backgroundColor: colors.bg.surface1, opacity: 0.6 },
  textMine: { color: '#fff' },
  msgClock: { marginTop: 2 },
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm,
    margin: spacing.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: colors.bg.surface1, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  input: { flex: 1, color: colors.text.primary, maxHeight: 100, padding: 0 },
  // 어린이 안내 행 — Community childNotice 관행(입력바 자리)
  childNotice: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    margin: spacing.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    backgroundColor: colors.bg.surface1, borderRadius: radius.lg,
  },
});
