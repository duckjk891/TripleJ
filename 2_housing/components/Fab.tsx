// [Fab] 화면 우하단 공용 플로팅 버튼 — 차트(+)·피드(글쓰기) 위치·크기·그림자 통일(v3.62).
// v3.67 확정 스펙: 하단바 위 12px 고정, 미니플레이어(재생 중)가 있으면 숨김(원래 차트 동작).
import { ReactNode } from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { usePlayerStore } from '../stores/playerStore';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';

const GAP_ABOVE_BAR = 12; // 하단바 위 간격

interface Props {
  onPress: () => void;
  children: ReactNode;          // 아이콘(텍스트 '+' 또는 Feather 등)
  accessibilityLabel: string;
}

export default function Fab({ onPress, children, accessibilityLabel }: Props) {
  const hasMiniPlayer = !!usePlayerStore((s) => s.track);
  if (hasMiniPlayer) return null; // 재생 중엔 숨김 — 미니플레이어 영역과 겹치지 않게
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
