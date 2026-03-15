// ID 기반으로 HSL 그라데이션 색상 생성
export function getAlbumGradient(id) {
  const hue = ((id || 0) * 137) % 360;
  return `linear-gradient(135deg, hsl(${250 + (hue % 60)}, 60%, 45%), hsl(${180 + ((hue + 30) % 60)}, 70%, 40%))`;
}

// 아티스트 아바타 배경색
export function getAvatarColor(id) {
  const hue = ((id || 0) * 97) % 360;
  return `hsl(${250 + (hue % 60)}, 55%, 50%)`;
}

// 이름 첫글자 추출
export function getInitial(name) {
  if (!name) return '?';
  return name.charAt(0).toUpperCase();
}

// 재생 횟수 포맷
export function formatPlayCount(count) {
  if (!count) return '0';
  if (count >= 100000000) return `${(count / 100000000).toFixed(1)}억`;
  if (count >= 10000) return `${(count / 10000).toFixed(1)}만`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}천`;
  return count.toLocaleString();
}

// 날짜 포맷
export function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}
