// v175 — 공용 포맷/판정 유틸.
// formatDate 는 기존 4곳(Users/Tracks/Dashboard/Reports) 복붙 구현과 동일(YYYY-MM-DD HH:mm).
// 이번 범위: AdminUserDetailPage + AdminUsersPage 만 전환 (Tracks/Dashboard/Reports 는 후속 과제).

export function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

// v188 — 페이지 표시 통일(관리자 앱 전역).
// 수집기가 저장하는 page 값은 스킴·호스트까지 포함한 전체 URL 이라
// (예: `http://100.83.210.58:4000/artist/abc`) 표 셀에서 폭을 크게 잡아먹는다.
// 화면에는 경로(+쿼리)만 보이게 하고 원문은 호출측이 title 툴팁으로 남긴다.
// **표시 전용 변환** — 저장값·API 응답·fingerprint 묶음 기준은 일절 건드리지 않는다.
// 파싱 실패(URL 형태가 아닌 값)는 원문을 그대로 폴백한다.
export function formatPagePath(url) {
  if (!url || typeof url !== 'string') return '-';
  const raw = url.trim();
  if (!raw) return '-';
  try {
    // base 를 주면 상대 경로도 파싱된다. 절대 URL 이면 base 는 무시되므로 두 형태 모두 처리.
    const u = new URL(raw, 'http://_');
    return `${u.pathname}${u.search}${u.hash}` || '/';
  } catch {
    return raw;
  }
}

// SanctionSquad(v145) — restricted_until 이 현재 시각 이후면 "생성 제한 중"
export function isRestricted(user) {
  if (!user?.restricted_until) return false;
  return new Date(user.restricted_until).getTime() > Date.now();
}
