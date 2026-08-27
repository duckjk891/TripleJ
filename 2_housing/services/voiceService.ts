import { Platform } from 'react-native';
import api, { BACKEND_BASE_URL } from './api';
import { useAuthStore } from '../stores/authStore';

// ── 내 목소리(Voice Persona) 서비스 — 백엔드 /api/voice-persona/* ──────────────
// 서버 계약(9004, 수정 불가):
//   POST   /voice-persona/create             multipart { file, name, description="" }
//   GET    /voice-persona/list               → { personas: [...] }
//   DELETE /voice-persona/{persona_id}
//   GET    /voice-persona/{persona_id}/vocal/stream   (미리듣기, ?token= 쿼리 인증 지원)

export interface VoicePersona {
  persona_id: string;
  name: string;
  description: string;
  status: string; // 'completed' 인 것만 곡 생성에 사용 가능
  [key: string]: any;
}

function normalizePersona(raw: any): VoicePersona {
  return {
    ...raw,
    persona_id: String(raw?.persona_id ?? raw?.id ?? ''),
    name: raw?.name ?? '',
    description: raw?.description ?? '',
    status: raw?.status ?? '',
  };
}

/** GET /voice-persona/list — 실측 응답: { "personas": [...] } (방어적으로 배열/다른 래핑도 수용) */
export const listVoicePersonas = async (): Promise<VoicePersona[]> => {
  try {
    const response = await api.get('/voice-persona/list');
    const data = response.data;
    const arr = Array.isArray(data)
      ? data
      : data?.personas ?? data?.items ?? data?.list ?? [];
    const personas = (Array.isArray(arr) ? arr : []).map(normalizePersona);
    if (__DEV__) {
      console.log('[voiceService] listVoicePersonas:', personas.length, '개');
    }
    return personas;
  } catch (err: any) {
    console.error('[voiceService] listVoicePersonas 실패:', err?.response?.status, err?.message);
    throw err;
  }
};

/**
 * POST /voice-persona/create — 노래 음원 업로드로 내 목소리 페르소나 생성.
 * 업로드 + Suno 처리 대기 가능성 → timeout 120초.
 */
export const createVoicePersona = async (
  fileUri: string,
  fileName: string,
  name: string,
  description: string = ''
): Promise<VoicePersona> => {
  const formData = new FormData();
  if (Platform.OS === 'web') {
    // web: 표준 Web FormData는 Blob/File 객체만 받음
    const res = await fetch(fileUri);
    const blob = await res.blob();
    formData.append('file', blob, fileName);
  } else {
    // native: RN 확장 문법
    formData.append('file', {
      uri: fileUri,
      name: fileName,
      type: 'audio/mpeg',
    } as any);
  }
  formData.append('name', name);
  formData.append('description', description);

  if (__DEV__) {
    console.log('[voiceService] createVoicePersona 요청:', { fileName, name });
  }
  try {
    const response = await api.post('/voice-persona/create', formData, {
      // web에서는 boundary 자동 추가되도록 헤더 미지정
      headers: Platform.OS === 'web' ? undefined : { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    });
    if (__DEV__) {
      console.log('[voiceService] createVoicePersona 응답:', JSON.stringify(response.data)?.slice(0, 200));
    }
    return normalizePersona(response.data?.persona ?? response.data);
  } catch (err: any) {
    console.error('[voiceService] createVoicePersona 실패:', err?.response?.status, err?.message);
    throw err;
  }
};

/** DELETE /voice-persona/{persona_id} */
export const deleteVoicePersona = async (personaId: string) => {
  try {
    const response = await api.delete(`/voice-persona/${personaId}`);
    if (__DEV__) {
      console.log('[voiceService] deleteVoicePersona:', personaId, 'status=', response.status);
    }
    return response.data;
  } catch (err: any) {
    console.error('[voiceService] deleteVoicePersona 실패:', personaId, err?.response?.status, err?.message);
    throw err;
  }
};

/**
 * 미리듣기 스트림 URL.
 * 스트림 엔드포인트는 인증 필수 — <audio>/expo-av는 헤더를 못 붙이므로
 * 백엔드가 지원하는 ?token= 쿼리 파라미터로 인증한다.
 */
export const personaVocalStreamUrl = (personaId: string): string => {
  const token = useAuthStore.getState().token;
  const base = `${BACKEND_BASE_URL}/api/voice-persona/${personaId}/vocal/stream`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
};
