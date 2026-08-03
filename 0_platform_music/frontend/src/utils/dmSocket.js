/**
 * dmSocket.js — v152
 *
 * 실시간 1:1 DM WebSocket 연결 관리자 (서버→클라 push 전용).
 * - URL 은 location 기반 동적 생성(호스트 하드코딩 금지). dev 는 vite proxy(ws:true) 통과.
 *   `${wss|ws}://${location.host}/api/dm/ws?token=<jwt>`
 * - 자동 재연결(지수 백오프, 1s→최대 30s), 이벤트 구독(onMessage/onUnread), keepalive ping.
 * - 인증: localStorage.token 을 URL ?token= 로 전달(axios Bearer 인터셉터 미적용 대상).
 *
 * 보안: 토큰 값 자체는 절대 로그로 남기지 않는다(remoteLogger 가 token= 포함 로그를 drop 하기도 함).
 * 로그 prefix `[DmSocket]`.
 *
 * 서버 이벤트(PLAN v155):
 *   { type:"message", conversation_id, conversation_status, message:{id,sender_id,text,created_at} }
 *   { type:"unread", count }  | { type:"read", conversation_id }
 *   { type:"accepted", conversation_id }  — 메시지 요청 수락 시 요청자에게
 */

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const PING_INTERVAL_MS = 25000;

function buildUrl(token) {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/api/dm/ws?token=${encodeURIComponent(token)}`;
}

class DmSocket {
  constructor() {
    this.ws = null;
    this.token = null;
    this.shouldRun = false;
    this.retry = 0;
    this.reconnectTimer = null;
    this.pingTimer = null;
    // 이벤트 콜백 세트 (다중 구독 허용)
    this.messageHandlers = new Set();
    this.unreadHandlers = new Set();
    this.readHandlers = new Set();
    this.acceptedHandlers = new Set();
    this.statusHandlers = new Set();
  }

  /** WS 연결 시작. token 없으면 skip(비로그인). 이미 연결 중이면 무시. */
  connect() {
    const token = (() => {
      try { return localStorage.getItem('token'); } catch { return null; }
    })();
    if (!token) {
      if (import.meta.env.DEV) console.info('[DmSocket] connect skipped (no token)');
      return;
    }
    this.token = token;
    this.shouldRun = true;
    // 이미 열려있거나 연결 중이면 재사용
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this._open();
  }

  _open() {
    let socket;
    try {
      socket = new WebSocket(buildUrl(this.token));
    } catch (err) {
      // URL/브라우저 문제 — 재연결 스케줄로 흡수
      console.error('[DmSocket] WebSocket construct failed', { message: err?.message });
      this._scheduleReconnect();
      return;
    }
    this.ws = socket;

    socket.onopen = () => {
      this.retry = 0;
      if (import.meta.env.DEV) console.info('[DmSocket] open');
      this._emitStatus('open');
      this._startPing();
    };

    socket.onmessage = (evt) => {
      let payload;
      try {
        payload = JSON.parse(evt.data);
      } catch {
        console.warn('[DmSocket] non-JSON message ignored');
        return;
      }
      const type = payload?.type;
      if (type === 'message') {
        this.messageHandlers.forEach((fn) => {
          try { fn(payload); } catch (err) { console.error('[DmSocket] onMessage handler error', { message: err?.message }); }
        });
      } else if (type === 'unread') {
        this.unreadHandlers.forEach((fn) => {
          try { fn(payload); } catch (err) { console.error('[DmSocket] onUnread handler error', { message: err?.message }); }
        });
      } else if (type === 'read') {
        this.readHandlers.forEach((fn) => {
          try { fn(payload); } catch (err) { console.error('[DmSocket] onRead handler error', { message: err?.message }); }
        });
      } else if (type === 'accepted') {
        this.acceptedHandlers.forEach((fn) => {
          try { fn(payload); } catch (err) { console.error('[DmSocket] onAccepted handler error', { message: err?.message }); }
        });
      } else if (type === 'pong') {
        // keepalive 응답 — 무시
      } else if (import.meta.env.DEV) {
        console.info('[DmSocket] unknown event type', { type });
      }
    };

    socket.onerror = () => {
      // onclose 가 뒤따라 재연결 처리 — 여기선 상태만 로깅(브라우저가 상세를 안 줌)
      console.error('[DmSocket] socket error');
    };

    socket.onclose = (evt) => {
      this._stopPing();
      this._emitStatus('closed');
      // 4401 = 인증 실패(토큰 무효). 재연결해도 동일 실패 → 중단.
      if (evt?.code === 4401) {
        this.shouldRun = false;
        console.error('[DmSocket] closed: auth rejected (4401)');
        return;
      }
      if (import.meta.env.DEV) console.info('[DmSocket] closed', { code: evt?.code });
      if (this.shouldRun) this._scheduleReconnect();
    };
  }

  _scheduleReconnect() {
    if (!this.shouldRun) return;
    if (this.reconnectTimer) return;
    const delay = Math.min(RECONNECT_BASE_MS * (2 ** this.retry), RECONNECT_MAX_MS);
    this.retry += 1;
    if (import.meta.env.DEV) console.info('[DmSocket] reconnect scheduled', { delayMs: delay, attempt: this.retry });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      // 토큰이 갱신됐을 수 있으니 재조회
      let token = null;
      try { token = localStorage.getItem('token'); } catch { token = null; }
      if (!token) {
        this.shouldRun = false;
        if (import.meta.env.DEV) console.info('[DmSocket] reconnect aborted (no token)');
        return;
      }
      this.token = token;
      this._open();
    }, delay);
  }

  _startPing() {
    this._stopPing();
    this.pingTimer = setInterval(() => {
      this.send({ type: 'ping' });
    }, PING_INTERVAL_MS);
  }

  _stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /** 클라→서버 전송 (MVP 는 ping/keepalive 용). 열려있지 않으면 조용히 skip. */
  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(obj));
      } catch (err) {
        console.error('[DmSocket] send failed', { message: err?.message });
      }
    }
  }

  /** 신규 메시지 이벤트 구독 → unsubscribe 함수 반환 */
  onMessage(fn) {
    this.messageHandlers.add(fn);
    return () => this.messageHandlers.delete(fn);
  }

  /** unread 갱신 이벤트 구독 → unsubscribe 함수 반환 */
  onUnread(fn) {
    this.unreadHandlers.add(fn);
    return () => this.unreadHandlers.delete(fn);
  }

  /** read(멀티탭 읽음 동기화) 이벤트 구독 → unsubscribe 함수 반환 */
  onRead(fn) {
    this.readHandlers.add(fn);
    return () => this.readHandlers.delete(fn);
  }

  /** accepted(메시지 요청 수락 — 요청자 수신) 이벤트 구독 → unsubscribe 함수 반환 */
  onAccepted(fn) {
    this.acceptedHandlers.add(fn);
    return () => this.acceptedHandlers.delete(fn);
  }

  /** 연결 상태('open'|'closed') 구독 → unsubscribe 함수 반환 */
  onStatus(fn) {
    this.statusHandlers.add(fn);
    return () => this.statusHandlers.delete(fn);
  }

  _emitStatus(status) {
    this.statusHandlers.forEach((fn) => {
      try { fn(status); } catch { /* ignore */ }
    });
  }

  /** 연결 종료 + 재연결 중단 (로그아웃/언마운트 시). */
  disconnect() {
    this.shouldRun = false;
    this.retry = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this._stopPing();
    if (this.ws) {
      try {
        this.ws.onclose = null; // 재연결 스케줄 방지
        this.ws.close();
      } catch { /* ignore */ }
      this.ws = null;
    }
    if (import.meta.env.DEV) console.info('[DmSocket] disconnect');
  }
}

// 앱 전역 단일 인스턴스 — 헤더(배지)와 DM함이 같은 소켓 공유.
const dmSocket = new DmSocket();
export default dmSocket;
