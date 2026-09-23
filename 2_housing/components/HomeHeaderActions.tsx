// [HomeHeaderActions] 홈(차트) 상단 우측 — 로그인 시 별 배지·출석체크·친구초대·DM(봉투+미읽음), 항상 마이페이지.
// v3.213: registerTutorialAnchors prop — 차트 탭 헤더 인스턴스만 상단바 튜토리얼 anchor 6종을
// 등록한다(여러 탭 헤더에 다중 마운트되므로 비활성 인스턴스의 stale 좌표 등록을 차단).
// 아이콘에는 ref+onLayout만 부착 — 스타일·레이아웃 무변경.
import { useEffect, useRef, useState } from 'react';
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
import { TutorialAnchorKey, measureAndRegister, unregisterAnchor } from '../utils/tutorialAnchors';

// v3.213: 상단바 튜토리얼 anchor 키 — 마이페이지 외 5종은 로그인 시에만 마운트
const TOPBAR_ANCHOR_KEYS: TutorialAnchorKey[] = [
  'topbar-star', 'topbar-attendance', 'topbar-invite', 'topbar-noti', 'topbar-dm', 'topbar-mypage',
];

export default function HomeHeaderActions({
  navigation,
  registerTutorialAnchors,
}: {
  navigation: any;
  /** v3.213: 상단바 튜토리얼 anchor 등록 — 차트 탭 헤더에서만 true */
  registerTutorialAnchors?: boolean;
}) {
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

  // v3.213: 상단바 튜토리얼 anchor — 차트 탭 헤더 인스턴스만 등록(ref+onLayout, 스타일 무변경)
  const anchorNodes = useRef<Partial<Record<TutorialAnchorKey, any>>>({});
  const anchorRef = (key: TutorialAnchorKey) => (node: any) => {
    anchorNodes.current[key] = node;
  };
  const anchorLayout = (key: TutorialAnchorKey) => () => {
    if (registerTutorialAnchors) measureAndRegister(key, anchorNodes.current[key]);
  };
  // 언마운트 시 전체 해제 — 다른 화면에서 stale 좌표가 남지 않게
  useEffect(() => {
    if (!registerTutorialAnchors) return;
    return () => TOPBAR_ANCHOR_KEYS.forEach(unregisterAnchor);
  }, [registerTutorialAnchors]);
  // 로그아웃 시 로그인 전용 아이콘 5종 anchor 해제(마이페이지는 상시 마운트)
  useEffect(() => {
    if (registerTutorialAnchors && !user)
      TOPBAR_ANCHOR_KEYS.filter((k) => k !== 'topbar-mypage').forEach(unregisterAnchor);
  }, [registerTutorialAnchors, user]);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 12 }}>
      {user ? (
        <>
          {/* 별 배지 — 클릭 시 별 안내(모으는/쓰는 법) 팝업 */}
          <TouchableOpacity
            ref={anchorRef('topbar-star')}
            onLayout={anchorLayout('topbar-star')}
            onPress={openStarGuide}
            accessibilityLabel="스타 안내"
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 3,
              backgroundColor: colors.bg.surface2, borderRadius: radius.pill,
              paddingHorizontal: 8, paddingVertical: 4, marginRight: spacing.xs,
            }}
          >
            <AppText variant="footnote">⭐</AppText>
            <AppText variant="footnote" tone="accent">{balance ?? 0}</AppText>
          </TouchableOpacity>
          <TouchableOpacity ref={anchorRef('topbar-attendance')} onLayout={anchorLayout('topbar-attendance')} onPress={openAttendance} style={{ paddingHorizontal: 6 }} accessibilityLabel="출석체크">
            <Feather name="calendar" size={18} color={colors.text.primary} />
          </TouchableOpacity>
          <TouchableOpacity ref={anchorRef('topbar-invite')} onLayout={anchorLayout('topbar-invite')} onPress={openInvite} style={{ paddingHorizontal: 6 }} accessibilityLabel="친구초대">
            <Feather name="share" size={18} color={colors.text.primary} />
          </TouchableOpacity>
          {/* 알림(벨) — v192 인앱 알림함 */}
          <TouchableOpacity ref={anchorRef('topbar-noti')} onLayout={anchorLayout('topbar-noti')} onPress={() => navigation.navigate('Notifications')} style={{ paddingHorizontal: 6 }} accessibilityLabel="알림">
            <Feather name="bell" size={18} color={colors.text.primary} />
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
          <TouchableOpacity ref={anchorRef('topbar-dm')} onLayout={anchorLayout('topbar-dm')} onPress={() => navigation.navigate('DmInbox')} style={{ paddingHorizontal: 6 }} accessibilityLabel="메시지">
            <Feather name="mail" size={18} color={colors.text.primary} />
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
      <TouchableOpacity ref={anchorRef('topbar-mypage')} onLayout={anchorLayout('topbar-mypage')} onPress={() => navigation.navigate('MyMusic')} style={{ paddingHorizontal: 6 }} accessibilityLabel="마이페이지">
        <Feather name="user" size={20} color={colors.text.primary} />
      </TouchableOpacity>
    </View>
  );
}
