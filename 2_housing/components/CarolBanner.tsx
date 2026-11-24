// [CarolBanner] v3.438 캐롤 이벤트 들어가는 줄 — 차트·커뮤니티·캐롤 크루 화면. 이벤트가 꺼져 있으면 렌더하지 않는다.
import { useCallback } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { AppText } from './ui';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/spacing';
import { useAuthStore } from '../stores/authStore';
import { useCarolStore } from '../stores/carolStore';
import { untilLabel } from '../utils/carolStop';

/** clubId 를 주면 그 크루가 캐롤 크루일 때만 보인다 */
export default function CarolBanner({ clubId }: { clubId?: string }) {
  const navigation = useNavigation<any>();
  const uid = useAuthStore((s) => (s.user?.id ? String(s.user.id) : null));
  const status = useCarolStore((s) => s.status);
  const load = useCarolStore((s) => s.load);
  useFocusEffect(useCallback(() => { void load(uid); }, [load, uid]));

  if (!status?.active || (clubId && status.club?.id !== String(clubId))) return null;
  const ready = status.ready;
  if (!status.submit_open && !ready) return null;
  const sub = ready > 0
    ? `스타 스톱 도전권이 ${ready}개 있어요`
    : `캐롤을 업로드하고 스타 스톱 도전! ${untilLabel(status.submit_until)}까지`;
  return (
    <TouchableOpacity
      style={[styles.row, ready > 0 && styles.ready]}
      activeOpacity={0.8}
      onPress={() => navigation.navigate('MainTabs', { screen: 'CarolEvent' })}
      accessibilityRole="button"
      accessibilityLabel={`${status.title} 이벤트. ${sub}`}
    >
      <MaterialCommunityIcons name="pine-tree" size={22} color={colors.status.success} />
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong" numberOfLines={1}>{status.title}</AppText>
        <AppText variant="caption" tone={ready > 0 ? 'accent' : 'secondary'} numberOfLines={1}>{sub}</AppText>
      </View>
      <Feather name="chevron-right" size={18} color={colors.text.muted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginHorizontal: spacing.lg, marginVertical: spacing.sm,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border.subtle, backgroundColor: colors.bg.surface1,
  },
  ready: { borderColor: colors.accent.secondary },
});
