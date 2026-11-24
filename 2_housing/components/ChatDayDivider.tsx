// [ChatDayDivider] v3.435 채팅 날짜 구분선 — DM·크루 채팅 공용(날짜가 바뀌는 곳 위에 놓는다)
import { StyleSheet, View } from 'react-native';
import { AppText } from './ui';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { chatDayLabel } from '../utils/chatDate';

export default function ChatDayDivider({ date }: { date: Date }) {
  return (
    <View style={styles.row} accessibilityRole="header">
      <View style={styles.line} />
      <AppText variant="caption" tone="muted">{chatDayLabel(date)}</AppText>
      <View style={styles.line} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs, marginBottom: spacing.md },
  line: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border.subtle },
});
