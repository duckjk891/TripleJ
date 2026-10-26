// v3.410 [StorySong] 완성 화면 카드 — 낙서·사진에서 만든 노래를 낙서장에 남긴다(대표 확정 SP-1).
// 낙서에서 시작했거나 '낙서장에도 남기기'를 켰으면 → '이 낙서에 노래 붙이기'(그 낙서에 곡 블록 추가),
// 아니면 → '낙서장에 남기기'(이 곡을 붙인 새 낙서 쓰기). 기록에서 온 곡이 아니면(맥락 없음) 아무것도 안 보인다.
import { useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AppText } from './ui';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { clearStorySong, loadLinkedStorySong, type StorySongContext } from '../utils/storySong';
import { attachSongToDiary } from '../services/storySongService';
import { showAlert } from '../utils/appAlert';

export default function StorySongDiaryCard({ trackId, navigation }: { trackId: string | null; navigation: any }) {
  const [ctx, setCtx] = useState<StorySongContext | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    loadLinkedStorySong().then((c) => { if (alive) setCtx(c && !c.guest ? c : null); });
    return () => { alive = false; };
  }, [trackId]);

  if (!ctx) return null;
  if (!trackId) {
    // 아직 저장 전 — 무엇을 할 수 있는지만 먼저 보여 준다(버튼은 저장 뒤)
    return (
      <View style={[styles.card, styles.cardTop]}>
        <Feather name="book-open" size={18} color={colors.accent.secondary} />
        <View style={{ flex: 1 }}>
          <AppText style={styles.title}>{ctx.feedId ? '이 노래를 낙서에 붙일 수 있어요' : '이 노래를 낙서장에 남길 수 있어요'}</AppText>
          <AppText style={styles.sub}>마음에 드는 버전을 저장하면 여기에 버튼이 생겨요</AppText>
        </View>
      </View>
    );
  }

  const dismiss = () => { clearStorySong('dismissed'); setCtx(null); };

  const attach = async () => {
    if (busy || !ctx.feedId) return;
    setBusy(true);
    try {
      const r = await attachSongToDiary(ctx.feedId, trackId);
      console.info('[StorySong] 낙서에 노래 붙이기', { result: r });
      clearStorySong('attached');
      setCtx(null);
      showAlert('낙서장', r === 'already' ? '이 낙서에는 이미 노래가 붙어 있어요.' : '낙서에 노래를 붙였어요. 낙서를 열면 이 노래가 함께 보여요.', [
        { text: '확인', style: 'cancel' },
        { text: '낙서 보기', onPress: () => navigation.navigate('FeedDetail', { feedId: ctx.feedId }) },
      ]);
    } catch (err: any) {
      console.error('[StorySong] 낙서에 노래 붙이기 실패', { status: err?.response?.status });
      showAlert('낙서장', err?.response?.data?.error || '노래를 붙이지 못했어요. 잠시 후 다시 해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const writeNew = () => {
    clearStorySong('write_new_diary');
    setCtx(null);
    navigation.navigate('FeedCompose', { attachTrackId: trackId });
  };

  return (
    <View style={[styles.card, styles.cardTop]}>
      <Feather name="book-open" size={18} color={colors.accent.secondary} />
      <View style={{ flex: 1 }}>
        <AppText style={styles.title}>{ctx.feedId ? '이 낙서에 노래 붙이기' : '낙서장에 남기기'}</AppText>
        <AppText style={styles.sub}>{ctx.feedId ? '낙서를 열면 이 노래가 함께 보여요' : '오늘 이야기와 이 노래를 낙서로 남겨요'}</AppText>
      </View>
      <TouchableOpacity onPress={dismiss} style={styles.ghost} accessibilityLabel="괜찮아요">
        <AppText style={styles.ghostText}>괜찮아요</AppText>
      </TouchableOpacity>
      <TouchableOpacity onPress={ctx.feedId ? attach : writeNew} style={[styles.main, busy && { opacity: 0.6 }]} disabled={busy}
        accessibilityLabel={ctx.feedId ? '이 낙서에 노래 붙이기' : '낙서장에 남기기'}>
        <AppText style={styles.mainText}>{ctx.feedId ? '붙이기' : '남기기'}</AppText>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md,
    padding: spacing.md, borderRadius: radius.xl, borderWidth: 1, borderColor: 'rgba(251,191,36,0.5)',
    backgroundColor: 'rgba(251,191,36,0.08)',
  },
  cardTop: { marginTop: 0, marginBottom: spacing.md },
  title: { fontSize: 14, fontWeight: '800', color: colors.text.primary },
  sub: { fontSize: 11.5, color: colors.text.secondary, marginTop: 1 },
  ghost: { paddingVertical: 7, paddingHorizontal: 10 },
  ghostText: { fontSize: 12, color: colors.text.muted },
  main: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.accent.secondaryDim },
  mainText: { fontSize: 13, fontWeight: '800', color: '#fff' },
});
