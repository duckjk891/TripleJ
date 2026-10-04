// [GuestTrial] v3.276 게스트 작사 체험 — 비로그인 기기당 1회 무료 작사(가사 결과까지).
// 서버: POST /api/generate/lyrics/guest (헤더 X-Guest-Device-Id) — 기기당 평생 1회(429 guest_trial_used)·
// 전역 일일 상한(429 guest_daily_cap). 앱도 사용 여부를 기억해 재시도 전에 로그인으로 안내한다.
// 기기 id 는 화면 분석(utils/screenAnalytics)의 설치 단위 device_id(AsyncStorage)를 재사용.
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';

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
  resultBanner: '체험 결과예요 — 가입하면 저장하고 작곡까지 이어서 할 수 있어요',
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

/** 서버 거절 코드 판별(429 본문 error) */
export function guestDenyCode(err: any): 'guest_trial_used' | 'guest_daily_cap' | null {
  if (err?.response?.status !== 429) return null;
  const code = err?.response?.data?.error;
  return code === 'guest_trial_used' || code === 'guest_daily_cap' ? code : null;
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
