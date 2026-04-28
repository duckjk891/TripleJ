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
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMusicStore } from '../stores/musicStore';
import { useLyricsStore } from '../stores/lyricsStore';
import {
  generateWithSuno,
  generateWithWondera,
  getGenerationStatus,
} from '../services/musicService';
import { BACKEND_BASE_URL } from '../services/api';
import { useGemsStore } from '../stores/gemsStore';
import { useArtistStore } from '../stores/artistStore';
import { useCompanyStore } from '../stores/companyStore';
import { GEM_REWARDS } from '../data/directors';
import { colors } from '../theme/colors';

const COMPOSER_PORTRAIT = require('../assets/portraits/composer_director.png');
const WONDERA_PORTRAIT = require('../assets/portraits/wondera_director.png');

type Props = NativeStackScreenProps<any, 'MusicLoading'>;

const LOADING_STEPS = [
  { label: '멜로디', message: '멜로디를 구상하고 있어요...' },
  { label: '화음', message: '화음을 넣고 있어요...' },
  { label: '작곡', message: '작곡 중이에요...' },
  { label: '믹싱', message: '믹싱 중이에요...' },
  { label: '마무리', message: '마무리 중이에요...' },
];

export default function MusicLoadingScreen({ navigation }: Props) {
  const store = useMusicStore();
  const lyricsStore = useLyricsStore();
  const [messageIndex, setMessageIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const portrait = store.selectedModel === 'suno' ? COMPOSER_PORTRAIT : WONDERA_PORTRAIT;

  // Advance loading step (cap at last; progress % from poll drives earlier jumps)
  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex((i) => Math.min(i + 1, LOADING_STEPS.length - 1));
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // Sync step with progress % when available (0-100 → step index)
  useEffect(() => {
    if (progress > 0) {
      const stepFromProgress = Math.min(
        Math.floor((progress / 100) * LOADING_STEPS.length),
        LOADING_STEPS.length - 1
      );
      setMessageIndex((i) => Math.max(i, stepFromProgress));
    }
  }, [progress]);

  // Pulse animation
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

  // Call generation API
  useEffect(() => {
    let isMounted = true;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    const doGenerate = async () => {
      store.setIsLoading(true);
      store.setError(null);
      store.setStatus('pending');

      try {
        const params = {
          lyrics: store.lyrics,
          title: lyricsStore.generatedTitle || undefined,
          genre: store.genre,
          mood: store.mood,
          tempo: store.tempo,
          vocal: store.vocal || undefined,
          vocalStyle: store.vocalStyle || undefined,
          referenceFile: store.referenceFile || undefined,
          isDuet: lyricsStore.isDuet || undefined,
          subVocal: store.subVocal || undefined,
          subVocalStyle: store.subVocalStyle || undefined,
        };

        let result: any;
        if (store.selectedModel === 'suno') {
          result = await generateWithSuno(params);
        } else {
          result = await generateWithWondera(params);
        }

        if (!isMounted) return;

        // Check if we got a generation ID to poll
        const genId = result.generation_id || result.id || result.task_id;

        if (genId) {
          store.setGenerationId(genId);
          store.setStatus('processing');

          // Poll for status
          pollInterval = setInterval(async () => {
            try {
              const status = await getGenerationStatus(genId);
              if (!isMounted) return;

              if (status.progress) {
                setProgress(status.progress);
              }

              if (
                status.status === 'completed' ||
                status.status === 'complete'
              ) {
                if (pollInterval) clearInterval(pollInterval);
                const trackId = status.result_track_id || status.track_id;
                const rawUrl =
                  status.audio_url ||
                  status.result_audio_url ||
                  status.result_url ||
                  status.url ||
                  status.output_url ||
                  '';
                // Build playable URL
                let url: string;
                if (trackId) {
                  url = `${BACKEND_BASE_URL}/api/tracks/stream/${trackId}`;
                } else if (rawUrl) {
                  // result_audio_url is a MinIO object name; use generation stream endpoint
                  url = `${BACKEND_BASE_URL}/api/generate/${genId}/stream/`;
                } else {
                  url = '';
                }
                store.setResultUrl(url);
                if (trackId) store.setGenerationId(trackId);
                store.setStatus('completed');
                store.setIsLoading(false);
                useGemsStore.getState().earn(GEM_REWARDS.TRACK_MUSIC_DONE, 'track_music_done', trackId);
                // 곡 발매 EXP — 아티스트 +50 / 기획사 +30
                useArtistStore.getState().addExp(50, 'release');
                useCompanyStore.getState().addExp(30, 'release');
                navigation.replace('MusicResult');
              } else if (status.status === 'failed' || status.status === 'error') {
                if (pollInterval) clearInterval(pollInterval);
                store.setError(status.error || '음악 생성에 실패했습니다.');
                store.setStatus('failed');
                store.setIsLoading(false);
                navigation.replace('MusicResult');
              }
            } catch {
              // Poll error, keep trying
            }
          }, 3000);
        } else {
          // Direct result (no polling needed)
          const trackId = result.result_track_id || result.track_id;
          const rawUrl =
            result.audio_url ||
            result.result_audio_url ||
            result.result_url ||
            result.url ||
            result.output_url ||
            '';
          // Build playable URL
          let url: string;
          if (trackId) {
            url = `${BACKEND_BASE_URL}/api/tracks/stream/${trackId}`;
          } else if (rawUrl) {
            url = `${BACKEND_BASE_URL}/api/generate/${genId}/stream/`;
          } else {
            url = '';
          }
          store.setResultUrl(url);
          if (trackId) store.setGenerationId(trackId);
          store.setStatus('completed');
          store.setIsLoading(false);
          useGemsStore.getState().earn(GEM_REWARDS.TRACK_MUSIC_DONE, 'track_music_done', trackId);
          navigation.replace('MusicResult');
        }
      } catch (err: any) {
        if (!isMounted) return;
        const errorMsg =
          err?.response?.data?.detail ||
          err?.message ||
          '음악 생성에 실패했습니다.';
        store.setError(errorMsg);
        store.setStatus('failed');
        store.setIsLoading(false);
        navigation.replace('MusicResult');
      }
    };

    doGenerate();

    return () => {
      isMounted = false;
      if (pollInterval) clearInterval(pollInterval);
    };
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <View style={styles.portraitContainer}>
            <Image source={portrait} style={styles.portraitImage} />
          </View>
        </Animated.View>

        <Text style={styles.loadingText}>{LOADING_STEPS[messageIndex].message}</Text>

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
                  <Text style={styles.stepDotText}>
                    {state === 'done' ? '✓' : i + 1}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.stepLabel,
                    state === 'active' && styles.stepLabelActive,
                    state === 'done' && styles.stepLabelDone,
                  ]}
                  numberOfLines={1}
                >
                  {s.label}
                </Text>
              </View>
            );
          })}
        </View>

        {progress > 0 && (
          <View style={styles.progressContainer}>
            <View style={styles.progressBar}>
              <View
                style={[styles.progressFill, { width: `${progress}%` }]}
              />
            </View>
            <Text style={styles.progressText}>{Math.round(progress)}%</Text>
          </View>
        )}

        <View style={styles.noteContainer}>
          <Text style={styles.noteText}>
            작곡 디렉터가 {messageIndex + 1}/{LOADING_STEPS.length} 단계를 진행 중이에요.{'\n'}
            1~3분 정도 소요될 수 있어요.
          </Text>
        </View>
      </View>
    </View>
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
    marginBottom: 20,
  },
  stepRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  stepItem: {
    alignItems: 'center',
    flex: 1,
  },
  stepDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
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
    fontSize: 11,
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
  progressContainer: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
    gap: 12,
  },
  progressBar: {
    flex: 1,
    height: 8,
    backgroundColor: colors.bg.surface1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.accent.primary,
    borderRadius: 4,
  },
  progressText: {
    color: colors.text.secondary,
    fontSize: 14,
    fontWeight: '600',
    minWidth: 40,
    textAlign: 'right',
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
