import { useCallback, useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import { Audio } from 'expo-av';
import { AppText } from '../components/ui';
import { showAlert } from '../utils/appAlert';
import { colors } from '../theme/colors';
import { applyPlaybackAudioMode } from '../services/audioMode';
import { getGenerationStatus } from '../services/musicService';
import {
  KitsVoiceModel,
  getKitsVoiceModels,
  startVoiceConvert,
  getVoiceConvertStatus,
  mergeVoiceConversion,
  voiceConvertStreamUrl,
  convertedVocalStreamUrl,
  backingStreamUrl,
  previewMrPitchedToUri,
  releasePreviewUri,
  isVoiceConvertInProgress,
  vcStatusLabel,
} from '../services/voiceConvertService';
import { useMusicStore } from '../stores/musicStore';
import { useLyricsStore } from '../stores/lyricsStore';
import { GenerationItem } from '../types';

// ── v3.98(A-8) Kits 음성 변환 화면 ──────────────────────────────────────────
// MAIDOL StudioTab2의 VC 모달 + MrPitchAdjustPanel을 한 화면 흐름으로 이식.
// 흐름: 완료된 생성(생성 이력에서 진입) → Kits 목소리 모델 선택(+강도/믹스/피치)
//   → 변환 시작(무료 — 백엔드 과금 없음) → 5초 폴링(pending/converting)
//   → awaiting_merge: 보컬/MR 미리듣기 + MR 피치 프리뷰(preview-mr) + 볼륨 조절
//   → 최종 병합(merge) → completed: 병합본 재생 + "이 버전으로 발매 준비"(MusicResult,
//     tracks.py:1379 use_voice_converted — variant 0 전용 tracks.py:1418).
// 소스는 서버 계약상 "완료된 생성물"만 가능(voice_convert.py:108, kits_service.py는
// generated/{id}/suno_output.mp3 고정) — 녹음/파일 업로드 소스는 존재하지 않음.

type Props = NativeStackScreenProps<any, 'VoiceConvert'>;

type Phase = 'loading' | 'setup' | 'progress' | 'merge' | 'done';

const POLL_INTERVAL_MS = 5000;
// 백엔드 Kits 폴링 상한 10분(kits_service.py:67 — 120회*5초) + 여유 → 클라이언트 12.5분
const POLL_TIMEOUT_COUNT = 150;

function formatPitch(p: number): string {
  return `${p > 0 ? '+' : ''}${p}`;
}

export default function VoiceConvertScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const generationId: string = route.params?.generationId;

  // ── 생성 문서 + 단계 ──
  const [doc, setDoc] = useState<GenerationItem | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(true);
  const [forceSetup, setForceSetup] = useState(false); // completed에서 "다른 목소리로 다시 변환"
  const [adjustAgain, setAdjustAgain] = useState(false); // completed에서 "피치 다시 조절"(merge 재실행)

  // ── 모델 선택 단계 ──
  const [models, setModels] = useState<KitsVoiceModel[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);
  const [strength, setStrength] = useState(0.75); // MAIDOL 기본값
  const [volumeMix, setVolumeMix] = useState(0.9); // MAIDOL 기본값
  const [pitchShift, setPitchShift] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // ── MR 피치 조절 단계 (MAIDOL MrPitchAdjustPanel 기본값) ──
  const [playMode, setPlayMode] = useState<'both' | 'vocal' | 'mr'>('both');
  const [mrPitch, setMrPitch] = useState(0);
  const [vocalVolume, setVocalVolume] = useState(0.7);
  const [mrVolume, setMrVolume] = useState(0.85);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewPitch, setPreviewPitch] = useState<number | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [merging, setMerging] = useState(false);
  const [panelPlaying, setPanelPlaying] = useState(false);
  const vocalSoundRef = useRef<Audio.Sound | null>(null);
  const mrSoundRef = useRef<Audio.Sound | null>(null);

  // ── 완료 단계 (최종 병합본 플레이어) ──
  const [finalPlaying, setFinalPlaying] = useState(false);
  const finalSoundRef = useRef<Audio.Sound | null>(null);

  const pollCountRef = useRef(0);
  const mergeRequestedAtRef = useRef(0);
  const previewUriRef = useRef<string | null>(null);
  previewUriRef.current = previewUri;

  const status = doc?.voice_conversion_status || null;

  let phase: Phase = 'loading';
  if (!loadingDoc && doc) {
    if (forceSetup || !status || status === 'failed') phase = 'setup';
    else if (status === 'awaiting_merge' || (status === 'completed' && adjustAgain)) phase = 'merge';
    else if (status === 'completed') phase = 'done';
    else phase = 'progress'; // pending / converting / uploading / merging
  }

  // ── 생성 문서 조회 (GET /generate/{id} — VC 필드 포함) ──
  const fetchDoc = useCallback(async () => {
    try {
      console.log('[VoiceConvert] 생성 문서 조회:', generationId);
      const d = await getGenerationStatus(generationId);
      setDoc(d);
      if (d?.status !== 'completed') {
        // 서버 계약: completed 생성만 변환 가능 (voice_convert.py:108)
        showAlert('안내', '음악 생성이 완료된 곡만 목소리를 변환할 수 있어요.', [
          { text: '확인', onPress: () => navigation.goBack() },
        ]);
      }
    } catch (err: any) {
      console.error('[VoiceConvert] 생성 문서 조회 실패:', err?.response?.status, err?.message);
      showAlert('오류', err?.response?.data?.error || '곡 정보를 불러오지 못했어요.', [
        { text: '확인', onPress: () => navigation.goBack() },
      ]);
    } finally {
      setLoadingDoc(false);
    }
  }, [generationId, navigation]);

  useEffect(() => {
    fetchDoc();
  }, [fetchDoc]);

  // ── Kits 모델 목록 (setup 진입 시 1회) ──
  useEffect(() => {
    if (phase !== 'setup' || modelsLoaded) return;
    let mounted = true;
    (async () => {
      try {
        const list = await getKitsVoiceModels();
        if (!mounted) return;
        setModels(list);
        setModelsError(null);
      } catch (err: any) {
        // 503 = Kits API 키 미설정, 502 = Kits API 오류 (voice_convert.py:440/450)
        const msg = err?.response?.data?.error || 'Kits 목소리 모델을 불러오지 못했어요.';
        console.error('[VoiceConvert] 모델 목록 실패:', err?.response?.status, msg);
        if (mounted) setModelsError(msg);
      } finally {
        if (mounted) setModelsLoaded(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [phase, modelsLoaded]);

  // ── 진행 폴링 (pending/converting/uploading/merging) ──
  useEffect(() => {
    if (phase !== 'progress') return;
    let stopped = false;
    const tick = async () => {
      try {
        const s = await getVoiceConvertStatus(generationId);
        if (stopped) return;
        console.log('[VoiceConvert] 폴링:', JSON.stringify({
          status: s.voice_conversion_status,
          progress: s.voice_conversion_progress,
        }));
        // merge 요청 직후 서버가 잠시 stale 'awaiting_merge'를 돌려주면 로컬 'merging'을 덮지 않음
        // (30초 grace — 이후에도 awaiting_merge면 서버 상태를 신뢰해 수용)
        if (
          s.voice_conversion_status === 'awaiting_merge' &&
          Date.now() - mergeRequestedAtRef.current < 30000
        ) {
          console.warn('[VoiceConvert] merge 직후 stale awaiting_merge 무시(grace)');
          return;
        }
        setDoc((prev) =>
          prev
            ? {
                ...prev,
                voice_conversion_status: s.voice_conversion_status,
                voice_conversion_progress: s.voice_conversion_progress,
                voice_conversion_error: s.voice_conversion_error,
                voice_converted_url: s.voice_converted_url,
                voice_converted_vocal_url: s.voice_converted_vocal_url,
                voice_converted_backing_url: s.voice_converted_backing_url,
                voice_model_id: s.voice_model_id,
              }
            : prev
        );
        if (s.voice_conversion_status === 'failed') {
          showAlert(
            '변환 실패',
            `${s.voice_conversion_error || '알 수 없는 오류로 변환에 실패했어요.'}\n\n다시 시도할 수 있어요. (⭐ 차감 없음)`
          );
          return;
        }
        pollCountRef.current += 1;
        if (
          pollCountRef.current >= POLL_TIMEOUT_COUNT &&
          isVoiceConvertInProgress(s.voice_conversion_status)
        ) {
          pollCountRef.current = 0; // 재알림은 다시 한도만큼 기다린 뒤
          showAlert('아직 진행 중이에요', '서버 변환이 평소보다 오래 걸리고 있어요. 계속 기다리거나, 나중에 생성 이력에서 다시 확인할 수 있어요.', [
            { text: '계속 기다리기' },
            { text: '나중에 확인', onPress: () => navigation.goBack() },
          ]);
        }
      } catch (err: any) {
        // 일시적 네트워크 오류는 다음 틱에서 재시도
        console.warn('[VoiceConvert] 폴링 실패(재시도 예정):', err?.response?.status, err?.message);
      }
    };
    const iv = setInterval(tick, POLL_INTERVAL_MS);
    tick();
    return () => {
      stopped = true;
      clearInterval(iv);
    };
  }, [phase, generationId, navigation]);

  // ── 사운드 정리 ──
  const stopPanelPlayback = useCallback(async () => {
    setPanelPlaying(false);
    const v = vocalSoundRef.current;
    const m = mrSoundRef.current;
    vocalSoundRef.current = null;
    mrSoundRef.current = null;
    try { if (v) await v.unloadAsync(); } catch {}
    try { if (m) await m.unloadAsync(); } catch {}
  }, []);

  const stopFinalPlayback = useCallback(async () => {
    setFinalPlaying(false);
    const f = finalSoundRef.current;
    finalSoundRef.current = null;
    try { if (f) await f.unloadAsync(); } catch {}
  }, []);

  useEffect(() => {
    return () => {
      stopPanelPlayback();
      stopFinalPlayback();
      releasePreviewUri(previewUriRef.current);
    };
  }, [stopPanelPlayback, stopFinalPlayback]);

  // 재생 중 볼륨/모드 변경 즉시 반영
  useEffect(() => {
    if (!panelPlaying) return;
    vocalSoundRef.current?.setVolumeAsync(playMode === 'mr' ? 0 : vocalVolume).catch(() => {});
    mrSoundRef.current?.setVolumeAsync(playMode === 'vocal' ? 0 : mrVolume).catch(() => {});
  }, [vocalVolume, mrVolume, playMode, panelPlaying]);

  // ── 변환 시작 ──
  const doStart = async () => {
    if (submitting || !selectedModelId) return;
    setSubmitting(true);
    try {
      await startVoiceConvert(generationId, {
        voiceModelId: selectedModelId,
        conversionStrength: strength,
        modelVolumeMix: volumeMix,
        pitchShift,
      });
      pollCountRef.current = 0;
      setForceSetup(false);
      setAdjustAgain(false);
      // 병합 전 프리뷰 상태 초기화 (재변환 시 이전 프리뷰 무효)
      releasePreviewUri(previewUriRef.current);
      setPreviewUri(null);
      setPreviewPitch(null);
      setDoc((prev) =>
        prev ? { ...prev, voice_conversion_status: 'pending', voice_conversion_progress: 0, voice_conversion_error: null } : prev
      );
    } catch (err: any) {
      const statusCode = err?.response?.status;
      const msg = err?.response?.data?.error;
      console.error('[VoiceConvert] 변환 시작 실패:', statusCode, msg || err?.message);
      if (statusCode === 409) {
        // 이미 변환 중 — 서버 상태로 동기화
        showAlert('안내', msg || '이미 변환이 진행 중이에요.');
        fetchDoc();
      } else {
        showAlert('변환 시작 실패', msg || '음성 변환을 시작하지 못했어요. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleStart = () => {
    if (!selectedModelId) {
      showAlert('안내', '목소리 모델을 먼저 선택해주세요.');
      return;
    }
    const model = models.find((m) => m.id === selectedModelId);
    const name = model?.title || model?.name || `모델 ${selectedModelId}`;
    showAlert(
      '음성 변환 시작',
      `"${name}" 목소리로 이 곡의 보컬을 변환할까요?\n변환에는 몇 분 정도 걸려요. (⭐ 차감 없음)`,
      [
        { text: '취소', style: 'cancel' },
        { text: '변환 시작', onPress: doStart },
      ]
    );
  };

  // ── MR 패널: 미리듣기 재생 ──
  const startPanelPlayback = async () => {
    await stopPanelPlayback();
    try {
      await applyPlaybackAudioMode();
      const mrUri = previewUri && previewPitch === mrPitch ? previewUri : backingStreamUrl(generationId);
      console.log('[VoiceConvert] 패널 재생 시작:', JSON.stringify({ playMode, mrPitch, pitched: mrUri === previewUri }));
      const [v, m] = await Promise.all([
        Audio.Sound.createAsync(
          { uri: convertedVocalStreamUrl(generationId) },
          { shouldPlay: false, volume: playMode === 'mr' ? 0 : vocalVolume }
        ),
        Audio.Sound.createAsync(
          { uri: mrUri },
          { shouldPlay: false, volume: playMode === 'vocal' ? 0 : mrVolume }
        ),
      ]);
      vocalSoundRef.current = v.sound;
      mrSoundRef.current = m.sound;
      v.sound.setOnPlaybackStatusUpdate((st) => {
        if (st.isLoaded && st.didJustFinish) stopPanelPlayback();
      });
      await Promise.all([v.sound.playAsync(), m.sound.playAsync()]);
      setPanelPlaying(true);
    } catch (err: any) {
      console.error('[VoiceConvert] 패널 재생 실패:', err?.message);
      showAlert('재생 실패', '미리듣기 재생에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');
      stopPanelPlayback();
    }
  };

  const togglePanelPlayback = () => {
    if (panelPlaying) stopPanelPlayback();
    else startPanelPlayback();
  };

  // ── MR 피치 프리뷰 적용 ──
  const handlePreviewPitch = async () => {
    if (loadingPreview) return;
    if (previewPitch === mrPitch && previewUri) return;
    setLoadingPreview(true);
    await stopPanelPlayback();
    try {
      const uri = await previewMrPitchedToUri(generationId, mrPitch);
      releasePreviewUri(previewUriRef.current);
      setPreviewUri(uri);
      setPreviewPitch(mrPitch);
      console.log('[VoiceConvert] MR 프리뷰 적용:', formatPitch(mrPitch));
    } catch (err: any) {
      // responseType blob이라 서버 error JSON 파싱 불가 — 일반 메시지로 안내
      console.error('[VoiceConvert] MR 프리뷰 실패:', err?.response?.status, err?.message);
      showAlert('프리뷰 실패', 'MR 피치 프리뷰 생성에 실패했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setLoadingPreview(false);
    }
  };

  // ── 최종 병합 ──
  const doMerge = async () => {
    if (merging) return;
    setMerging(true);
    await stopPanelPlayback();
    try {
      await mergeVoiceConversion(generationId, {
        mrPitchShift: mrPitch,
        vocalVolume,
        mrVolume,
      });
      pollCountRef.current = 0;
      mergeRequestedAtRef.current = Date.now();
      setAdjustAgain(false);
      await stopFinalPlayback(); // 재병합 시 이전 병합본 재생 중지
      setDoc((prev) =>
        prev ? { ...prev, voice_conversion_status: 'merging', voice_conversion_progress: 92 } : prev
      );
    } catch (err: any) {
      const msg = err?.response?.data?.error;
      console.error('[VoiceConvert] 병합 실패:', err?.response?.status, msg || err?.message);
      showAlert('합치기 실패', msg || '최종 합치기를 시작하지 못했어요. 다시 시도해주세요.');
    } finally {
      setMerging(false);
    }
  };

  const handleMerge = () => {
    showAlert(
      '최종 합치기',
      `MR ${formatPitch(mrPitch)}반음 · 보컬 ${Math.round(vocalVolume * 100)}% · MR ${Math.round(mrVolume * 100)}% 설정으로 합칠까요?\n합친 뒤에도 다시 조절할 수 있어요. (⭐ 차감 없음)`,
      [
        { text: '취소', style: 'cancel' },
        { text: '합치기', onPress: doMerge },
      ]
    );
  };

  // ── 완료: 최종 병합본 재생 ──
  const toggleFinalPlayback = async () => {
    if (finalPlaying) {
      await stopFinalPlayback();
      return;
    }
    try {
      await applyPlaybackAudioMode();
      const { sound } = await Audio.Sound.createAsync(
        { uri: voiceConvertStreamUrl(generationId) },
        { shouldPlay: true }
      );
      finalSoundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((st) => {
        if (st.isLoaded && st.didJustFinish) stopFinalPlayback();
      });
      setFinalPlaying(true);
    } catch (err: any) {
      console.error('[VoiceConvert] 병합본 재생 실패:', err?.message);
      showAlert('재생 실패', '변환된 곡 재생에 실패했어요. 다시 시도해주세요.');
      stopFinalPlayback();
    }
  };

  // ── 완료: 발매 준비 (MusicResult로 — tracks.py use_voice_converted, variant 0 전용) ──
  const handlePrepareRelease = () => {
    if (!doc) return;
    stopFinalPlayback();
    const music = useMusicStore.getState();
    const lyrics = useLyricsStore.getState();
    music.setSelectedModel('suno');
    music.setGenerationId(doc.id);
    music.setSavedTrackId(doc.result_track_id || null);
    music.setLyrics(doc.lyrics || '');
    music.setGenre(doc.genre || '');
    music.setMood(doc.mood || '');
    lyrics.setGeneratedTitle(doc.title || '');
    lyrics.setGeneratedLyrics(doc.lyrics || '');
    music.setStatus('completed');
    music.setError(null);
    music.setResultUrl(voiceConvertStreamUrl(doc.id));
    music.setIsLoading(false);
    console.log('[VoiceConvert] 발매 준비 이동(use_voice_converted):', doc.id);
    navigation.navigate('MusicResult', { useVoiceConverted: true });
  };

  const handleReconvert = () => {
    showAlert('다시 변환', '다른 목소리로 다시 변환하면 지금 변환본은 새 결과로 대체돼요. 계속할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '다시 변환',
        onPress: () => {
          stopFinalPlayback();
          stopPanelPlayback();
          setForceSetup(true);
          setAdjustAgain(false);
        },
      },
    ]);
  };

  // ── 렌더 ──────────────────────────────────────────────────────────────────
  const renderHeader = () => (
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
      <TouchableOpacity
        onPress={() => navigation.goBack()}
        style={styles.backBtn}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <AppText style={styles.backBtnText}>‹</AppText>
      </TouchableOpacity>
      <AppText style={styles.headerTitle}>내 목소리 변환</AppText>
      <View style={styles.backBtn} />
    </View>
  );

  const renderSongCard = () => (
    <View style={styles.songCard}>
      <Feather name="music" size={14} color={colors.accent.primary} />
      <View style={{ flex: 1 }}>
        <AppText style={styles.songTitle} numberOfLines={1}>
          {doc?.title || '제목 없음'}
        </AppText>
        {(doc?.genre || doc?.mood) && (
          <AppText style={styles.songMeta} numberOfLines={1}>
            {[doc?.genre, doc?.mood].filter(Boolean).join(' · ')}
          </AppText>
        )}
      </View>
    </View>
  );

  const renderSetup = () => (
    <>
      {renderSongCard()}
      {status === 'failed' && (
        <View style={styles.errorBox}>
          <AppText style={styles.errorText}>
            이전 변환 실패: {doc?.voice_conversion_error || '알 수 없는 오류'}
          </AppText>
        </View>
      )}

      <AppText style={styles.sectionLabel}>목소리 모델 선택 (Kits.AI)</AppText>
      {!modelsLoaded ? (
        <ActivityIndicator size="small" color={colors.accent.primary} style={{ marginVertical: 16 }} />
      ) : modelsError ? (
        <View style={styles.errorBox}>
          <AppText style={styles.errorText}>{modelsError}</AppText>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => {
              setModelsError(null);
              setModelsLoaded(false);
            }}
          >
            <AppText style={styles.retryBtnText}>다시 시도</AppText>
          </TouchableOpacity>
        </View>
      ) : models.length === 0 ? (
        <View style={styles.emptyBox}>
          <AppText style={styles.emptyText}>등록된 Kits.AI 목소리 모델이 없어요.</AppText>
        </View>
      ) : (
        <View style={styles.modelWrap}>
          {models.map((m) => {
            const active = m.id === selectedModelId;
            return (
              <TouchableOpacity
                key={m.id}
                style={[styles.modelChip, active && styles.modelChipActive]}
                onPress={() => setSelectedModelId(m.id)}
              >
                <Feather name="mic" size={12} color={active ? colors.bg.deepest : colors.text.secondary} />
                <AppText style={[styles.modelChipText, active && styles.modelChipTextActive]} numberOfLines={1}>
                  {m.title || m.name || `모델 ${m.id}`}
                </AppText>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <View style={styles.sliderSection}>
        <AppText style={styles.sliderLabel}>변환 강도  {strength.toFixed(2)}</AppText>
        <AppText style={styles.sliderHint}>선택한 목소리를 얼마나 강하게 입힐지 (높을수록 그 목소리에 가까움)</AppText>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={1}
          step={0.05}
          value={strength}
          onValueChange={setStrength}
          minimumTrackTintColor={colors.accent.primary}
          maximumTrackTintColor={colors.border.subtle}
          thumbTintColor={colors.accent.primary}
        />
      </View>
      <View style={styles.sliderSection}>
        <AppText style={styles.sliderLabel}>모델 볼륨 믹스  {volumeMix.toFixed(2)}</AppText>
        <AppText style={styles.sliderHint}>변환된 목소리와 원본 보컬의 음량 비율 (높을수록 변환 목소리 위주)</AppText>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={1}
          step={0.05}
          value={volumeMix}
          onValueChange={setVolumeMix}
          minimumTrackTintColor={colors.accent.primary}
          maximumTrackTintColor={colors.border.subtle}
          thumbTintColor={colors.accent.primary}
        />
      </View>
      <View style={styles.sliderSection}>
        <AppText style={styles.sliderLabel}>보컬 피치 조절  {formatPitch(pitchShift)}반음</AppText>
        <AppText style={styles.sliderHint}>0 = 원래 그대로 · 남→여 +3~5 · 여→남 -3~-5</AppText>
        <Slider
          style={styles.slider}
          minimumValue={-24}
          maximumValue={24}
          step={1}
          value={pitchShift}
          onValueChange={(v: number) => setPitchShift(Math.round(v))}
          minimumTrackTintColor={colors.accent.primary}
          maximumTrackTintColor={colors.border.subtle}
          thumbTintColor={colors.accent.primary}
        />
      </View>

      <TouchableOpacity
        style={[styles.primaryBtn, (!selectedModelId || submitting) && { opacity: 0.5 }]}
        onPress={handleStart}
        disabled={!selectedModelId || submitting}
      >
        {submitting && <ActivityIndicator size="small" color={colors.bg.deepest} style={{ marginRight: 6 }} />}
        <AppText style={styles.primaryBtnText}>{submitting ? '시작 중...' : '변환 시작'}</AppText>
      </TouchableOpacity>
    </>
  );

  const renderProgress = () => (
    <>
      {renderSongCard()}
      <View style={styles.progressBox}>
        <ActivityIndicator size="large" color={colors.accent.primary} />
        <AppText style={styles.progressLabel}>
          {vcStatusLabel(status)} {Math.round(doc?.voice_conversion_progress || 0)}%
        </AppText>
        <View style={styles.progressBar}>
          <View
            style={[
              styles.progressFill,
              { width: `${Math.min(Math.max(doc?.voice_conversion_progress || 0, 0), 100)}%` },
            ]}
          />
        </View>
        <AppText style={styles.progressHint}>
          서버에서 변환이 진행돼요. 화면을 나가도 계속 진행되고,{'\n'}생성 이력에서 언제든 다시 확인할 수 있어요.
        </AppText>
      </View>
    </>
  );

  const renderMergePanel = () => (
    <>
      {renderSongCard()}
      <AppText style={styles.sectionLabel}>미리듣기</AppText>
      <View style={styles.modeTabs}>
        {(
          [
            { key: 'vocal', label: '보컬만' },
            { key: 'mr', label: 'MR만' },
            { key: 'both', label: '같이 듣기' },
          ] as const
        ).map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.modeTab, playMode === t.key && styles.modeTabActive]}
            onPress={() => setPlayMode(t.key)}
          >
            <AppText style={[styles.modeTabText, playMode === t.key && styles.modeTabTextActive]}>
              {t.label}
            </AppText>
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity style={styles.playBtn} onPress={togglePanelPlayback}>
        <Feather name={panelPlaying ? 'pause' : 'play'} size={14} color={colors.bg.deepest} />
        <AppText style={styles.playBtnText}>{panelPlaying ? '정지' : '미리 듣기'}</AppText>
      </TouchableOpacity>
      <AppText style={styles.panelHint}>
        보컬과 MR을 함께 재생해 확인해요. (네트워크에 따라 시작 타이밍이 살짝 어긋날 수 있어요 — 최종본은 서버에서 정확히 합쳐져요)
      </AppText>

      <View style={styles.sliderSection}>
        <AppText style={styles.sliderLabel}>MR 음정 조절  {formatPitch(mrPitch)}반음</AppText>
        <Slider
          style={styles.slider}
          minimumValue={-12}
          maximumValue={12}
          step={0.5}
          value={mrPitch}
          onValueChange={setMrPitch}
          minimumTrackTintColor={colors.accent.primary}
          maximumTrackTintColor={colors.border.subtle}
          thumbTintColor={colors.accent.primary}
        />
        <View style={styles.quickRow}>
          <TouchableOpacity style={styles.quickBtn} onPress={() => setMrPitch((p) => Math.max(-12, p - 1))}>
            <AppText style={styles.quickBtnText}>-1</AppText>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickBtn} onPress={() => setMrPitch((p) => Math.max(-12, p - 0.5))}>
            <AppText style={styles.quickBtnText}>-0.5</AppText>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickBtn} onPress={() => setMrPitch(0)}>
            <AppText style={styles.quickBtnText}>원래 음정</AppText>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickBtn} onPress={() => setMrPitch((p) => Math.min(12, p + 0.5))}>
            <AppText style={styles.quickBtnText}>+0.5</AppText>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickBtn} onPress={() => setMrPitch((p) => Math.min(12, p + 1))}>
            <AppText style={styles.quickBtnText}>+1</AppText>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[styles.previewBtn, (loadingPreview || mrPitch === 0) && { opacity: 0.5 }]}
          onPress={handlePreviewPitch}
          disabled={loadingPreview || mrPitch === 0}
        >
          {loadingPreview && (
            <ActivityIndicator size="small" color={colors.accent.primary} style={{ marginRight: 6 }} />
          )}
          <AppText style={styles.previewBtnText}>
            {loadingPreview ? '변환 중...' : `이 음정(${formatPitch(mrPitch)})으로 미리듣기 적용`}
          </AppText>
        </TouchableOpacity>
        {mrPitch === 0 ? (
          <AppText style={styles.previewNote}>원래 음정은 변환이 필요 없어요</AppText>
        ) : previewPitch === mrPitch && previewUri ? (
          <AppText style={styles.previewApplied}>적용됨 — 미리 듣기에 반영돼요</AppText>
        ) : (
          <AppText style={styles.previewNote}>적용을 눌러야 미리 듣기에 반영돼요 (최종 합치기에는 자동 반영)</AppText>
        )}
      </View>

      <View style={styles.sliderSection}>
        <AppText style={styles.sliderLabel}>보컬 볼륨  {Math.round(vocalVolume * 100)}%</AppText>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={1}
          step={0.05}
          value={vocalVolume}
          onValueChange={setVocalVolume}
          minimumTrackTintColor={colors.accent.primary}
          maximumTrackTintColor={colors.border.subtle}
          thumbTintColor={colors.accent.primary}
        />
      </View>
      <View style={styles.sliderSection}>
        <AppText style={styles.sliderLabel}>MR 볼륨  {Math.round(mrVolume * 100)}%</AppText>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={1}
          step={0.05}
          value={mrVolume}
          onValueChange={setMrVolume}
          minimumTrackTintColor={colors.accent.primary}
          maximumTrackTintColor={colors.border.subtle}
          thumbTintColor={colors.accent.primary}
        />
      </View>

      <TouchableOpacity
        style={styles.resetBtn}
        onPress={() => {
          setMrPitch(0);
          setVocalVolume(0.7);
          setMrVolume(0.85);
        }}
      >
        <AppText style={styles.resetBtnText}>설정 초기화</AppText>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.primaryBtn, merging && { opacity: 0.5 }]}
        onPress={handleMerge}
        disabled={merging}
      >
        {merging && <ActivityIndicator size="small" color={colors.bg.deepest} style={{ marginRight: 6 }} />}
        <AppText style={styles.primaryBtnText}>{merging ? '합치는 중...' : '이 설정으로 최종 합치기'}</AppText>
      </TouchableOpacity>
      {adjustAgain && (
        <TouchableOpacity style={styles.secondaryBtn} onPress={() => setAdjustAgain(false)}>
          <AppText style={styles.secondaryBtnText}>조절 취소하고 결과로 돌아가기</AppText>
        </TouchableOpacity>
      )}
    </>
  );

  const renderDone = () => (
    <>
      {renderSongCard()}
      <View style={styles.doneBox}>
        <Feather name="check-circle" size={28} color={colors.accent.primary} />
        <AppText style={styles.doneTitle}>내 목소리 버전 완성!</AppText>
        <AppText style={styles.doneText}>보컬이 선택한 목소리로 변환되어 MR과 합쳐졌어요.</AppText>
        <TouchableOpacity style={styles.playBtn} onPress={toggleFinalPlayback}>
          <Feather name={finalPlaying ? 'pause' : 'play'} size={14} color={colors.bg.deepest} />
          <AppText style={styles.playBtnText}>{finalPlaying ? '정지' : '변환된 곡 듣기'}</AppText>
        </TouchableOpacity>
      </View>

      {doc?.result_track_id ? (
        <AppText style={styles.doneNote}>
          이 곡은 이미 발매되어 트랙 오디오는 바뀌지 않아요. 변환본은 여기서 감상할 수 있어요.
        </AppText>
      ) : (
        <TouchableOpacity style={styles.primaryBtn} onPress={handlePrepareRelease}>
          <AppText style={styles.primaryBtnText}>이 버전으로 발매 준비</AppText>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.secondaryBtn} onPress={() => setAdjustAgain(true)}>
        <AppText style={styles.secondaryBtnText}>MR 피치·볼륨 다시 조절하기</AppText>
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondaryBtn} onPress={handleReconvert}>
        <AppText style={styles.secondaryBtnText}>다른 목소리로 다시 변환</AppText>
      </TouchableOpacity>
    </>
  );

  return (
    <View style={styles.container}>
      {renderHeader()}
      {phase === 'loading' ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={colors.accent.primary} />
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 32 + insets.bottom }}
          showsVerticalScrollIndicator={false}
        >
          {phase === 'setup' && renderSetup()}
          {phase === 'progress' && renderProgress()}
          {phase === 'merge' && renderMergePanel()}
          {phase === 'done' && renderDone()}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.bg.surface1,
  },
  backBtn: { width: 44, paddingHorizontal: 12, paddingVertical: 4 },
  backBtnText: { fontSize: 26, color: colors.text.primary, fontWeight: '300' },
  headerTitle: { fontSize: 16, fontWeight: '700', color: colors.text.primary },
  centerBox: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  songCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  songTitle: { color: colors.text.primary, fontSize: 15, fontWeight: '700' },
  songMeta: { color: colors.accent.primary, fontSize: 11, fontWeight: '600', marginTop: 2 },

  sectionLabel: { color: colors.text.primary, fontSize: 14, fontWeight: '700', marginBottom: 10 },

  errorBox: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.status.error,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  errorText: { color: colors.status.error, fontSize: 12, lineHeight: 18 },
  retryBtn: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  retryBtnText: { color: colors.text.primary, fontSize: 12, fontWeight: '600' },

  emptyBox: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    alignItems: 'center',
  },
  emptyText: { color: colors.text.muted, fontSize: 12 },

  modelWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  modelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    maxWidth: '100%',
  },
  modelChipActive: { backgroundColor: colors.accent.primary, borderColor: colors.accent.primary },
  modelChipText: { color: colors.text.secondary, fontSize: 12, fontWeight: '600' },
  modelChipTextActive: { color: colors.bg.deepest },

  sliderSection: { marginTop: 14 },
  sliderLabel: { color: colors.text.primary, fontSize: 13, fontWeight: '700' },
  sliderHint: { color: colors.text.muted, fontSize: 11, marginTop: 2 },
  slider: { width: '100%', height: 36, marginTop: 4 },

  quickRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  quickBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.bg.surface2,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  quickBtnText: { color: colors.text.primary, fontSize: 11, fontWeight: '600' },

  previewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.accent.primary,
  },
  previewBtnText: { color: colors.accent.primary, fontSize: 12, fontWeight: '700' },
  previewApplied: { color: colors.accent.primary, fontSize: 11, marginTop: 6, textAlign: 'center' },
  previewNote: { color: colors.text.muted, fontSize: 11, marginTop: 6, textAlign: 'center' },

  modeTabs: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  modeTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    alignItems: 'center',
  },
  modeTabActive: { borderColor: colors.accent.primary },
  modeTabText: { color: colors.text.secondary, fontSize: 12, fontWeight: '600' },
  modeTabTextActive: { color: colors.accent.primary },

  playBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.accent.primary,
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 4,
  },
  playBtnText: { color: colors.bg.deepest, fontSize: 13, fontWeight: '700' },
  panelHint: { color: colors.text.muted, fontSize: 10, lineHeight: 15, marginTop: 8 },

  progressBox: { alignItems: 'center', paddingVertical: 32 },
  progressLabel: { color: colors.text.primary, fontSize: 15, fontWeight: '700', marginTop: 16 },
  progressBar: {
    width: '80%',
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.bg.surface2,
    marginTop: 12,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: colors.accent.primary },
  progressHint: { color: colors.text.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 16 },

  doneBox: {
    alignItems: 'center',
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 14,
    padding: 20,
    marginBottom: 14,
    gap: 8,
  },
  doneTitle: { color: colors.text.primary, fontSize: 16, fontWeight: '700' },
  doneText: { color: colors.text.secondary, fontSize: 12, textAlign: 'center', marginBottom: 6 },
  doneNote: { color: colors.text.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginVertical: 8 },

  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent.primary,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 20,
  },
  primaryBtnText: { color: colors.bg.deepest, fontSize: 14, fontWeight: '700' },
  secondaryBtn: {
    alignItems: 'center',
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  secondaryBtnText: { color: colors.text.primary, fontSize: 13, fontWeight: '600' },
  resetBtn: { alignItems: 'center', paddingVertical: 10, marginTop: 16 },
  resetBtnText: { color: colors.text.muted, fontSize: 12 },
});
