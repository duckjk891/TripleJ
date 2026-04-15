import { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Image,
  ScrollView,
  Alert,
  Platform,
  useWindowDimensions,
  Modal,
  TouchableOpacity,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Character, { DirectorType } from '../components/Character';
import { useTimerStore } from '../stores/timerStore';
import { useLyricsStore } from '../stores/lyricsStore';
import { useMusicStore } from '../stores/musicStore';
import { useAuthStore } from '../stores/authStore';

// AdMob Rewarded Ad
let RewardedAd: any = null;
let RewardedAdEventType: any = null;

const AD_UNIT_ID = Platform.select({
  ios: 'ca-app-pub-1425041551318467/8070806176',
  android: 'ca-app-pub-1425041551318467/1283416835',
}) ?? '';

try {
  const admob = require('react-native-google-mobile-ads');
  RewardedAd = admob.RewardedAd;
  RewardedAdEventType = admob.RewardedAdEventType;
} catch {
  console.log('[AdMob] Not available - using mock ads');
}

const MAP_IMAGE = require('../assets/map_rendered.png');
const MAP_WIDTH = 704;
const MAP_HEIGHT = 2208;

const PORTRAITS: Record<string, any> = {
  artist: require('../assets/portraits/artist_director.png'),
  lyricist: require('../assets/portraits/lyricist_director.png'),
  composer: require('../assets/portraits/composer_director.png'),
  image: require('../assets/portraits/image_director.png'),
  video: require('../assets/portraits/video_director.png'),
};

const DIRECTOR_NAMES: Record<DirectorType, string> = {
  artist: '아티스트 디렉터',
  lyricist: '작사 디렉터',
  composer: '작곡 디렉터',
  image: '이미지 디렉터',
  video: '영상 디렉터',
};

const DIRECTOR_ROLES: Record<DirectorType, string> = {
  artist: '아티스트 캐릭터를 생성하고 관리합니다',
  lyricist: 'AI로 가사를 작성합니다',
  composer: 'AI로 음악을 제작합니다',
  image: '앨범 자켓과 MV 씬 이미지를 디자인합니다',
  video: '뮤직비디오를 제작합니다',
};

const DIRECTORS = [
  { type: 'artist' as DirectorType, x: 208, y: 340 },
  { type: 'lyricist' as DirectorType, x: 208, y: 660 },
  { type: 'composer' as DirectorType, x: 208, y: 980 },
  { type: 'image' as DirectorType, x: 208, y: 1300 },
  { type: 'video' as DirectorType, x: 208, y: 1620 },
];

type StudioStackParamList = {
  Map: undefined;
  Dialogue: {
    directorType: DirectorType;
    directorName: string;
    directorRole: string;
    directorY: number;
  };
  LyricsLoading: undefined;
  MusicLoading: undefined;
};

type Props = NativeStackScreenProps<StudioStackParamList, 'Map'>;

interface TimerTask {
  directorType: DirectorType;
  taskName: string;
  queueNumber: number;
  startedAt: number;
}

export default function MapScreen({ navigation }: Props) {
  const { width: screenWidth } = useWindowDimensions();
  const mapScale = screenWidth / MAP_WIDTH;
  const displayHeight = MAP_HEIGHT * mapScale;
  const { user } = useAuthStore();
  const timerStore = useTimerStore();
  const lyricsStore = useLyricsStore();
  const musicStore = useMusicStore();

  const [popupTask, setPopupTask] = useState<{ type: DirectorType; task: TimerTask } | null>(null);
  const [showLoginOverlay, setShowLoginOverlay] = useState(false);

  // Tick every 30 seconds to reduce queue by 1
  useEffect(() => {
    const interval = setInterval(() => {
      timerStore.tick();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const showAdAndReduceQueue = (type: DirectorType) => {
    const reduceAmount = Math.floor(Math.random() * 11) + 10; // 10~20

    if (RewardedAd) {
      const rewarded = RewardedAd.createForAdRequest(AD_UNIT_ID);
      const unsubLoaded = rewarded.addAdEventListener(
        RewardedAdEventType.LOADED,
        () => rewarded.show()
      );
      const unsubEarned = rewarded.addAdEventListener(
        RewardedAdEventType.EARNED_REWARD,
        () => {
          timerStore.reduceQueue(type, reduceAmount);
          Alert.alert('보상 획득!', `대기번호가 ${reduceAmount}번 앞당겨졌습니다!`);
          unsubLoaded();
          unsubEarned();
        }
      );
      rewarded.load();
      setTimeout(() => { unsubLoaded(); unsubEarned(); }, 15000);
    } else {
      // Mock ad for Expo Go
      Alert.alert('광고 로딩 중...', '3초 후 보상이 지급됩니다.');
      setTimeout(() => {
        timerStore.reduceQueue(type, reduceAmount);
        Alert.alert('보상 획득!', `대기번호가 ${reduceAmount}번 앞당겨졌습니다!`);
      }, 3000);
    }
  };

  const handleDirectorPress = (type: DirectorType) => {
    if (!user) {
      setShowLoginOverlay(true);
      return;
    }
    const task = timerStore.getTask(type);

    if (task) {
      if (task.queueNumber <= 0) {
        timerStore.completeTask(type);
        if (task.taskName.includes('작사')) {
          navigation.navigate('LyricsLoading' as any);
        } else {
          navigation.navigate('MusicLoading' as any);
        }
        return;
      }

      // Show custom popup modal
      setPopupTask({ type, task });
      return;
    }

    // 작사 디렉터: 이미 프롬프트가 있으면 프롬프트 확인 화면으로 바로 이동
    if (type === 'lyricist' && lyricsStore.generatedPrompt) {
      navigation.navigate('LyricsPromptReview' as any);
      return;
    }

    // 이미지 디렉터: 커버 생성 화면으로 이동
    if (type === 'image') {
      navigation.navigate('CoverGeneration' as any);
      return;
    }

    // 비디오 디렉터: 준비 중
    if (type === 'video') {
      Alert.alert('안내', 'MV 제작 기능은 준비 중입니다.');
      return;
    }

    const director = DIRECTORS.find((d) => d.type === type);
    navigation.navigate('Dialogue', {
      directorType: type,
      directorName: DIRECTOR_NAMES[type],
      directorRole: DIRECTOR_ROLES[type],
      directorY: director?.y ?? 0,
    });
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <View style={{ width: screenWidth, height: displayHeight }}>
          <Image
            source={MAP_IMAGE}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: screenWidth,
              height: displayHeight,
            }}
            resizeMode="contain"
          />
          {DIRECTORS.map((d) => {
            const task = timerStore.getTask(d.type);
            return (
              <View key={d.type}>
                <Character
                  type={d.type}
                  x={d.x}
                  y={d.y}
                  mapScale={mapScale}
                  onPress={() => handleDirectorPress(d.type)}
                />
                {/* Queue status above director - ticket style */}
                {task && (
                  <View style={{
                    position: 'absolute',
                    left: (d.x - 50) * mapScale,
                    top: (d.y - 100) * mapScale,
                    width: 120 * mapScale,
                    alignItems: 'center',
                  }}>
                    <View style={{
                      backgroundColor: task.queueNumber <= 0 ? '#27ae60' : '#fff',
                      borderRadius: 12 * mapScale,
                      paddingHorizontal: 14 * mapScale,
                      paddingVertical: 8 * mapScale,
                      alignItems: 'center',
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 2 },
                      shadowOpacity: 0.3,
                      shadowRadius: 4,
                      elevation: 5,
                      minWidth: 80 * mapScale,
                    }}>
                      <Text style={{
                        color: task.queueNumber <= 0 ? '#fff' : '#333',
                        fontSize: 11 * mapScale,
                        fontWeight: '600',
                        marginBottom: 2 * mapScale,
                      }}>
                        {task.taskName}
                      </Text>
                      <Text style={{
                        color: task.queueNumber <= 0 ? '#fff' : '#e94560',
                        fontSize: 20 * mapScale,
                        fontWeight: 'bold',
                      }}>
                        {task.queueNumber <= 0 ? '완료!' : `#${task.queueNumber}`}
                      </Text>
                    </View>
                    {/* Ticket notch */}
                    <View style={{
                      width: 0,
                      height: 0,
                      borderLeftWidth: 8 * mapScale,
                      borderRightWidth: 8 * mapScale,
                      borderTopWidth: 8 * mapScale,
                      borderLeftColor: 'transparent',
                      borderRightColor: 'transparent',
                      borderTopColor: task.queueNumber <= 0 ? '#27ae60' : '#fff',
                    }} />
                  </View>
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/* Non-logged-in touch overlay */}
      {!user && !showLoginOverlay && (
        <TouchableOpacity
          style={styles.guestTouchOverlay}
          activeOpacity={1}
          onPress={() => setShowLoginOverlay(true)}
        />
      )}

      {/* Login overlay modal */}
      {!user && showLoginOverlay && (
        <TouchableOpacity
          style={styles.loginOverlay}
          activeOpacity={1}
          onPress={() => setShowLoginOverlay(false)}
        >
          <View style={styles.loginOverlayContent}>
            <Text style={styles.loginOverlayIcon}>{'🎵'}</Text>
            <Text style={styles.loginOverlayTitle}>AI 음악 작업실</Text>
            <Text style={styles.loginOverlayDesc}>
              {'나만의 음악을 만들어서\n차트에 올려보세요!'}
            </Text>
            <TouchableOpacity
              style={styles.loginOverlayButton}
              onPress={() => navigation.getParent()?.navigate('Settings')}
            >
              <Text style={styles.loginOverlayButtonText}>로그인하고 시작하기</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      )}

      {/* Custom popup Modal */}
      <Modal visible={popupTask !== null} transparent animationType="fade" onRequestClose={() => setPopupTask(null)}>
        <View style={styles.popupOverlay}>
          <View style={styles.popupContainer}>
            {/* Close button - top right */}
            <TouchableOpacity style={styles.popupClose} onPress={() => setPopupTask(null)}>
              <Text style={styles.popupCloseText}>✕</Text>
            </TouchableOpacity>

            {/* Title */}
            <Text style={styles.popupTitle}>{popupTask?.task.taskName} 대기 중</Text>

            {/* Director portrait */}
            {popupTask && (
              <Image source={PORTRAITS[popupTask.type]} style={styles.popupPortrait} resizeMode="contain" />
            )}

            {/* Queue info */}
            <View style={styles.queueBadge}>
              <Text style={styles.queueLabel}>대기번호</Text>
              <Text style={styles.queueNumber}>#{popupTask?.task.queueNumber}</Text>
            </View>

            {/* Description */}
            <Text style={styles.popupDesc}>
              대기번호를 앞으로 당기고 싶나요?{'\n'}광고를 보면 순서를 앞당길 수 있어요!
            </Text>

            {/* Ad button */}
            <TouchableOpacity
              style={styles.adButton}
              onPress={() => {
                if (popupTask) {
                  showAdAndReduceQueue(popupTask.type);
                  setPopupTask(null);
                }
              }}
            >
              <Text style={styles.adButtonIcon}>▶</Text>
              <Text style={styles.adButtonText}>광고 보고 순서 앞당기기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  scrollView: {
    flex: 1,
  },
  guestTouchOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  loginOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loginOverlayContent: {
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  loginOverlayIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  loginOverlayTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
  },
  loginOverlayDesc: {
    fontSize: 15,
    color: '#ccc',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 28,
  },
  loginOverlayButton: {
    backgroundColor: '#e94560',
    borderRadius: 24,
    paddingVertical: 14,
    paddingHorizontal: 40,
  },
  loginOverlayButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  // Popup Modal styles
  popupOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  popupContainer: {
    width: '85%',
    backgroundColor: '#1a1a2e',
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#e94560',
    padding: 24,
    alignItems: 'center',
  },
  popupClose: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#e94560',
    justifyContent: 'center',
    alignItems: 'center',
  },
  popupCloseText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  popupTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 16,
  },
  popupPortrait: {
    width: 100,
    height: 160,
    marginBottom: 16,
  },
  queueBadge: {
    backgroundColor: '#0a0a1a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e94560',
    paddingVertical: 8,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginBottom: 16,
  },
  queueLabel: {
    color: '#888',
    fontSize: 12,
  },
  queueNumber: {
    color: '#e94560',
    fontSize: 28,
    fontWeight: 'bold',
  },
  popupDesc: {
    color: '#aaa',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  adButton: {
    flexDirection: 'row',
    backgroundColor: '#e94560',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 24,
    gap: 8,
    alignItems: 'center',
  },
  adButtonIcon: {
    color: '#fff',
    fontSize: 16,
  },
  adButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
