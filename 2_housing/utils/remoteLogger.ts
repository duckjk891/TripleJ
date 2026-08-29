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
 *         web: window 'error' / 'unhandledrejection' + pagehide/beforeunload(sendBeacon ?token=)
 * - 배치: 5초 인터벌 OR 큐 길이 ≥ 20 시 flush
 * - 민감정보 필터: token=, api_key=, password=, secret=, bearer ..., JWT-like 패턴 → 이벤트 통째 drop
 * - 실패 모드(무음 — 절대 throw/재로깅 금지):
 *     비로그인 → 배치 무음 drop(401 스팸 방지, MAIDOL의 401 drop과 동일 결과)
 *     401/422 → drop, 네트워크/5xx → 큐 보존(최대 200, 초과 시 oldest drop)
 * - 무한루프 방지: _inEmit 재진입 가드 — flush 중 발생한 console(예: api.ts '[API Error]' 로그)은 enqueue 안 함
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
let _inEmit = false; // 자기 호출에서 발생한 console 재진입 방지

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
      return window.location.href;
    }
    return navigationRef?.getCurrentRoute?.()?.name || '';
  } catch {
    return '';
  }
}

function _enqueue(level: string, args: any[], extraStack?: string): void {
  if (_inEmit) return; // 자기 자신이 발생시킨 console 재진입 차단
  try {
    const { message, context, stack } = _serializeArgs(args);
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
    if (_queue.length >= FLUSH_THRESHOLD) _flush();
  } catch {
    // serialization 실패 → 조용히 drop (절대 throw 금지)
  }
}

async function _flush(): Promise<void> {
  if (_queue.length === 0) return;
  // 비로그인: 백엔드가 JWT 필수(401) — 보내지 않고 무음 drop (MAIDOL 401 drop과 동일 결과)
  let token: string | null = null;
  try { token = useAuthStore.getState().token; } catch { token = null; }
  const batch = _queue.splice(0, MAX_BATCH);
  if (!token) return;
  _inEmit = true;
  try {
    await api.post('/_logs/frontend', { events: batch }, { timeout: 15000 });
    // 성공: 큐에서 이미 제거됨
  } catch (err: any) {
    const status = err?.response?.status;
    if (status === 401 || status === 422) {
      // 인증/스키마 문제 — 재시도해도 못 보낼 가능성, drop
      return;
    }
    // 네트워크/서버다운/5xx → 큐 앞쪽으로 되돌리되 cap 초과는 잘라낸다
    const merged = batch.concat(_queue);
    _queue = merged.slice(-MAX_QUEUE);
  } finally {
    _inEmit = false;
  }
}

function _flushBeacon(): void {
  // (web 전용) 페이지 종료 시 fire-and-forget. sendBeacon은 헤더를 못 붙여 ?token= 쿼리 인증.
  if (_queue.length === 0) return;
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') {
    try { _flush(); } catch { /* noop */ }
    return;
  }
  let token: string | null = null;
  try { token = useAuthStore.getState().token; } catch { token = null; }
  const batch = _queue.splice(0, MAX_BATCH);
  if (!token) return; // 비로그인 — 무음 drop
  try {
    const blob = new Blob([JSON.stringify({ events: batch })], { type: 'application/json' });
    const url = `${BACKEND_BASE_URL}/api/_logs/frontend?token=${encodeURIComponent(token)}`;
    const ok = navigator.sendBeacon(url, blob);
    if (!ok) {
      _queue = batch.concat(_queue).slice(-MAX_QUEUE);
    }
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

    // 페이지 종료 시 sendBeacon flush
    window.addEventListener('pagehide', _flushBeacon);
    window.addEventListener('beforeunload', _flushBeacon);
  } else {
    // native: RN 전역 에러 핸들러 체이닝 (window.onerror 대응물)
    try {
      const g: any = globalThis as any;
      if (g?.ErrorUtils?.setGlobalHandler) {
        const prevHandler = g.ErrorUtils.getGlobalHandler?.();
        g.ErrorUtils.setGlobalHandler((e: any, isFatal?: boolean) => {
          try {
            _enqueue('error', [e?.message || 'global error', { kind: 'ErrorUtils', isFatal: !!isFatal }], e?.stack);
            _flush(); // fatal일 수 있으니 즉시 전송 시도
          } catch { /* noop */ }
          if (typeof prevHandler === 'function') prevHandler(e, isFatal);
        });
      }
    } catch { /* noop */ }

    // native: 백그라운드 전환 시 잔여 큐 flush (web pagehide 대응물)
    try {
      AppState.addEventListener('change', (state) => {
        if (state === 'background' || state === 'inactive') {
          try { _flush(); } catch { /* noop */ }
        }
      });
    } catch { /* noop */ }
  }

  // 주기 flush
  _flushTimer = setInterval(() => {
    try { _flush(); } catch { /* noop */ }
  }, FLUSH_INTERVAL_MS);
}

// 테스트/디버그 보조 (옵션) — 큐 길이 확인용
export function _remoteLoggerDebug() {
  return { initialized: _initialized, queueLen: _queue.length, timer: !!_flushTimer };
}
