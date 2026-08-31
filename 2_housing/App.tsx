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
// v3.91: 콘솔/오류 이벤트를 백엔드 /_logs/frontend 로 배치 전송 (MAIDOL main.jsx 관행 — 모듈 초기화 시 1회)
import { initRemoteLogger } from './utils/remoteLogger';
initRemoteLogger();
import { colors } from './theme/colors';
import { AppText } from './components/ui';
import { Feather } from '@expo/vector-icons';
import { NavigationContainer, LinkingOptions } from '@react-navigation/native';
import * as Linking from 'expo-linking';
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
import { usePlayerStore } from './stores/playerStore';
import { usePointsStore } from './stores/pointsStore';
import api, { BACKEND_BASE_URL } from './services/api';

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
import GenerationHistoryScreen from './screens/GenerationHistoryScreen';
import CoverGenerationScreen from './screens/CoverGenerationScreen';
import PlayerScreen from './screens/PlayerScreen';
import LevelUpModal from './components/LevelUpModal';
import AppDialogHost from './components/AppDialogHost';
import RoyaltyScreen from './screens/RoyaltyScreen';
import ArtistInputScreen from './screens/ArtistInputScreen';
import ArtistLoadingScreen from './screens/ArtistLoadingScreen';
import ArtistResultScreen from './screens/ArtistResultScreen';
import MyArtistsScreen from './screens/MyArtistsScreen';
import VoiceManageScreen from './screens/VoiceManageScreen';
import VoiceCloneWizardScreen from './screens/VoiceCloneWizardScreen';
import LyricsBookScreen from './screens/LyricsBookScreen';
import ArtistCodyScreen from './screens/ArtistCodyScreen';
import ArtistDetailScreen from './screens/ArtistDetailScreen';
import UserChannelScreen from './screens/UserChannelScreen';
import FeedComposeScreen from './screens/FeedComposeScreen';
import AgencyProfileScreen from './screens/AgencyProfileScreen';
import FeedDetailScreen from './screens/FeedDetailScreen';
import DirectorLineupScreen from './screens/DirectorLineupScreen';
import AlbumDetailScreen from './screens/AlbumDetailScreen';
// v3.100(A-10): 직접 음원 파일 업로드
import TrackUploadScreen from './screens/TrackUploadScreen';
// v3.104(B-5): 커버 보관함 — 열람/삭제 + 선택 모드({ select: true })로 커버 재사용
import CoverLibraryScreen from './screens/CoverLibraryScreen';

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
  // v3.93: resumeGenerationId — 생성 이력에서 진행 중 생성을 이어볼 때 폴링 재개 모드
  MusicLoading: { resumeGenerationId?: string } | undefined;
  // v3.93: alreadySaved — 이력에서 트랙 확정(발매)된 완료 생성으로 진입 시 재저장 방지
  // v3.102: useVoiceConverted 파라미터 제거 — v216에서 서버 /voice-convert/* 삭제, 기능 제거 확정
  MusicResult: { alreadySaved?: boolean } | undefined;
  // v3.93: 생성 이력 목록 (진행중 이어보기 / 완료 결과 / 실패 확인·삭제)
  GenerationHistory: undefined;
  CoverGeneration: undefined;
  // v3.81: 아티스트 1명=슬롯 1개 모델 — 목록(MyArtists)에서 slot/forceKind 파라미터로 진입
  // v3.103(B-1): characterId — 서버 다중 아티스트(cid) 진입. slot은 레거시(me 폴백) 전용.
  //   ArtistInput.characterId = 재생성 대상(kind 불일치 400 → forceKind 동반 필수)
  ArtistInput: { forceKind?: 'real' | 'virtual'; characterId?: string } | undefined;
  ArtistLoading: undefined;
  ArtistResult: { slot?: 'real' | 'virtual'; characterId?: string } | undefined;
  MyArtists: undefined;
  ArtistCody: undefined;
  VoiceManage: { select?: 'artist' } | undefined;
  // v3.83: 정식 보이스 클로닝(노래+문장낭독) 4단계 위저드 — resumeCloneId로 2/3단계 재개
  VoiceCloneWizard: { resumeCloneId?: string } | undefined;
  LyricsBook: undefined;
};

export type RootStackParamList = {
  Splash: undefined;
  MainTabs: undefined;
  Settings: undefined;
  Player: { track: any };
  DmInbox: undefined;
  Notifications: undefined;
  MyReports: undefined;
  // v3.95(A-14): prefill — CS 오류신고 진입 시 입력창 프리필(자동 전송 X)
  DmChat: { conversation: any; prefill?: string };
  UserChannel: { authorId: string; name?: string };
  // v3.115: kind='community' — 마이페이지 커뮤니티 탭 [새 공지 작성] 진입(작성 payload kind 반영)
  FeedCompose: { kind?: 'feed' | 'community' } | undefined;
  // v3.95(A-21): 피드 단건 착지(공유/딥링크 목적지)
  FeedDetail: { feedId: string };
  ArtistDetail: { artistId: string; artistName?: string };
  // v3.96(A-2): 앨범 상세 — 열람(전체) + 내 앨범이면 관리(수정/삭제/트랙/커버)
  AlbumDetail: { albumId: string };
  // v3.100(A-10): 직접 음원 파일 업로드 — 마이뮤직 작곡 탭에서 진입
  TrackUpload: undefined;
  // v3.104(B-5): 커버 보관함 — select=true면 선택 모드(coverLibraryStore.pickedCover에 쓰고 goBack)
  CoverLibrary: { select?: boolean } | undefined;
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
      <StudioStack.Screen name="GenerationHistory" component={GenerationHistoryScreen} />
      <StudioStack.Screen name="CoverGeneration" component={CoverGenerationScreen} />
      <StudioStack.Screen name="ArtistInput" component={ArtistInputScreen} />
      <StudioStack.Screen
        name="ArtistLoading"
        component={ArtistLoadingScreen}
        options={{ gestureEnabled: false }}
      />
      <StudioStack.Screen name="ArtistResult" component={ArtistResultScreen} />
      <StudioStack.Screen name="MyArtists" component={MyArtistsScreen} />
      <StudioStack.Screen name="ArtistCody" component={ArtistCodyScreen} />
      <StudioStack.Screen name="VoiceManage" component={VoiceManageScreen} />
      <StudioStack.Screen name="VoiceCloneWizard" component={VoiceCloneWizardScreen} />
      <StudioStack.Screen name="LyricsBook" component={LyricsBookScreen} />
    </StudioStack.Navigator>
  );
}

function MiniPlayerWrapper() {
  const insets = require('react-native-safe-area-context').useSafeAreaInsets();
  // v3.82: 화면 단위 숨김(ArtistResult 등) — 렌더만 막고 오디오 재생은 유지
  const miniHidden = usePlayerStore((s) => s.miniHidden);
  // 탭 바 높이: 49(기본) + safeArea bottom
  const tabBarHeight = 49 + insets.bottom;
  if (miniHidden) return null;
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

// v3.75: 탭 헤더 = 좌측 페이지명 텍스트 + 우측은 차트와 동일한 액션(HomeHeaderActions).
// 차트만 좌측이 AIDOL 로고, 작업실은 MapScreen이 기획사명+ⓘ로 headerTitle을 덮는다.
const titleHeader = (navigation: any, title: string) => ({
  headerShown: true,
  headerTitle: () => <AppText variant="subtitle">{title}</AppText>,
  headerTitleAlign: 'left' as const,
  headerStyle: { backgroundColor: colors.bg.deepest },
  headerTintColor: colors.text.primary,
  headerRight: () => <HomeHeaderActions navigation={navigation} />,
});

// v3.71: 스택 페이지 헤더 — 알림/메시지 등 RootStack 화면도 플레이리스트처럼 상단바에 타이틀이 뜨도록.
// pageHeader와 달리 뒤로가기는 goBack(진입 지점으로 복귀).
const stackHeader = (navigation: any, title: string) => ({
  headerShown: true,
  headerTitle: () => <AppText variant="subtitle">{title}</AppText>,
  headerStyle: { backgroundColor: colors.bg.deepest },
  headerTintColor: colors.text.primary,
  headerShadowVisible: false,
  headerLeft: () => (
    <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginLeft: 12 }} accessibilityLabel="뒤로">
      <Feather name="arrow-left" size={22} color={colors.text.primary} />
    </TouchableOpacity>
  ),
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
          ...titleHeader(navigation, '플레이리스트'), // v3.75: 좌측 페이지명 + 우측 차트와 동일 액션
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
          ...titleHeader(navigation, '피드'),
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
          ...titleHeader(navigation, '검색'),
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
          // v3.75: 기본은 '작업실' — MapScreen이 setOptions로 기획사명+ⓘ 타이틀로 덮는다
          ...titleHeader(navigation, '작업실'),
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

// v3.95(A-21): 딥링크 — aidol://feed/{id} · {웹/공유 URL}/feed/{id} → FeedDetail 착지.
// FeedCard 공유 URL(`${BACKEND_BASE_URL}/feed/{id}`)과 경로 형식 일치.
// Linking.createURL('/')는 개발(Expo Go: exp://.../--/)과 빌드(aidol://)를 모두 커버.
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [Linking.createURL('/'), 'aidol://', BACKEND_BASE_URL],
  config: {
    // 콜드 스타트 딥링크에서도 뒤로가기(goBack)가 홈으로 떨어지도록 MainTabs를 밑에 깐다
    initialRouteName: 'MainTabs',
    screens: {
      FeedDetail: 'feed/:feedId',
    },
  },
};

export default function App() {
  useOAuthCallback();
  // v3.60: 픽셀 피드 콘셉트 철회로 폰트 로드 제거(에셋 assets/fonts/neodgm.ttf 는 재사용 대비 보존)
  // 세션 영속화(B1) — 저장된 토큰으로 자동 로그인(앱 재시작 시 로그아웃되던 문제 해소)
  useEffect(() => { restoreSession(); }, []);
  // v3.57: 현재 라우트 추적 — 설정(모달) 위에서 미니플레이어 숨김용
  const [currentRoute, setCurrentRoute] = useState<string | undefined>(undefined);
  const syncRoute = () => setCurrentRoute(navigationRef.getCurrentRoute()?.name);
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <NavigationContainer ref={navigationRef} linking={linking} onReady={syncRoute} onStateChange={syncRoute}>
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
            <RootStack.Screen name="DmInbox" component={DmInboxScreen} options={({ navigation }) => stackHeader(navigation, '메시지')} />
            <RootStack.Screen name="Notifications" component={NotificationsScreen} options={({ navigation }) => stackHeader(navigation, '알림')} />
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
            {/* v3.73: 피드작성도 다른 페이지처럼 상단바에 타이틀 — X(취소)는 좌측, 등록은 화면에서 headerRight로 주입 */}
            <RootStack.Screen name="FeedCompose" component={FeedComposeScreen} options={({ navigation, route }) => ({
              presentation: 'modal', animation: 'slide_from_bottom',
              headerShown: true,
              // v3.115: 커뮤니티(공지) 모드면 타이틀도 구분
              headerTitle: () => <AppText variant="subtitle">{route.params?.kind === 'community' ? '공지 작성' : '피드 작성'}</AppText>,
              headerStyle: { backgroundColor: colors.bg.deepest },
              headerTintColor: colors.text.primary,
              headerShadowVisible: false,
              headerLeft: () => (
                <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginLeft: 12 }} accessibilityLabel="작성 취소">
                  <Feather name="x" size={22} color={colors.text.primary} />
                </TouchableOpacity>
              ),
            })} />
            {/* v3.95(A-21): 피드 단건 착지 — 공유/딥링크(aidol://feed/{id}) 목적지 */}
            <RootStack.Screen name="FeedDetail" component={FeedDetailScreen} options={({ navigation }) => stackHeader(navigation, '피드')} />
            <RootStack.Screen name="ArtistDetail" component={ArtistDetailScreen} />
            {/* v3.96(A-2): 앨범 상세/관리 — 홈 최신앨범·채널·마이페이지에서 진입 */}
            <RootStack.Screen name="AlbumDetail" component={AlbumDetailScreen} options={({ navigation }) => stackHeader(navigation, '앨범')} />
            {/* v3.100(A-10): 직접 음원 파일 업로드 — 마이뮤직 작곡 탭에서 진입 */}
            <RootStack.Screen name="TrackUpload" component={TrackUploadScreen} options={({ navigation }) => stackHeader(navigation, '음원 파일 올리기')} />
            <RootStack.Screen name="CoverLibrary" component={CoverLibraryScreen} options={({ navigation }) => stackHeader(navigation, '커버 보관함')} />
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
          {/* v3.85: 전역 앱 내 다이얼로그 (showAlert → dialogStore) — 시스템 팝업 대체 */}
          <AppDialogHost />
        </View>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
