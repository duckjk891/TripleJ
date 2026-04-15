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

const COMPOSER_PORTRAIT = require('../assets/portraits/composer_director.png');
const WONDERA_PORTRAIT = require('../assets/portraits/wondera_director.png');

type Props = NativeStackScreenProps<any, 'MusicLoading'>;

const LOADING_MESSAGES = [
  '멜로디를 구상하고 있어요...',
  '화음을 넣고 있어요...',
  '작곡 중이에요...',
  '믹싱 중이에요...',
  '마무리 중이에요...',
];

export default function MusicLoadingScreen({ navigation }: Props) {
  const store = useMusicStore();
  const lyricsStore = useLyricsStore();
  const [messageIndex, setMessageIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const portrait = store.selectedModel === 'suno' ? COMPOSER_PORTRAIT : WONDERA_PORTRAIT;

  // Cycle loading messages
  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex((i) => (i + 1) % LOADING_MESSAGES.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

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
                  url = `http://192.168.219.106:9001/api/tracks/stream/${trackId}`;
                } else if (rawUrl) {
                  // result_audio_url is a MinIO object name; use generation stream endpoint
                  url = `http://192.168.219.106:9001/api/generate/${genId}/stream/`;
                } else {
                  url = '';
                }
                store.setResultUrl(url);
                if (trackId) store.setGenerationId(trackId);
                store.setStatus('completed');
                store.setIsLoading(false);
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
            url = `http://192.168.219.106:9001/api/tracks/stream/${trackId}`;
          } else if (rawUrl) {
            url = `http://192.168.219.106:9001/api/generate/${genId}/stream/`;
          } else {
            url = '';
          }
          store.setResultUrl(url);
          if (trackId) store.setGenerationId(trackId);
          store.setStatus('completed');
          store.setIsLoading(false);
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

        <Text style={styles.loadingText}>{LOADING_MESSAGES[messageIndex]}</Text>

        <ActivityIndicator size="large" color="#e94560" style={styles.spinner} />

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
            작곡 디렉터가 음악을 생성하고 있습니다.{'\n'}
            잠시만 기다려주세요. 1~3분 정도 소요될 수 있어요.
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a1a',
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
    borderColor: '#e94560',
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
    color: '#fff',
    marginBottom: 24,
    textAlign: 'center',
  },
  spinner: {
    marginBottom: 24,
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
    backgroundColor: '#1a1a2e',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#e94560',
    borderRadius: 4,
  },
  progressText: {
    color: '#aaa',
    fontSize: 14,
    fontWeight: '600',
    minWidth: 40,
    textAlign: 'right',
  },
  noteContainer: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  noteText: {
    fontSize: 13,
    color: '#888',
    textAlign: 'center',
    lineHeight: 20,
  },
});
