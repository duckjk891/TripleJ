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
import AppScreenLayout from '../components/AppScreenLayout';
import { colors } from '../theme/colors';
import { AppText } from '../components/ui';

// AdMob Rewarded Ad
let RewardedAd: any = null;
let RewardedAdEventType: any = null;
let TestIds: any = null;
let adUnitId: string = '';

// web에서는 native-only 모듈이라 import 자체 스킵 (metro.config.js에서도 empty 처리)
if (Platform.OS !== 'web') {
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
  // 광고 pre-load — 화면 mount 시 미리 받아두면 사용자 클릭 시 즉시 show
  const preloadedAdRef = useRef<any>(null);
  const preloadedAdReadyRef = useRef(false);
  const adUnsubsRef = useRef<Array<() => void>>([]);

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

  // 광고 pre-load — 화면 진입 시 백그라운드로 load
  useEffect(() => {
    if (!RewardedAd) return;
    try {
      const rewarded = RewardedAd.createForAdRequest(adUnitId);
      preloadedAdRef.current = rewarded;
      const unsubLoaded = rewarded.addAdEventListener(
        RewardedAdEventType.LOADED,
        () => {
          preloadedAdReadyRef.current = true;
        }
      );
      adUnsubsRef.current.push(unsubLoaded);
      rewarded.load();
    } catch (e) {
      console.warn('[Ad] preload 실패:', e);
    }
    return () => {
      adUnsubsRef.current.forEach((un) => { try { un(); } catch {} });
      adUnsubsRef.current = [];
      preloadedAdRef.current = null;
      preloadedAdReadyRef.current = false;
    };
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

    if (RewardedAd) {
      try {
        // pre-load된 광고가 ready면 즉시 show, 아니면 fallback으로 새 load
        const rewarded = preloadedAdReadyRef.current && preloadedAdRef.current
          ? preloadedAdRef.current
          : RewardedAd.createForAdRequest(adUnitId);

        let earned = false;
        const unsubEarned = rewarded.addAdEventListener(
          RewardedAdEventType.EARNED_REWARD,
          () => {
            earned = true;
            applyReward();
          }
        );
        const unsubClosed = rewarded.addAdEventListener(
          'closed',
          () => {
            try { unsubEarned(); } catch {}
            try { unsubClosed(); } catch {}
            setIsWatchingAd(false);
            preloadedAdReadyRef.current = false;
            preloadedAdRef.current = null;
            // 다음 광고 pre-load 시작
            try {
              const next = RewardedAd.createForAdRequest(adUnitId);
              preloadedAdRef.current = next;
              const unsubNext = next.addAdEventListener(
                RewardedAdEventType.LOADED,
                () => { preloadedAdReadyRef.current = true; }
              );
              adUnsubsRef.current.push(unsubNext);
              next.load();
            } catch {}
          }
        );

        if (preloadedAdReadyRef.current) {
          // 이미 로드 완료 → 즉시 show
          rewarded.show();
        } else {
          // 로드 안 됐으면 load 후 자동 show
          const unsubLoaded = rewarded.addAdEventListener(
            RewardedAdEventType.LOADED,
            () => {
              rewarded.show();
              try { unsubLoaded(); } catch {}
            }
          );
          rewarded.load();
          // 10초 내 로드 안되면 실패
          setTimeout(() => {
            if (!earned && isWatchingAd) {
              try { unsubLoaded(); } catch {}
              setIsWatchingAd(false);
              Alert.alert('오류', '광고를 불러올 수 없습니다. 다시 시도해주세요.');
            }
          }, 10000);
        }
      } catch {
        setIsWatchingAd(false);
        Alert.alert('오류', '광고를 불러올 수 없습니다.');
      }
    } else {
      // Mock (Expo Go) — 3초 대기 제거, 즉시 보상
      applyReward();
      setIsWatchingAd(false);
    }
  };

  const portrait = PORTRAITS[directorType];

  return (
    <AppScreenLayout
      scroll={false}
      insideTab
      avoidMiniPlayer={false}
      contentStyle={styles.container}
    >
      {/* Director character (2D sprite) */}
      <View style={styles.spriteContainer}>
        <Character type={directorType} x={0} y={0} mapScale={2} />
      </View>

      {/* Director portrait */}
      <Image source={portrait} style={styles.portrait} resizeMode="contain" />

      {/* Task info */}
      <AppText variant="title2" style={styles.taskName}>{taskName} 진행 중...</AppText>

      {/* Timer */}
      <View style={styles.timerBox}>
        <AppText variant="bodyLg" tone="secondary" style={styles.timerLabel}>완료까지 남은 시간</AppText>
        <AppText style={styles.timerText}>{formatTime(remainingSeconds)}</AppText>
      </View>

      {/* Ad button */}
      <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
        <TouchableOpacity
          style={[styles.adButton, isWatchingAd && styles.adButtonDisabled]}
          onPress={handleWatchAd}
          disabled={isWatchingAd}
        >
          <AppText style={styles.adButtonIcon}>{'▶'}</AppText>
          <View>
            <AppText variant="callout" tone="primary" style={styles.adButtonText}>
              {isWatchingAd ? '광고 시청 중...' : '광고 보고 시간 단축하기'}
            </AppText>
            <AppText style={styles.adButtonSub}>30분 단축</AppText>
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
        <AppText variant="body" tone="muted" style={styles.skipButtonText}>건너뛰기 (테스트용)</AppText>
      </TouchableOpacity>
    </AppScreenLayout>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.deepest,
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
    marginBottom: 24,
  },
  timerBox: {
    backgroundColor: colors.bg.surface1,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.accent.primary,
    paddingVertical: 20,
    paddingHorizontal: 40,
    alignItems: 'center',
    marginBottom: 32,
  },
  timerLabel: {
    marginBottom: 8,
  },
  timerText: {
    fontSize: 40,
    fontWeight: 'bold',
    color: colors.accent.primary,
    fontVariant: ['tabular-nums'],
  },
  adButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accent.primary,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 24,
    gap: 12,
    marginBottom: 16,
  },
  adButtonDisabled: {
    backgroundColor: colors.text.muted,
  },
  adButtonIcon: {
    fontSize: 20,
    color: colors.text.primary,
  },
  adButtonText: {},
  adButtonSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 2,
  },
  skipButton: {
    marginTop: 20,
  },
  skipButtonText: {
    textDecorationLine: 'underline',
  },
});
