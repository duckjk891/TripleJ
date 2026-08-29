import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import api, { BACKEND_BASE_URL } from './api';
import { useAuthStore } from '../stores/authStore';

// ── v3.98(A-8): Kits 음성 변환 + MR 피치 프리뷰/병합 ─────────────────────────
// 계약(backend_9004 voice_convert.py — 전부 인증 필수, ?token= 쿼리 인증 지원 auth.py:22):
//   POST /voice-convert/{genId}                        변환 시작 (:84 — completed 생성만, 409=이미 변환중, Kits 키 미설정 시 503)
//   GET  /voice-convert/{genId}/status                 상태 폴링 (:143)
//   GET  /voice-convert/{genId}/stream|download        최종 병합본 mp3 (:172 / :215)
//   GET  /voice-convert/{genId}/converted-vocal/stream 변환 보컬 wav (:260, 병합 전 미리듣기용)
//   GET  /voice-convert/{genId}/backing/stream         MR wav (:279)
//   POST /voice-convert/{genId}/preview-mr             피치 시프트된 MR wav 바이트 (:302, pitch 0이면 원본 스트림)
//   POST /voice-convert/{genId}/merge                  최종 병합 (:389 — awaiting_merge|completed 상태만 허용)
//   GET  /kits/voice-models                            Kits 목소리 모델 목록 (:435)
// 상태 흐름(kits_service.py): pending → converting(5~90%) → awaiting_merge(90)
//   → merging(92) → completed(100) / failed(voice_conversion_error 기록)
// ⭐ 과금 없음 — voice_convert.py·kits_service.py에 points 연동 코드가 전혀 없다(무료).

export interface KitsVoiceModel {
  id: number;
  title?: string | null;
  name?: string | null;
}

export type VoiceConversionStatus =
  | 'pending'
  | 'converting'
  | 'uploading'
  | 'awaiting_merge'
  | 'merging'
  | 'completed'
  | 'failed';

/** GET /voice-convert/{id}/status 응답 (voice_convert.py:160) */
export interface VoiceConvertStatusResult {
  generation_id: string;
  voice_conversion_status: VoiceConversionStatus | null;
  voice_conversion_progress: number;
  voice_conversion_error?: string | null;
  voice_converted_url?: string | null;
  voice_converted_vocal_url?: string | null;
  voice_converted_backing_url?: string | null;
  voice_model_id?: number | null;
}

/**
 * Kits 목소리 모델 목록 — GET /kits/voice-models (voice_convert.py:435).
 * 응답 { voice_models }는 Kits 원본 그대로라 {data:[...]} 래핑 가능성이 있어
 * MAIDOL StudioTab2.openVcModal 관행대로 방어적으로 정규화한다.
 */
export const getKitsVoiceModels = async (): Promise<KitsVoiceModel[]> => {
  console.log('[voiceConvert] Kits 목소리 모델 목록 조회');
  const res = await api.get('/kits/voice-models');
  const raw = res.data?.voice_models;
  const models = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
  console.log('[voiceConvert] Kits 모델 개수:', models.length);
  return models;
};

/**
 * 음성 변환 시작 — POST /voice-convert/{genId} (voice_convert.py:84).
 * completed 상태 생성만 허용(400), 변환 진행 중이면 409 { error }.
 * ⭐ 차감 없음(백엔드에 과금 코드 없음).
 */
export const startVoiceConvert = async (
  genId: string,
  params: {
    voiceModelId: number;
    conversionStrength?: number; // 0~1, 기본 0.5 (MAIDOL UI 기본 0.75)
    modelVolumeMix?: number; // 0~1, 기본 0.5 (MAIDOL UI 기본 0.9)
    pitchShift?: number; // 정수 반음, -24~24
  }
) => {
  const body = {
    voice_model_id: params.voiceModelId,
    conversion_strength: params.conversionStrength ?? 0.75,
    model_volume_mix: params.modelVolumeMix ?? 0.9,
    pitch_shift: params.pitchShift ?? 0,
  };
  console.log('[voiceConvert] 변환 시작:', genId, JSON.stringify(body));
  const res = await api.post(`/voice-convert/${genId}`, body);
  return res.data;
};

/** 변환 상태 폴링 — GET /voice-convert/{genId}/status (voice_convert.py:143) */
export const getVoiceConvertStatus = async (genId: string): Promise<VoiceConvertStatusResult> => {
  const res = await api.get(`/voice-convert/${genId}/status`);
  return res.data;
};

/**
 * 최종 병합 — POST /voice-convert/{genId}/merge (voice_convert.py:389).
 * awaiting_merge | completed 상태만 허용(400). 백그라운드 처리 → status 폴링으로 완료 확인.
 */
export const mergeVoiceConversion = async (
  genId: string,
  params: { mrPitchShift?: number; vocalVolume?: number; mrVolume?: number }
) => {
  const body = {
    mr_pitch_shift: params.mrPitchShift ?? 0,
    vocal_volume: params.vocalVolume ?? 1.0,
    mr_volume: params.mrVolume ?? 1.0,
  };
  console.log('[voiceConvert] 최종 병합 요청:', genId, JSON.stringify(body));
  const res = await api.post(`/voice-convert/${genId}/merge`, body);
  return res.data;
};

// expo-av는 요청 헤더를 못 붙이므로 ?token= 쿼리 인증(personaVocalStreamUrl 관행, auth.py:22 지원)
const tokenQuery = (): string => {
  const token = useAuthStore.getState().token;
  return token ? `?token=${encodeURIComponent(token)}` : '';
};

/** 최종 병합본(mp3) 스트림 URL (voice_convert.py:172) */
export const voiceConvertStreamUrl = (genId: string): string =>
  `${BACKEND_BASE_URL}/api/voice-convert/${genId}/stream${tokenQuery()}`;

/** 변환된 보컬(wav, 병합 전) 스트림 URL (voice_convert.py:260) */
export const convertedVocalStreamUrl = (genId: string): string =>
  `${BACKEND_BASE_URL}/api/voice-convert/${genId}/converted-vocal/stream${tokenQuery()}`;

/** MR(wav) 스트림 URL (voice_convert.py:279) */
export const backingStreamUrl = (genId: string): string =>
  `${BACKEND_BASE_URL}/api/voice-convert/${genId}/backing/stream${tokenQuery()}`;

/**
 * MR 피치 프리뷰 — POST /voice-convert/{genId}/preview-mr (voice_convert.py:302).
 * 서버가 rubberband로 피치 시프트한 wav 바이트를 반환한다(POST라 URL 재생 불가).
 * pitch 0이면 서버도 원본을 반환하므로 GET 스트림 URL로 대체.
 * native: expo-av는 URI만 재생 가능 → blob→base64→캐시 파일 저장 후 file:// URI 반환.
 * web: blob URL 반환(교체 시 releasePreviewUri로 해제).
 */
export const previewMrPitchedToUri = async (genId: string, pitchShift: number): Promise<string> => {
  if (!pitchShift) return backingStreamUrl(genId);
  console.log('[voiceConvert] MR 피치 프리뷰 요청:', JSON.stringify({ genId, pitchShift }));
  const res = await api.post(
    `/voice-convert/${genId}/preview-mr`,
    { pitch_shift: pitchShift },
    { responseType: 'blob', timeout: 120000 } // 서버 ffmpeg 변환 30s + 전송 여유
  );
  const blob: Blob = res.data;
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(blob);
    console.log('[voiceConvert] MR 프리뷰 blob URL 생성');
    return url;
  }
  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('MR 프리뷰 응답을 읽지 못했습니다.'));
    reader.readAsDataURL(blob);
  });
  const base64 = dataUrl.substring(dataUrl.indexOf(',') + 1);
  const path = `${FileSystem.cacheDirectory}mr-preview-${genId}-${Date.now()}.wav`;
  await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
  console.log('[voiceConvert] MR 프리뷰 캐시 저장:', path);
  return path;
};

/** 이전 프리뷰 URI 해제 — web blob URL revoke, native 캐시 파일 삭제(무시 가능) */
export const releasePreviewUri = (uri: string | null) => {
  if (!uri) return;
  try {
    if (Platform.OS === 'web') {
      if (uri.startsWith('blob:')) URL.revokeObjectURL(uri);
    } else if (uri.startsWith(FileSystem.cacheDirectory || '')) {
      FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    }
  } catch {
    // 해제 실패는 무해(캐시는 OS가 정리)
  }
};

/** 변환 파이프라인이 서버에서 진행 중인 상태인지 (폴링 지속 여부) */
export const isVoiceConvertInProgress = (status?: string | null): boolean =>
  status === 'pending' || status === 'converting' || status === 'uploading' || status === 'merging';

/** 상태 한글 라벨 (MAIDOL StudioTab2.vcStatusLabel 관행) */
export const vcStatusLabel = (status?: string | null): string => {
  switch (status) {
    case 'pending': return '대기 중';
    case 'converting': return '변환 중';
    case 'uploading': return '업로드 중';
    case 'awaiting_merge': return 'MR 조절 대기';
    case 'merging': return '합치는 중';
    case 'completed': return '완료';
    case 'failed': return '실패';
    default: return '';
  }
};
