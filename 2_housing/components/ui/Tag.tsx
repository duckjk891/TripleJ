// [ui/Tag] 칩(필터/장르). Spotify식 가로 스크롤 칩 필터에 사용. selected 상태 강조.
import { Pressable, StyleSheet, PressableProps } from 'react-native';
import AppText from './AppText';
import { colors } from '../../theme/colors';
import { spacing, radius } from '../../theme/spacing';

export interface TagProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  selected?: boolean;
  size?: 'sm' | 'md';
}

export default function Tag({ label, selected, size = 'md', ...rest }: TagProps) {
  const pv = size === 'sm' ? spacing.xxs : spacing.xs;
  return (
    <Pressable style={[styles.base, { paddingVertical: pv }, selected ? styles.selected : styles.default]} {...rest}>
      <AppText variant={size === 'sm' ? 'caption' : 'footnote'} tone={selected ? 'primary' : 'secondary'}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, alignSelf: 'flex-start' },
  default: { borderColor: colors.border.default, backgroundColor: colors.bg.surface1 },
  selected: { borderColor: colors.accent.primary, backgroundColor: colors.bg.surface2 },
});
