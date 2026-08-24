// [HomeHeaderActions] 홈(차트) 상단 우측 — 로그인 시 별 배지·출석체크·친구초대·DM(봉투+미읽음), 항상 마이페이지.
import { useEffect, useState } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuthStore } from '../stores/authStore';
import { useUiStore } from '../stores/uiStore';
import { usePointsStore } from '../stores/pointsStore';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { AppText } from './ui';
import api from '../services/api';
import { dmSocketConnect, dmSocketDisconnect, dmSocketSubscribe } from '../services/dmSocket';

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

  // DM·알림 미읽음 배지 — 30초 폴링
  const [dmUnread, setDmUnread] = useState(0);
  const [notiUnread, setNotiUnread] = useState(0);
  useEffect(() => {
    if (!user) { setDmUnread(0); setNotiUnread(0); return; }
    let alive = true;
    const refresh = async () => {
      try {
        const [dm, noti] = await Promise.allSettled([
          api.get('/dm/unread-count'),
          api.get('/notifications/unread-count'),
        ]);
        if (!alive) return;
        if (dm.status === 'fulfilled') setDmUnread((dm.value.data?.count ?? 0) + (dm.value.data?.requests ?? 0));
        if (noti.status === 'fulfilled') setNotiUnread(noti.value.data?.count ?? 0);
      } catch (err: any) {
        if (__DEV__) console.info('[HomeHeaderActions] unread 조회 실패', { status: err?.response?.status });
      }
    };
    refresh();
    const t = setInterval(refresh, 30000); // 폴링 폴백(WS 단절 대비)
    // v3.48(B4): WebSocket 실시간 — 이벤트 수신 시 unread 즉시 재조회
    const token = useAuthStore.getState().token;
    if (token) dmSocketConnect(token);
    const unsub = dmSocketSubscribe((ev) => {
      if (ev.type === 'unread' && typeof ev.count === 'number') setDmUnread(ev.count);
      else refresh();
    });
    return () => { alive = false; clearInterval(t); unsub(); if (!useAuthStore.getState().user) dmSocketDisconnect(); };
  }, [user]);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 12 }}>
      {user ? (
        <>
          {/* 별 배지 — 클릭 시 별 안내(모으는/쓰는 법) 팝업 */}
          <TouchableOpacity
            onPress={openStarGuide}
            accessibilityLabel="루미 안내"
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
            <Feather name="share" size={20} color={colors.text.primary} />
          </TouchableOpacity>
          {/* 알림(벨) — v192 인앱 알림함 */}
          <TouchableOpacity onPress={() => navigation.navigate('Notifications')} style={{ paddingHorizontal: 8 }} accessibilityLabel="알림">
            <Feather name="bell" size={20} color={colors.text.primary} />
            {notiUnread > 0 ? (
              <View style={{
                position: 'absolute', top: -4, right: 0, minWidth: 16, height: 16, borderRadius: 8,
                backgroundColor: colors.accent.primary, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 3,
              }}>
                <AppText style={{ fontSize: 9, color: '#fff' }}>{notiUnread > 99 ? '99+' : notiUnread}</AppText>
              </View>
            ) : null}
          </TouchableOpacity>
          {/* DM(메시지) — MAIDOL 봉투 아이콘 위치 대응 */}
          <TouchableOpacity onPress={() => navigation.navigate('DmInbox')} style={{ paddingHorizontal: 8 }} accessibilityLabel="메시지">
            <Feather name="mail" size={20} color={colors.text.primary} />
            {dmUnread > 0 ? (
              <View style={{
                position: 'absolute', top: -4, right: 0, minWidth: 16, height: 16, borderRadius: 8,
                backgroundColor: colors.accent.primary, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 3,
              }}>
                <AppText style={{ fontSize: 9, color: '#fff' }}>{dmUnread > 99 ? '99+' : dmUnread}</AppText>
              </View>
            ) : null}
          </TouchableOpacity>
        </>
      ) : null}
      <TouchableOpacity onPress={() => navigation.navigate('MyMusic')} style={{ paddingHorizontal: 8 }} accessibilityLabel="마이페이지">
        <Feather name="user" size={22} color={colors.text.primary} />
      </TouchableOpacity>
    </View>
  );
}
