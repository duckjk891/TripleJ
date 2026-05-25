/**
 * remoteLogger.js — v46-pre
 *
 * 프론트엔드 콘솔/오류 이벤트를 백엔드(`/api/_logs/frontend`) 로 배치 전송.
 * - 후킹: console.error/warn (항상), console.info (DEV 만), window 'error' / 'unhandledrejection'
 * - 배치: 5초 인터벌 OR 큐 길이 ≥ 20 OR pagehide(sendBeacon) 시 flush
 * - 민감정보 필터: token=, api_key=, password=, secret=, bearer ..., JWT-like 패턴 drop
 * - 인증: axios 인터셉터가 JWT 자동 첨부 (sendBeacon 은 ?token= 쿼리)
 * - 실패 모드: 백엔드 5xx → 큐 보존(최대 200, 초과 시 oldest drop), 401 → drop, throw 안 함
 * - idempotent: initRemoteLogger() 두 번 호출돼도 중복 후킹 안 함
 *
 * 본 모듈 자체는 console 으로 디버그 메시지를 거의 출력하지 않는다 — 무한루프 방지.
 */

import { sendFrontendLogs, frontendLogsBeaconUrl } from '../api';

const FLUSH_INTERVAL_MS = 5000;
const FLUSH_THRESHOLD = 20;
const MAX_BATCH = 50;          // 백엔드와 동일
const MAX_QUEUE = 200;         // 폴백 보존 cap
const MAX_MESSAGE_LEN = 8192;  // 백엔드와 동일

// 민감정보 차단 패턴 (보수적으로 — 매치 시 이벤트 통째 drop)
const SECRET_PATTERNS = [
  /token=/i,
  /api[_-]?key=/i,
  /password=/i,
  /secret=/i,
  /bearer\s+\S+/i,
  /\beyJ[A-Za-z0-9_-]{20,}\./, // JWT-like
];

let _initialized = false;
let _queue = [];
let _flushTimer = null;
let _userAgent = '';
let _inEmit = false;            // 자기 호출에서 발생한 console 재진입 방지

const _origConsole = {
  error: null,
  warn: null,
  info: null,
};

function _hasSecret(s) {
  if (typeof s !== 'string' || !s) return false;
  for (const re of SECRET_PATTERNS) {
    if (re.test(s)) return true;
  }
  return false;
}

function _eventHasSecret(ev) {
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

function _serializeArgs(args) {
  // console.error('msg', {ctx}) 형태를 message + context 로 분리
  const parts = [];
  let context = {};
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

function _enqueue(level, args, extraStack) {
  if (_inEmit) return; // 자기 자신이 발생시킨 console 재진입 차단
  try {
    const { message, context, stack } = _serializeArgs(args);
    const ev = {
      level,
      message,
      context,
      ts: new Date().toISOString(),
      url: typeof window !== 'undefined' ? window.location.href : '',
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

async function _flush() {
  if (_queue.length === 0) return;
  const batch = _queue.splice(0, MAX_BATCH);
  _inEmit = true;
  try {
    await sendFrontendLogs(batch);
    // 성공: 큐에서 이미 제거됨
  } catch (err) {
    const status = err?.response?.status;
    if (status === 401 || status === 422) {
      // 인증/스키마 문제 — 재시도해도 못 보낼 가능성, drop
      return;
    }
    // 네트워크/5xx → 큐 앞쪽으로 되돌리되 cap 초과는 잘라낸다
    const merged = batch.concat(_queue);
    _queue = merged.slice(-MAX_QUEUE);
  } finally {
    _inEmit = false;
  }
}

function _flushBeacon() {
  // 페이지 종료 시 fire-and-forget. body size 작게 유지 (최대 50개).
  if (_queue.length === 0) return;
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') {
    // sendBeacon 미지원: 마지막 시도로 비동기 flush 만 트리거
    try { _flush(); } catch { /* noop */ }
    return;
  }
  const batch = _queue.splice(0, MAX_BATCH);
  try {
    const blob = new Blob([JSON.stringify({ events: batch })], { type: 'application/json' });
    const ok = navigator.sendBeacon(frontendLogsBeaconUrl(), blob);
    if (!ok) {
      // 큐 앞쪽으로 복원
      _queue = batch.concat(_queue).slice(-MAX_QUEUE);
    }
  } catch {
    _queue = batch.concat(_queue).slice(-MAX_QUEUE);
  }
}

function _wrapConsole(level) {
  const orig = console[level];
  if (typeof orig !== 'function') return;
  _origConsole[level] = orig;
  console[level] = function patched(...args) {
    try { _enqueue(level, args); } catch { /* noop */ }
    return orig.apply(console, args);
  };
}

export function initRemoteLogger() {
  if (_initialized) return;
  if (typeof window === 'undefined') return;
  _initialized = true;

  try { _userAgent = navigator?.userAgent || ''; } catch { _userAgent = ''; }

  // console 후킹
  _wrapConsole('error');
  _wrapConsole('warn');
  if (import.meta && import.meta.env && import.meta.env.DEV) {
    _wrapConsole('info');
  }

  // uncaught error
  window.addEventListener('error', (e) => {
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
  window.addEventListener('unhandledrejection', (e) => {
    try {
      const reason = e?.reason;
      let msg, stack;
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

  // 주기 flush
  _flushTimer = setInterval(() => {
    try { _flush(); } catch { /* noop */ }
  }, FLUSH_INTERVAL_MS);
}

// 테스트/디버그 보조 (옵션) — 큐 길이 확인용
export function _remoteLoggerDebug() {
  return { initialized: _initialized, queueLen: _queue.length };
}
