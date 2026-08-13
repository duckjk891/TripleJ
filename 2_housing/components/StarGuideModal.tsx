// [StarGuideModal] 별(⭐) 안내 — 헤더 별 배지 클릭 시 "별 버는/쓰는 법" 팝업.
// 별정책.txt(별 경제 v1.2) 기반. 쓰는 곳 금액은 GET /points/costs 로 실시간 반영(폴백: 정책 기본값).
import { useState, useEffect } from 'react';
import { Modal, View, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import api from '../services/api';
import { useUiStore } from '../stores/uiStore';
import { usePointsStore } from '../stores/pointsStore';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { AppText } from './ui';

// 버는 곳 — 별정책.txt 고정 항목
const EARN_ROWS: { icon: string; label: string; amount: string; sub?: string }[] = [
  { icon: '🎉', label: '첫 가입 보너스', amount: '+50', sub: '한 번만' },
  { icon: '🛡️', label: '본인·보호자 인증', amount: '+30', sub: '한 번만' },
  { icon: '👥', label: '친구 초대', amount: '+50', sub: '나 +50 · 친구 +50' },
  { icon: '📅', label: '매일 출석체크', amount: '+10', sub: '5일차 +30 · 10일차 +100' },
  { icon: '🎧', label: '남의 곡 듣기', amount: '+1', sub: '하루 5곡까지' },
  { icon: '🚀', label: '내 곡 발매', amount: '+5', sub: '곡당' },
];

// 쓰는 곳 — costs 키 → 표시 라벨/아이콘 (금액은 API 우선)
const SPEND_META: { key: string; icon: string; label: string; fallback: number }[] = [
  { key: 'lyrics', icon: '✍️', label: '작사', fallback: 5 },
  { key: 'compose', icon: '🎵', label: '작곡', fallback: 15 },
  { key: 'cover', icon: '🖼️', label: '커버(이미지)', fallback: 5 },
  { key: 'character', icon: '👤', label: '아티스트 생성', fallback: 10 },
  { key: 'fatigue_skip', icon: '⏰', label: '디렉터 피로 스킵', fallback: 5 },
];

export default function StarGuideModal() {
  const open = useUiStore((s) => s.starGuideOpen);
  const close = useUiStore((s) => s.closeStarGuide);
  const balance = usePointsStore((s) => s.balance);
  const [costs, setCosts] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    if (__DEV__) console.info('[StarGuideModal] open — load /points/costs');
    (async () => {
      try {
        const { data } = await api.get('/points/costs');
        if (!cancelled) setCosts(data?.costs || null);
      } catch (err: any) {
        // 실패해도 폴백(정책 기본값)으로 표시 — 조용히
        console.error('[StarGuideModal] costs 실패', { status: err?.response?.status });
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  const costOf = (key: string, fallback: number) =>
    costs && typeof costs[key] === 'number' ? costs[key] : fallback;
  const fullCycle = costOf('lyrics', 5) + costOf('compose', 15) + costOf('cover', 5);

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={close}>
        <TouchableOpacity style={styles.modal} activeOpacity={1} onPress={() => {}}>
          <View style={styles.head}>
            <AppText variant="title2">⭐ 별 안내</AppText>
            <TouchableOpacity onPress={close} accessibilityLabel="닫기">
              <AppText variant="title3" tone="muted">✕</AppText>
            </TouchableOpacity>
          </View>

          {/* 내 별 잔액 */}
          <View style={styles.balanceBox}>
            <AppText variant="footnote" tone="secondary">내 별</AppText>
            <AppText variant="title1" tone="accent">⭐ {balance ?? 0}</AppText>
          </View>

          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            {/* 버는 곳 */}
            <AppText variant="title3" style={styles.sectionTitle}>⭐ 별 모으는 법</AppText>
            {EARN_ROWS.map((r) => (
              <View key={r.label} style={styles.row}>
                <AppText variant="body" style={styles.rowIcon}>{r.icon}</AppText>
                <View style={styles.rowMid}>
                  <AppText variant="body">{r.label}</AppText>
                  {r.sub ? <AppText variant="caption" tone="muted">{r.sub}</AppText> : null}
                </View>
                <AppText variant="body" tone="accent">{r.amount}</AppText>
              </View>
            ))}

            {/* 쓰는 곳 */}
            <AppText variant="title3" style={[styles.sectionTitle, styles.sectionGap]}>🎬 별 쓰는 곳 (디렉터 업무지시)</AppText>
            {SPEND_META.map((m) => (
              <View key={m.key} style={styles.row}>
                <AppText variant="body" style={styles.rowIcon}>{m.icon}</AppText>
                <View style={styles.rowMid}>
                  <AppText variant="body">{m.label}</AppText>
                </View>
                <AppText variant="body" tone="secondary">-{costOf(m.key, m.fallback)}</AppText>
              </View>
            ))}
            <View style={styles.cycleBox}>
              <AppText variant="footnote" tone="secondary" center>
                곡 1개 풀사이클(작사+작곡+커버) = <AppText variant="footnote" tone="primary">-{fullCycle}</AppText>
              </AppText>
            </View>

            <AppText variant="caption" tone="muted" center style={styles.tip}>
              하루 평균 +31을 모으면 곡 1개는 거의 무료! 매일 출석하고 친구를 초대해 별을 모아보세요.
            </AppText>
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  modal: { width: '100%', maxWidth: 380, maxHeight: '85%', backgroundColor: colors.bg.surface1, borderRadius: radius.xxl, padding: spacing.xl },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  balanceBox: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.bg.deepest, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border.accent,
    paddingVertical: spacing.md, paddingHorizontal: spacing.lg, marginBottom: spacing.md,
  },
  scroll: { flexGrow: 0 },
  sectionTitle: { marginBottom: spacing.sm },
  sectionGap: { marginTop: spacing.lg },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border.subtle,
  },
  rowIcon: { width: 26, textAlign: 'center' },
  rowMid: { flex: 1 },
  cycleBox: {
    marginTop: spacing.md, backgroundColor: colors.bg.surface2, borderRadius: radius.md,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
  },
  tip: { marginTop: spacing.lg },
});
