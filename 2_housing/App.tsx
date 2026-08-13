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
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DirectorType } from './components/Character';
import MiniPlayer from './components/MiniPlayer';

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
import AgencyProfileScreen from './screens/AgencyProfileScreen';
import DirectorLineupScreen from './screens/DirectorLineupScreen';

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

// 상단 헤더 로고 (메뉴명 대신) — 모든 탭 공통
function LogoTitle() {
  return <AppText variant="title2" tone="accent" style={{ letterSpacing: 1 }}>AIDOL</AppText>;
}

// 탭 공통 헤더: 좌측 로고 + 우측 마이페이지(👤) 아이콘 → MyMusic
const tabHeader = (navigation: any) => ({
  headerShown: true,
  headerTitle: () => <LogoTitle />,
  headerTitleAlign: 'left' as const,
  headerStyle: { backgroundColor: colors.bg.deepest },
  headerTintColor: colors.text.primary,
  headerRight: () => (
    <TouchableOpacity
      onPress={() => navigation.navigate('MyMusic')}
      style={{ marginRight: 16 }}
      accessibilityLabel="마이페이지"
    >
      <Feather name="user" size={22} color={colors.text.primary} />
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
          ...tabHeader(navigation),
        })}
      />
      <Tab.Screen
        name="Playlist"
        component={PlaylistScreen}
        options={({ navigation }) => ({
          tabBarLabel: '플레이리스트',
          tabBarIcon: ({ color, size }) => (
            <Feather name="list" size={size - 2} color={color} />
          ),
          ...tabHeader(navigation),
        })}
      />
      <Tab.Screen
        name="Feed"
        component={FeedScreen}
        options={({ navigation }) => ({
          tabBarLabel: '피드',
          tabBarIcon: ({ color, size }) => (
            <Feather name="home" size={size - 2} color={color} />
          ),
          ...tabHeader(navigation),
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
          ...tabHeader(navigation),
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
            <Feather name="mic" size={size - 2} color={color} />
          ),
          ...tabHeader(navigation),
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
          headerTitle: '마이페이지',
          headerStyle: { backgroundColor: colors.bg.deepest },
          headerTintColor: colors.text.primary,
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

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <NavigationContainer>
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
            <RootStack.Screen name="ArtistDetail" component={ArtistDetailScreen} />
            <RootStack.Screen name="AgencyProfile" component={AgencyProfileScreen} />
            <RootStack.Screen name="DirectorLineup" component={DirectorLineupScreen} />
            <RootStack.Screen name="Royalty" component={RoyaltyScreen} />
          </RootStack.Navigator>
          {/* 미니 플레이어 - 탭 바 위에 absolute 배치 */}
          <MiniPlayerWrapper />
          {/* 레벨업 토스트 - 전역 표시 (모든 화면 위에 떠오름) */}
          <LevelUpModal />
        </View>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
