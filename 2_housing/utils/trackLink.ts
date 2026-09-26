// v3.235 B5 [TrackLink] 공유 링크 진입 → 곡 즉시 재생.
//  진입 형태
//   · 웹: 서버 공유 랜딩(`/track/{id}`, S7)이 `https://app.maidol.ai.kr/?track={id}` 로 보낸다
//     (래퍼 app-shell 이 search 를 `/app` 로 보존 — 래퍼 무변경). 앱 모듈 로드 시 1회 캡처.
//   · 네이티브: `aidol://track/{id}`(랜딩 '앱에서 열기') — 콜드 스타트 getInitialURL + 실행 중 url 이벤트.
//     개발 빌드(Expo Go `exp://…/--/track/{id}`)·향후 App Links(`https://…/track/{id}`)도 같은 파서로 수용.
//  소비: pending 1건 → 컨테이너 ready + 현재 라우트 ≠ Splash 인 첫 시점(App.tsx syncRoute)에
//   `GET /tracks/{id}` 선조회 → 200 = 재생목록 뒤에 붙이고(v3.223 곡 단위 append 관행) Player(via:'share') /
//   404 등 = "비공개로 바뀌었거나 삭제된 곡이에요" 안내 후 현재 화면(차트) 유지.
//   웹은 소비 즉시 주소창에서 `track` 파라미터만 제거(`ref` 등 보존, history.state 유지).
//  OAuth 콜백(#token/#error)·`?ref=` 추천코드 캡처와 독립(서로의 값을 건드리지 않음).
//  React Navigation linking config 는 무변경 — `track/…` 경로는 config 불일치로 무시된다(getStateFromPath → undefined).
// v3.237 B [TrackLink] 공유 ID `?s=`(서버 랜딩이 `/?track={id}&s={s}` 로 전달 · 네이티브 `aidol://track/{id}?s=`):
//   형식(8자 소문자 base36) 검증 후 pending 에 함께 보관 → 소비 시 Player 파라미터 `shareId` + 측정 이벤트
//   `share_link_open`(track_id·share_id·logged_in — 개인정보·자유 문자열 없음). 형식 불일치·없음 = shareId 없이 기존 동작 그대로.
//   웹 주소창 정리 시 `track` 과 함께 `s` 도 제거(`ref`·hash 보존).
import { Platform } from 'react-native';
import api from '../services/api';
import { usePlayerStore } from '../stores/playerStore';
import { useAuthStore } from '../stores/authStore';
import { trackEvent } from './screenAnalytics';
import { showAlert } from './appAlert';

/** Mongo ObjectId(24 hex) — 서버 트랙 id 형식 */
export const TRACK_ID_RE = /^[0-9a-f]{24}$/i;

export type TrackLinkSrc = 'web' | 'native';

export interface PendingTrackLink {
  id: string;
  src: TrackLinkSrc;
  /** v3.237: 공유 ID(`?s=`, 8자 base36) — 형식 통과분만 */
  shareId?: string;
}

/** v3.237: 공유 ID — 서버 랜딩 정규식(^[0-9a-z]{8}$)과 동일. 대문자·길이 불일치는 무효(서버도 전달 안 함) */
export const SHARE_ID_RE = /^[0-9a-z]{8}$/;

/** 형식 검증 후 공유 ID, 아니면 '' (순수) — 대소문자 변환 없음(서버 규칙과 동일하게 엄격) */
export function normalizeShareId(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const v = raw.trim();
  return SHARE_ID_RE.test(v) ? v : '';
}

/** search 문자열에서 첫 유효 `s` (순수). 중복 파라미터는 첫 유효값 */
export function parseShareIdFromSearch(search: string | null | undefined): string {
  if (!search) return '';
  try {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    for (const v of params.getAll('s')) {
      const sid = normalizeShareId(v);
      if (sid) return sid;
    }
  } catch {
    // 손상된 쿼리 — 무시
  }
  return '';
}

/** 딥링크/URL 의 쿼리(해시 앞)에서 `s` (순수). OAuth 콜백 URL 은 항상 '' */
export function parseShareIdFromUrl(url: string | null | undefined): string {
  if (!url || typeof url !== 'string') return '';
  if (url.includes('oauth/callback')) return '';
  const qm = url.match(/\?([^#]*)/);
  return qm ? parseShareIdFromSearch(qm[1]) : '';
}

/** 형식 검증 후 소문자 id, 아니면 '' (순수) */
export function normalizeTrackId(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const v = raw.trim();
  return TRACK_ID_RE.test(v) ? v.toLowerCase() : '';
}

/** `?a=1&track=…` 형태 search 문자열에서 첫 유효 track id (순수). 중복 파라미터는 첫 유효값 */
export function parseTrackIdFromSearch(search: string | null | undefined): string {
  if (!search) return '';
  try {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    for (const v of params.getAll('track')) {
      const id = normalizeTrackId(v);
      if (id) return id;
    }
  } catch {
    // 손상된 쿼리 — 무시
  }
  return '';
}

/**
 * 딥링크/URL 에서 track id (순수). 지원:
 *  aidol://track/{id} · aidol:///track/{id} · exp://host/--/track/{id} · https://host/track/{id} · …?track={id}
 * OAuth 콜백(`oauth/callback`) URL 은 항상 '' — 로그인 처리와 섞이지 않게.
 */
export function parseTrackIdFromUrl(url: string | null | undefined): string {
  if (!url || typeof url !== 'string') return '';
  if (url.includes('oauth/callback')) return '';
  const qIdx = url.search(/[?#]/);
  const base = qIdx >= 0 ? url.slice(0, qIdx) : url;
  const m =
    base.match(/^aidol:\/{2,3}track\/([^/]+)\/?$/i) ||
    base.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]*\/(?:--\/)?track\/([^/]+)\/?$/i);
  if (m) {
    let seg = m[1];
    try { seg = decodeURIComponent(seg); } catch {}
    const id = normalizeTrackId(seg);
    if (id) return id;
  }
  // 쿼리 폴백(`aidol://?track=` · `https://app…/?track=`) — 해시 앞 쿼리만
  const qm = url.match(/\?([^#]*)/);
  return qm ? parseTrackIdFromSearch(qm[1]) : '';
}

/** href 에서 `track`(+ v3.237 공유 ID `s`) 파라미터를 제거한 상대 URL(path+search+hash) — track 없으면 null (순수).
 *  `s` 는 track 과 함께 올 때만 링크 소속으로 보고 제거한다(`ref` 등 다른 파라미터·hash 보존). */
export function stripTrackParam(href: string): string | null {
  try {
    const u = new URL(href);
    if (!u.searchParams.has('track')) return null;
    u.searchParams.delete('track');
    u.searchParams.delete('s');
    const qs = u.searchParams.toString();
    return `${u.pathname}${qs ? `?${qs}` : ''}${u.hash}`;
  } catch {
    return null;
  }
}

// ── pending 1건(가장 최근 진입이 이긴다) ──
let pending: PendingTrackLink | null = null;
let consuming = false;
/** 같은 링크의 연속 수신(getInitialURL + url 이벤트 중복 등) 억제 창 */
export const TRACK_LINK_DEDUPE_MS = 3000;
let lastCaptured: { id: string; at: number } | null = null;

export function peekPendingTrackLink(): PendingTrackLink | null {
  return pending;
}

function setPending(id: string, src: TrackLinkSrc, shareId: string = '', now: number = Date.now()): boolean {
  if (!id) return false;
  if (lastCaptured && lastCaptured.id === id && now - lastCaptured.at < TRACK_LINK_DEDUPE_MS) {
    // v3.237: 중복 수신 중 뒤늦게 공유 ID 가 온 경우(같은 곡·아직 미소비)만 보강
    if (shareId && pending && pending.id === id && !pending.shareId) pending = { ...pending, shareId };
    if (__DEV__) console.info('[TrackLink] 중복 수신 무시', { id, src });
    return false;
  }
  lastCaptured = { id, at: now };
  pending = shareId ? { id, src, shareId } : { id, src };
  console.info('[TrackLink] captured', { id, src, s: shareId || null });
  return true;
}

/** 웹 전용 — 앱 모듈 로드 시 1회(React Navigation 이 주소를 바꾸기 전) `?track=` 캡처 */
export function captureWebTrackLink(): string {
  try {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return '';
    const search = window.location.search;
    const id = parseTrackIdFromSearch(search);
    if (id) setPending(id, 'web', parseShareIdFromSearch(search));
    return id;
  } catch (err: any) {
    console.error('[TrackLink] web capture 실패', { message: err?.message });
    return '';
  }
}

/** 네이티브 딥링크 캡처 — 트랙 링크면 true */
export function captureNativeTrackLink(url: string | null | undefined): boolean {
  const id = parseTrackIdFromUrl(url);
  return id ? setPending(id, 'native', parseShareIdFromUrl(url)) : false;
}

/** 웹 주소창에서 track(+s) 파라미터 제거(ref·hash·history.state 보존) */
export function clearWebTrackParam(): void {
  try {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const next = stripTrackParam(window.location.href);
    if (next === null) return;
    window.history.replaceState(window.history.state, '', next);
    if (__DEV__) console.info('[TrackLink] 주소창 track·s 제거');
  } catch (err: any) {
    console.error('[TrackLink] 주소창 정리 실패', { message: err?.message });
  }
}

/** 재생목록 보관용 축약 트랙 — 상세(가사·프롬프트·착장)는 Player 가 풀 트랙으로 다시 조회한다 */
export function toQueueTrack(data: any): any {
  const keys = [
    'id', 'title', 'artist_name', 'agency_name', 'uploader_id', 'uploader_nickname',
    'cover_image', 'cover_image_url', 'play_count', 'like_count', 'genre', 'mood',
    'duration_sec', 'album_id', 'is_public', 'ai_model', 'created_at',
  ];
  const out: any = {};
  for (const k of keys) if (data?.[k] !== undefined) out[k] = data[k];
  out.id = String(data?.id);
  return out;
}

export type ConsumeResult = 'none' | 'waiting' | 'busy' | 'consumed' | 'not-found' | 'error';

export interface ConsumeDeps {
  isReady: () => boolean;
  currentRoute: () => string | undefined;
  navigate: (name: string, params: any) => void;
  /** 소비 보류 사유(없으면 null) — App.tsx: 재생목록 하이드레이션·부팅 세션 복원/OAuth 로그인 정착 전.
   *  로그인 복원(restoreQueueFor)이 재생목록을 계정 보관함으로 교체하므로, 그 뒤에 붙여야 링크 곡이 남는다. */
  blockedReason?: () => string | null;
}

/**
 * pending 소비 — 준비 전(컨테이너 미준비·Splash)이면 'waiting'(보관 유지).
 * 소비 시점에 곧장 pending 을 비워 중복 소비를 막는다(syncRoute 가 연속 호출돼도 1회).
 */
export async function consumePendingTrackLink(deps: ConsumeDeps): Promise<ConsumeResult> {
  if (!pending) return 'none';
  if (consuming) return 'busy';
  let route: string | undefined;
  try {
    if (!deps.isReady()) return 'waiting';
    route = deps.currentRoute();
  } catch {
    return 'waiting';
  }
  if (!route || route === 'Splash') return 'waiting';
  let blocked: string | null = null;
  try {
    blocked = deps.blockedReason ? deps.blockedReason() : null;
  } catch {
    blocked = null;
  }
  if (blocked) {
    if (__DEV__) console.info('[TrackLink] 소비 보류', { reason: blocked });
    return 'waiting';
  }
  const link = pending;
  pending = null;
  consuming = true;
  if (link.src === 'web') clearWebTrackParam();
  try {
    const res = await api.get(`/tracks/${link.id}`);
    const data = res?.data;
    if (!data?.id) {
      console.warn('[TrackLink] not-found', { id: link.id, src: link.src, reason: 'empty' });
      showAlert('알림', '비공개로 바뀌었거나 삭제된 곡이에요.');
      return 'not-found';
    }
    const qt = toQueueTrack(data);
    // v3.223 곡 단위 재생 = append(차트 곡 탭 관행 1:1) — 기존 재생목록 보존, 중복이면 기존 위치 재생
    const ps = usePlayerStore.getState();
    ps.addToQueue(qt);
    const q = usePlayerStore.getState().queue;
    const idx = q.findIndex((t: any) => String(t?.id) === String(qt.id));
    usePlayerStore.getState().setCurrentIndex(idx >= 0 ? idx : q.length - 1);
    deps.navigate('Player', link.shareId ? { track: qt, via: 'share', shareId: link.shareId } : { track: qt, via: 'share' });
    console.info('[TrackLink] consumed', { id: link.id, src: link.src, s: link.shareId || null, from: route, queueLen: q.length });
    emitShareLinkOpen(link);
    return 'consumed';
  } catch (err: any) {
    const status = err?.response?.status;
    if (status === 404 || status === 403 || status === 400 || status === 422) {
      console.warn('[TrackLink] not-found', { id: link.id, src: link.src, status });
      showAlert('알림', '비공개로 바뀌었거나 삭제된 곡이에요.');
      return 'not-found';
    }
    console.error('[TrackLink] 곡 조회 실패', { id: link.id, src: link.src, status, message: err?.message });
    showAlert('알림', '곡을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
    return 'error';
  } finally {
    consuming = false;
  }
}

/** v3.237 측정 — 링크 진입 1건(착지 성공 시 · 404/오류 = 0건). 개인정보 없음: 곡 id·공유 id·로그인 여부만.
 *  s 없는 구 링크도 share_id 없이 1건(구 링크 유입 측정).
 *  전송 실패·예외는 앱 동작에 영향 없게 삼킨다(로그만). */
function emitShareLinkOpen(link: PendingTrackLink): void {
  try {
    let loggedIn = false;
    try { loggedIn = !!useAuthStore.getState().user; } catch { loggedIn = false; }
    // props = PLAN 고정 형식 키만(track_id 24hex · share_id 8 base36 · logged_in bool) — 자유 문자열 0
    const props: Record<string, string | number | boolean> = { track_id: link.id, logged_in: loggedIn };
    if (link.shareId) props.share_id = link.shareId;
    trackEvent('share_link_open', props);
    if (__DEV__) console.info('[TrackLink] event share_link_open', { id: link.id, s: link.shareId || null, loggedIn });
  } catch (err: any) {
    console.error('[TrackLink] share_link_open 기록 실패', { message: err?.message });
  }
}

/** 테스트 전용 — 모듈 상태 초기화 */
export function __resetTrackLinkForTest(): void {
  pending = null;
  consuming = false;
  lastCaptured = null;
}
