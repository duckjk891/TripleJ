/**
 * [remoteLogger] v3.91 — MAIDOL utils/remoteLogger.js(v46-pre) 이식(RN/Expo 적응판).
 *
 * 프론트엔드 콘솔/오류 이벤트를 백엔드 `POST /api/_logs/frontend` 로 배치 전송.
 * 계약(backend_9004 _logs.py:252 receive_frontend_logs):
 *   요청 { events: [{ level, message, context, ts, url, user_agent, stack? }] }
 *   인증 JWT 필수(비로그인 401), events 1~50개·body 256KB·message 8KB·stack 16KB 제한, 응답 { received }
 *
 * - 후킹: console.error/warn (항상), console.info (DEV만),
 *         native: ErrorUtils 전역 핸들러(기존 핸들러 체이닝),
 *         web: window 'error' / 'unhandledrejection' + pagehide/beforeunload(keepalive fetch — 헤더 인증)
 * - 배치: 5초 인터벌 OR 큐 길이 ≥ 20 시 flush
 * - 민감정보 필터: token=, api_key=, password=, secret=, bearer ..., JWT-like 패턴 → 이벤트 통째 drop
 * - 실패 모드(무음 — 절대 throw/재로깅 금지):
 *     비로그인 → 배치 무음 drop(401 스팸 방지, MAIDOL의 401 drop과 동일 결과)
 *     401/403/422 → drop, 네트워크/5xx → 큐 보존(최대 200, 초과 시 oldest drop)
 * - v3.227 폭주 차단(만료 토큰 상태 분당 요청 ≤1, 첫 403 이후 0):
 *     ① 401·403 → 그 토큰으로 일시정지(_authBlockedToken — 같은 토큰인 동안 enqueue·flush 무동작, 토큰 교체 시 해제)
 *     ② 단일 in-flight(_inflight) — 실행 중이면 새 flush(임계치 트리거 포함)는 무동작
 *     ③ 네트워크·5xx 실패 → 지수 백오프 min(5s·2^n, 5분), 연속 5회 실패 → 서킷 10분(큐는 MAX_QUEUE로 절단 유지)
 *     ④ 성공 시 카운터 초기화 ⑤ 자체 경고는 console로 1회만(재귀 방지)
 * - 무한루프 방지: flush 요청이 발생시킨 console(api.ts '[API Error] /_logs/frontend'·'[AUTH]')은 enqueue 안 함
 * - v3.227: 페이지 종료 전송은 sendBeacon(URL 쿼리 토큰 인증) 대신 keepalive fetch + Authorization 헤더(URL 토큰 금지)
 * - idempotent: initRemoteLogger() 두 번 호출돼도 중복 후킹 안 함
 *
 * 본 모듈 자체는 console 으로 디버그 메시지를 출력하지 않는다 — 무한루프 방지.
 */

import { Platform, AppState } from 'react-native';
import api, { BACKEND_BASE_URL } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { navigationRef } from '../services/navigationRef';

const FLUSH_INTERVAL_MS = 5000;
const FLUSH_THRESHOLD = 20;
const MAX_BATCH = 50;          // 백엔드 _MAX_BATCH_SIZE와 동일
const MAX_QUEUE = 200;         // 폴백 보존 cap
const MAX_MESSAGE_LEN = 8192;  // 백엔드 _MAX_MESSAGE_LEN과 동일

// 민감정보 차단 패턴 (보수적으로 — 매치 시 이벤트 통째 drop)
const SECRET_PATTERNS = [
  /token=/i,
  /api[_-]?key=/i,
  /password=/i,
  /secret=/i,
  /bearer\s+\S+/i,
  /\beyJ[A-Za-z0-9_-]{20,}\./, // JWT-like
];

interface RemoteLogEvent {
  level: string;
  message: string;
  context: Record<string, any>;
  ts: string;
  url: string;
  user_agent: string;
  stack?: string;
}

let _initialized = false;
let _queue: RemoteLogEvent[] = [];
let _flushTimer: ReturnType<typeof setInterval> | null = null;
let _userAgent = '';
// v3.227 B: 폭주 차단 상태
let _inflight: Promise<void> | null = null;   // 단일 in-flight
let _authBlockedToken: string | null = null;  // 401/403 받은 토큰 — 같은 토큰이면 일시정지
let _consecutiveFailures = 0;                 // 네트워크·5xx 연속 실패
let _nextAllowedAt = 0;                       // 백오프 해제 시각(ms)
let _circuitUntil = 0;                        // 서킷 차단 해제 시각(ms)
let _warnedAuth = false;
let _warnedCircuit = false;
const BACKOFF_BASE_MS = 5000;
const BACKOFF_MAX_MS = 5 * 60 * 1000;
const CIRCUIT_FAILURES = 5;
const CIRCUIT_MS = 10 * 60 * 1000;
const SELF_ENDPOINT = '/_logs/frontend';

const _origConsole: Record<'error' | 'warn' | 'info', ((...args: any[]) => void) | null> = {
  error: null,
  warn: null,
  info: null,
};

function _hasSecret(s: unknown): boolean {
  if (typeof s !== 'string' || !s) return false;
  for (const re of SECRET_PATTERNS) {
    if (re.test(s)) return true;
  }
  return false;
}

function _eventHasSecret(ev: RemoteLogEvent): boolean {
  if (_hasSecret(ev.message)) return true;
  if (_hasSecret(ev.stack)) return true;
  const ctx = ev.context;
  if (ctx && typeof ctx === 'object') {
    for (const k of Object.keys(ctx)) {
      const v = ctx[k];
      if (typeof v === 'string' && _hasSecret(v)) return true;
    }
  }
  return false;
}

function _serializeArgs(args: any[]): { message: string; context: Record<string, any>; stack?: string } {
  // console.error('msg', {ctx}) 형태를 message + context 로 분리 (MAIDOL 동일)
  const parts: string[] = [];
  const context: Record<string, any> = {};
  for (const a of args) {
    if (a && typeof a === 'object' && !Array.isArray(a) && !(a instanceof Error)) {
      try {
        Object.assign(context, a);
      } catch {
        parts.push(String(a));
      }
    } else if (a instanceof Error) {
      parts.push(a.message || String(a));
      if (a.stack && !context.__stack) context.__stack = a.stack;
    } else {
      try { parts.push(typeof a === 'string' ? a : JSON.stringify(a)); }
      catch { parts.push(String(a)); }
    }
  }
  let msg = parts.join(' ');
  if (msg.length > MAX_MESSAGE_LEN) msg = msg.slice(0, MAX_MESSAGE_LEN) + '...[truncated]';
  const stack = context.__stack;
  if (stack) delete context.__stack;
  return { message: msg, context, stack };
}

/** 현재 위치 — web은 href, native는 현재 라우트명 */
function _currentUrl(): string {
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      // v3.216 ①: OAuth 콜백 `#token=` 등 해시는 로그에 싣지 않는다(토큰 유출 방어)
      return window.location.href.split('#')[0];
    }
    return navigationRef?.getCurrentRoute?.()?.name || '';
  } catch {
    return '';
  }
}

function _currentToken(): string | null {
  try { return useAuthStore.getState().token; } catch { return null; }
}

/** 토큰이 바뀌었으면 인증 일시정지 해제(재로그인·토큰 교체 즉시 재개) */
function _syncAuthBlock(token: string | null): boolean {
  if (_authBlockedToken && token !== _authBlockedToken) {
    _authBlockedToken = null;
    _warnedAuth = false;
    _consecutiveFailures = 0;
    _nextAllowedAt = 0;
  }
  return !!token && token === _authBlockedToken;
}

/** 자체 경고 — 원본 console로 1회(후킹 우회 = 재귀 0) */
function _selfWarn(msg: string, ctx?: Record<string, any>): void {
  try {
    const w = _origConsole.warn || console.warn;
    w.call(console, `[remoteLogger] ${msg}`, ctx ?? {});
  } catch { /* noop */ }
}

function _enqueue(level: string, args: any[], extraStack?: string): void {
  try {
    // v3.227: 인증 일시정지 중(같은 토큰)에는 쌓지도 않는다
    if (_syncAuthBlock(_currentToken())) return;
    const { message, context, stack } = _serializeArgs(args);
    // 자기 flush 요청이 발생시킨 console(api 인터셉터의 '[API Error] /_logs/frontend'·'[AUTH]') 재진입 차단
    if (message.includes(SELF_ENDPOINT) || (_inflight && message.startsWith('[AUTH]'))) return;
    const ev: RemoteLogEvent = {
      level,
      message,
      context,
      ts: new Date().toISOString(),
      url: _currentUrl(),
      user_agent: _userAgent,
      stack: extraStack || stack,
    };
    if (_eventHasSecret(ev)) return; // 민감정보 → drop
    if (_queue.length >= MAX_QUEUE) _queue.shift();
    _queue.push(ev);
    // 임계치 즉시 flush — _flush가 inflight·백오프·서킷·인증 조건을 모두 통과할 때만 전송
    if (_queue.length >= FLUSH_THRESHOLD) void _flush();
  } catch {
    // serialization 실패 → 조용히 drop (절대 throw 금지)
  }
}

/** 전송 가능 여부(백오프·서킷·인증 일시정지) — 불가면 false */
function _canSend(token: string | null): boolean {
  const now = Date.now();
  if (now < _circuitUntil || now < _nextAllowedAt) return false;
  if (!token) return true; // 비로그인은 _flush에서 무음 drop
  return !_syncAuthBlock(token);
}

function _onSendFailure(batch: RemoteLogEvent[]): void {
  _consecutiveFailures += 1;
  const now = Date.now();
  if (_consecutiveFailures >= CIRCUIT_FAILURES) {
    _circuitUntil = now + CIRCUIT_MS;
    _nextAllowedAt = 0;
    _consecutiveFailures = 0;
    if (!_warnedCircuit) {
      _warnedCircuit = true;
      _selfWarn('연속 실패 — 10분간 전송 중단', { queued: _queue.length + batch.length });
    }
  } else {
    _nextAllowedAt = now + Math.min(BACKOFF_BASE_MS * 2 ** (_consecutiveFailures - 1), BACKOFF_MAX_MS);
  }
  // 네트워크/서버다운/5xx → 큐 앞쪽으로 되돌리되 cap 초과는 잘라낸다
  _queue = batch.concat(_queue).slice(-MAX_QUEUE);
}

function _onSendSuccess(): void {
  _consecutiveFailures = 0;
  _nextAllowedAt = 0;
  _circuitUntil = 0;
  _warnedCircuit = false;
}

function _flush(): Promise<void> {
  if (_inflight) return _inflight; // 단일 in-flight — 겹친 flush는 무동작
  if (_queue.length === 0) return Promise.resolve();
  const token = _currentToken();
  if (!_canSend(token)) {
    if (token && token === _authBlockedToken) _queue = []; // 인증 일시정지 — 쌓인 것도 버림
    return Promise.resolve();
  }
  const batch = _queue.splice(0, MAX_BATCH);
  // 비로그인: 백엔드가 JWT 필수(401) — 보내지 않고 무음 drop (MAIDOL 401 drop과 동일 결과)
  if (!token) return Promise.resolve();
  _inflight = (async () => {
    try {
      await api.post(SELF_ENDPOINT, { events: batch }, { timeout: 15000 });
      _onSendSuccess();
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401 || status === 403) {
        // 토큰 만료·무효 — 이 토큰으로는 더 보내지 않는다(토큰 교체 시 자동 재개). 배치는 drop
        _authBlockedToken = token;
        _queue = [];
        if (!_warnedAuth) {
          _warnedAuth = true;
          _selfWarn('인증 만료 — 재로그인 전까지 전송 일시정지', { status });
        }
        return;
      }
      if (status === 422) return; // 스키마 문제 — 재시도해도 못 보냄, drop
      _onSendFailure(batch);
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

function _flushOnExit(): void {
  // (web 전용) 페이지 종료 시 fire-and-forget. v3.227: keepalive fetch + Authorization 헤더
  // (구 sendBeacon 쿼리 토큰 인증 폐기 — URL에 토큰을 싣지 않는다). 백오프·서킷·인증 조건 동일 적용.
  if (_queue.length === 0 || _inflight) return;
  const token = _currentToken();
  if (!token || !_canSend(token)) return;
  const batch = _queue.splice(0, MAX_BATCH);
  try {
    if (typeof fetch !== 'function') throw new Error('no fetch');
    fetch(`${BACKEND_BASE_URL}/api${SELF_ENDPOINT}`, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ events: batch }),
    }).catch(() => { /* 종료 중 — 무음 */ });
  } catch {
    _queue = batch.concat(_queue).slice(-MAX_QUEUE);
  }
}

function _wrapConsole(level: 'error' | 'warn' | 'info'): void {
  const orig = console[level];
  if (typeof orig !== 'function') return;
  _origConsole[level] = orig;
  console[level] = function patched(...args: any[]) {
    try { _enqueue(level, args); } catch { /* noop */ }
    return orig.apply(console, args);
  };
}

export function initRemoteLogger(): void {
  if (_initialized) return;
  _initialized = true;

  try {
    _userAgent = Platform.OS === 'web' && typeof navigator !== 'undefined'
      ? navigator?.userAgent || ''
      : `${Platform.OS} ${String(Platform.Version ?? '')}`.trim();
  } catch {
    _userAgent = '';
  }

  // console 후킹 — error/warn 항상, info는 DEV만 (MAIDOL 관행)
  _wrapConsole('error');
  _wrapConsole('warn');
  if (__DEV__) {
    _wrapConsole('info');
  }

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    // uncaught error
    window.addEventListener('error', (e: any) => {
      try {
        const msg = e?.message || (e?.error && e.error.message) || 'window.onerror';
        const stack = (e?.error && e.error.stack) || undefined;
        const context = {
          filename: e?.filename || '',
          lineno: e?.lineno || 0,
          colno: e?.colno || 0,
        };
        _enqueue('error', [msg, context], stack);
      } catch { /* noop */ }
    });

    // unhandled promise rejection
    window.addEventListener('unhandledrejection', (e: any) => {
      try {
        const reason = e?.reason;
        let msg: string | undefined;
        let stack: string | undefined;
        if (reason instanceof Error) {
          msg = reason.message || 'unhandledrejection';
          stack = reason.stack;
        } else {
          msg = typeof reason === 'string' ? reason : JSON.stringify(reason);
        }
        _enqueue('error', ['[unhandledrejection] ' + (msg || ''), { kind: 'unhandledrejection' }], stack);
      } catch { /* noop */ }
    });

    // 페이지 종료 시 keepalive flush
    window.addEventListener('pagehide', _flushOnExit);
    window.addEventListener('beforeunload', _flushOnExit);
  } else {
    // native: RN 전역 에러 핸들러 체이닝 (window.onerror 대응물)
    try {
      const g: any = globalThis as any;
      if (g?.ErrorUtils?.setGlobalHandler) {
        const prevHandler = g.ErrorUtils.getGlobalHandler?.();
        g.ErrorUtils.setGlobalHandler((e: any, isFatal?: boolean) => {
          try {
            _enqueue('error', [e?.message || 'global error', { kind: 'ErrorUtils', isFatal: !!isFatal }], e?.stack);
            void _flush(); // fatal일 수 있으니 즉시 전송 시도(게이트 통과 시)
          } catch { /* noop */ }
          if (typeof prevHandler === 'function') prevHandler(e, isFatal);
        });
      }
    } catch { /* noop */ }

    // native: 백그라운드 전환 시 잔여 큐 flush (web pagehide 대응물)
    try {
      AppState.addEventListener('change', (state) => {
        if (state === 'background' || state === 'inactive') {
          try { void _flush(); } catch { /* noop */ }
        }
      });
    } catch { /* noop */ }
  }

  // 주기 flush
  _flushTimer = setInterval(() => {
    try { void _flush(); } catch { /* noop */ }
  }, FLUSH_INTERVAL_MS);
}

// 테스트/디버그 보조 (옵션) — 큐 길이 확인용
export function _remoteLoggerDebug() {
  return {
    initialized: _initialized,
    queueLen: _queue.length,
    timer: !!_flushTimer,
    inflight: !!_inflight,
    authBlocked: !!_authBlockedToken,
    failures: _consecutiveFailures,
    nextAllowedAt: _nextAllowedAt,
    circuitUntil: _circuitUntil,
  };
}
