// v3.289 [VoiceMsg]: 목소리 학습 실패 안내 문구 — 사용자에게 "Network Error"·Suno 영문 원문을
// 그대로 노출하지 않는다(대표 지시 10-06). 원문은 호출측 console 로그에만 남긴다.

export const VOICE_RETRY_HINT = '더 정확한 목소리 분석을 위해 다시 시도해주세요.';

/** Suno/서버 실패 원문(error_message) → 사용자 안내 본문 */
export function friendlyVoiceFailure(raw: string | null | undefined): string {
  const msg = String(raw || '');
  if (/didn'?t sound like you said|phrase more clearly|read(ing)? it more clearly/i.test(msg)) {
    return `안내 문구가 또렷하게 들리지 않았어요.\n조용한 곳에서 문구를 천천히 또박또박 읽어주세요.`;
  }
  if (/phrase expired|not found\. please request a new phrase|만료/i.test(msg)) {
    return `안내 문구의 확인 시간이 지났어요.\n${VOICE_RETRY_HINT}`;
  }
  if (/시간 초과|timeout/i.test(msg)) {
    return `목소리 분석이 너무 오래 걸렸어요.\n${VOICE_RETRY_HINT}`;
  }
  return `목소리를 명확하게 분석하지 못했어요.\n${VOICE_RETRY_HINT}`;
}

/**
 * API 오류(axios) → 사용자 안내 본문.
 * 서버가 준 한국어 안내(예: 구간 30초 이상, 보관함 샘플 없음)는 그대로 보여주고,
 * 네트워크 오류·영문 원문은 공통 재시도 안내로 바꾼다.
 */
export function friendlyVoiceApiError(err: any, lead: string): string {
  const detail = err?.response?.data?.detail ?? err?.response?.data?.error;
  if (typeof detail === 'string' && /[가-힣]/.test(detail) && !/validate|generate|suno/i.test(detail)) {
    return `${lead}\n${detail}`;
  }
  return `${lead}\n${VOICE_RETRY_HINT}`;
}

/** 응답을 못 받은 오류(연결 끊김·타임아웃) — 서버는 처리했을 수 있으므로 상태 재확인 대상 */
export function isNoResponseError(err: any): boolean {
  return !err?.response && (err?.message === 'Network Error' || err?.code === 'ECONNABORTED' || /timeout|network/i.test(String(err?.message || '')));
}
