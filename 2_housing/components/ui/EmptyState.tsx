// [ui/EmptyState] 빈/에러/초기 상태 공통 — 아이콘 + 제목 + 힌트 + 액션.
import { ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import AppText from './AppText';
import { spacing } from '../../theme/spacing';

export interface EmptyStateProps {
  icon?: string;
  title: string;
  hint?: string;
  action?: ReactNode;
}

export default function EmptyState({ icon, title, hint, action }: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      {icon ? <AppText variant="display" center style={styles.icon}>{icon}</AppText> : null}
      <AppText variant="callout" tone="muted" center>{title}</AppText>
      {hint ? <AppText variant="footnote" tone="muted" center style={styles.hint}>{hint}</AppText> : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  icon: { marginBottom: spacing.md },
  hint: { marginTop: spacing.xs },
  action: { marginTop: spacing.lg },
});
