// [dmSocket] DM 실시간 WebSocket 싱글턴 — MAIDOL dmSocket.js 이식(RN/웹 공용).
// 서버 /api/dm/ws?token=JWT 로 연결, 이벤트(message/unread/read/accepted)를 리스너에 브로드캐스트.
// 재연결: 지수 백오프 1s→최대 30s. keepalive: 25s ping. 30초 폴링은 폴백으로 별도 유지(HomeHeaderActions).
// v3.252: 크루 채팅 'club_chat' 이벤트 분기 — 별도 리스너 채널(clubListeners)로만 전달해
//   기존 dm 리스너(HomeHeaderActions else refresh() 등)에 신규 이벤트가 새지 않게 한다(무회귀).
//   재연결 시 'open' 이벤트도 club 채널에만 브로드캐스트 — ClubChat이 after 캐치업 1회에 사용.
import { BACKEND_BASE_URL } from './api';

type DmEvent = { type: 'message' | 'unread' | 'read' | 'accepted' | 'pong'; [k: string]: any };
type Listener = (ev: DmEvent) => void;
// v3.252: 크루 채팅 이벤트 — {type:'club_chat', club_id, message:{…}} + 재연결 신호 {type:'open'}
export type ClubChatEvent = { type: 'club_chat' | 'open'; club_id?: string | number; message?: any; [k: string]: any };
type ClubListener = (ev: ClubChatEvent) => void;

const WS_URL = `${BACKEND_BASE_URL.replace(/^http/, 'ws')}/api/dm/ws`;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const PING_INTERVAL_MS = 25000;

let ws: WebSocket | null = null;
let token: string | null = null;
let listeners: Set<Listener> = new Set();
let clubListeners: Set<ClubListener> = new Set(); // v3.252 — club_chat/open 전용 채널
let reconnectDelay = RECONNECT_BASE_MS;
let reconnectTimer: any = null;
let pingTimer: any = null;
let closedByUs = false;

function cleanupTimers() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
}

function open() {
  if (!token) return;
  try {
    ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
  } catch (err: any) {
    console.error('[dmSocket] 생성 실패', { message: err?.message });
    scheduleReconnect();
    return;
  }
  ws.onopen = () => {
    if (__DEV__) console.info('[dmSocket] 연결됨');
    reconnectDelay = RECONNECT_BASE_MS;
    cleanupTimers();
    pingTimer = setInterval(() => {
      try { ws?.send(JSON.stringify({ type: 'ping' })); } catch {}
    }, PING_INTERVAL_MS);
    // v3.252: 재연결 신호 — club 채널에만(기존 dm 리스너 무회귀). ClubChat은 after 캐치업 1회 수행.
    clubListeners.forEach((l) => { try { l({ type: 'open' }); } catch {} });
  };
  ws.onmessage = (e) => {
    try {
      const ev: any = JSON.parse(String(e.data));
      if (ev.type === 'pong') return;
      // v3.252: 'club_chat' 분기 — club 전용 채널로만 전달(기존 dm 리스너에는 미전달 = 무회귀)
      if (ev.type === 'club_chat') {
        clubListeners.forEach((l) => { try { l(ev as ClubChatEvent); } catch {} });
        return;
      }
      listeners.forEach((l) => { try { l(ev as DmEvent); } catch {} });
    } catch {}
  };
  ws.onclose = (e: any) => {
    cleanupTimers();
    ws = null;
    if (closedByUs) return;
    if (e?.code === 4401) { // 인증 실패 — 재연결 중단(MAIDOL 규약)
      if (__DEV__) console.info('[dmSocket] 인증 실패(4401) — 재연결 중단');
      return;
    }
    scheduleReconnect();
  };
  ws.onerror = () => {}; // onclose에서 재연결 처리
}

function scheduleReconnect() {
  if (reconnectTimer || closedByUs || !token) return;
  if (__DEV__) console.info('[dmSocket] 재연결 예약', { delayMs: reconnectDelay });
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    open();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
}

/** 로그인 후 연결(이미 연결돼 있으면 무시). 토큰 교체 시 재연결. */
export function dmSocketConnect(jwt: string) {
  if (token === jwt && ws) return;
  dmSocketDisconnect();
  token = jwt;
  closedByUs = false;
  open();
}

export function dmSocketDisconnect() {
  closedByUs = true;
  cleanupTimers();
  try { ws?.close(); } catch {}
  ws = null;
  token = null;
}

/** 이벤트 리스너 등록 — 반환 함수로 해제 */
export function dmSocketSubscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** v3.252: 크루 채팅 이벤트('club_chat'·재연결 'open') 구독 — dm 채널과 분리(무회귀), 반환 함수로 해제 */
export function dmSocketSubscribeClubChat(fn: ClubListener): () => void {
  clubListeners.add(fn);
  return () => clubListeners.delete(fn);
}
