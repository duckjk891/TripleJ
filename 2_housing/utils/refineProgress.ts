// [CoverRefine] v3.284: 커버 미세조정 1~4단계 진행 표시 — 이미지 생성 로딩과 같은 단계 UI.
// 미세조정은 2048 고화질 전체 재생성이라(화질 유지 — 대표 지시) 실측 110~138초(10-06 서버 로그 5건).
// 서버가 단계별 진행을 주지 않으므로 경과 시간으로 단계를 넘긴다 — 마지막 단계는 완료 시까지 유지.
// React/RN 의존 없음 — Node 하니스로 검증.

export interface ProgressStep {
  label: string;
  message: string;
}

export const REFINE_STEPS: ProgressStep[] = [
  { label: '요청 확인', message: '요청하신 내용을 살펴보고 있어요...' },
  { label: '수정', message: '요청하신 부분을 고치고 있어요...' },
  { label: '다듬기', message: '나머지 부분을 원본에 맞춰 다듬고 있어요...' },
  { label: '마무리', message: '거의 다 됐어요. 마무리 중이에요...' },
];

/** 단계 시작 시각(초) — 실측 중앙값 약 2분에 맞춰 마지막 단계가 끝나기 30~50초 전에 오도록 */
export const REFINE_STEP_STARTS_SEC = [0, 15, 45, 85];

/** 보통 걸리는 시간 안내 문구 */
export const REFINE_TYPICAL_TEXT = '보통 2분 정도 걸려요';

/** 경과(ms) → 단계 인덱스(0~3). 음수·비수치는 0, 시계 역행도 0 */
export function refineStepIndex(elapsedMs: number): number {
  if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  const sec = elapsedMs / 1000;
  let idx = 0;
  REFINE_STEP_STARTS_SEC.forEach((s, i) => {
    if (sec >= s) idx = i;
  });
  return Math.min(idx, REFINE_STEPS.length - 1);
}
