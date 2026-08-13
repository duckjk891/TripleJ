// [StarGuideModal] 별(⭐) 안내 — 헤더 별 배지 클릭 시 "별 모으는 법" 팝업(별정책.txt 기반).
// 각 항목 클릭 시 해당 기능으로 이동/실행: 친구초대→공유, 출석체크→출석팝업, 남곡듣기→차트, 내곡발매→작업실.
import { Modal, View, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useUiStore } from '../stores/uiStore';
import { usePointsStore } from '../stores/pointsStore';
import { navigateGlobal } from '../services/navigationRef';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { AppText } from './ui';

// 버는 곳 — 별정책.txt (첫가입 보너스 ~ 내곡 발매). action 이 있으면 클릭 가능.
type EarnAction = 'invite' | 'attendance' | 'chart' | 'studio';
const EARN_ROWS: { icon: string; label: string; amount: string; sub?: string; action?: EarnAction }[] = [
  { icon: '🎉', label: '첫 가입 보너스', amount: '+50', sub: '한 번만' },
  { icon: '🛡️', label: '본인·보호자 인증', amount: '+30', sub: '한 번만' },
  { icon: '👥', label: '친구 초대', amount: '+50', sub: '눌러서 공유하기', action: 'invite' },
  { icon: '📅', label: '매일 출석체크', amount: '+10', sub: '5일차 +30 · 10일차 +100', action: 'attendance' },
  { icon: '🎧', label: '남의 곡 듣기', amount: '+1', sub: '눌러서 차트로 이동', action: 'chart' },
  { icon: '🚀', label: '내 곡 발매', amount: '+5', sub: '눌러서 작업실로 이동', action: 'studio' },
];

export default function StarGuideModal() {
  const open = useUiStore((s) => s.starGuideOpen);
  const close = useUiStore((s) => s.closeStarGuide);
  const openInvite = useUiStore((s) => s.openInvite);
  const openAttendance = useUiStore((s) => s.openAttendance);
  const balance = usePointsStore((s) => s.balance);

  const handleAction = (action?: EarnAction) => {
    if (!action) return;
    if (__DEV__) console.info('[StarGuideModal] action', { action });
    close(); // 별 안내 먼저 닫고 실행/이동
    switch (action) {
      case 'invite': openInvite(); break;
      case 'attendance': openAttendance(); break;
      case 'chart': navigateGlobal('Chart'); break;
      case 'studio': navigateGlobal('Studio'); break;
    }
  };

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={close}>
        <TouchableOpacity style={styles.modal} activeOpacity={1} onPress={() => {}}>
          <View style={styles.head}>
            <AppText variant="title2">⭐ 별 모으는 법</AppText>
            <TouchableOpacity onPress={close} accessibilityLabel="닫기">
              <AppText variant="title3" tone="muted">✕</AppText>
            </TouchableOpacity>
          </View>

          {/* 내 별 잔액 */}
          <View style={styles.balanceBox}>
            <AppText variant="footnote" tone="secondary">내 별</AppText>
            <AppText variant="title1" tone="accent">⭐ {balance ?? 0}</AppText>
          </View>

          {EARN_ROWS.map((r) => {
            const pressable = !!r.action;
            const Row: any = pressable ? TouchableOpacity : View;
            return (
              <Row
                key={r.label}
                style={styles.row}
                {...(pressable ? { onPress: () => handleAction(r.action), accessibilityLabel: r.label, activeOpacity: 0.7 } : {})}
              >
                <AppText variant="body" style={styles.rowIcon}>{r.icon}</AppText>
                <View style={styles.rowMid}>
                  <AppText variant="body">{r.label}</AppText>
                  {r.sub ? <AppText variant="caption" tone={pressable ? 'accent' : 'muted'}>{r.sub}</AppText> : null}
                </View>
                <AppText variant="body" tone="accent">{r.amount}</AppText>
                {pressable ? <Feather name="chevron-right" size={16} color={colors.text.muted} /> : null}
              </Row>
            );
          })}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  modal: { width: '100%', maxWidth: 380, backgroundColor: colors.bg.surface1, borderRadius: radius.xxl, padding: spacing.xl },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  balanceBox: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.bg.deepest, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border.accent,
    paddingVertical: spacing.md, paddingHorizontal: spacing.lg, marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border.subtle,
  },
  rowIcon: { width: 26, textAlign: 'center' },
  rowMid: { flex: 1 },
});
