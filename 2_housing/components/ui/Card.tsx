// [ui/Card] Material 3 카드(filled=tonal surface / outlined). 무거운 그림자 대신 surface 톤.
import { View, ViewProps, StyleSheet } from 'react-native';
import { colors } from '../../theme/colors';
import { spacing, radius } from '../../theme/spacing';

export interface CardProps extends ViewProps {
  variant?: 'filled' | 'outlined';
  padded?: boolean;
}

export default function Card({ variant = 'filled', padded = true, style, ...rest }: CardProps) {
  return (
    <View
      {...rest}
      style={[styles.base, padded && styles.padded, variant === 'filled' ? styles.filled : styles.outlined, style]}
    />
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.xl },
  padded: { padding: spacing.lg },
  filled: { backgroundColor: colors.bg.surface1 },
  outlined: { borderWidth: 1, borderColor: colors.border.subtle, backgroundColor: 'transparent' },
});
