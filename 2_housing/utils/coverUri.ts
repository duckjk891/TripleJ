import { BACKEND_BASE_URL } from '../services/api';

// 트랙 커버 값은 응답마다 형태가 다르다: object명(covers/...), 이미 조립된 프록시 경로
// (/api/upload/cover-preview/... — 앨범 상세 tracks), presigned 풀 URL(만료됨).
// object명을 우선하고, 경로/URL은 다시 감싸지 않는다(이중 래핑 시 404로 커버가 빈다).
function isBuilt(v: string): boolean {
  return v.startsWith('http') || v.startsWith('/');
}

export function trackCoverUri(track: { cover_image?: string | null; cover_image_url?: string | null } | null | undefined): string | null {
  const cands = [track?.cover_image, track?.cover_image_url].filter((v): v is string => !!v);
  if (!cands.length) return null;
  const objectName = cands.find((v) => !isBuilt(v));
  if (objectName) return `${BACKEND_BASE_URL}/api/upload/cover-preview/${encodeURIComponent(objectName)}`;
  const built = cands[0];
  return built.startsWith('/') ? `${BACKEND_BASE_URL}${built}` : built;
}
