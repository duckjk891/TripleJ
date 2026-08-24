// [Fab] 화면 우하단 공용 플로팅 버튼 — 차트(+)·피드(글쓰기) 위치·크기·그림자 통일(v3.62).
// v3.66: 미니플레이어와 무관하게 **하단바 기준 6px 위 고정**(사용자 확정 스펙).
//        재생 중엔 미니플레이어가 이 자리를 덮으므로 버튼은 자연히 가려진다(의도된 동작).
import { ReactNode } from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';

const GAP_ABOVE_BAR = 6; // 하단바 위 간격

interface Props {
  onPress: () => void;
  children: ReactNode;          // 아이콘(텍스트 '+' 또는 Feather 등)
  accessibilityLabel: string;
}

export default function Fab({ onPress, children, accessibilityLabel }: Props) {
  return (
    <TouchableOpacity style={styles.fab} onPress={onPress} activeOpacity={0.85} accessibilityLabel={accessibilityLabel}>
      {children}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute', bottom: GAP_ABOVE_BAR, right: spacing.xl,
    width: 56, height: 56, borderRadius: radius.pill,
    backgroundColor: colors.accent.primary, justifyContent: 'center', alignItems: 'center',
    shadowColor: colors.accent.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 8,
  },
});
