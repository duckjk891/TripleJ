// [ui/Button] Material 3 버튼(filled/tonal/outline/text) — stadium(pill) 형태, 최소 터치 44.
import { ReactNode } from 'react';
import { Pressable, StyleSheet, View, ActivityIndicator, PressableProps } from 'react-native';
import AppText from './AppText';
import { colors } from '../../theme/colors';
import { spacing, radius, layout } from '../../theme/spacing';

type Variant = 'filled' | 'tonal' | 'outline' | 'text';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
  leading?: ReactNode;
}

const SIZE: Record<Size, { pv: number; ph: number; text: 'bodyStrong' | 'callout' | 'subtitle' }> = {
  sm: { pv: spacing.xs, ph: spacing.md, text: 'bodyStrong' },
  md: { pv: spacing.sm + 2, ph: spacing.lg, text: 'callout' },
  lg: { pv: spacing.md, ph: spacing.xl, text: 'subtitle' },
};

export default function Button({
  label, variant = 'filled', size = 'md', loading, disabled, fullWidth, leading, ...rest
}: ButtonProps) {
  const s = SIZE[size];
  const isDisabled = disabled || loading;
  const fgTone = variant === 'filled' ? 'primary' : 'accent';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        { paddingVertical: s.pv, paddingHorizontal: s.ph, minHeight: layout.minTouchTarget },
        variant === 'filled' && { backgroundColor: pressed ? colors.accent.primaryDim : colors.accent.primary },
        variant === 'tonal' && { backgroundColor: pressed ? colors.bg.surface3 : colors.bg.surface2 },
        variant === 'outline' && { borderWidth: 1, borderColor: colors.border.accent, backgroundColor: pressed ? colors.bg.surface1 : 'transparent' },
        variant === 'text' && { backgroundColor: 'transparent' },
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'filled' ? colors.text.primary : colors.accent.primary} />
      ) : (
        <View style={styles.content}>
          {leading}
          <AppText variant={s.text} tone={fgTone}>{label}</AppText>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  content: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  fullWidth: { alignSelf: 'stretch' },
  disabled: { opacity: 0.45 },
});
