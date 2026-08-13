import { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Image,
  Animated,
  Easing,
  ActivityIndicator,
} from 'react-native';
import { AppText } from '../components/ui';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useLyricsStore } from '../stores/lyricsStore';
import { generateLyrics } from '../services/lyricsService';
import { useGemsStore } from '../stores/gemsStore';
import { GEM_REWARDS } from '../data/directors';
import AppScreenLayout from '../components/AppScreenLayout';
import { colors } from '../theme/colors';

const LYRICIST_PORTRAIT = require('../assets/portraits/lyricist_director.png');

type Props = NativeStackScreenProps<any, 'LyricsLoading'>;

const LOADING_STEPS = [
  { label: '영감 수집', message: '영감을 모으고 있어요...' },
  { label: '가사 작성', message: '가사를 쓰고 있어요...' },
  { label: '운율 정리', message: '운율을 맞추고 있어요...' },
  { label: '마무리', message: '마무리 중이에요...' },
];

export default function LyricsLoadingScreen({ navigation }: Props) {
  const store = useLyricsStore();
  const [messageIndex, setMessageIndex] = useState(0);
  const dotAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Advance loading step (cap at last step, API finish will navigate away)
  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex((i) => Math.min(i + 1, LOADING_STEPS.length - 1));
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Pulse animation for portrait
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  // Call API
  useEffect(() => {
    let isMounted = true;

    const doGenerate = async () => {
      store.setIsLoading(true);
      store.setError(null);

      try {
        const result = await generateLyrics({
          prompt: store.generatedPrompt,
          genre: store.genre,
          mood: store.mood,
          language: store.language,
          style: store.style || undefined,
          duration_minutes: store.duration >= 60 ? Math.round(store.duration / 60) : undefined,
        });

        if (isMounted) {
          const lyrics =
            result.lyrics || result.generated_lyrics || result.text || result.result || '';
          const title = result.title || '';
          store.setGeneratedTitle(title);
          store.setGeneratedLyrics(lyrics);
          store.setIsLoading(false);
          // 캐시 보상 지급
          useGemsStore.getState().earn(GEM_REWARDS.TRACK_LYRICS_DONE, 'track_lyrics_done');
          navigation.replace('LyricsResult');
        }
      } catch (err: any) {
        if (isMounted) {
          const status = err?.response?.status;
          let errorMsg: string;
          if (status === 401) {
            errorMsg = '로그인이 필요합니다. 설정에서 다시 로그인해주세요.';
          } else {
            errorMsg =
              err?.response?.data?.detail ||
              err?.message ||
              '가사 생성에 실패했습니다.';
          }
          store.setError(typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg));
          store.setIsLoading(false);
          navigation.replace('LyricsResult');
        }
      }
    };

    doGenerate();
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <AppScreenLayout scroll={false} insideTab avoidMiniPlayer={false}>
      <View style={styles.content}>
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <View style={styles.portraitContainer}>
            <Image source={LYRICIST_PORTRAIT} style={styles.portraitImage} />
          </View>
        </Animated.View>

        <AppText style={styles.loadingText}>{LOADING_STEPS[messageIndex].message}</AppText>

        <ActivityIndicator size="large" color={colors.accent.primary} style={styles.spinner} />

        {/* 스텝 인디케이터 */}
        <View style={styles.stepRow}>
          {LOADING_STEPS.map((s, i) => {
            const state = i < messageIndex ? 'done' : i === messageIndex ? 'active' : 'pending';
            return (
              <View key={s.label} style={styles.stepItem}>
                <View
                  style={[
                    styles.stepDot,
                    state === 'active' && styles.stepDotActive,
                    state === 'done' && styles.stepDotDone,
                  ]}
                >
                  <AppText style={styles.stepDotText}>
                    {state === 'done' ? '✓' : i + 1}
                  </AppText>
                </View>
                <AppText
                  style={[
                    styles.stepLabel,
                    state === 'active' && styles.stepLabelActive,
                    state === 'done' && styles.stepLabelDone,
                  ]}
                  numberOfLines={1}
                >
                  {s.label}
                </AppText>
              </View>
            );
          })}
        </View>

        <View style={styles.noteContainer}>
          <AppText style={styles.noteText}>
            작사 디렉터가 {messageIndex + 1}/{LOADING_STEPS.length} 단계를 진행 중이에요.{'\n'}잠시만 기다려주세요...
          </AppText>
        </View>
      </View>
    </AppScreenLayout>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.deepest,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  portraitContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: colors.accent.primary,
    marginBottom: 32,
  },
  portraitImage: {
    width: 120,
    height: 360,
    resizeMode: 'cover',
    position: 'absolute',
    top: 0,
    left: 0,
  },
  loadingText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text.primary,
    marginBottom: 24,
    textAlign: 'center',
  },
  spinner: {
    marginBottom: 24,
  },
  stepRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 24,
    paddingHorizontal: 4,
  },
  stepItem: {
    alignItems: 'center',
    flex: 1,
  },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.bg.surface1,
    borderWidth: 1.5,
    borderColor: colors.border.subtle,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  stepDotActive: {
    backgroundColor: colors.accent.primary,
    borderColor: colors.accent.primary,
  },
  stepDotDone: {
    backgroundColor: colors.bg.surface2,
    borderColor: colors.accent.primary,
  },
  stepDotText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text.primary,
  },
  stepLabel: {
    fontSize: 10,
    color: colors.text.muted,
    textAlign: 'center',
  },
  stepLabelActive: {
    color: colors.accent.primary,
    fontWeight: '700',
  },
  stepLabelDone: {
    color: colors.text.secondary,
  },
  noteContainer: {
    backgroundColor: colors.bg.surface1,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  noteText: {
    fontSize: 13,
    color: colors.text.secondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
