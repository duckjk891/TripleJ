// [ui/SectionHeader] 섹션 제목 + 선택적 액션(우측). 8pt 리듬 패딩.
import { ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import AppText from './AppText';
import { spacing } from '../../theme/spacing';

export interface SectionHeaderProps {
  title: string;
  action?: ReactNode;
}

export default function SectionHeader({ title, action }: SectionHeaderProps) {
  return (
    <View style={styles.wrap}>
      <AppText variant="title3">{title}</AppText>
      {action ?? null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.md,
  },
});
