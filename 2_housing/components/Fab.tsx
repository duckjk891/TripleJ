// [Fab] 화면 우하단 공용 플로팅 버튼 — v3.62: 차트(+)와 피드(글쓰기) 위치·크기·그림자 통일.
// v3.63: 미니플레이어가 떠 있으면 숨기는 대신 그 위로 들어올린다 — 재생 중에도 항상 보이도록.
// v3.64: 기준점 = 하단바(미니플레이어 포함) 윗부분에서 살짝(12px) 위 — 낮고 가깝게.
import { ReactNode } from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { usePlayerStore } from '../stores/playerStore';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';

const MINI_PLAYER_HEIGHT = 70;
const GAP_ABOVE_BAR = 6; // 하단바(또는 미니플레이어) 위 간격 — v3.65: 12→6, 더 붙게

interface Props {
  onPress: () => void;
  children: ReactNode;          // 아이콘(텍스트 '+' 또는 Feather 등)
  accessibilityLabel: string;
}

export default function Fab({ onPress, children, accessibilityLabel }: Props) {
  const hasMiniPlayer = !!usePlayerStore((s) => s.track);
  return (
    <TouchableOpacity
      style={[styles.fab, hasMiniPlayer && { bottom: GAP_ABOVE_BAR + MINI_PLAYER_HEIGHT }]}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityLabel={accessibilityLabel}
    >
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
