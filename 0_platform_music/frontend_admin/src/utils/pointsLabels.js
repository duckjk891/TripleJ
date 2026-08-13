// 별(포인트) 액션 한글 라벨 — 단일 소스 (v180 AdminPointsPage 내부 정의를 v181 에서 모듈로 추출).
// AdminPointsPage(운영 탭 원장)·AdminPointsDashboard(분석 분포 패널)가 공유한다.
// 참고: 페이지 파일 named export 는 react-refresh/only-export-components 규칙 위반이라 별도 모듈로 둔다.

// 기본 액션 한글 라벨 — spend:/refund: 접두는 분해 후 조합. 미등록 action 은 원문 fallback.
export const BASE_ACTION_LABELS = {
  listen: '재생 적립',
  download: '다운로드 적립',
  attendance: '출석',
  signup_bonus: '가입 보너스',
  lyrics: '작사',
  compose: '작곡',
  cover: '커버 이미지',
  character: '캐릭터 시트',
  fatigue_skip: '피로 스킵',
};

export function actionLabel(action) {
  if (!action) return '-';
  if (action === 'admin_adjust') return '관리자 지급';
  if (action === 'spend:admin_adjust') return '관리자 차감';
  if (action.startsWith('spend:')) {
    const base = BASE_ACTION_LABELS[action.slice(6)];
    return base ? `${base} 사용` : action; // 미등록 원문 fallback
  }
  if (action.startsWith('refund:')) {
    const base = BASE_ACTION_LABELS[action.slice(7)];
    return base ? `${base} 환불` : action;
  }
  return BASE_ACTION_LABELS[action] || action;
}
