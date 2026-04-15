import { StatusBar } from 'expo-status-bar';
import { Text, TouchableOpacity } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DirectorType } from './components/Character';

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
        contentStyle: { backgroundColor: '#0a0a1a' },
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

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#0a0a1a',
          borderTopColor: '#1a1a2e',
          borderTopWidth: 1,
        },
        tabBarActiveTintColor: '#e94560',
        tabBarInactiveTintColor: '#666',
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
        tabBarIconStyle: {
          marginTop: 0,
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
          headerStyle: { backgroundColor: '#0a0a1a' },
          headerTintColor: '#fff',
          headerRight: () => (
            <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={{ marginRight: 16 }}>
              <Text style={{ fontSize: 22, color: '#fff' }}>{'⋮'}</Text>
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
          headerStyle: { backgroundColor: '#0a0a1a' },
          headerTintColor: '#fff',
          headerRight: () => (
            <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={{ marginRight: 16 }}>
              <Text style={{ fontSize: 22, color: '#fff' }}>{'⋮'}</Text>
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
          headerStyle: { backgroundColor: '#0a0a1a' },
          headerTintColor: '#fff',
          headerRight: () => (
            <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={{ marginRight: 16 }}>
              <Text style={{ fontSize: 22, color: '#fff' }}>{'⋮'}</Text>
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
          headerStyle: { backgroundColor: '#0a0a1a' },
          headerTintColor: '#fff',
          headerRight: () => (
            <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={{ marginRight: 16 }}>
              <Text style={{ fontSize: 22, color: '#fff' }}>{'⋮'}</Text>
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
        <RootStack.Navigator
          initialRouteName="Splash"
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#0a0a1a' },
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
        </RootStack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
