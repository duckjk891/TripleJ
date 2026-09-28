// v3.246 T1 [1c][27]: 웹 녹음 컨테이너 선택 — expo-av 웹 프리셋은 mimeType 'audio/webm' 고정인데
// iOS 사파리 MediaRecorder는 webm 미지원(생성자 NotSupportedError) → 녹음 자체가 실패했다.
// MediaRecorder.isTypeSupported로 지원 컨테이너를 고른다(iOS 사파리=audio/mp4 우선).
// 서버 voice_clone.py ALLOWED_AUDIO_EXT = {mp3, wav, m4a, webm, ogg} — CT는 관대(확장자만 강제).
// 순수 유틸(RN/브라우저 의존 없음) — Node 하니스로 단위 검증.

export interface WebRecordingFormat {
  /** MediaRecorder에 넘길 컨테이너 mimeType */
  mimeType: string;
  /** 업로드 파일명에 쓸 확장자(점 없이) — 서버 허용 확장자와 일치해야 함 */
  extension: string;
}

/** 선호 순서: iOS 사파리(audio/mp4) → Chrome/Android(audio/webm) → Firefox(audio/ogg) */
const FORMAT_CANDIDATES: WebRecordingFormat[] = [
  { mimeType: 'audio/mp4', extension: 'm4a' },
  { mimeType: 'audio/webm', extension: 'webm' },
  { mimeType: 'audio/ogg', extension: 'ogg' },
];

/**
 * 지원되는 웹 녹음 포맷을 고른다.
 * @param isTypeSupported MediaRecorder.isTypeSupported (미지원 브라우저·비웹 = undefined)
 * @returns 지원 포맷, 판별 불가(null) — null이면 호출부가 expo-av 프리셋 기본값을 그대로 쓴다.
 */
export function pickWebRecordingFormat(
  isTypeSupported?: (type: string) => boolean
): WebRecordingFormat | null {
  if (typeof isTypeSupported !== 'function') return null;
  for (const candidate of FORMAT_CANDIDATES) {
    try {
      if (isTypeSupported(candidate.mimeType)) return candidate;
    } catch {
      // 일부 브라우저 구현이 인자에 따라 throw — 다음 후보 계속
    }
  }
  return null;
}

/** 서버 voice_clone.py 최소 샘플 길이(초) — 미만이면 422 "15초 이상의 명확한 보컬 음원" */
export const MIN_SAMPLE_DURATION_S = 15;

/**
 * 샘플 길이 부족 판정 — 길이를 아는 경우(녹음·프로브 성공)만 차단한다.
 * 길이를 모르는 업로드(null/undefined)는 서버 검증(422, ⭐ 차감 전)에 맡긴다.
 */
export function isSampleTooShort(durationS: number | null | undefined): boolean {
  if (typeof durationS !== 'number' || !Number.isFinite(durationS) || durationS <= 0) return false;
  return durationS < MIN_SAMPLE_DURATION_S;
}
