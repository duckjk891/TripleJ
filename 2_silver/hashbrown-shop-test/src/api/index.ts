/**
 * 백엔드 API 클라이언트 모듈.
 *
 * - 컴포넌트에서 fetch를 직접 호출하지 말고 반드시 이 모듈을 경유할 것.
 * - 경로는 상대경로(/api/*)만 사용 — vite dev 서버의 /api 프록시(→ 백엔드 3100)를 경유하므로
 *   호스트/포트를 하드코딩하지 않는다.
 * - 에러 응답 형식(공통): { "error": { "code", "message", "requestId" } }
 */

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
  };
}

/**
 * 세션 ID (8자리, localStorage 영속) — "같은 사람의 한 세션" 추적용.
 * 백엔드 로그의 [sess:xxxxxxxx]와 매칭된다.
 */
const SESSION_KEY = 'silvercare-session-id';

export function getSessionId(): string {
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    // localStorage 불가(프라이빗 모드 등) — 추적 없이 동작
    return 'no-store';
  }
}

/**
 * 이용 이벤트 원격 로깅. POST /api/log (fire-and-forget — 실패해도 앱 동작에 영향 없음)
 * 이벤트 어휘: user_message / assistant_response / cart_add / cart_remove /
 *             cart_set_quantity / order_checkout
 */
export function logEvent(event: string, data?: Record<string, unknown>): void {
  try {
    void fetch('/api/log', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': getSessionId(),
      },
      body: JSON.stringify(data === undefined ? { event } : { event, data }),
      keepalive: true,
    }).catch((cause) => {
      if (import.meta.env.DEV) {
        console.error('[api] logEvent 전송 실패:', event, cause);
      }
    });
  } catch (cause) {
    if (import.meta.env.DEV) {
      console.error('[api] logEvent 실패:', event, cause);
    }
  }
}

/** 백엔드 공통 에러 JSON의 code/message/requestId를 담은 Error */
export class ApiError extends Error {
  readonly code: string;
  readonly requestId?: string;

  constructor(code: string, message: string, requestId?: string) {
    super(`[${code}] ${message}`);
    this.name = 'ApiError';
    this.code = code;
    this.requestId = requestId;
  }
}

/** 비-2xx 응답을 공통 에러 JSON 스펙에 따라 ApiError로 변환 */
async function toApiError(res: Response, context: string): Promise<ApiError> {
  let code = `HTTP_${res.status}`;
  let message = res.statusText || '요청이 실패했습니다.';
  let requestId: string | undefined;
  try {
    const body = (await res.json()) as ApiErrorBody;
    if (body?.error) {
      code = body.error.code ?? code;
      message = body.error.message ?? message;
      requestId = body.error.requestId;
    }
  } catch {
    // 413 등 일부 에러는 JSON 바디가 없을 수 있음 — 상태코드 기반 기본값 유지
  }
  console.error(`[api] ${context} 실패:`, {
    status: res.status,
    code,
    message,
    requestId,
  });
  return new ApiError(code, message, requestId);
}

/**
 * 음성(오디오 Blob) → 텍스트. POST /api/stt
 * 요청 바디는 Blob raw binary 그대로, Content-Type은 녹음 mimeType.
 */
export async function transcribeAudio(blob: Blob): Promise<string> {
  const contentType = blob.type || 'audio/webm';
  if (import.meta.env.DEV) {
    console.info('[api] POST /api/stt 요청:', {
      size: blob.size,
      contentType,
    });
  }
  const startedAt = performance.now();

  let res: Response;
  try {
    res = await fetch('/api/stt', {
      method: 'POST',
      headers: { 'Content-Type': contentType, 'X-Session-Id': getSessionId() },
      body: blob,
    });
  } catch (cause) {
    console.error('[api] POST /api/stt 네트워크 오류:', cause);
    throw new ApiError('NETWORK_ERROR', '서버에 연결하지 못했습니다.');
  }

  if (!res.ok) {
    throw await toApiError(res, 'POST /api/stt');
  }

  const data = (await res.json()) as { text?: unknown };
  const text = typeof data.text === 'string' ? data.text : '';
  if (typeof data.text !== 'string') {
    console.warn('[api] /api/stt 응답에 text(string) 필드가 없습니다:', data);
  }
  if (import.meta.env.DEV) {
    console.info(
      `[api] POST /api/stt 응답 (${Math.round(performance.now() - startedAt)}ms):`,
      text.slice(0, 50),
    );
  }
  return text;
}

/**
 * 텍스트 → 음성(mp3 Blob). POST /api/tts
 * 요청: JSON { text, voice? } / 응답: audio/mpeg 바이너리.
 */
export async function synthesizeSpeech(text: string, voice?: string): Promise<Blob> {
  if (import.meta.env.DEV) {
    console.info('[api] POST /api/tts 요청:', {
      textLength: text.length,
      voice: voice ?? '(기본값)',
    });
  }
  const startedAt = performance.now();

  let res: Response;
  try {
    res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Id': getSessionId() },
      body: JSON.stringify(voice ? { text, voice } : { text }),
    });
  } catch (cause) {
    console.error('[api] POST /api/tts 네트워크 오류:', cause);
    throw new ApiError('NETWORK_ERROR', '서버에 연결하지 못했습니다.');
  }

  if (!res.ok) {
    throw await toApiError(res, 'POST /api/tts');
  }

  const blob = await res.blob();
  if (import.meta.env.DEV) {
    console.info(
      `[api] POST /api/tts 응답 (${Math.round(performance.now() - startedAt)}ms):`,
      { size: blob.size, type: blob.type },
    );
  }
  return blob;
}
