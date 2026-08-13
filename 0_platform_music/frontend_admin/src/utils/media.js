// v175 — 어드민 미디어 src 헬퍼 공용화.
// AdminReportsPage(v138) 로컬 함수에서 이동 — react-refresh 규칙상 컴포넌트 파일
// (RecentContentPane.jsx)에서는 컴포넌트 외 export 를 둘 수 없어 utils 로 분리.
import { coverPreviewUrl } from '../api';

export function coverSrc(url) {
  if (!url) return '';
  if (url.startsWith('http') || url.startsWith('/api/')) return url;
  return coverPreviewUrl(url);
}

// v138 — 어드민 전용 미디어(/api/admin/media/...)는 img src 에 토큰 쿼리 필요
// (인터셉터가 못 붙는 <img> 태그 경로 — adminEvidenceUrl 과 동일 패턴)
export function adminMediaSrc(url) {
  if (!url) return '';
  if (url.startsWith('/api/admin/')) {
    const token = localStorage.getItem('token') || '';
    return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
  }
  return coverSrc(url);
}
