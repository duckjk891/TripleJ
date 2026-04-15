import { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Image,
  TouchableOpacity,
  Animated,
  Alert,
  Platform,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Character, { DirectorType } from '../components/Character';

// AdMob Rewarded Ad
let RewardedAd: any = null;
let RewardedAdEventType: any = null;
let TestIds: any = null;
let adUnitId: string = '';

try {
  const admob = require('react-native-google-mobile-ads');
  RewardedAd = admob.RewardedAd;
  RewardedAdEventType = admob.RewardedAdEventType;
  TestIds = admob.TestIds;
  // 테스트 광고 ID (프로덕션에서는 실제 ID로 교체)
  adUnitId = TestIds?.REWARDED ?? 'ca-app-pub-3940256099942544/5224354917';
} catch {
  // react-native-google-mobile-ads not available (Expo Go)
  console.log('[AdMob] Not available - using mock ads');
}

const PORTRAITS: Record<string, any> = {
  artist: require('../assets/portraits/artist_director.png'),
  lyricist: require('../assets/portraits/lyricist_director.png'),
  composer: require('../assets/portraits/composer_director.png'),
  image: require('../assets/portraits/image_director.png'),
  video: require('../assets/portraits/video_director.png'),
};

type Props = NativeStackScreenProps<any, 'WaitTimer'>;

export default function WaitTimerScreen({ route, navigation }: Props) {
  const { directorType, taskName } = route.params as {
    directorType: DirectorType;
    taskName: string;
  };

  const INITIAL_SECONDS = 5 * 60 * 60; // 5 hours in seconds
  const AD_REWARD_SECONDS = 30 * 60; // 30 minutes per ad

  const [remainingSeconds, setRemainingSeconds] = useState(INITIAL_SECONDS);
  const [isWatchingAd, setIsWatchingAd] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Countdown timer
  useEffect(() => {
    const timer = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          if (taskName === '작사') {
            navigation.replace('LyricsLoading');
          } else {
            navigation.replace('MusicLoading');
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Pulse animation for the ad button
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.05,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  const formatTime = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const applyReward = useCallback(() => {
    setRemainingSeconds((prev) => {
      const newTime = prev - AD_REWARD_SECONDS;
      if (newTime <= 0) {
        if (taskName === '작사') {
          navigation.replace('LyricsLoading');
        } else {
          navigation.replace('MusicLoading');
        }
        return 0;
      }
      return newTime;
    });
    Alert.alert('보상 획득!', '30분이 단축되었습니다!');
  }, [taskName, navigation]);

  const handleWatchAd = async () => {
    setIsWatchingAd(true);

    // 실제 AdMob 사용 가능한 경우
    if (RewardedAd) {
      try {
        const rewarded = RewardedAd.createForAdRequest(adUnitId);

        const unsubLoaded = rewarded.addAdEventListener(
          RewardedAdEventType.LOADED,
          () => {
            rewarded.show();
          }
        );

        const unsubEarned = rewarded.addAdEventListener(
          RewardedAdEventType.EARNED_REWARD,
          () => {
            applyReward();
            unsubLoaded();
            unsubEarned();
            setIsWatchingAd(false);
          }
        );

        rewarded.load();

        // 타임아웃 (10초 내 로드 안되면 실패)
        setTimeout(() => {
          if (isWatchingAd) {
            unsubLoaded();
            unsubEarned();
            setIsWatchingAd(false);
            Alert.alert('오류', '광고를 불러올 수 없습니다. 다시 시도해주세요.');
          }
        }, 10000);
      } catch {
        setIsWatchingAd(false);
        Alert.alert('오류', '광고를 불러올 수 없습니다.');
      }
    } else {
      // Mock: Expo Go에서는 3초 대기 후 보상 지급
      try {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        applyReward();
      } catch {
        Alert.alert('오류', '광고를 불러올 수 없습니다.');
      } finally {
        setIsWatchingAd(false);
      }
    }
  };

  const portrait = PORTRAITS[directorType];

  return (
    <View style={styles.container}>
      {/* Director character (2D sprite) */}
      <View style={styles.spriteContainer}>
        <Character type={directorType} x={0} y={0} mapScale={2} />
      </View>

      {/* Director portrait */}
      <Image source={portrait} style={styles.portrait} resizeMode="contain" />

      {/* Task info */}
      <Text style={styles.taskName}>{taskName} 진행 중...</Text>

      {/* Timer */}
      <View style={styles.timerBox}>
        <Text style={styles.timerLabel}>완료까지 남은 시간</Text>
        <Text style={styles.timerText}>{formatTime(remainingSeconds)}</Text>
      </View>

      {/* Ad button */}
      <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
        <TouchableOpacity
          style={[styles.adButton, isWatchingAd && styles.adButtonDisabled]}
          onPress={handleWatchAd}
          disabled={isWatchingAd}
        >
          <Text style={styles.adButtonIcon}>{'▶'}</Text>
          <View>
            <Text style={styles.adButtonText}>
              {isWatchingAd ? '광고 시청 중...' : '광고 보고 시간 단축하기'}
            </Text>
            <Text style={styles.adButtonSub}>30분 단축</Text>
          </View>
        </TouchableOpacity>
      </Animated.View>

      {/* Skip button (for testing) */}
      <TouchableOpacity
        style={styles.skipButton}
        onPress={() => {
          if (taskName === '작사') {
            navigation.replace('LyricsLoading');
          } else {
            navigation.replace('MusicLoading');
          }
        }}
      >
        <Text style={styles.skipButtonText}>건너뛰기 (테스트용)</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a1a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  spriteContainer: {
    width: 64,
    height: 128,
    marginBottom: 10,
  },
  portrait: {
    width: 120,
    height: 200,
    marginBottom: 20,
  },
  taskName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 24,
  },
  timerBox: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#e94560',
    paddingVertical: 20,
    paddingHorizontal: 40,
    alignItems: 'center',
    marginBottom: 32,
  },
  timerLabel: {
    fontSize: 14,
    color: '#888',
    marginBottom: 8,
  },
  timerText: {
    fontSize: 40,
    fontWeight: 'bold',
    color: '#e94560',
    fontVariant: ['tabular-nums'],
  },
  adButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e94560',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 24,
    gap: 12,
    marginBottom: 16,
  },
  adButtonDisabled: {
    backgroundColor: '#555',
  },
  adButtonIcon: {
    fontSize: 20,
    color: '#fff',
  },
  adButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
  },
  adButtonSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 2,
  },
  skipButton: {
    marginTop: 20,
  },
  skipButtonText: {
    fontSize: 13,
    color: '#555',
    textDecorationLine: 'underline',
  },
});
