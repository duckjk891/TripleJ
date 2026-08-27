import { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { AppText } from '../components/ui';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Audio } from 'expo-av';
import { applyPlaybackAudioMode } from '../services/audioMode';
import { useMusicStore } from '../stores/musicStore';
import { useAuthStore } from '../stores/authStore';
import { useLyricsStore } from '../stores/lyricsStore';
import { usePlayerStore } from '../stores/playerStore';
import { useGemsStore } from '../stores/gemsStore';
import { useArtistStore } from '../stores/artistStore';
import { useCompanyStore } from '../stores/companyStore';
import { GEM_REWARDS } from '../data/directors';
import api, { BACKEND_BASE_URL } from '../services/api';
import { showAlert } from '../utils/appAlert';
import { colors } from '../theme/colors';

const COMPOSER_PORTRAIT = require('../assets/portraits/composer_director.png');
const WONDERA_PORTRAIT = require('../assets/portraits/wondera_director.png');
const IMAGE_PORTRAIT = require('../assets/portraits/image_director.png');

// 작곡 디렉터에서 받은 풍부한 파라미터를 한 줄 한 줄 요약 텍스트로 변환.
// PlayerScreen의 prompt 탭에 그대로 표시되도록 한국어 라벨 + 줄바꿈 구분.
function buildPromptSummary(music: any, lyrics: any): string | undefined {
  const lines: string[] = [];
  const add = (label: string, val: any) => {
    if (val === null || val === undefined) return;
    const s = String(val).trim();
    if (!s) return;
    lines.push(`${label}: ${s}`);
  };
  add('장르', music.genre || lyrics.genre);
  add('분위기', music.mood || lyrics.mood);
  add('템포', music.tempo);
  add('스타일', music.style || lyrics.style);
  add('보컬', music.vocal);
  add('보컬 스타일', music.vocalStyle);
  add('서브 보컬', music.subVocal);
  add('서브 보컬 스타일', music.subVocalStyle);
  add('BPM', music.bpm);
  add('키', music.musicalKey);
  add('레퍼런스 스타일', music.referenceStyle);
  add('네거티브 태그', music.negativeTags);
  add('Persona Model', music.personaModel);
  return lines.length > 0 ? lines.join('\n') : undefined;
}

// BUG-3 픽스: 발매 보상(젬+EXP)은 폴링 완료가 아니라 트랙 "저장 성공" 시에만 지급.
// 같은 generation 에 대한 재지급(저장 재시도·커버 경유 저장 등)은 모듈 레벨 Set 으로 가드.
const rewardedGenerationIds = new Set<string>();
function grantReleaseRewards(generationId: string, trackId?: string) {
  if (rewardedGenerationIds.has(generationId)) {
    if (__DEV__) console.log('[MusicResult] 발매 보상 이미 지급됨, 스킵:', generationId);
    return;
  }
  rewardedGenerationIds.add(generationId);
  useGemsStore.getState().earn(GEM_REWARDS.TRACK_MUSIC_DONE, 'track_music_done', trackId);
  // 곡 발매 EXP — 아티스트 +50 / 기획사 +30 (기존 MusicLoadingScreen 지급 로직 이동)
  useArtistStore.getState().addExp(50, 'release');
  useCompanyStore.getState().addExp(30, 'release');
  if (__DEV__) console.log('[MusicResult] 발매 보상 지급 완료:', generationId);
}

// MAIDOL 계약: 커버에 쓴 캐릭터 기준 { sheet_object_name, used_items } 스냅샷.
// 실패/미보유 시 null — 저장 페이로드에서 생략(회귀 금지).
async function fetchCharacterSnapshot(): Promise<
  { sheet_object_name: string; used_items: any[] } | null
> {
  try {
    const res = await api.get('/character/me');
    const ch = res.data?.character;
    if (ch?.sheet_object_name) {
      return {
        sheet_object_name: ch.sheet_object_name,
        used_items: Array.isArray(ch.used_items) ? ch.used_items : [],
      };
    }
    if (__DEV__) console.log('[MusicResult] 캐릭터 미보유 — snapshot 생략');
  } catch (err: any) {
    console.error('[MusicResult] /character/me 조회 실패 — snapshot 생략:', err?.response?.status, err?.message);
  }
  return null;
}

type Props = NativeStackScreenProps<any, 'MusicResult'>;

export default function MusicResultScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const store = useMusicStore();
  const { token } = useAuthStore();
  const lyricsStore = useLyricsStore();
  const hasMiniPlayer = !!usePlayerStore((s) => s.track);
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
      if (!store.resultUrl && !store.generationId && !store.savedTrackId) return;

      // 백엔드 프록시 우선 사용 (LTE/cloudflared 환경에서도 동작)
      // 저장된 트랙: stream-proxy / 생성 직후: generate stream / 폴백: 원본 URL
      let audioUrl: string;
      if (store.savedTrackId) {
        audioUrl = `${BACKEND_BASE_URL}/api/tracks/stream-proxy/${store.savedTrackId}`;
      } else if (store.generationId) {
        audioUrl = `${BACKEND_BASE_URL}/api/generate/${store.generationId}/stream/`;
      } else {
        audioUrl = store.resultUrl as string;
        // 폴백: 동일 LAN 환경에서 MinIO 직접 접근용 (LTE에서는 작동 안 함)
        if (audioUrl.includes('localhost') || audioUrl.includes('127.0.0.1') || audioUrl.includes('minio:')) {
          audioUrl = audioUrl.replace(/localhost|127\.0\.0\.1/g, '192.168.219.106');
          audioUrl = audioUrl.replace(/minio:\d+/, '192.168.219.106:5000');
        }
      }
      console.log('[MusicResult] Loading audio from:', audioUrl);

      try {
        await applyPlaybackAudioMode(); // v3.57: 재생 오디오 정책 공통화(타 앱 중단 포함)

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
  }, [store.resultUrl, store.generationId, store.savedTrackId]);

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
      showAlert('오류', '저장할 곡 정보가 없습니다.');
      return;
    }
    if (isSaving || isSaved) return;

    setIsSaving(true);
    // 저장 직전 캐릭터 스냅샷 시도 (실패/미보유 시 기존 페이로드 그대로)
    const snapshot = await fetchCharacterSnapshot();
    const payload = {
      generation_id: store.generationId,
      ...(snapshot ? { user_character_snapshot: snapshot } : {}),
      title: lyricsStore.generatedTitle
        || (store.genre && store.mood ? `${store.genre} - ${store.mood}` : store.genre || store.mood || '새로운 곡'),
      genre: store.genre || undefined,
      mood: store.mood || undefined,
      // prompt: 작곡 디렉터가 받은 풍부한 파라미터를 요약 텍스트로 합쳐서 저장.
      // 가사는 별도 lyrics 필드에 들어가니 여기선 제외.
      prompt: buildPromptSummary(store, lyricsStore),
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
      // BUG-3 픽스: 발매 보상은 트랙 저장 성공 직후에만 지급 (같은 generation 재지급 가드)
      grantReleaseRewards(String(payload.generation_id), trackId);
      lyricsStore.reset();
      showAlert('저장 완료', '마이뮤직에서 확인할 수 있어요!');
    } catch (err: any) {
      const status = err?.response?.status;
      const data = err?.response?.data;
      console.error('[Save] 저장 실패:', status, JSON.stringify(data));
      const msg = data?.error || err?.message || '저장에 실패했습니다.';
      showAlert('저장 실패', `${msg}\n(상태: ${status || 'unknown'})`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleGenerateCover = async () => {
    // 곡이 아직 저장 안 되었으면 먼저 저장
    if (!isSaved && store.generationId) {
      try {
        // 저장 직전 캐릭터 스냅샷 시도 (실패/미보유 시 기존 페이로드 그대로)
        const snapshot = await fetchCharacterSnapshot();
        const payload = {
          generation_id: store.generationId,
          ...(snapshot ? { user_character_snapshot: snapshot } : {}),
          title: lyricsStore.generatedTitle
            || (store.genre && store.mood ? `${store.genre} - ${store.mood}` : store.genre || store.mood || '새로운 곡'),
          genre: store.genre || undefined,
          mood: store.mood || undefined,
          prompt: store.lyrics || undefined,
          lyrics: lyricsStore.generatedLyrics || store.lyrics || undefined,
          ai_model: store.selectedModel === 'suno' ? 'Suno' : 'Wondera',
        };
        const res = await api.post('/tracks/upload-from-generation', payload);
        const trackId = res.data?.id;
        if (trackId) {
          try { await api.put(`/tracks/${trackId}`, { is_public: false }); } catch {}
          store.setSavedTrackId(trackId);
        }
        setIsSaved(true);
        // BUG-3 픽스: 커버 경유 저장도 동일하게 저장 성공 직후 지급 (중복 가드 공유)
        grantReleaseRewards(String(payload.generation_id), trackId);
        lyricsStore.reset();
      } catch (err: any) {
        console.error('[MusicResult] 커버 경유 저장 실패:', err?.response?.status, err?.message);
        showAlert('저장 실패', err?.response?.data?.error || '곡 저장에 실패했습니다.');
        return;
      }
    }
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
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 16, paddingBottom: 32 + (hasMiniPlayer ? 70 : 0) + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Director message */}
        <View style={styles.directorRow}>
          <View style={styles.portraitContainer}>
            <Image source={portrait} style={styles.portraitImage} />
          </View>
          <View style={styles.directorBubble}>
            <AppText style={styles.directorName}>{composerName}</AppText>
            <AppText style={styles.directorText}>
              {hasError
                ? '앗, 문제가 생겼어요. 다시 시도해볼까요?'
                : '곡이 완성됐어요! 들어보세요!'}
            </AppText>
          </View>
        </View>

        {/* Error display */}
        {hasError && (
          <View style={styles.errorBox}>
            <AppText style={styles.errorText}>{typeof store.error === 'string' ? store.error : JSON.stringify(store.error)}</AppText>
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

              <AppText style={styles.trackTitle}>
                {lyricsStore.generatedTitle || `${store.genre} - ${store.mood}`}
              </AppText>
              <AppText style={styles.trackSubtitle}>
                {composerName} | {store.tempo} 템포
              </AppText>

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
                  <AppText style={styles.timeText}>{formatTime(position)}</AppText>
                  <AppText style={styles.timeText}>{formatTime(duration)}</AppText>
                </View>
              </View>

              {/* Play/Pause button */}
              <TouchableOpacity
                style={styles.playButton}
                onPress={togglePlay}
              >
                <AppText style={styles.playButtonText}>
                  {isPlaying ? '일시정지' : '재생'}
                </AppText>
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
            <AppText style={styles.regenerateButtonText}>다시 생성하기</AppText>
          </TouchableOpacity>

          {hasResult && (
            <TouchableOpacity
              style={[styles.saveButton, (isSaving || isSaved) && { opacity: 0.6 }]}
              onPress={handleSave}
              disabled={isSaving || isSaved}
            >
              <AppText style={styles.saveButtonText}>
                {isSaved ? '저장 완료' : isSaving ? '저장 중...' : '저장하기'}
              </AppText>
            </TouchableOpacity>
          )}

          {/* Cover image - 이미지 디렉터와 대화 */}
          {hasResult && (
            <TouchableOpacity
              style={styles.coverButton}
              onPress={handleGenerateCover}
            >
              <AppText style={styles.coverButtonText}>커버 이미지 생성하기</AppText>
            </TouchableOpacity>
          )}

          {/* MV button - future feature */}
          <TouchableOpacity
            style={[styles.mvButton, styles.mvButtonDisabled]}
            disabled
          >
            <AppText style={styles.mvButtonText}>MV 만들기 (준비 중)</AppText>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.backButton}
            onPress={handleBackToMap}
          >
            <AppText style={styles.backButtonText}>맵으로 돌아가기</AppText>
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
    backgroundColor: colors.bg.deepest,
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
    borderColor: colors.accent.primary,
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
    backgroundColor: colors.bg.surface1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.accent.primary,
    padding: 12,
  },
  directorName: {
    fontSize: 13,
    fontWeight: 'bold',
    color: colors.accent.primary,
    marginBottom: 4,
  },
  directorText: {
    fontSize: 14,
    color: colors.text.primary,
    lineHeight: 20,
  },
  errorBox: {
    backgroundColor: colors.bg.surface2,
    borderWidth: 1,
    borderColor: colors.accent.primary,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  errorText: {
    color: colors.status.error,
    fontSize: 13,
    lineHeight: 20,
  },
  playerContainer: {
    marginBottom: 24,
  },
  playerCard: {
    backgroundColor: colors.bg.surface1,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.accent.primary,
    padding: 24,
    alignItems: 'center',
  },
  albumArt: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: colors.bg.surface2,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 3,
    borderColor: colors.accent.primary,
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
    color: colors.text.primary,
    marginBottom: 4,
  },
  trackSubtitle: {
    fontSize: 13,
    color: colors.text.secondary,
    marginBottom: 20,
  },
  progressContainer: {
    width: '100%',
    marginBottom: 20,
  },
  progressBar: {
    width: '100%',
    height: 6,
    backgroundColor: colors.border.subtle,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.accent.primary,
    borderRadius: 3,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  timeText: {
    color: colors.text.muted,
    fontSize: 12,
  },
  playButton: {
    backgroundColor: colors.accent.primary,
    borderRadius: 30,
    paddingVertical: 14,
    paddingHorizontal: 48,
  },
  playButtonText: {
    color: colors.text.primary,
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
    borderColor: colors.accent.primary,
  },
  coverButton: {
    backgroundColor: colors.bg.surface2,
    borderWidth: 1,
    borderColor: colors.accent.primary,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  coverButtonText: {
    color: colors.accent.primary,
    fontSize: 16,
    fontWeight: 'bold',
  },
  buttonContainer: {
    gap: 12,
  },
  regenerateButton: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.accent.primary,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  regenerateButtonText: {
    color: colors.accent.primary,
    fontSize: 16,
    fontWeight: 'bold',
  },
  saveButton: {
    backgroundColor: colors.accent.primary,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveButtonText: {
    color: colors.text.primary,
    fontSize: 16,
    fontWeight: 'bold',
  },
  mvButton: {
    backgroundColor: colors.bg.surface2,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  mvButtonDisabled: {
    opacity: 0.5,
  },
  mvButtonText: {
    color: colors.text.muted,
    fontSize: 16,
    fontWeight: 'bold',
  },
  backButton: {
    backgroundColor: colors.bg.surface1,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  backButtonText: {
    color: colors.text.secondary,
    fontSize: 16,
    fontWeight: '600',
  },
});
