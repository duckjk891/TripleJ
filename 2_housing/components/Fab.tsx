// [Fab] 화면 우하단 공용 플로팅 버튼 — v3.62: 차트(+)와 피드(글쓰기) 위치·크기·그림자 통일.
// 스펙은 기존 차트 FAB 기준(56×56, bottom/right spacing.xl, 보라 그림자).
import { ReactNode } from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';

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
    position: 'absolute', bottom: spacing.xl, right: spacing.xl,
    width: 56, height: 56, borderRadius: radius.pill,
    backgroundColor: colors.accent.primary, justifyContent: 'center', alignItems: 'center',
    shadowColor: colors.accent.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 8,
  },
});
