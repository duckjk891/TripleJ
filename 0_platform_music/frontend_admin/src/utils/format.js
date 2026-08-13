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

// SanctionSquad(v145) — restricted_until 이 현재 시각 이후면 "생성 제한 중"
export function isRestricted(user) {
  if (!user?.restricted_until) return false;
  return new Date(user.restricted_until).getTime() > Date.now();
}
