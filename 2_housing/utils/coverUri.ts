import { BACKEND_BASE_URL } from '../services/api';

// 트랙 커버 값은 응답마다 형태가 다르다: object명(covers/...), 이미 조립된 프록시 경로
// (/api/upload/cover-preview/... — 앨범 상세 tracks), presigned 풀 URL(만료됨).
// object명을 우선하고, 경로/URL은 다시 감싸지 않는다(이중 래핑 시 404로 커버가 빈다).
function isBuilt(v: string): boolean {
  return v.startsWith('http') || v.startsWith('/');
}

/** v3.275 [perf]: 서버 썸네일 폭 — 목록 행·미니플레이어 160, 카드/그리드 320, 중간 크기 640. 미지정 = 원본.
 *  실측: 커버 원본이 장당 6~8MB PNG 로 전체 트래픽의 85~95% — 목록은 반드시 썸네일을 쓴다. */
export type CoverThumbWidth = 160 | 320 | 640;

const withThumb = (url: string, w?: CoverThumbWidth) =>
  w && url.includes('/api/upload/cover-preview/') ? `${url}${url.includes('?') ? '&' : '?'}w=${w}` : url;

export function trackCoverUri(
  track: { cover_image?: string | null; cover_image_url?: string | null } | null | undefined,
  w?: CoverThumbWidth,
): string | null {
  const cands = [track?.cover_image, track?.cover_image_url].filter((v): v is string => !!v);
  if (!cands.length) return null;
  const objectName = cands.find((v) => !isBuilt(v));
  if (objectName) return withThumb(`${BACKEND_BASE_URL}/api/upload/cover-preview/${encodeURIComponent(objectName)}`, w);
  const built = cands[0];
  return withThumb(built.startsWith('/') ? `${BACKEND_BASE_URL}${built}` : built, w);
}

/** object 명 → 커버 URL(썸네일 폭 선택) — 화면별 자체 조립 대신 이 함수로 통일(브라우저 캐시 키 일치) */
export function coverObjectUri(objectName: string | null | undefined, w?: CoverThumbWidth): string | null {
  if (!objectName) return null;
  if (isBuilt(objectName)) return withThumb(objectName.startsWith('/') ? `${BACKEND_BASE_URL}${objectName}` : objectName, w);
  return withThumb(`${BACKEND_BASE_URL}/api/upload/cover-preview/${encodeURIComponent(objectName)}`, w);
}
