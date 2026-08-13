// [HomeHeaderActions] 홈(차트) 상단 우측 — 로그인 시 별 배지·출석체크·친구초대(모달), 항상 마이페이지.
import { useEffect } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuthStore } from '../stores/authStore';
import { useUiStore } from '../stores/uiStore';
import { usePointsStore } from '../stores/pointsStore';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { AppText } from './ui';

export default function HomeHeaderActions({ navigation }: { navigation: any }) {
  const { user } = useAuthStore();
  const openAttendance = useUiStore((s) => s.openAttendance);
  const openInvite = useUiStore((s) => s.openInvite);
  const openStarGuide = useUiStore((s) => s.openStarGuide);
  const balance = usePointsStore((s) => s.balance);
  const fetchBalance = usePointsStore((s) => s.fetchBalance);

  // 로그인 상태에서 별 잔액 로드(헤더 마운트 시)
  useEffect(() => {
    if (user) fetchBalance();
  }, [user, fetchBalance]);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 12 }}>
      {user ? (
        <>
          {/* 별 배지 — 클릭 시 별 안내(모으는/쓰는 법) 팝업 */}
          <TouchableOpacity
            onPress={openStarGuide}
            accessibilityLabel="별 안내"
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 3,
              backgroundColor: colors.bg.surface2, borderRadius: radius.pill,
              paddingHorizontal: 10, paddingVertical: 4, marginRight: spacing.xs,
            }}
          >
            <AppText variant="footnote">⭐</AppText>
            <AppText variant="footnote" tone="accent">{balance ?? 0}</AppText>
          </TouchableOpacity>
          <TouchableOpacity onPress={openAttendance} style={{ paddingHorizontal: 8 }} accessibilityLabel="출석체크">
            <Feather name="calendar" size={20} color={colors.text.primary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={openInvite} style={{ paddingHorizontal: 8 }} accessibilityLabel="친구초대">
            <Feather name="user-plus" size={20} color={colors.text.primary} />
          </TouchableOpacity>
        </>
      ) : null}
      <TouchableOpacity onPress={() => navigation.navigate('MyMusic')} style={{ paddingHorizontal: 8 }} accessibilityLabel="마이페이지">
        <Feather name="user" size={22} color={colors.text.primary} />
      </TouchableOpacity>
    </View>
  );
}
