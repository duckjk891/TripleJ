// v3.410 [StorySong] 이런 마음이 보여요 — 감정·키워드·'멈춰 있는 마음'·'풀어낼 방향' + 추천 3개 + 반전 1개(대표 확정 SP-1).
// 고른 추천을 작사 작업본(lyricsStore)에 채우고 기존 '작사 요청 정리' 화면(LyricsPromptReview)으로 — 게스트 체험·휴식·⭐5 확인은 그대로.
// 반전 추천은 추천 3개 아래 금색 점선 카드로 항상 보인다(결정 4). 힘든 마음 신호(care)면 상담 안내를 먼저 앱 안 창으로(결정 7).
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { AppText, Tag } from '../components/ui';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { useLyricsStore } from '../stores/lyricsStore';
import { useMusicStore } from '../stores/musicStore';
import { armStorySong, getStoryAnalysis, STORY_TEXT } from '../utils/storySong';
import type { StoryPick } from '../services/storySongService';
import { showAlert } from '../utils/appAlert';
import type { StudioStackParamList } from '../App';

type Props = NativeStackScreenProps<StudioStackParamList, 'StorySongRead'>;

const DURATIONS = [{ v: 60, l: '1분' }, { v: 120, l: '2분' }, { v: 180, l: '3분' }];
const KIND_LABEL: Record<string, string> = { daily: '사진', book: '책', capture: '캡처' };

export default function StorySongReadScreen({ navigation, route }: Props) {
  const a = getStoryAnalysis();
  // v3.411 뒤로가기는 작업실 상단바(재료 담기와 같은 자리)
  useFocusEffect(
    useCallback(() => {
      navigation.getParent()?.setOptions({
        headerLeft: () => (
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginLeft: 12 }} accessibilityLabel="뒤로">
            <Feather name="arrow-left" size={22} color={colors.text.primary} />
          </TouchableOpacity>
        ),
      });
    }, [navigation])
  );
  const feedId = route.params?.feedId || null;
  const guest = !!route.params?.guest;
  const [picked, setPicked] = useState<string>('p1');
  const [duration, setDuration] = useState(120);

  useEffect(() => {
    if (a?.care) {
      console.info('[StorySong] 상담 안내 표시');
      showAlert(STORY_TEXT.careTitle, STORY_TEXT.careBody, [{ text: '이어서 보기' }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!a) {
    return (
      <View style={[styles.container, { paddingTop: spacing.xl, paddingHorizontal: spacing.lg }]}>
        <AppText tone="secondary">들여다본 결과가 없어요. 다시 해 주세요.</AppText>
        <TouchableOpacity style={[styles.cta, { marginTop: spacing.lg }]} onPress={() => navigation.goBack()}>
          <AppText style={styles.ctaText}>돌아가기</AppText>
        </TouchableOpacity>
      </View>
    );
  }

  const choose = (custom: boolean) => {
    const pick: StoryPick | undefined = custom ? undefined : [...a.picks, a.twist].find((p) => p.id === picked);
    const s = useLyricsStore.getState();
    s.reset(); // 이전 작업본 비움 — 들어올 때(재료 담기 진입) 진행 중 작업 확인을 거쳤다
    if (pick) {
      s.setGenre(pick.genre);
      s.setMood(pick.mood);
      s.setTempo(pick.tempo);
    }
    s.setContent(a.brief.topic || a.read.summary);
    s.setKeywords(a.brief.keywords || a.read.keywords.join(', '));
    if (a.brief.perspective) s.setPerspective(a.brief.perspective);
    if (a.brief.reference) s.setReference(a.brief.reference);
    s.setDuration(duration);
    s.setDraftCreationMode(useMusicStore.getState().creationMode);
    armStorySong({ analysisId: a.analysis_id, pick: pick?.id || 'custom', feedId, guest });
    console.info('[StorySong] 추천 선택 → 작사 요청 정리', { pick: pick?.id || 'custom', genre: pick?.genre ?? null, duration });
    navigation.navigate('LyricsPromptReview');
  };

  const PickCard = ({ p, twist }: { p: StoryPick; twist?: boolean }) => {
    const sel = picked === p.id;
    return (
      <TouchableOpacity
        style={[styles.pick, twist && styles.twist, sel && (twist ? styles.twistSel : styles.pickSel)]}
        onPress={() => setPicked(p.id)}
        accessibilityLabel={`${twist ? '반전 추천 ' : ''}${p.genre} ${p.mood}`}
        accessibilityState={{ selected: sel }}
      >
        {twist ? <AppText style={styles.twistTag}>반전 추천</AppText> : null}
        <View style={styles.pickHead}>
          <AppText variant="footnote" style={{ flex: 1, fontWeight: '700' }}>{p.genre} · {p.mood}</AppText>
          {sel ? <Feather name="check-circle" size={18} color={twist ? colors.accent.secondary : colors.accent.primaryGlow} /> : null}
        </View>
        <AppText variant="caption" tone="secondary">빠르기 {p.tempo}</AppText>
        <AppText variant="caption" style={{ color: colors.text.primary }}>{p.reason}</AppText>
      </TouchableOpacity>
    );
  };

  const maxStrength = Math.max(5, ...a.read.emotions.map((e) => e.strength));
  const notes: string[] = [];
  a.photos.forEach((p) => { if (p.caption) notes.push(`${KIND_LABEL[p.kind] || '사진'}: ${p.caption}`); });
  if (a.book?.title) notes.push(`책: 『${a.book.title}』${a.book.themes.length ? ` — ${a.book.themes.join(', ')}` : ''}`);
  if (a.weather?.label) notes.push(`날씨: ${a.weather.label}`);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <AppText variant="bodyStrong">{STORY_TEXT.readTitle}</AppText>

        <View style={styles.card}>
          <AppText variant="caption" tone="muted">한 줄로</AppText>
          <AppText variant="bodyStrong">{a.read.summary}</AppText>
        </View>

        <View style={styles.card}>
          <AppText variant="caption" tone="muted">감정</AppText>
          {a.read.emotions.map((e) => (
            <View key={e.label} style={styles.meterRow}>
              <AppText variant="footnote" style={styles.meterLabel}>{e.label}</AppText>
              <View style={styles.meterTrack}><View style={[styles.meterFill, { width: `${Math.round((e.strength / maxStrength) * 100)}%` }]} /></View>
            </View>
          ))}
          <View style={styles.chipRow}>
            {a.read.keywords.map((k) => <Tag key={k} size="sm" label={k} />)}
          </View>
        </View>

        <View style={[styles.card, styles.stuck]}>
          <AppText variant="caption" tone="muted">멈춰 있는 마음</AppText>
          <AppText variant="footnote">{a.read.stuck}</AppText>
          <AppText variant="caption" tone="muted" style={{ marginTop: spacing.xs }}>노래로 풀어낼 방향</AppText>
          <AppText variant="footnote">{a.read.release}</AppText>
        </View>

        {notes.length ? (
          <View style={{ gap: 2 }}>
            {notes.map((n) => <AppText key={n} variant="caption" tone="muted">{n}</AppText>)}
          </View>
        ) : null}

        <AppText variant="bodyStrong" style={{ marginTop: spacing.xs }}>어떤 노래로 할까요?</AppText>
        {a.picks.map((p) => <PickCard key={p.id} p={p} />)}
        <PickCard p={a.twist} twist />

        <View style={styles.optRow}>
          <AppText variant="footnote" tone="secondary">길이</AppText>
          {DURATIONS.map((d) => <Tag key={d.v} size="sm" label={d.l} selected={duration === d.v} onPress={() => setDuration(d.v)} />)}
          <View style={{ flex: 1 }} />
          <Tag size="sm" label="직접 고르기" onPress={() => choose(true)} />
        </View>

        <TouchableOpacity style={styles.cta} onPress={() => choose(false)} accessibilityLabel="이 느낌으로 가사 쓰기">
          <AppText style={styles.ctaText}>이 느낌으로 가사 쓰기</AppText>
          <AppText style={styles.ctaSub}>{guest ? '무료 체험으로 가사까지' : '다음 화면에서 한 번 더 확인해요 · ⭐5'}</AppText>
        </TouchableOpacity>
        <View style={{ height: 96 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  card: {
    backgroundColor: colors.bg.surface1, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border.default,
    padding: spacing.md, gap: spacing.xs,
  },
  stuck: { borderLeftWidth: 3, borderLeftColor: colors.accent.secondary },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  meterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  meterLabel: { width: 56 },
  meterTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.bg.surface2, overflow: 'hidden' },
  meterFill: { height: 6, borderRadius: 3, backgroundColor: colors.accent.primary },
  pick: {
    backgroundColor: colors.bg.surface1, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border.default,
    padding: spacing.md, gap: 2,
  },
  pickSel: { borderColor: colors.accent.primary, backgroundColor: colors.bg.surface2 },
  twist: { borderStyle: 'dashed', borderColor: colors.accent.secondary, backgroundColor: 'rgba(251,191,36,0.07)' },
  twistSel: { borderWidth: 2, borderStyle: 'solid' },
  twistTag: { fontSize: 11, fontWeight: '700', color: colors.accent.secondary, letterSpacing: 0.5 },
  pickHead: { flexDirection: 'row', alignItems: 'center' },
  optRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
  cta: { marginTop: spacing.sm, borderRadius: radius.xl, paddingVertical: spacing.md, alignItems: 'center', backgroundColor: colors.accent.primaryDim },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  ctaSub: { color: 'rgba(255,255,255,0.85)', fontSize: 11, marginTop: 2 },
});
