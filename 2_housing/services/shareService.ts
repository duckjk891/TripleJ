// [ShareCompose] v3.237 공유 문구 API — GET /api/share/track/{track_id}(optional auth, 타임아웃 3초).
// 계약(PLAN v3.237 API-1 — backend 동시 작업, 아래는 계약 가정):
//   200 { track:{id,title,artist_name}, audience:"own"|"other", theme:{key,name,source:"override"|"auto"|"default"},
//         templates:[{id,theme,kind:"normal"|"dedication",label,emoji?,order,enabled?,body}] (body = audience 해석 완료·치환 전 원문),
//         benefit:{text}|null (베타 종료 시 null), link:"https://api.maidol.ai.kr/track/{id}", limits:{body,recipient,head_title},
//         recipient_default, config_version }
//   404 {error} = 비공개로 바뀌었거나 삭제·블라인드(요청자가 업로더면 비공개도 200) — 서버 관행 JSONResponse({"error":…}).
//   그 외 오류·타임아웃·형식 오류 = 내장 기본값 폴백.
//   ※ 구서버(라우트 없음)도 404 를 준다 → 본문이 FastAPI 기본 {"detail":"Not Found"} 이면 라우트 부재로 보고 폴백.
import api from './api';
import { trackShareUrl } from '../utils/trackShare';
import { SHARE_MESSAGES_DEFAULT } from '../constants/shareMessages';
import {
  buildLocalShareData,
  oneLine,
  ShareArtistSource,
  ShareAudience,
  ShareData,
  ShareTemplate,
  ShareThemeSource,
} from '../utils/shareMessage';

export const SHARE_API_TIMEOUT_MS = 3000;
const TEMPLATE_ID_RE = /^[a-z0-9_]{1,32}$/;

export type ShareLoadStatus = 'server' | 'fallback' | 'not_found';

export interface ShareLoadResult {
  status: ShareLoadStatus;
  data: ShareData | null;
  /** 폴백 사유(로그용) */
  reason?: string;
}

function num(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : def;
  return n >= min && n <= max ? n : def;
}

/** 서버 응답 정규화(순수) — 쓸 수 있는 안이 하나도 없으면 null(→ 폴백) */
export function normalizeShareResponse(raw: any, trackId: string, isOwn: boolean): ShareData | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.templates)) return null;
  const templates: ShareTemplate[] = [];
  const seen = new Set<string>();
  for (const t of raw.templates) {
    if (!t || typeof t !== 'object') continue;
    const id = typeof t.id === 'string' ? t.id : '';
    const body = typeof t.body === 'string' ? t.body : '';
    if (!TEMPLATE_ID_RE.test(id) || !body.trim() || seen.has(id)) continue;
    seen.add(id);
    templates.push({
      id,
      theme: typeof t.theme === 'string' && t.theme ? t.theme : 'default',
      kind: t.kind === 'dedication' ? 'dedication' : 'normal',
      emoji: typeof t.emoji === 'string' && t.emoji.trim() ? t.emoji.trim() : undefined,
      label: oneLine(t.label) || id,
      order: typeof t.order === 'number' && Number.isFinite(t.order) ? t.order : 0,
      enabled: t.enabled !== false,
      body,
    });
  }
  if (!templates.some((t) => t.enabled)) return null;
  const d = SHARE_MESSAGES_DEFAULT;
  const audience: ShareAudience = raw.audience === 'own' || raw.audience === 'other' ? raw.audience : (isOwn ? 'own' : 'other');
  const source: ShareThemeSource = raw.theme?.source === 'override' || raw.theme?.source === 'auto' ? raw.theme.source : 'default';
  const themeKey = typeof raw.theme?.key === 'string' && /^[a-z0-9_]{1,16}$/.test(raw.theme.key) ? raw.theme.key : 'default';
  const link = typeof raw.link === 'string' && /^https?:\/\/\S+$/.test(raw.link) ? raw.link : trackShareUrl(trackId);
  const benefitText = raw.benefit && typeof raw.benefit.text === 'string' ? oneLine(raw.benefit.text) : '';
  return {
    track: {
      id: trackId,
      title: oneLine(raw.track?.title),
      artist_name: oneLine(raw.track?.artist_name),
    },
    audience,
    theme: { key: themeKey, name: oneLine(raw.theme?.name), source: themeKey === 'default' ? 'default' : source },
    templates,
    benefit: benefitText ? { text: benefitText } : null,
    link,
    limits: {
      body: num(raw.limits?.body, d.limits.body, 20, 1000),
      recipient: num(raw.limits?.recipient, d.limits.recipient, 1, 100),
      head_title: num(raw.limits?.head_title, d.limits.head_title, 5, 200),
    },
    recipient_default: oneLine(raw.recipient_default) || d.recipient_default,
    config_version: typeof raw.config_version === 'number' ? raw.config_version : 0,
  };
}

/** 라우트 부재(구서버) 404 판별 — FastAPI 기본 본문 {"detail":"Not Found"} */
function isRouteMissing404(err: any): boolean {
  const data = err?.response?.data;
  return !!data && typeof data === 'object' && data.detail === 'Not Found' && !data.error;
}

/**
 * 공유 문구 데이터 로드. 곡 정보(title·artist)가 응답에 없으면 진입 곡 정보로 채운다.
 * 반환: server(정상) / fallback(내장 기본값) / not_found(비공개 전환·삭제 — 화면은 안내 후 닫기).
 */
export async function fetchShareData(
  track: { id: string | number; title?: string } & ShareArtistSource,
  isOwn: boolean,
  now: number = Date.now(),
): Promise<ShareLoadResult> {
  const trackId = String(track.id);
  const fallback = (reason: string): ShareLoadResult => ({
    status: 'fallback',
    reason,
    data: buildLocalShareData(track, isOwn, trackShareUrl(trackId), now),
  });
  try {
    const res = await api.get(`/share/track/${encodeURIComponent(trackId)}`, { timeout: SHARE_API_TIMEOUT_MS });
    const data = normalizeShareResponse(res?.data, trackId, isOwn);
    if (!data) {
      console.error('[ShareCompose] fail — 응답 형식 오류 → 내장 기본값', { id: trackId });
      return fallback('invalid');
    }
    // 제목만 보충. 아티스트는 서버 값 그대로(null/빈 값 = 아티스트 없음 → 머리줄 「곡명」 만) — 앱 곡 객체의
    // artist_name 은 업로더 닉네임 폴백일 수 있어 외부 문구에 쓰지 않는다(v3.237 tester 버그 1).
    if (!data.track.title) data.track.title = oneLine(track.title);
    return { status: 'server', data };
  } catch (err: any) {
    const status = err?.response?.status;
    if (status === 404 && !isRouteMissing404(err)) {
      console.error('[ShareCompose] fail — 곡 없음/비공개(404)', { id: trackId });
      return { status: 'not_found', data: null };
    }
    console.error('[ShareCompose] fail — 공유 설정 조회 → 내장 기본값', { id: trackId, status, message: err?.message });
    return fallback(status ? `http_${status}` : (err?.code === 'ECONNABORTED' ? 'timeout' : 'network'));
  }
}
