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

/**
 * 서버 voice_clone.py 최소 샘플·구간 길이(초).
 * v3.281: 15→30 — 실데이터(10-04) 클론 구간 18건 중 16건이 5~24초라 유사도가 낮았다(Suno 권장 1분 이상).
 * 서버는 구간(끝-시작) 30초 미만을 400, 정규화 실패·5초 미만을 422 로 ⭐ 차감 전에 거절한다.
 */
export const MIN_SAMPLE_DURATION_S = 30;
/** v3.281: 더 닮은 목소리를 위한 권장 길이(초) — 안내 문구용 */
export const RECOMMENDED_SAMPLE_DURATION_S = 60;

/**
 * 샘플 길이 부족 판정 — 길이를 아는 경우(녹음·프로브 성공)만 차단한다.
 * 길이를 모르는 업로드(null/undefined)는 서버 검증(422, ⭐ 차감 전)에 맡긴다.
 */
export function isSampleTooShort(durationS: number | null | undefined): boolean {
  if (typeof durationS !== 'number' || !Number.isFinite(durationS) || durationS <= 0) return false;
  return durationS < MIN_SAMPLE_DURATION_S;
}

/**
 * v3.281 — 보컬 구간(끝-시작) 길이 부족 판정. 서버 voice_clone.py MIN_VOCAL_SEGMENT_S(30초)와 동일 기준.
 * 숫자가 아니거나 끝<=시작이면 false(그 경우는 호출부의 '구간 확인' 검증이 담당).
 */
export function isSegmentTooShort(startS: number, endS: number): boolean {
  if (!Number.isFinite(startS) || !Number.isFinite(endS) || endS <= startS) return false;
  return endS - startS < MIN_SAMPLE_DURATION_S;
}
