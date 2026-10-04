// [GuestTrial] v3.276 게스트 작사 체험 — 비로그인 기기당 1회 무료 작사(가사 결과까지).
// 서버: POST /api/generate/lyrics/guest (헤더 X-Guest-Device-Id) — 기기당 평생 1회(429 guest_trial_used)·
// 전역 일일 상한(429 guest_daily_cap). 앱도 사용 여부를 기억해 재시도 전에 로그인으로 안내한다.
// 기기 id 는 화면 분석(utils/screenAnalytics)의 설치 단위 device_id(AsyncStorage)를 재사용.
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { BACKEND_BASE_URL } from '../services/api';
import { showAlert } from './appAlert';

export const GUEST_LYRICS_USED_KEY = 'maidol_guest_lyrics_used_v1';
/** utils/screenAnalytics DEVICE_KEY 와 동일 — 분석 초기화 전이면 같은 형식으로 만들어 둔다 */
const DEVICE_KEY = 'maidol_analytics_device_id';
/** 서버 검증 규칙과 동일(8~64자 영숫자/하이픈) */
const DEVICE_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

export const GUEST_TEXT = {
  usedTitle: '체험은 1회예요',
  usedBody: '가입하면 계속 만들 수 있어요(⭐ 지급)',
  dailyCapTitle: '오늘 체험이 마감됐어요',
  dailyCapBody: '가입하면 바로 이어서 만들 수 있어요(⭐ 지급)',
  resultBanner: '체험 결과예요 — 가입 없이 작곡까지 체험할 수 있어요',
  /** v3.277 작곡 체험 이후(작곡 체험을 이미 쓴 기기) 가사 결과 배너 */
  resultBannerComposeUsed: '체험 결과예요 — 가입하면 저장하고 작곡까지 이어서 할 수 있어요',
  composeUsedTitle: '작곡 체험은 1회예요',
  composeUsedBody: '가입하면 계속 만들 수 있어요(⭐ 지급)',
  composeDailyCapTitle: '오늘 작곡 체험이 마감됐어요',
  composeDailyCapBody: '가입하면 바로 이어서 만들 수 있어요(⭐ 지급)',
  composeIpCapTitle: '이 네트워크의 오늘 체험이 마감됐어요',
  composeIpCapBody: '가입하면 바로 이어서 만들 수 있어요(⭐ 지급)',
  musicResultBanner: '체험 곡이에요 — 가입하면 발매해서 차트에 올릴 수 있어요',
  claimedTitle: '체험 곡을 가져왔어요',
  claimedBody: '작업실 > 생성 이력에서 발매할 수 있어요.',
} as const;

/** 현재 비로그인(게스트)인지 — 렌더 밖(핸들러·afterLogin)에서 최신 상태로 판정 */
export function isGuestNow(): boolean {
  return !useAuthStore.getState().user;
}

let _usedCache: boolean | null = null;

export async function isGuestTrialUsed(): Promise<boolean> {
  if (_usedCache) return true;
  try {
    _usedCache = (await AsyncStorage.getItem(GUEST_LYRICS_USED_KEY)) === '1';
  } catch (err: any) {
    console.warn('[GuestTrial] 사용 여부 조회 실패 — 미사용 취급(서버 429가 최종 방어)', { message: err?.message });
    return false;
  }
  return _usedCache;
}

export async function markGuestTrialUsed(reason: 'success' | 'server_429'): Promise<void> {
  _usedCache = true;
  try {
    await AsyncStorage.setItem(GUEST_LYRICS_USED_KEY, '1');
    if (__DEV__) console.info('[GuestTrial] 체험 사용 기록', { reason });
  } catch (err: any) {
    console.warn('[GuestTrial] 사용 기록 실패', { reason, message: err?.message });
  }
}

function _randomDeviceId(): string {
  // screenAnalytics._randomId 와 같은 형식(시간16진-8hex-12hex)
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${Date.now().toString(16)}-${hex()}${hex()}-${hex()}${hex()}${hex()}`;
}

/** 게스트 기기 id — 분석 device_id 재사용(없으면 생성·저장). 저장 실패 시에도 이번 실행 동안 같은 값 */
let _memDeviceId: string | null = null;
export async function getGuestDeviceId(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(DEVICE_KEY);
    if (stored && DEVICE_ID_RE.test(stored)) return stored;
    const created = _memDeviceId || _randomDeviceId();
    _memDeviceId = created;
    await AsyncStorage.setItem(DEVICE_KEY, created);
    return created;
  } catch (err: any) {
    console.warn('[GuestTrial] 기기 id 저장소 접근 실패 — 메모리 id 사용', { message: err?.message });
    _memDeviceId = _memDeviceId || _randomDeviceId();
    return _memDeviceId;
  }
}

/** 서버 거절 코드 판별(429 본문 error) — guest_ip_cap 은 v3.277 작곡 체험 전용 */
export function guestDenyCode(err: any): 'guest_trial_used' | 'guest_daily_cap' | 'guest_ip_cap' | null {
  if (err?.response?.status !== 429) return null;
  const code = err?.response?.data?.error;
  return code === 'guest_trial_used' || code === 'guest_daily_cap' || code === 'guest_ip_cap' ? code : null;
}

/** POST /generate/lyrics/guest — 요청 바디는 로그인 작사와 동일(LyricsRequest). save 는 서버가 무시 */
export async function generateGuestLyrics(payload: Record<string, any>): Promise<any> {
  const deviceId = await getGuestDeviceId();
  const { save: _ignored, ...body } = payload || {};
  const res = await api.post('/generate/lyrics/guest', body, {
    headers: { 'X-Guest-Device-Id': deviceId },
  });
  return res.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// [GuestCompose] v3.277 게스트 작곡 체험 — 비로그인 기기당 1회 무료 작곡(A/B 2버전 청취까지).
// 서버: POST /generate/guest-compose · GET /generate/guest-compose/{id} · GET …/{id}/stream/?device=&variant=
//       · POST …/{id}/claim(인증). 발매·저장·커버는 로그인 → claim(소유권 이전) 뒤 기존 인증 경로 그대로.
// 웹 소셜 로그인은 페이지가 리로드되므로 대기 중 게스트 생성 id 를 AsyncStorage 에 영속(GUEST_PENDING_GEN_KEY)
// → 로그인 확정 시 LoginModalHost 가 runGuestClaimIfPending() 으로 1회 자동 claim.
// ─────────────────────────────────────────────────────────────────────────────
export const GUEST_COMPOSE_USED_KEY = 'maidol_guest_compose_used_v1';
export const GUEST_PENDING_GEN_KEY = 'maidol_guest_pending_gen_v1';
const OBJECT_ID_RE = /^[0-9a-f]{24}$/i;

let _composeUsedCache: boolean | null = null;

export async function isGuestComposeUsed(): Promise<boolean> {
  if (_composeUsedCache) return true;
  try {
    _composeUsedCache = (await AsyncStorage.getItem(GUEST_COMPOSE_USED_KEY)) === '1';
  } catch (err: any) {
    console.warn('[GuestCompose] 사용 여부 조회 실패 — 미사용 취급(서버 429가 최종 방어)', { message: err?.message });
    return false;
  }
  return _composeUsedCache;
}

export async function markGuestComposeUsed(reason: 'success' | 'server_429'): Promise<void> {
  _composeUsedCache = true;
  try {
    await AsyncStorage.setItem(GUEST_COMPOSE_USED_KEY, '1');
    if (__DEV__) console.info('[GuestCompose] 체험 사용 기록', { reason });
  } catch (err: any) {
    console.warn('[GuestCompose] 사용 기록 실패', { reason, message: err?.message });
  }
}

/** 생성 실패로 서버가 체험권을 돌려줬을 때(guest_ticket_returned) — 다시 체험 가능 */
export async function unmarkGuestComposeUsed(reason: string): Promise<void> {
  _composeUsedCache = false;
  try {
    await AsyncStorage.removeItem(GUEST_COMPOSE_USED_KEY);
    console.info('[GuestCompose] 체험권 반환 반영', { reason });
  } catch (err: any) {
    console.warn('[GuestCompose] 체험권 반환 반영 실패', { reason, message: err?.message });
  }
}

/** 작곡 체험 거절 문구(429 코드별) */
export function guestComposeDenyText(code: 'guest_trial_used' | 'guest_daily_cap' | 'guest_ip_cap'): { title: string; body: string } {
  if (code === 'guest_daily_cap') return { title: GUEST_TEXT.composeDailyCapTitle, body: GUEST_TEXT.composeDailyCapBody };
  if (code === 'guest_ip_cap') return { title: GUEST_TEXT.composeIpCapTitle, body: GUEST_TEXT.composeIpCapBody };
  return { title: GUEST_TEXT.composeUsedTitle, body: GUEST_TEXT.composeUsedBody };
}

/** 서버 허용 필드만 — 목소리 클론·참고 음원·세션·모델 지정 등은 서버도 무시하지만 앱에서도 보내지 않는다 */
const GUEST_COMPOSE_FIELDS = [
  'title', 'lyrics', 'prompt', 'genre', 'mood', 'style', 'vocal', 'duration', 'instrumental', 'bpm', 'key',
  'negative_tags', 'style_weight', 'weirdness', 'duet', 'duet_main_vocal_style', 'duet_sub_vocal_style',
] as const;

/** POST /generate/guest-compose — 201 {id, status, guest:true}. 429 는 guestDenyCode(err) 로 판별 */
export async function createGuestCompose(payload: Record<string, any>): Promise<{ id: string; status: string }> {
  const deviceId = await getGuestDeviceId();
  const body: Record<string, any> = {};
  for (const k of GUEST_COMPOSE_FIELDS) {
    if (payload?.[k] !== undefined && payload?.[k] !== null && payload?.[k] !== '') body[k] = payload[k];
  }
  console.info('[GuestCompose] 생성 요청', { lyricsLen: (body.lyrics || '').length, genre: body.genre, mood: body.mood, vocal: body.vocal });
  const res = await api.post('/generate/guest-compose', body, {
    headers: { 'X-Guest-Device-Id': deviceId },
    timeout: 60000,
  });
  return res.data;
}

/** GET /generate/guest-compose/{id} — 기존 GET /generate/{id} 와 같은 직렬화 + guest_ticket_returned */
export async function getGuestComposeStatus(genId: string): Promise<any> {
  const deviceId = await getGuestDeviceId();
  const res = await api.get(`/generate/guest-compose/${genId}`, {
    headers: { 'X-Guest-Device-Id': deviceId },
    timeout: 30000,
  });
  return res.data;
}

/** A/B 청취 URL — <audio>/expo-av 는 헤더를 못 붙이므로 device 쿼리(토큰 아님) */
export async function guestComposeStreamUrl(genId: string, variant = 0): Promise<string> {
  const deviceId = await getGuestDeviceId();
  const parts = [`device=${encodeURIComponent(deviceId)}`];
  if (variant > 0) parts.push(`variant=${variant}`);
  return `${BACKEND_BASE_URL}/api/generate/guest-compose/${genId}/stream/?${parts.join('&')}`;
}

// ── 대기 중 게스트 생성 id 영속(웹 소셜 로그인 리로드 대비) ──
export async function setGuestPendingGen(genId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(GUEST_PENDING_GEN_KEY, genId);
    if (__DEV__) console.info('[GuestCompose] 대기 생성 id 저장', { genId });
  } catch (err: any) {
    console.warn('[GuestCompose] 대기 생성 id 저장 실패', { message: err?.message });
  }
}

export async function getGuestPendingGen(): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(GUEST_PENDING_GEN_KEY);
    return v && OBJECT_ID_RE.test(v) ? v : null;
  } catch (err: any) {
    console.warn('[GuestCompose] 대기 생성 id 조회 실패', { message: err?.message });
    return null;
  }
}

export async function clearGuestPendingGen(reason: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(GUEST_PENDING_GEN_KEY);
    if (__DEV__) console.info('[GuestCompose] 대기 생성 id 삭제', { reason });
  } catch (err: any) {
    console.warn('[GuestCompose] 대기 생성 id 삭제 실패', { reason, message: err?.message });
  }
}

export type GuestClaimResult = 'claimed' | 'already' | 'not_ready' | 'failed' | 'gone' | 'error';

/** 같은 genId 의 claim 은 1회만 진행(화면 afterLogin·전역 자동 claim 동시 호출 합류) */
const _claimInflight = new Map<string, Promise<GuestClaimResult>>();
const _claimedIds = new Set<string>();

/**
 * POST /generate/guest-compose/{id}/claim (로그인 필요). 결과:
 *  claimed/already = 이 계정 소유(이후 기존 /generate/{id}·발매 경로 사용) — 대기 키 삭제
 *  not_ready = 아직 생성 중(대기 키 유지 — 다음 로그인/세션 복원 시 재시도)
 *  failed/gone = 가져올 곡 없음·다른 계정 소유·문서 없음(대기 키 삭제) · error = 네트워크 등(대기 키 유지)
 */
export function claimGuestCompose(genId: string): Promise<GuestClaimResult> {
  if (_claimedIds.has(genId)) return Promise.resolve('already');
  const inflight = _claimInflight.get(genId);
  if (inflight) return inflight;
  const p = (async (): Promise<GuestClaimResult> => {
    if (isGuestNow()) return 'error';
    const deviceId = await getGuestDeviceId();
    try {
      const res = await api.post(`/generate/guest-compose/${genId}/claim`, null, {
        headers: { 'X-Guest-Device-Id': deviceId },
        timeout: 30000,
      });
      const already = !!res.data?.already;
      _claimedIds.add(genId);
      await clearGuestPendingGen(already ? 'claim_already' : 'claimed');
      console.info('[GuestCompose] claim 완료', { genId, already });
      return already ? 'already' : 'claimed';
    } catch (err: any) {
      const st = err?.response?.status;
      const code = err?.response?.data?.error;
      console.warn('[GuestCompose] claim 실패', { genId, status: st ?? null, code: code ?? null });
      if (st === 409 && code === 'guest_compose_not_ready') return 'not_ready';
      if (st === 404 || st === 409) {
        await clearGuestPendingGen(`claim_${st}_${code || '-'}`);
        return st === 409 && code === 'guest_compose_failed' ? 'failed' : 'gone';
      }
      return 'error';
    }
  })().finally(() => { _claimInflight.delete(genId); });
  _claimInflight.set(genId, p);
  return p;
}

/** 지금 화면에서 보고 있는 게스트 곡(결과 화면이 afterLogin 으로 직접 처리 — 전역 안내 팝업 생략) */
let _viewerGenId: string | null = null;
export function setGuestComposeViewer(genId: string | null): void {
  _viewerGenId = genId;
}

let _autoClaimRunning = false;
let _retryTimer: ReturnType<typeof setTimeout> | null = null;
/** 아직 생성 중(not_ready)이면 1분 간격 재시도 — 서버 하드캡(30분) 이후엔 실패로 확정돼 대기 키가 정리된다 */
const CLAIM_RETRY_MS = 60 * 1000;
const CLAIM_RETRY_MAX = 32;

/** 로그인 확정 시 1회 — 대기 중 게스트 생성이 있으면 claim 후 안내(LoginModalHost 의 user effect 에서 호출) */
export async function runGuestClaimIfPending(source: string, attempt = 0): Promise<void> {
  if (_autoClaimRunning || isGuestNow()) return;
  if (_retryTimer && attempt === 0) { clearTimeout(_retryTimer); _retryTimer = null; }
  _autoClaimRunning = true;
  try {
    const genId = await getGuestPendingGen();
    if (!genId) return;
    console.info('[GuestCompose] 로그인 후 자동 claim 시도', { source, genId, attempt });
    const r = await claimGuestCompose(genId);
    if (r === 'claimed' && _viewerGenId !== genId) {
      showAlert(GUEST_TEXT.claimedTitle, GUEST_TEXT.claimedBody);
    } else if ((r === 'not_ready' || r === 'error') && attempt < CLAIM_RETRY_MAX) {
      _retryTimer = setTimeout(() => {
        _retryTimer = null;
        void runGuestClaimIfPending('retry', attempt + 1);
      }, CLAIM_RETRY_MS);
    }
  } catch (err: any) {
    console.error('[GuestCompose] 자동 claim 처리 실패', { source, message: err?.message });
  } finally {
    _autoClaimRunning = false;
  }
}
