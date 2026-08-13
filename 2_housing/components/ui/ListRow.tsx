// [ui/ListRow] Material 3 리스트(표준 높이 64, leading/title/subtitle/trailing) + press 피드백.
import { ReactNode } from 'react';
import { Pressable, View, StyleSheet, PressableProps } from 'react-native';
import AppText from './AppText';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';

export interface ListRowProps extends Omit<PressableProps, 'style' | 'children'> {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  divider?: boolean;
}

export default function ListRow({ title, subtitle, leading, trailing, divider = true, ...rest }: ListRowProps) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.pressed, divider && styles.divider]}
      {...rest}
    >
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <View style={styles.center}>
        <AppText variant="bodyStrong" numberOfLines={1}>{title}</AppText>
        {subtitle ? (
          <AppText variant="footnote" tone="secondary" numberOfLines={1} style={styles.subtitle}>{subtitle}</AppText>
        ) : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 64 },
  pressed: { backgroundColor: colors.bg.surface1 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle },
  leading: { marginRight: spacing.md },
  center: { flex: 1, marginRight: spacing.sm },
  subtitle: { marginTop: 2 },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
