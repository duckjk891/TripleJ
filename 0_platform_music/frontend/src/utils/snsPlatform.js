// SNS 플랫폼 감지 유틸 — URL 호스트 기반으로 { key, label, icon } 반환.
// Header 모달(입력값 실시간 아이콘) / PlayerPage(업로더 SNS 링크 표시) 공용.

const PLATFORMS = [
  { key: 'youtube', label: 'YouTube', icon: '▶', hosts: ['youtube.com', 'youtu.be'] },
  { key: 'instagram', label: 'Instagram', icon: '📷', hosts: ['instagram.com'] },
  { key: 'x', label: 'X', icon: '🐦', hosts: ['x.com', 'twitter.com'] },
  { key: 'tiktok', label: 'TikTok', icon: '🎵', hosts: ['tiktok.com'] },
  { key: 'facebook', label: 'Facebook', icon: '📘', hosts: ['facebook.com'] },
  { key: 'soundcloud', label: 'SoundCloud', icon: '🔊', hosts: ['soundcloud.com'] },
  { key: 'spotify', label: 'Spotify', icon: '🎧', hosts: ['spotify.com'] },
];

/**
 * URL 에서 SNS 플랫폼 감지.
 * - 알려진 호스트(서브도메인 포함, www. 제거) → 해당 플랫폼
 * - 그 외 유효 URL → { key: 'link', label: 호스트명, icon: '🔗' }
 * - URL 파싱 실패 → { key: 'link', label: url 앞부분, icon: '🔗' }
 */
export function detectPlatform(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    for (const p of PLATFORMS) {
      if (p.hosts.some((h) => host === h || host.endsWith('.' + h))) {
        return { key: p.key, label: p.label, icon: p.icon };
      }
    }
    return { key: 'link', label: host, icon: '🔗' };
  } catch {
    return { key: 'link', label: String(url ?? '').slice(0, 30), icon: '🔗' };
  }
}

/** 표시용 URL 축약 — 프로토콜/www. 제거 후 maxLen 초과 시 말줄임. */
export function shortenSnsUrl(url, maxLen = 38) {
  const s = String(url ?? '').replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
}
