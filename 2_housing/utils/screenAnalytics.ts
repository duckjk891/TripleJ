/**
 * [screenAnalytics] 화면 사용 분석 — 관리자 대시보드 '사용 분석'(화면별 체류시간·이탈률)용.
 *
 * 화면을 떠날 때마다 "화면 방문 1건"(screen, started_at, duration_ms)을 큐에 쌓아
 * `POST /api/analytics/events` 로 배치 전송한다(서버 analytics.py).
 *
 * - 식별: 설치 단위 무작위 device_id(AsyncStorage) — 비회원도 집계, 로그인 시 토큰을 함께 보내 user 연결
 * - 세션: 앱 실행 시 시작, 백그라운드 30분 이상 후 복귀하면 새 세션
 * - 백그라운드 전환 시 현재 화면을 닫고(체류시간 확정) 즉시 flush, 복귀 시 같은 화면 재시작
 * - 전송은 공용 api(axios)가 아닌 fetch — axios 인터셉터의 console 로그가 remoteLogger 로
 *   재수집되는 것을 피하고, 실패는 무음(분석 때문에 앱 동작이 영향받으면 안 됨)
 */

import { AppState, AppStateStatus, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { BACKEND_BASE_URL } from '../services/api';
import { useAuthStore } from '../stores/authStore';

const DEVICE_KEY = 'maidol_analytics_device_id';
const SESSION_GAP_MS = 30 * 60 * 1000;
const FLUSH_INTERVAL_MS = 15000;
const FLUSH_THRESHOLD = 20;
const MAX_BATCH = 100; // 서버 MAX_EVENTS 와 동일
const MAX_QUEUE = 300;
const IGNORED_SCREENS = new Set(['Splash']);

/** v3.237: 커스텀 이벤트(공유 측정 — 서버 analytics.py EVENT_TYPES 확장분). 구서버는 조용히 버린다. */
export type CustomEventType = 'share_compose_open' | 'share_sent' | 'share_link_open' | 'share_cta_tap';
/** 이벤트 속성 — 원시값만(서버가 허용 키만 정제 저장). 본문·받는 사람 이름 등 사용자 텍스트는 넣지 말 것. */
export type AnalyticsProps = Record<string, string | number | boolean>;

type AnalyticsEvent =
  | { type: 'screen'; session_id: string; screen: string; started_at: string; duration_ms: number; seq: number }
  | { type: 'session_start' | 'session_end'; session_id: string; ts: string; duration_ms?: number }
  | { type: CustomEventType; session_id: string; ts: string; props: AnalyticsProps };

const CUSTOM_EVENT_TYPES: ReadonlySet<string> = new Set<CustomEventType>([
  'share_compose_open', 'share_sent', 'share_link_open', 'share_cta_tap',
]);
const MAX_PROPS = 16;

let _initialized = false;
let _deviceId: string | null = null;
let _queue: AnalyticsEvent[] = [];
let _sessionId = '';
let _sessionStartedAt = 0;
let _seq = 0;
let _currentScreen: string | null = null;
let _screenStartedAt = 0;
let _backgroundedAt = 0;
let _flushing = false;

function _randomId(): string {
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${Date.now().toString(16)}-${hex()}${hex()}-${hex()}${hex()}${hex()}`;
}

function _startSession(now: number): void {
  _sessionId = _randomId();
  _sessionStartedAt = now;
  _seq = 0;
  _queue.push({ type: 'session_start', session_id: _sessionId, ts: new Date(now).toISOString() });
}

function _closeScreen(now: number): void {
  if (!_currentScreen || !_screenStartedAt) return;
  if (!IGNORED_SCREENS.has(_currentScreen)) {
    _queue.push({
      type: 'screen',
      session_id: _sessionId,
      screen: _currentScreen,
      started_at: new Date(_screenStartedAt).toISOString(),
      duration_ms: Math.max(0, now - _screenStartedAt),
      seq: _seq++,
    });
    if (_queue.length > MAX_QUEUE) _queue = _queue.slice(-MAX_QUEUE);
  }
  _screenStartedAt = 0;
}

async function _flush(): Promise<void> {
  if (_flushing || _queue.length === 0 || !_deviceId) return;
  _flushing = true;
  const batch = _queue.splice(0, MAX_BATCH);
  try {
    let token: string | null = null;
    try { token = useAuthStore.getState().token; } catch { token = null; }
    const res = await fetch(`${BACKEND_BASE_URL}/api/analytics/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        device_id: _deviceId,
        platform: Platform.OS,
        app_version: Constants.expoConfig?.version || '',
        events: batch,
      }),
    });
    // 5xx·429 만 재시도 대상으로 되돌림 — 4xx 는 다시 보내도 같은 결과
    if (res.status >= 500 || res.status === 429) {
      _queue = batch.concat(_queue).slice(-MAX_QUEUE);
    }
  } catch {
    _queue = batch.concat(_queue).slice(-MAX_QUEUE);
  } finally {
    _flushing = false;
  }
}

function _onAppState(state: AppStateStatus): void {
  const now = Date.now();
  if (state === 'background' || state === 'inactive') {
    if (_backgroundedAt) return;
    _backgroundedAt = now;
    _closeScreen(now);
    _flush();
    return;
  }
  if (state === 'active' && _backgroundedAt) {
    const away = now - _backgroundedAt;
    _backgroundedAt = 0;
    if (away >= SESSION_GAP_MS) {
      _queue.push({
        type: 'session_end',
        session_id: _sessionId,
        ts: new Date(now - away).toISOString(),
        duration_ms: Math.max(0, now - away - _sessionStartedAt),
      });
      _startSession(now);
    }
    if (_currentScreen) _screenStartedAt = now;
  }
}

/** NavigationContainer onReady/onStateChange 에서 현재 라우트명으로 호출 */
export function trackScreen(name: string | undefined): void {
  if (!_initialized || !name || name === _currentScreen) return;
  const now = Date.now();
  _closeScreen(now);
  _currentScreen = name;
  _screenStartedAt = _backgroundedAt ? 0 : now;
  if (_queue.length >= FLUSH_THRESHOLD) _flush();
}

/** 속성 정제(순수) — 원시값(string ≤64자·유한 number·boolean)만, 최대 16개 */
export function sanitizeEventProps(props: unknown): AnalyticsProps {
  const out: AnalyticsProps = {};
  if (!props || typeof props !== 'object') return out;
  let n = 0;
  for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
    if (n >= MAX_PROPS) break;
    if (!/^[a-z_]{1,32}$/.test(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 64);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else continue;
    n++;
  }
  return out;
}

/**
 * v3.237: 커스텀 이벤트 1건 적재(같은 큐·배치·device_id·세션). 전송 실패는 무음(분석이 앱 동작에 영향 X).
 * 서버: POST /api/analytics/events — type + ts(=started_at) + props(허용 키만 저장).
 */
export function trackEvent(type: CustomEventType, props: AnalyticsProps = {}): void {
  try {
    if (!_initialized || !CUSTOM_EVENT_TYPES.has(type)) {
      if (__DEV__) console.info('[screenAnalytics] trackEvent 무시', { type, initialized: _initialized });
      return;
    }
    _queue.push({ type, session_id: _sessionId, ts: new Date().toISOString(), props: sanitizeEventProps(props) });
    if (_queue.length > MAX_QUEUE) _queue = _queue.slice(-MAX_QUEUE);
    if (_queue.length >= FLUSH_THRESHOLD) _flush();
  } catch (err: any) {
    console.error('[screenAnalytics] fail — trackEvent', { type, message: err?.message });
  }
}

export function initScreenAnalytics(): void {
  if (_initialized) return;
  _initialized = true;
  _startSession(Date.now());
  AsyncStorage.getItem(DEVICE_KEY)
    .then(async (stored) => {
      if (stored) {
        _deviceId = stored;
      } else {
        _deviceId = _randomId();
        await AsyncStorage.setItem(DEVICE_KEY, _deviceId);
      }
    })
    .catch(() => { _deviceId = _deviceId || _randomId(); });
  try { AppState.addEventListener('change', _onAppState); } catch { /* noop */ }
  setInterval(() => { _flush(); }, FLUSH_INTERVAL_MS);
}
