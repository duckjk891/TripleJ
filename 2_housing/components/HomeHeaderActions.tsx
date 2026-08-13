// [HomeHeaderActions] 홈(차트) 상단 우측 — 로그인 시 출석체크·추천하기, 항상 마이페이지.
import { useState } from 'react';
import { View, TouchableOpacity, Alert, Share } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuthStore } from '../stores/authStore';
import api, { BACKEND_BASE_URL } from '../services/api';
import { colors } from '../theme/colors';

export default function HomeHeaderActions({ navigation }: { navigation: any }) {
  const { user } = useAuthStore();
  const [busy, setBusy] = useState(false);

  const handleCheckIn = async () => {
    if (busy) return;
    setBusy(true);
    if (__DEV__) console.info('[HomeHeaderActions] 출석체크 check-in');
    try {
      const res = await api.post('/attendance/check-in');
      const d = res.data || {};
      const already = d.already_checked_in || d.already;
      const msg = d.message
        || (already
          ? '오늘은 이미 출석했어요 🙂'
          : `출석 완료!${d.reward ? ` +${d.reward}` : ''}${d.streak ? ` (${d.streak}일 연속)` : ''}`);
      Alert.alert('출석체크', msg);
    } catch (err: any) {
      console.error('[HomeHeaderActions] 출석체크 실패', { status: err?.response?.status });
      Alert.alert('출석체크', err?.response?.data?.error || '출석체크에 실패했어요.');
    } finally {
      setBusy(false);
    }
  };

  const handleReferral = async () => {
    if (__DEV__) console.info('[HomeHeaderActions] 추천하기 my-code');
    try {
      const res = await api.get('/referral/my-code');
      const code = res.data?.referral_code || '';
      const url = `${BACKEND_BASE_URL}${res.data?.invite_url || `/invite/${code}`}`;
      await Share.share({ message: `AIDOL에서 함께 음악 만들어요! 초대코드: ${code}\n${url}` });
    } catch (err: any) {
      console.error('[HomeHeaderActions] 추천코드 실패', { status: err?.response?.status });
      Alert.alert('추천하기', err?.response?.data?.error || '추천코드를 불러오지 못했어요.');
    }
  };

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 12 }}>
      {user ? (
        <>
          <TouchableOpacity onPress={handleCheckIn} style={{ paddingHorizontal: 8 }} accessibilityLabel="출석체크">
            <Feather name="calendar" size={20} color={colors.text.primary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleReferral} style={{ paddingHorizontal: 8 }} accessibilityLabel="추천하기">
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
