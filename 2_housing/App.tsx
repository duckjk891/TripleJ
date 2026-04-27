import { StatusBar } from 'expo-status-bar';
import { Text, TouchableOpacity, View, Platform } from 'react-native';
import { colors } from './theme/colors';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DirectorType } from './components/Character';
import MiniPlayer from './components/MiniPlayer';

import SplashScreen from './screens/SplashScreen';
import ChartScreen from './screens/ChartScreen';
import PlaylistScreen from './screens/PlaylistScreen';
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
import ArtistDirectorScreen from './screens/ArtistDirectorScreen';
import ArtistDetailScreen from './screens/ArtistDetailScreen';
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
};

export type RootStackParamList = {
  Splash: undefined;
  MainTabs: undefined;
  Settings: undefined;
  Player: { track: any };
  ArtistDirector: undefined;
  ArtistDetail: { artistId: string; artistName?: string };
  DirectorLineup: undefined;
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
            <Text style={{ fontSize: size - 6, color }}>{'☰'}</Text>
          ),
          headerShown: true,
          headerTitle: '차트',
          headerStyle: { backgroundColor: colors.bg.deepest },
          headerTintColor: colors.text.primary,
          headerRight: () => (
            <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={{ marginRight: 16 }}>
              <Text style={{ fontSize: 22, color: colors.text.primary }}>{'⋮'}</Text>
            </TouchableOpacity>
          ),
        })}
      />
      <Tab.Screen
        name="Playlist"
        component={PlaylistScreen}
        options={({ navigation }) => ({
          tabBarLabel: '플레이리스트',
          tabBarIcon: ({ color, size }) => (
            <Text style={{ fontSize: size - 6, color }}>{'♬'}</Text>
          ),
          headerShown: true,
          headerTitle: '플레이리스트',
          headerStyle: { backgroundColor: colors.bg.deepest },
          headerTintColor: colors.text.primary,
          headerRight: () => (
            <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={{ marginRight: 16 }}>
              <Text style={{ fontSize: 22, color: colors.text.primary }}>{'⋮'}</Text>
            </TouchableOpacity>
          ),
        })}
      />
      <Tab.Screen
        name="Studio"
        component={StudioNavigator}
        options={({ navigation }) => ({
          tabBarLabel: '작업실',
          tabBarIcon: ({ color, size }) => (
            <Text style={{ fontSize: size - 6, color }}>{'✦'}</Text>
          ),
          headerShown: true,
          headerTitle: '작업실',
          headerStyle: { backgroundColor: colors.bg.deepest },
          headerTintColor: colors.text.primary,
          headerRight: () => (
            <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={{ marginRight: 16 }}>
              <Text style={{ fontSize: 22, color: colors.text.primary }}>{'⋮'}</Text>
            </TouchableOpacity>
          ),
        })}
      />
      <Tab.Screen
        name="MyMusic"
        component={MyMusicScreen}
        options={({ navigation }) => ({
          tabBarLabel: '마이뮤직',
          tabBarIcon: ({ color, size }) => (
            <Text style={{ fontSize: size - 6, color }}>{'♪'}</Text>
          ),
          headerShown: true,
          headerTitle: '마이뮤직',
          headerStyle: { backgroundColor: colors.bg.deepest },
          headerTintColor: colors.text.primary,
          headerRight: () => (
            <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={{ marginRight: 16 }}>
              <Text style={{ fontSize: 22, color: colors.text.primary }}>{'⋮'}</Text>
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
            <RootStack.Screen name="ArtistDirector" component={ArtistDirectorScreen} />
            <RootStack.Screen name="ArtistDetail" component={ArtistDetailScreen} />
            <RootStack.Screen name="DirectorLineup" component={DirectorLineupScreen} />
          </RootStack.Navigator>
          {/* 미니 플레이어 - 탭 바 위에 absolute 배치 */}
          <MiniPlayerWrapper />
        </View>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
