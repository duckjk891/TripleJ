// [StarGuideModal] 스타(⭐) 안내 — 헤더 배지 클릭 시 팝업. v3.58: 재화명 '별'→'스타' 리브랜딩,
// '모으는 법'·'내 별' 문구 제거(사용자 지시). 각 항목 클릭 시 해당 기능으로 이동/실행.
import { ReactNode } from 'react';
import { Modal, View, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useUiStore } from '../stores/uiStore';
import { usePointsStore } from '../stores/pointsStore';
import { navigateGlobal } from '../services/navigationRef';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { AppText } from './ui';
import { CURRENCY, CURRENCY_ICON } from '../constants/currency';

// 버는 곳 — 별정책.txt (첫가입 보너스 ~ 내곡 발매). action 이 있으면 클릭 가능.
// v3.194: 행 아이콘 이모지 → 벡터(Feather/MCI). ⭐ 재화 표기(CURRENCY_ICON·금액)는 유지.
type EarnAction = 'invite' | 'attendance' | 'chart' | 'studio';
const ROW_ICON_SIZE = 18;
const ROW_ICON_COLOR = colors.text.secondary;
const EARN_ROWS: { icon: ReactNode; label: string; amount: string; sub?: string; action?: EarnAction }[] = [
  { icon: <Feather name="gift" size={ROW_ICON_SIZE} color={ROW_ICON_COLOR} />, label: '첫 가입 보너스', amount: '+50', sub: '한 번만' },
  { icon: <Feather name="shield" size={ROW_ICON_SIZE} color={ROW_ICON_COLOR} />, label: '보호자 동의 완료', amount: '+30', sub: '만 14세 미만 · 한 번만' }, // v3.230 A8: 본인인증 유도 제거(추후 적용)
  { icon: <Feather name="users" size={ROW_ICON_SIZE} color={ROW_ICON_COLOR} />, label: '친구 초대', amount: '+50', sub: '눌러서 공유하기', action: 'invite' },
  { icon: <Feather name="calendar" size={ROW_ICON_SIZE} color={ROW_ICON_COLOR} />, label: '매일 출석체크', amount: '+10', sub: '5일차 +30 · 10일차 +100', action: 'attendance' },
  { icon: <Feather name="headphones" size={ROW_ICON_SIZE} color={ROW_ICON_COLOR} />, label: '남의 곡 듣기', amount: '+1', sub: '눌러서 차트로 이동', action: 'chart' },
  { icon: <MaterialCommunityIcons name="rocket-launch-outline" size={ROW_ICON_SIZE} color={ROW_ICON_COLOR} />, label: '내 곡 발매', amount: '+5', sub: '눌러서 작업실로 이동', action: 'studio' },
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
            <AppText variant="title2">{CURRENCY_ICON} {CURRENCY}</AppText>
            <TouchableOpacity onPress={close} accessibilityLabel="닫기">
              <Feather name="x" size={20} color={colors.text.muted} />
            </TouchableOpacity>
          </View>

          {/* 보유 잔액 */}
          <View style={styles.balanceBox}>
            <AppText variant="footnote" tone="secondary">보유 {CURRENCY}</AppText>
            <AppText variant="title1" tone="accent">{CURRENCY_ICON} {balance ?? 0}</AppText>
          </View>

          {/* v3.230 A7-3(D8): 스타 내역 화면 진입 */}
          <TouchableOpacity
            style={styles.historyBtn}
            onPress={() => {
              console.info('[StarHistory] 안내 팝업 내역 보기 탭');
              close();
              navigateGlobal('StarHistory');
            }}
            accessibilityLabel="스타 내역 보기"
            activeOpacity={0.7}
          >
            <Feather name="list" size={14} color={colors.text.secondary} />
            <AppText variant="footnote" tone="secondary">내역 보기</AppText>
            <Feather name="chevron-right" size={14} color={colors.text.muted} />
          </TouchableOpacity>

          {EARN_ROWS.map((r) => {
            const pressable = !!r.action;
            const Row: any = pressable ? TouchableOpacity : View;
            return (
              <Row
                key={r.label}
                style={styles.row}
                {...(pressable ? { onPress: () => handleAction(r.action), accessibilityLabel: r.label, activeOpacity: 0.7 } : {})}
              >
                <View style={styles.rowIcon}>{r.icon}</View>
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
  historyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4,
    paddingVertical: spacing.xs, marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border.subtle,
  },
  rowIcon: { width: 26, alignItems: 'center' },
  rowMid: { flex: 1 },
});
