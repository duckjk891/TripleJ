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
import { useMusicStore } from '../stores/musicStore';
import { useLyricsStore } from '../stores/lyricsStore';
import {
  generateWithSuno,
  generateWithWondera,
  getGenerationStatus,
  uploadReferenceAudio,
} from '../services/musicService';
import { ReferenceUploadResult, FatigueStatus } from '../types';
import { getFatigueStatus, isDirectorFatigued } from '../services/fatigueService';
import { showFatigueCooldownDialog } from '../utils/fatigueGate';
import { showAlert } from '../utils/appAlert';
import { BACKEND_BASE_URL } from '../services/api';
import AppScreenLayout from '../components/AppScreenLayout';
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

export default function MusicLoadingScreen({ navigation, route }: Props) {
  const store = useMusicStore();
  const lyricsStore = useLyricsStore();
  // v3.93: 생성 이력에서 진행 중 생성을 이어볼 때 — 새 생성 시작 없이 폴링만 재개
  const resumeGenerationId: string | undefined = route.params?.resumeGenerationId;
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

    // v3.91: 참고 음악 업로드 실패 시 사용자 확인 — true=참고 없이 진행, false=중단
    const confirmProceedWithoutReference = () =>
      new Promise<boolean>((resolve) => {
        showAlert('참고 음악', '참고 음악 업로드에 실패했어요. 참고 없이 진행할까요?', [
          { text: '중단', style: 'cancel', onPress: () => resolve(false) },
          { text: '참고 없이 진행', onPress: () => resolve(true) },
        ]);
      });

    // v3.93: 단건 폴링 1회 — 새 생성/이어보기 재개가 같은 로직을 공유 (GET /generate/{id})
    const pollOnce = async (genId: string) => {
      try {
        const status = await getGenerationStatus(genId);
        if (!isMounted) return;

        if (status.progress) {
          setProgress(status.progress);
        }

        if (status.status === 'completed' || status.status === 'complete') {
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
          // BUG-3 픽스: 발매 보상(젬+EXP)은 여기(폴링 완료)가 아니라
          // MusicResultScreen 의 트랙 저장 성공 직후에 지급한다.
          navigation.replace('MusicResult');
        } else if (status.status === 'failed' || status.status === 'error') {
          if (pollInterval) clearInterval(pollInterval);
          store.setError(status.error_message || status.error || '음악 생성에 실패했습니다.');
          store.setStatus('failed');
          store.setIsLoading(false);
          navigation.replace('MusicResult');
        }
      } catch (err: any) {
        // v3.93: 기록이 사라졌거나 접근 불가(404/403/400)면 폴링을 멈추고 실패 처리.
        // 그 외(네트워크 일시 오류)는 다음 폴링에서 재시도.
        const st = err?.response?.status;
        if (st === 404 || st === 403 || st === 400) {
          console.error('[MusicLoading] 폴링 중단 — 상태 조회 실패:', st, err?.response?.data?.error);
          if (pollInterval) clearInterval(pollInterval);
          if (!isMounted) return;
          store.setError(err?.response?.data?.error || '생성 정보를 찾을 수 없습니다.');
          store.setStatus('failed');
          store.setIsLoading(false);
          navigation.replace('MusicResult');
        }
      }
    };

    const beginPolling = (genId: string) => {
      pollInterval = setInterval(() => pollOnce(genId), 3000);
    };

    const doGenerate = async () => {
      store.setIsLoading(true);
      store.setError(null);
      store.setStatus('pending');

      // v3.91: 참고 음악 배선 — 선택/녹음된 파일(musicStore.referenceFile)이 있으면
      // 생성 직전 POST /generate/upload-reference/ 로 업로드하고, 응답의 upload_url 등을
      // generate body(reference_audio_url/name/duration)로 전달한다. (Suno 경로 전용)
      let referenceData: ReferenceUploadResult | null = null;
      if (store.selectedModel === 'suno' && store.referenceFile) {
        try {
          referenceData = await uploadReferenceAudio(
            store.referenceFile,
            store.referenceFileName || 'reference.mp3'
          );
        } catch (err: any) {
          console.error('[MusicLoading] 참고 음악 업로드 실패:', err?.response?.status, err?.response?.data?.error || err?.message);
          if (!isMounted) return;
          const proceed = await confirmProceedWithoutReference();
          if (!isMounted) return;
          if (!proceed) {
            // 중단: 로딩 상태를 되돌리고 이전 화면으로 복귀(파일 교체 후 재시도 가능)
            store.setIsLoading(false);
            store.setStatus('idle');
            navigation.goBack();
            return;
          }
          referenceData = null; // 참고 없이 진행
        }
      }

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
          // BUG-2 픽스: 대화 스텝에서 설정한 상세 파라미터가 실제 생성 요청에 빠져 있었음
          style: store.style || undefined,
          referenceStyle: store.referenceStyle || undefined,
          bpm: store.bpm || undefined,
          musicalKey: store.musicalKey || undefined,
          negativeTags: store.negativeTags || undefined,
          personaModel: store.personaModel || undefined,
          personaId: store.personaId || undefined,
          // v3.91: 참고 음악(업로드 응답) + 참고음 세기 — generateWithSuno가 reference_audio_*/audio_weight로 전송
          referenceData: referenceData || undefined,
          audioWeight: store.audioWeight ?? undefined,
          // v3.102(B-4): 가사 보관함 출처 스냅샷 — generateWithSuno가 lyrics_source로 전송
          lyricsSource: store.lyricsSource || undefined,
        };
        console.log('[MusicLoading] 생성 파라미터:', JSON.stringify({
          model: store.selectedModel, title: params.title, genre: params.genre, mood: params.mood,
          vocal: params.vocal, style: params.style, referenceStyle: params.referenceStyle,
          bpm: params.bpm, musicalKey: params.musicalKey, negativeTags: params.negativeTags,
          personaModel: params.personaModel, personaId: params.personaId,
          audioWeight: params.audioWeight, referenceUploaded: !!referenceData,
        }));

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

          // Poll for status (v3.93: 이어보기와 공유하는 pollOnce 재사용)
          beginPolling(genId);
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
          // BUG-3 픽스: 발매 보상은 MusicResultScreen 의 트랙 저장 성공 직후에 지급.
          navigation.replace('MusicResult');
        }
      } catch (err: any) {
        if (!isMounted) return;
        // v3.94: 디렉터 피로 429(레이스 — 게이트 통과 후 다른 곡 완성 등) — 생성 실패로 처리하지
        // 않는다. 서버는 ⭐ 차감 *전에* 게이트하므로 429 시 과금 없음 (generate.py:444-447, 573-577).
        // 동일 다이얼로그로 남은 시간 + ⭐/광고권 스킵을 안내하고, 해제되면 생성을 재시도한다.
        if (isDirectorFatigued(err)) {
          const gateRemain = Math.max(0, Math.floor(err?.response?.data?.cooldown_remaining_sec ?? 0));
          console.log('[MusicLoading] [fatigue] 429 게이트 — 남은', gateRemain, '초 (과금 없음)');
          store.setIsLoading(false);
          store.setStatus('idle');
          let fatigueStatus: FatigueStatus | null = null;
          try {
            fatigueStatus = await getFatigueStatus(); // 스킵 비용·광고권 잔량 표시용 (실패해도 기본값 안내)
          } catch (statusErr: any) {
            console.warn('[MusicLoading] [fatigue] 상태 조회 실패:', statusErr?.response?.status);
          }
          if (!isMounted) return;
          showFatigueCooldownDialog({
            status: fatigueStatus,
            remainingSec: Math.max(gateRemain, Math.floor(fatigueStatus?.cooldown_remaining_sec ?? 0)),
            cancelText: '돌아가기',
            onCancel: () => navigation.goBack(),
            onCleared: () => {
              // 스킵으로 쿨다운 해제 — 생성 재시도 (⭐ 작곡 비용은 이 재시도에서 정상 차감)
              doGenerate();
            },
          });
          return;
        }
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

    // v3.93: 이어보기 재개 모드 — 새 생성 시작(과금·참고음 업로드) 없이 기존 생성만 폴링
    if (resumeGenerationId) {
      console.log('[MusicLoading] 진행 중 생성 이어보기 재개:', resumeGenerationId);
      store.setIsLoading(true);
      store.setError(null);
      store.setGenerationId(resumeGenerationId);
      store.setStatus('processing');
      pollOnce(resumeGenerationId); // 즉시 1회 확인 (이미 완료된 경우 바로 결과로)
      beginPolling(resumeGenerationId);
    } else {
      doGenerate();
    }

    return () => {
      isMounted = false;
      if (pollInterval) clearInterval(pollInterval);
    };
  }, []);

  return (
    <AppScreenLayout scroll={false} insideTab avoidMiniPlayer={false}>
      <View style={styles.content}>
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <View style={styles.portraitContainer}>
            <Image source={portrait} style={styles.portraitImage} />
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

        {progress > 0 && (
          <View style={styles.progressContainer}>
            <View style={styles.progressBar}>
              <View
                style={[styles.progressFill, { width: `${progress}%` }]}
              />
            </View>
            <AppText style={styles.progressText}>{Math.round(progress)}%</AppText>
          </View>
        )}

        <View style={styles.noteContainer}>
          <AppText style={styles.noteText}>
            작곡 디렉터가 {messageIndex + 1}/{LOADING_STEPS.length} 단계를 진행 중이에요.{'\n'}
            1~3분 정도 소요될 수 있어요.
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
