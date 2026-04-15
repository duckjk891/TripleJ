import { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Audio } from 'expo-av';
import { useMusicStore } from '../stores/musicStore';
import { useAuthStore } from '../stores/authStore';
import { useLyricsStore } from '../stores/lyricsStore';
import api from '../services/api';

const COMPOSER_PORTRAIT = require('../assets/portraits/composer_director.png');
const WONDERA_PORTRAIT = require('../assets/portraits/wondera_director.png');
const IMAGE_PORTRAIT = require('../assets/portraits/image_director.png');

type Props = NativeStackScreenProps<any, 'MusicResult'>;

export default function MusicResultScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const store = useMusicStore();
  const { token } = useAuthStore();
  const lyricsStore = useLyricsStore();
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);

  const portrait = store.selectedModel === 'suno' ? COMPOSER_PORTRAIT : WONDERA_PORTRAIT;
  const composerName = store.selectedModel === 'suno' ? 'Suno 작곡가' : 'Wondera 작곡가';
  const hasError = !!store.error;
  const hasResult = !!store.resultUrl;

  // Load audio
  useEffect(() => {
    let mounted = true;

    const loadAudio = async () => {
      if (!store.resultUrl) return;

      // Ensure URL uses accessible IP instead of localhost
      let audioUrl = store.resultUrl;
      if (audioUrl.includes('localhost') || audioUrl.includes('127.0.0.1') || audioUrl.includes('minio:')) {
        audioUrl = audioUrl.replace(/localhost|127\.0\.0\.1/g, '192.168.219.106');
        audioUrl = audioUrl.replace(/minio:\d+/, '192.168.219.106:5000');
      }
      console.log('[MusicResult] Loading audio from:', audioUrl);

      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
        });

        const { sound: newSound } = await Audio.Sound.createAsync(
          {
            uri: audioUrl,
            ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
          },
          { shouldPlay: false },
          (status) => {
            if (!mounted) return;
            if (status.isLoaded) {
              setPosition(status.positionMillis || 0);
              setDuration(status.durationMillis || 0);
              if (status.didJustFinish) {
                setIsPlaying(false);
              }
            }
          }
        );

        if (mounted) {
          setSound(newSound);
        }
      } catch {
        // Audio loading failed
      }
    };

    loadAudio();

    return () => {
      mounted = false;
      if (sound) {
        sound.unloadAsync();
      }
    };
  }, [store.resultUrl]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (sound) {
        sound.unloadAsync();
      }
    };
  }, [sound]);

  const togglePlay = async () => {
    if (!sound) return;

    if (isPlaying) {
      await sound.pauseAsync();
      setIsPlaying(false);
    } else {
      await sound.playAsync();
      setIsPlaying(true);
    }
  };

  const formatTime = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  const handleRegenerate = () => {
    if (sound) {
      sound.unloadAsync();
      setSound(null);
    }
    store.setResultUrl(null);
    store.setError(null);
    store.setStatus('idle');
    store.setGenerationId(null);
    navigation.replace('MusicGeneration');
  };

  const handleSave = async () => {
    if (!store.generationId) {
      console.error('[Save] generationId가 없습니다. store:', JSON.stringify({
        generationId: store.generationId,
        resultUrl: store.resultUrl,
        status: store.status,
      }));
      Alert.alert('오류', '저장할 곡 정보가 없습니다.');
      return;
    }
    if (isSaving || isSaved) return;

    setIsSaving(true);
    const payload = {
      generation_id: store.generationId,
      title: lyricsStore.generatedTitle
        || (store.genre && store.mood ? `${store.genre} - ${store.mood}` : store.genre || store.mood || '새로운 곡'),
      genre: store.genre || undefined,
      mood: store.mood || undefined,
      prompt: store.lyrics || undefined,
      lyrics: lyricsStore.generatedLyrics || store.lyrics || undefined,
      ai_model: store.selectedModel === 'suno' ? 'Suno' : 'Wondera',
    };
    console.log('[Save] 저장 요청:', JSON.stringify(payload));

    try {
      const res = await api.post('/tracks/upload-from-generation', payload);
      console.log('[Save] 저장 성공:', JSON.stringify(res.data));

      // 비공개로 전환 (차트에 바로 노출 방지, 마이뮤직에서만 관리)
      const trackId = res.data?.id;
      if (trackId) {
        try {
          await api.put(`/tracks/${trackId}`, { is_public: false });
          console.log('[Save] 비공개 전환 완료');
        } catch {
          console.warn('[Save] 비공개 전환 실패 (트랙은 저장됨)');
        }
      }

      if (trackId) store.setSavedTrackId(trackId);
      setIsSaved(true);
      Alert.alert('저장 완료', '마이뮤직에서 확인할 수 있어요!');
    } catch (err: any) {
      const status = err?.response?.status;
      const data = err?.response?.data;
      console.error('[Save] 저장 실패:', status, JSON.stringify(data));
      const msg = data?.error || err?.message || '저장에 실패했습니다.';
      Alert.alert('저장 실패', `${msg}\n(상태: ${status || 'unknown'})`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleGenerateCover = () => {
    navigation.navigate('CoverGeneration');
  };

  const handleBackToMap = () => {
    if (sound) {
      sound.unloadAsync();
    }
    navigation.popToTop();
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 16 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Director message */}
        <View style={styles.directorRow}>
          <View style={styles.portraitContainer}>
            <Image source={portrait} style={styles.portraitImage} />
          </View>
          <View style={styles.directorBubble}>
            <Text style={styles.directorName}>{composerName}</Text>
            <Text style={styles.directorText}>
              {hasError
                ? '앗, 문제가 생겼어요. 다시 시도해볼까요?'
                : '곡이 완성됐어요! 들어보세요!'}
            </Text>
          </View>
        </View>

        {/* Error display */}
        {hasError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{typeof store.error === 'string' ? store.error : JSON.stringify(store.error)}</Text>
          </View>
        )}

        {/* Audio player */}
        {hasResult && (
          <View style={styles.playerContainer}>
            <View style={styles.playerCard}>
              {/* Album art placeholder */}
              <View style={styles.albumArt}>
                <Image source={portrait} style={styles.albumImage} />
              </View>

              <Text style={styles.trackTitle}>
                {lyricsStore.generatedTitle || `${store.genre} - ${store.mood}`}
              </Text>
              <Text style={styles.trackSubtitle}>
                {composerName} | {store.tempo} 템포
              </Text>

              {/* Progress bar */}
              <View style={styles.progressContainer}>
                <View style={styles.progressBar}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: duration > 0
                          ? `${(position / duration) * 100}%`
                          : '0%',
                      },
                    ]}
                  />
                </View>
                <View style={styles.timeRow}>
                  <Text style={styles.timeText}>{formatTime(position)}</Text>
                  <Text style={styles.timeText}>{formatTime(duration)}</Text>
                </View>
              </View>

              {/* Play/Pause button */}
              <TouchableOpacity
                style={styles.playButton}
                onPress={togglePlay}
              >
                <Text style={styles.playButtonText}>
                  {isPlaying ? '일시정지' : '재생'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Action buttons */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={styles.regenerateButton}
            onPress={handleRegenerate}
          >
            <Text style={styles.regenerateButtonText}>다시 생성하기</Text>
          </TouchableOpacity>

          {hasResult && (
            <TouchableOpacity
              style={[styles.saveButton, (isSaving || isSaved) && { opacity: 0.6 }]}
              onPress={handleSave}
              disabled={isSaving || isSaved}
            >
              <Text style={styles.saveButtonText}>
                {isSaved ? '저장 완료' : isSaving ? '저장 중...' : '저장하기'}
              </Text>
            </TouchableOpacity>
          )}

          {/* Cover image - 이미지 디렉터와 대화 */}
          {hasResult && (
            <TouchableOpacity
              style={styles.coverButton}
              onPress={handleGenerateCover}
            >
              <Text style={styles.coverButtonText}>커버 이미지 생성하기</Text>
            </TouchableOpacity>
          )}

          {/* MV button - future feature */}
          <TouchableOpacity
            style={[styles.mvButton, styles.mvButtonDisabled]}
            disabled
          >
            <Text style={styles.mvButtonText}>MV 만들기 (준비 중)</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.backButton}
            onPress={handleBackToMap}
          >
            <Text style={styles.backButtonText}>맵으로 돌아가기</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a1a',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingTop: 16,
  },
  directorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  portraitContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#e94560',
    marginRight: 12,
  },
  portraitImage: {
    width: 60,
    height: 180,
    resizeMode: 'cover',
    position: 'absolute',
    top: 0,
    left: 0,
  },
  directorBubble: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e94560',
    padding: 12,
  },
  directorName: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#e94560',
    marginBottom: 4,
  },
  directorText: {
    fontSize: 14,
    color: '#fff',
    lineHeight: 20,
  },
  errorBox: {
    backgroundColor: '#2e1a1a',
    borderWidth: 1,
    borderColor: '#e94560',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 13,
    lineHeight: 20,
  },
  playerContainer: {
    marginBottom: 24,
  },
  playerCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#e94560',
    padding: 24,
    alignItems: 'center',
  },
  albumArt: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: '#16213e',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 3,
    borderColor: '#e94560',
    overflow: 'hidden',
  },
  albumImage: {
    width: 140,
    height: 420,
    resizeMode: 'cover',
    position: 'absolute',
    top: 0,
    left: 0,
  },
  trackTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  trackSubtitle: {
    fontSize: 13,
    color: '#888',
    marginBottom: 20,
  },
  progressContainer: {
    width: '100%',
    marginBottom: 20,
  },
  progressBar: {
    width: '100%',
    height: 6,
    backgroundColor: '#333',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#e94560',
    borderRadius: 3,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  timeText: {
    color: '#666',
    fontSize: 12,
  },
  playButton: {
    backgroundColor: '#e94560',
    borderRadius: 30,
    paddingVertical: 14,
    paddingHorizontal: 48,
  },
  playButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  coverPreview: {
    alignItems: 'center',
    marginBottom: 12,
  },
  coverPreviewImage: {
    width: 200,
    height: 200,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#e94560',
  },
  coverButton: {
    backgroundColor: '#16213e',
    borderWidth: 1,
    borderColor: '#e94560',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  coverButtonText: {
    color: '#e94560',
    fontSize: 16,
    fontWeight: 'bold',
  },
  buttonContainer: {
    gap: 12,
  },
  regenerateButton: {
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#e94560',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  regenerateButtonText: {
    color: '#e94560',
    fontSize: 16,
    fontWeight: 'bold',
  },
  saveButton: {
    backgroundColor: '#e94560',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  mvButton: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  mvButtonDisabled: {
    opacity: 0.5,
  },
  mvButtonText: {
    color: '#666',
    fontSize: 16,
    fontWeight: 'bold',
  },
  backButton: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  backButtonText: {
    color: '#aaa',
    fontSize: 16,
    fontWeight: '600',
  },
});
