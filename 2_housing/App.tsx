import { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Text, TouchableOpacity, View, Platform, LogBox } from 'react-native';
import * as NavigationBar from 'expo-navigation-bar';

// 모바일 화면 하단에 뜨는 노란/빨간 LogBox 알림을 모두 숨김.
// (개발 중에도 사용자 데모 시 보기 싫으니 끔. 콘솔 로그는 그대로 유지됨.)
if (Platform.OS !== 'web') {
  LogBox.ignoreAllLogs(true);
}

// Android 하단 시스템 네비게이션 바 색상을 앱 배경과 통일 (#0a0a1a)
// edge-to-edge 모드에서도 동작.
if (Platform.OS === 'android') {
  NavigationBar.setBackgroundColorAsync('#0a0a1a').catch(() => {});
  NavigationBar.setButtonStyleAsync('light').catch(() => {});
}
import { colors } from './theme/colors';
import { AppText } from './components/ui';
import { Feather } from '@expo/vector-icons';
import { NavigationContainer } from '@react-navigation/native';
import { navigationRef } from './services/navigationRef';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DirectorType } from './components/Character';
import MiniPlayer from './components/MiniPlayer';
import HomeHeaderActions from './components/HomeHeaderActions';
import AttendanceModal from './components/AttendanceModal';
import AppShareModal from './components/AppShareModal';
import StarGuideModal from './components/StarGuideModal';
import { useAuthStore, restoreSession } from './stores/authStore';
import DmInboxScreen from './screens/DmInboxScreen';
import DmChatScreen from './screens/DmChatScreen';
import NotificationsScreen from './screens/NotificationsScreen';
import MyReportsScreen from './screens/MyReportsScreen';
import { useUiStore } from './stores/uiStore';
import { usePointsStore } from './stores/pointsStore';
import api from './services/api';

import SplashScreen from './screens/SplashScreen';
import ChartScreen from './screens/ChartScreen';
import PlaylistScreen from './screens/PlaylistScreen';
import FeedScreen from './screens/FeedScreen';
import SearchScreen from './screens/SearchScreen';
import MapScreen from './screens/MapScreen';
import MyMusicScreen from './screens/MyMusicScreen';
import SettingsScreen from './screens/SettingsScreen';
import DialogueScreen from './screens/DialogueScreen';
import LyricsInputScreen from './screens/LyricsInputScreen';
import LyricsPromptReviewScreen from './screens/LyricsPromptReviewScreen';
import LyricsLoadingScreen from './screens/LyricsLoadingScreen';
import LyricsResultScreen from './screens/LyricsResultScreen';
import ComposerInputScreen from './screens/ComposerInputScreen';
import ComposerSelectScreen from './screens/ComposerSelectScreen';
import MusicGenerationScreen from './screens/MusicGenerationScreen';
import MusicLoadingScreen from './screens/MusicLoadingScreen';
import MusicResultScreen from './screens/MusicResultScreen';
import CoverGenerationScreen from './screens/CoverGenerationScreen';
import PlayerScreen from './screens/PlayerScreen';
import LevelUpModal from './components/LevelUpModal';
import RoyaltyScreen from './screens/RoyaltyScreen';
import ArtistInputScreen from './screens/ArtistInputScreen';
import ArtistLoadingScreen from './screens/ArtistLoadingScreen';
import ArtistResultScreen from './screens/ArtistResultScreen';
import ArtistCodyScreen from './screens/ArtistCodyScreen';
import ArtistDetailScreen from './screens/ArtistDetailScreen';
import UserChannelScreen from './screens/UserChannelScreen';
import AgencyProfileScreen from './screens/AgencyProfileScreen';
import DirectorLineupScreen from './screens/DirectorLineupScreen';
import { useFonts } from 'expo-font';

export type StudioStackParamList = {
  Map: undefined;
  Dialogue: {
    directorType: DirectorType;
    directorName: string;
    directorRole: string;
    directorY: number;
  };
  LyricsInput: undefined;
  LyricsPromptReview: undefined;
  LyricsLoading: undefined;
  LyricsResult: undefined;
  ComposerInput: undefined;
  ComposerSelect: undefined;
  MusicGeneration: undefined;
  MusicLoading: undefined;
  MusicResult: undefined;
  CoverGeneration: undefined;
  ArtistInput: undefined;
  ArtistLoading: undefined;
  ArtistResult: undefined;
  ArtistCody: undefined;
};

export type RootStackParamList = {
  Splash: undefined;
  MainTabs: undefined;
  Settings: undefined;
  Player: { track: any };
  DmInbox: undefined;
  Notifications: undefined;
  MyReports: undefined;
  DmChat: { conversation: any };
  UserChannel: { authorId: string; name?: string };
  ArtistDetail: { artistId: string; artistName?: string };
  AgencyProfile: { uploaderNickname: string; uploaderId?: string };
  DirectorLineup: undefined;
  Royalty: undefined;
};

const RootStack = createNativeStackNavigator<RootStackParamList>();
const StudioStack = createNativeStackNavigator<StudioStackParamList>();
const Tab = createBottomTabNavigator();

function StudioNavigator() {
  return (
    <StudioStack.Navigator
      initialRouteName="Map"
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg.deepest },
        animation: 'fade',
      }}
    >
      <StudioStack.Screen name="Map" component={MapScreen} />
      <StudioStack.Screen
        name="Dialogue"
        component={DialogueScreen}
        options={{
          presentation: 'transparentModal',
          animation: 'fade',
        }}
      />
      <StudioStack.Screen name="LyricsInput" component={LyricsInputScreen} />
      <StudioStack.Screen
        name="LyricsPromptReview"
        component={LyricsPromptReviewScreen}
      />
      <StudioStack.Screen
        name="LyricsLoading"
        component={LyricsLoadingScreen}
        options={{ gestureEnabled: false }}
      />
      <StudioStack.Screen name="LyricsResult" component={LyricsResultScreen} />
      <StudioStack.Screen name="ComposerInput" component={ComposerInputScreen} />
      <StudioStack.Screen
        name="ComposerSelect"
        component={ComposerSelectScreen}
      />
      <StudioStack.Screen
        name="MusicGeneration"
        component={MusicGenerationScreen}
      />
      <StudioStack.Screen
        name="MusicLoading"
        component={MusicLoadingScreen}
        options={{ gestureEnabled: false }}
      />
      <StudioStack.Screen name="MusicResult" component={MusicResultScreen} />
      <StudioStack.Screen name="CoverGeneration" component={CoverGenerationScreen} />
      <StudioStack.Screen name="ArtistInput" component={ArtistInputScreen} />
      <StudioStack.Screen
        name="ArtistLoading"
        component={ArtistLoadingScreen}
        options={{ gestureEnabled: false }}
      />
      <StudioStack.Screen name="ArtistResult" component={ArtistResultScreen} />
      <StudioStack.Screen name="ArtistCody" component={ArtistCodyScreen} />
    </StudioStack.Navigator>
  );
}

function MiniPlayerWrapper() {
  const insets = require('react-native-safe-area-context').useSafeAreaInsets();
  // 탭 바 높이: 49(기본) + safeArea bottom
  const tabBarHeight = 49 + insets.bottom;
  return (
    <View style={{ position: 'absolute', bottom: tabBarHeight, left: 0, right: 0, zIndex: 999 }}>
      <MiniPlayer />
    </View>
  );
}

// 상단 헤더 로고 (차트=홈 전용)
function LogoTitle() {
  return <AppText variant="title2" tone="accent" style={{ letterSpacing: 1 }}>AIDOL</AppText>;
}

// 마이페이지(user) 아이콘 → MyMusic
const MyPageIcon = ({ navigation }: any) => (
  <TouchableOpacity onPress={() => navigation.navigate('MyMusic')} style={{ marginRight: 16 }} accessibilityLabel="마이페이지">
    <Feather name="user" size={22} color={colors.text.primary} />
  </TouchableOpacity>
);

// 이전으로 돌아가기(←) → 홈(차트)
const BackIcon = ({ navigation }: any) => (
  <TouchableOpacity onPress={() => navigation.navigate('Chart')} style={{ marginLeft: 12 }} accessibilityLabel="뒤로">
    <Feather name="arrow-left" size={22} color={colors.text.primary} />
  </TouchableOpacity>
);

// 홈(차트) 헤더: 좌 로고 + 우 (출석체크·추천하기·마이페이지)
const homeHeader = (navigation: any) => ({
  headerShown: true,
  headerTitle: () => <LogoTitle />,
  headerTitleAlign: 'left' as const,
  headerStyle: { backgroundColor: colors.bg.deepest },
  headerTintColor: colors.text.primary,
  headerRight: () => <HomeHeaderActions navigation={navigation} />,
});

// 일반 페이지 헤더: 좌 뒤로가기 + 페이지명 + 우 마이페이지
const pageHeader = (navigation: any, title: string) => ({
  headerShown: true,
  headerTitle: () => <AppText variant="subtitle">{title}</AppText>,
  headerStyle: { backgroundColor: colors.bg.deepest },
  headerTintColor: colors.text.primary,
  headerLeft: () => <BackIcon navigation={navigation} />,
  headerRight: () => <MyPageIcon navigation={navigation} />,
});

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.bg.deepest,
          borderTopColor: colors.border.subtle,
          borderTopWidth: 1,
        },
        tabBarActiveTintColor: colors.accent.primary,
        tabBarInactiveTintColor: colors.text.muted,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <Tab.Screen
        name="Chart"
        component={ChartScreen}
        options={({ navigation }) => ({
          tabBarLabel: '차트',
          tabBarIcon: ({ color, size }) => (
            <Feather name="bar-chart-2" size={size - 2} color={color} />
          ),
          ...homeHeader(navigation),
        })}
      />
      <Tab.Screen
        name="Playlist"
        component={PlaylistScreen}
        options={({ navigation }) => ({
          tabBarLabel: '플레이리스트',
          tabBarIcon: ({ color, size }) => (
            <Feather name="play-circle" size={size - 2} color={color} />
          ),
          ...pageHeader(navigation, '플레이리스트'),
        })}
      />
      <Tab.Screen
        name="Feed"
        component={FeedScreen}
        options={({ navigation }) => ({
          tabBarLabel: '피드',
          tabBarIcon: ({ color, size }) => (
            <Feather name="edit-3" size={size - 2} color={color} />
          ),
          ...pageHeader(navigation, '피드'),
        })}
      />
      <Tab.Screen
        name="Search"
        component={SearchScreen}
        options={({ navigation }) => ({
          tabBarLabel: '검색',
          tabBarIcon: ({ color, size }) => (
            <Feather name="search" size={size - 2} color={color} />
          ),
          ...pageHeader(navigation, '검색'),
        })}
      />
      <Tab.Screen
        name="Studio"
        component={StudioNavigator}
        listeners={({ navigation }) => ({
          // Studio 탭 클릭 시 항상 Map으로 리셋 (Dialogue/ArtistInput 등에 갇혀있어도 Map 복귀)
          tabPress: () => {
            navigation.navigate('Studio', { screen: 'Map' });
          },
        })}
        options={({ navigation }) => ({
          tabBarLabel: '작업실',
          tabBarIcon: ({ color, size }) => (
            <Feather name="music" size={size - 2} color={color} />
          ),
          ...pageHeader(navigation, '작업실'),
        })}
      />
      {/* 마이뮤직=마이페이지: 하단바에서 숨김(상단 👤로 진입). 설정은 이 화면 헤더 ⚙️로 진입. */}
      <Tab.Screen
        name="MyMusic"
        component={MyMusicScreen}
        options={({ navigation }) => ({
          tabBarButton: () => null,
          tabBarItemStyle: { display: 'none' },
          headerShown: true,
          headerTitle: () => <AppText variant="subtitle">마이페이지</AppText>,
          headerStyle: { backgroundColor: colors.bg.deepest },
          headerTintColor: colors.text.primary,
          headerLeft: () => <BackIcon navigation={navigation} />,
          headerRight: () => (
            <TouchableOpacity
              onPress={() => navigation.navigate('Settings')}
              style={{ marginRight: 16 }}
              accessibilityLabel="설정"
            >
              <Feather name="settings" size={20} color={colors.text.primary} />
            </TouchableOpacity>
          ),
        })}
      />
    </Tab.Navigator>
  );
}

// 전역 모달(출석/초대) + 최초 로그인 시 출석 팝업 자동 오픈
function GlobalModals() {
  const user = useAuthStore((s) => s.user);
  const openAttendance = useUiStore((s) => s.openAttendance);
  const fetchBalance = usePointsStore((s) => s.fetchBalance);
  const prevUserRef = useRef<any>(null);
  useEffect(() => {
    const wasLoggedOut = !prevUserRef.current;
    prevUserRef.current = user;
    if (!user || !wasLoggedOut) return; // 로그인 전환(null→user)일 때만
    (async () => {
      if (__DEV__) console.info('[GlobalModals] 로그인 감지 — 별 잔액 + 출석 상태 확인');
      fetchBalance(); // 별 배지 즉시 갱신
      try {
        const { data } = await api.get('/attendance/status');
        if (data?.checked_today === false) {
          if (__DEV__) console.info('[GlobalModals] 오늘 미출석 → 출석 팝업 자동 오픈');
          openAttendance();
        }
      } catch (err: any) {
        console.error('[GlobalModals] 자동 출석 상태 확인 실패', { status: err?.response?.status });
      }
    })();
  }, [user, openAttendance, fetchBalance]);
  return (
    <>
      <AttendanceModal />
      <AppShareModal />
      <StarGuideModal />
    </>
  );
}

// [App] 웹 전용 — 소셜 로그인 콜백 수신: 백엔드가 `{frontend_url}/oauth/callback#token=JWT`로
// 리다이렉트하면 해시에서 토큰을 꺼내 세션을 연다(해시라 서버로그/Referer에 남지 않음).
function useOAuthCallback() {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    try {
      const hash = (globalThis as any)?.location?.hash || '';
      const m = hash.match(/[#&]token=([^&]+)/);
      if (!m) return;
      const token = decodeURIComponent(m[1]);
      // URL에서 토큰 즉시 제거(히스토리 노출 방지)
      try { (globalThis as any).history?.replaceState?.(null, '', (globalThis as any).location.pathname); } catch {}
      if (__DEV__) console.info('[App] OAuth 콜백 토큰 수신 — 세션 열기');
      useAuthStore.getState().loginWithToken(token);
    } catch (err: any) {
      console.error('[App] OAuth 콜백 처리 실패', { message: err?.message });
    }
  }, []);
}

// v3.57: 이 라우트들 위에서는 미니플레이어 UI를 숨긴다(모달과 겹쳐 어색). 사운드는
// playerStore 전역 소유라 UI를 숨겨도 재생은 계속된다.
const HIDE_MINIPLAYER_ROUTES = ['Settings'];

export default function App() {
  useOAuthCallback();
  // v3.52: 피드 게임창용 픽셀 폰트(Neo둥근모) — 비차단 로드(로드 전엔 시스템 폰트 폴백)
  useFonts({ NeoDGM: require('./assets/fonts/neodgm.ttf') });
  // 세션 영속화(B1) — 저장된 토큰으로 자동 로그인(앱 재시작 시 로그아웃되던 문제 해소)
  useEffect(() => { restoreSession(); }, []);
  // v3.57: 현재 라우트 추적 — 설정(모달) 위에서 미니플레이어 숨김용
  const [currentRoute, setCurrentRoute] = useState<string | undefined>(undefined);
  const syncRoute = () => setCurrentRoute(navigationRef.getCurrentRoute()?.name);
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <NavigationContainer ref={navigationRef} onReady={syncRoute} onStateChange={syncRoute}>
        <View style={{ flex: 1 }}>
          <RootStack.Navigator
            initialRouteName="Splash"
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.bg.deepest },
              animation: 'fade',
            }}
          >
            <RootStack.Screen name="Splash" component={SplashScreen} />
            <RootStack.Screen name="MainTabs" component={MainTabs} />
            <RootStack.Screen name="DmInbox" component={DmInboxScreen} />
            <RootStack.Screen name="Notifications" component={NotificationsScreen} />
            <RootStack.Screen name="MyReports" component={MyReportsScreen} />
            <RootStack.Screen name="DmChat" component={DmChatScreen} />
            <RootStack.Screen
              name="Player"
              component={PlayerScreen}
              options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
            />
            <RootStack.Screen
              name="Settings"
              component={SettingsScreen}
              options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
            />
            <RootStack.Screen name="UserChannel" component={UserChannelScreen} options={{ headerShown: true, headerTitle: '채널', headerStyle: { backgroundColor: colors.bg.deepest }, headerTintColor: colors.text.primary, headerShadowVisible: false }} />
            <RootStack.Screen name="ArtistDetail" component={ArtistDetailScreen} />
            <RootStack.Screen name="AgencyProfile" component={AgencyProfileScreen} />
            <RootStack.Screen name="DirectorLineup" component={DirectorLineupScreen} />
            <RootStack.Screen name="Royalty" component={RoyaltyScreen} />
          </RootStack.Navigator>
          {/* 미니 플레이어 - 탭 바 위에 absolute 배치. 설정 등 모달 라우트에선 숨김(재생은 유지) */}
          {!HIDE_MINIPLAYER_ROUTES.includes(currentRoute ?? '') ? <MiniPlayerWrapper /> : null}
          {/* 레벨업 토스트 - 전역 표시 (모든 화면 위에 떠오름) */}
          <LevelUpModal />
          {/* 출석체크·초대 모달 + 최초 로그인 자동 출석 팝업 */}
          <GlobalModals />
        </View>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
