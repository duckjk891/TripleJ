import { Platform } from 'react-native';
import api from './api';

// v3.102: 구 Voice Persona(/api/voice-persona/*) 서비스 제거 — v216에서 서버 엔드포인트
// 삭제(404 실측). 내 목소리 자산은 voice_clones(/api/voice-clone/*) 체계로 일원화됨.

// ── v3.83: Voice Clone(정식 클로닝 — 노래 + 문장 낭독 검증) — /api/voice-clone/* ──
// 서버 계약(9004, openapi 실측 + backend_9004 라우터 확인):
//   POST   /voice-clone/create   multipart { source_file, voice_name, description="",
//                                            vocal_start_s, vocal_end_s, language="ko", style_mode="sing" }
//          → { clone_id, validate_task_id, status }
//   GET    /voice-clone/list     → { clones: [...] }  (실측: 빈 계정 = {"clones":[]})
//   GET    /voice-clone/{id}     → 클론 doc 직접 반환 (clone_id, status, validate_info, voice_id ...)
//   DELETE /voice-clone/{id}     → { deleted: true }
//   POST   /voice-clone/{id}/regenerate-phrase → { validate_task_id }
//   POST   /voice-clone/{id}/verify  multipart { verify_file, singer_skill_level }
//          singer_skill_level ∈ { beginner, intermediate, advanced, professional }
//   POST   /voice-clone/check-availability → { checked, available, expired, errors }
// 상태: validating → awaiting_verify → generating → ready | failed | expired

export interface VoiceClone {
  clone_id: string;
  voice_id: string | null; // ready 시 Suno voice_id — 작곡 전송 시 persona_id 로 사용
  voice_name: string;
  description: string;
  status: string; // validating | awaiting_verify | generating | ready | failed | expired
  validate_info?: any; // 낭독 문구 — string 또는 { phrase | text | validateInfo } (다중 폴백 파싱)
  error_message?: string;
  created_at?: string;
  [key: string]: any;
}

function normalizeClone(raw: any): VoiceClone {
  return {
    ...raw,
    clone_id: String(raw?.clone_id ?? raw?.id ?? raw?._id ?? ''),
    voice_id: raw?.voice_id ? String(raw.voice_id) : null,
    voice_name: raw?.voice_name ?? raw?.name ?? '',
    description: raw?.description ?? '',
    status: raw?.status ?? '',
  };
}

/** 클론 낭독 문구 파싱 — sunoapi는 string, 콜백 경로는 dict 가능(MAIDOL 계약과 동일한 다중 폴백). */
export function cloneValidatePhrase(validateInfo: any): string {
  if (!validateInfo) return '';
  if (typeof validateInfo === 'string') return validateInfo;
  return validateInfo?.phrase || validateInfo?.text || validateInfo?.validateInfo || '';
}

/** 파일 확장자 기반 mime 추정 (백엔드는 확장자만 강제 — CT는 관대) */
function guessAudioMime(fileName: string): string {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  const map: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    webm: 'audio/webm',
    ogg: 'audio/ogg',
  };
  return map[ext] || 'audio/mpeg';
}

/** web/native FormData 파일 첨부 분기 (구 createVoicePersona 관행 승계) */
async function appendAudioFile(formData: FormData, field: string, fileUri: string, fileName: string) {
  if (Platform.OS === 'web') {
    const res = await fetch(fileUri);
    const blob = await res.blob();
    formData.append(field, blob, fileName);
  } else {
    formData.append(field, {
      uri: fileUri,
      name: fileName,
      type: guessAudioMime(fileName),
    } as any);
  }
}

/** GET /voice-clone/list — 실측 응답: { "clones": [...] } (방어적으로 다른 래핑도 수용) */
export const listVoiceClones = async (): Promise<VoiceClone[]> => {
  try {
    const response = await api.get('/voice-clone/list');
    const data = response.data;
    const arr = Array.isArray(data) ? data : data?.clones ?? data?.items ?? data?.list ?? [];
    const clones = (Array.isArray(arr) ? arr : []).map(normalizeClone);
    if (__DEV__) console.log('[voiceService] listVoiceClones:', clones.length, '개');
    return clones;
  } catch (err: any) {
    console.error('[voiceService] listVoiceClones 실패:', err?.response?.status, err?.message);
    throw err;
  }
};

/** GET /voice-clone/{clone_id} — doc 직접 반환 (방어적으로 {clone:...} 래핑도 수용) */
export const getVoiceClone = async (cloneId: string): Promise<VoiceClone> => {
  try {
    const response = await api.get(`/voice-clone/${cloneId}`);
    const clone = normalizeClone(response.data?.clone ?? response.data);
    if (__DEV__) console.log('[voiceService] getVoiceClone:', cloneId, 'status=', clone.status);
    return clone;
  } catch (err: any) {
    console.error('[voiceService] getVoiceClone 실패:', cloneId, err?.response?.status, err?.message);
    throw err;
  }
};

/**
 * POST /voice-clone/create — 노래 샘플 + 보컬 구간으로 클로닝 시작.
 * 업로드 + Suno validate 대기 가능성 → timeout 180초.
 * 응답: { clone_id, validate_task_id, status }
 */
export const createVoiceClone = async (params: {
  fileUri: string;
  fileName: string;
  voiceName: string;
  description?: string;
  vocalStartS: number;
  vocalEndS: number;
  language?: string;
  styleMode?: string; // sing | speak | rap (서버 ALLOWED_STYLE_MODES)
}): Promise<{ clone_id: string; validate_task_id?: string; status?: string }> => {
  const formData = new FormData();
  await appendAudioFile(formData, 'source_file', params.fileUri, params.fileName);
  formData.append('voice_name', params.voiceName);
  formData.append('description', params.description ?? '');
  formData.append('vocal_start_s', String(params.vocalStartS));
  formData.append('vocal_end_s', String(params.vocalEndS));
  formData.append('language', params.language ?? 'ko');
  formData.append('style_mode', params.styleMode ?? 'sing');

  if (__DEV__) {
    console.log('[voiceService] createVoiceClone 요청:', {
      fileName: params.fileName,
      voiceName: params.voiceName,
      vocalStartS: params.vocalStartS,
      vocalEndS: params.vocalEndS,
      styleMode: params.styleMode ?? 'sing',
    });
  }
  try {
    const response = await api.post('/voice-clone/create', formData, {
      headers: Platform.OS === 'web' ? undefined : { 'Content-Type': 'multipart/form-data' },
      timeout: 180000,
    });
    const data = response.data ?? {};
    if (__DEV__) console.log('[voiceService] createVoiceClone 응답:', JSON.stringify(data)?.slice(0, 200));
    return { ...data, clone_id: String(data.clone_id ?? data.id ?? '') };
  } catch (err: any) {
    console.error('[voiceService] createVoiceClone 실패:', err?.response?.status, err?.message);
    throw err;
  }
};

/** DELETE /voice-clone/{clone_id} → { deleted: true } */
export const deleteVoiceClone = async (cloneId: string) => {
  try {
    const response = await api.delete(`/voice-clone/${cloneId}`);
    if (__DEV__) console.log('[voiceService] deleteVoiceClone:', cloneId, 'status=', response.status);
    return response.data;
  } catch (err: any) {
    console.error('[voiceService] deleteVoiceClone 실패:', cloneId, err?.response?.status, err?.message);
    throw err;
  }
};

/** POST /voice-clone/{clone_id}/regenerate-phrase → { validate_task_id } */
export const regenerateClonePhrase = async (cloneId: string) => {
  try {
    const response = await api.post(`/voice-clone/${cloneId}/regenerate-phrase`);
    if (__DEV__) console.log('[voiceService] regenerateClonePhrase:', cloneId, JSON.stringify(response.data)?.slice(0, 120));
    return response.data;
  } catch (err: any) {
    console.error('[voiceService] regenerateClonePhrase 실패:', cloneId, err?.response?.status, err?.message);
    throw err;
  }
};

/**
 * POST /voice-clone/{clone_id}/verify — 낭독 검증 녹음 제출.
 * singerSkillLevel ∈ beginner|intermediate|advanced|professional (서버 ALLOWED_SKILL_LEVELS).
 * 응답: { clone_id, generate_task_id, status }
 */
export const verifyVoiceClone = async (
  cloneId: string,
  params: { fileUri: string; fileName: string; singerSkillLevel: string }
) => {
  const formData = new FormData();
  await appendAudioFile(formData, 'verify_file', params.fileUri, params.fileName);
  formData.append('singer_skill_level', params.singerSkillLevel);

  if (__DEV__) {
    console.log('[voiceService] verifyVoiceClone 요청:', cloneId, {
      fileName: params.fileName,
      singerSkillLevel: params.singerSkillLevel,
    });
  }
  try {
    const response = await api.post(`/voice-clone/${cloneId}/verify`, formData, {
      headers: Platform.OS === 'web' ? undefined : { 'Content-Type': 'multipart/form-data' },
      timeout: 180000,
    });
    if (__DEV__) console.log('[voiceService] verifyVoiceClone 응답:', JSON.stringify(response.data)?.slice(0, 200));
    return response.data;
  } catch (err: any) {
    console.error('[voiceService] verifyVoiceClone 실패:', cloneId, err?.response?.status, err?.message);
    throw err;
  }
};

/** POST /voice-clone/check-availability — 실측: { checked, available, expired, errors } */
export const checkCloneAvailability = async () => {
  try {
    const response = await api.post('/voice-clone/check-availability');
    if (__DEV__) console.log('[voiceService] checkCloneAvailability:', JSON.stringify(response.data)?.slice(0, 160));
    return response.data;
  } catch (err: any) {
    console.error('[voiceService] checkCloneAvailability 실패:', err?.response?.status, err?.message);
    throw err;
  }
};
