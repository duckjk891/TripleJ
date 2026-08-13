// [HomeHeaderActions] 홈(차트) 상단 우측 — 로그인 시 출석체크·추천하기(모달), 항상 마이페이지.
import { View, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuthStore } from '../stores/authStore';
import { useUiStore } from '../stores/uiStore';
import { colors } from '../theme/colors';

export default function HomeHeaderActions({ navigation }: { navigation: any }) {
  const { user } = useAuthStore();
  const openAttendance = useUiStore((s) => s.openAttendance);
  const openInvite = useUiStore((s) => s.openInvite);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 12 }}>
      {user ? (
        <>
          <TouchableOpacity onPress={openAttendance} style={{ paddingHorizontal: 8 }} accessibilityLabel="출석체크">
            <Feather name="calendar" size={20} color={colors.text.primary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={openInvite} style={{ paddingHorizontal: 8 }} accessibilityLabel="추천하기">
            <Feather name="gift" size={20} color={colors.text.primary} />
          </TouchableOpacity>
        </>
      ) : null}
      <TouchableOpacity onPress={() => navigation.navigate('MyMusic')} style={{ paddingHorizontal: 8 }} accessibilityLabel="마이페이지">
        <Feather name="user" size={22} color={colors.text.primary} />
      </TouchableOpacity>
    </View>
  );
}
