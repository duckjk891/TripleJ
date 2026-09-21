// v3.200: 창작 기록 계층(Phase 0) 앱 SDK — 세션·이벤트·가사 버전 커밋.
// 계약(backend_9004 신설, PLAN v3.200 §4 backend-dev):
//   POST /sessions                     → { session_id }  (SESSION_START 서버 기록)
//   POST /sessions/{id}/events         → 배치 { events: [...] } (event_id idempotent, seq 서버 부여)
//   POST /sessions/{id}/lyrics         → { lyrics_version_id } (전문+prev_version_id+source, LYRIC_EDIT 서버 기록)
// 원칙(문서 §3.4/§5.5):
//   - 실패 무해: 서버 미배포(404)·비로그인(401)이면 이번 앱 세션 동안 no-op으로 게이트.
//     기록 실패가 생성·발매 등 기능을 절대 막지 않는다.
//   - 이벤트는 메모리 큐 + 2s 디바운스 배치 전송, client_seq 로컬 단조 증가로 세션 내 순서 보존.
//     전송 실패는 지수 백오프 최대 3회 재시도 후 폐기.
//     오프라인 SQLite 영속 큐(§5.5 완전판)는 후속(v3.201+) — 강제종료 시 유실 허용(테스트 배포 슬라이스).
//   - 가사 버전은 커밋 시점에만 저장(§7.4: 적용/생성 요청/에디터 닫기 — 키 입력마다 금지).
//     붙여넣기(paste) 감지·edit_stats.pasted_tokens 기록은 후속(§7.4).
import Constants from 'expo-constants';
import api from './api';
import { useAuthStore } from '../stores/authStore';
import { useMusicStore } from '../stores/musicStore';

// 문서 §5.1 앱 발생 이벤트 타입 (FINALIZE는 서버 훅이 기록 — 앱은 flush+session_id 동봉만)
export type CreationEventType = 'LISTEN' | 'CANDIDATE_SELECT' | 'LYRIC_EDIT';
export type LyricsVersionSource = 'ai_draft' | 'user_edit';

// v3.200: 배포 서버 확정 스펙 — 봉투형 {"events":[...]} 배치, 이벤트 필드는 아래 6종만
// (event_id, client_seq, type, client_ts, target, payload). §12 엄격 검증: 미정의 필드 400.
// actor는 서버가 부여(앱 이벤트 = user 고정)하므로 앱에서 보내지 않는다.
interface QueuedEvent {
  event_id: string;
  client_seq: number;
  type: CreationEventType;
  client_ts: string;
  target?: Record<string, any>;
  payload: Record<string, any>;
}

// ---- 모듈 상태 (메모리 큐 — 화면을 넘나드는 한 곡 흐름 공유) ----
let sessionId: string | null = null;
let sessionStartPromise: Promise<string | null> | null = null;
let disabled = false; // 401/404 게이트 — 이번 앱 실행 동안 무해 no-op
let clientSeq = 0;
let queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> | null = null;
let lastLyricsVersionId: string | null = null;
let lastLyricsText: string | null = null;

const FLUSH_DEBOUNCE_MS = 2000;
const MAX_SEND_ATTEMPTS = 3; // 1회 + 재시도 2회(백오프 1s/2s) 후 폐기

// uuid v4 — 외부 의존성 없이 생성(이벤트 idempotency 키 용도로 충분).
// expo-crypto randomUUID 도입은 후속.
function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function appVersion(): string {
  // app.json version + 내부 릴리스 태그 — SESSION_START 근거 기록용
  return `${Constants.expoConfig?.version || '1.0.0'} (v3.200)`;
}

// 404(라우터 미배포)/401(비로그인)은 기능 게이트 — 이번 실행 동안 조용히 no-op.
// 그 외(네트워크 등)는 일시 오류로 보고 게이트하지 않는다.
function gateIfUnavailable(err: any, where: string): void {
  const status = err?.response?.status;
  if (status === 404 || status === 401) {
    disabled = true;
    if (__DEV__) console.log('[CreationLog]', where, '게이트(no-op 전환) — status:', status);
  }
}

/** 현재 창작 세션 id (없으면 null — 호출부는 기존 흐름 그대로 진행) */
export function getCreationSessionId(): string | null {
  return sessionId;
}

/** 마지막 커밋된 가사 버전 id — 생성 body lyrics_version_id 동봉용 */
export function getLastLyricsVersionId(): string | null {
  return lastLyricsVersionId;
}

/**
 * 세션 확보(idempotent) — 없으면 POST /sessions로 생성. 실패 시 null(기존 흐름 무영향).
 * 새 곡 흐름의 첫 접점(가사 결과 진입·작곡 대화 mount·이벤트 첫 기록)에서 lazy 생성된다.
 * 세션 미확보 상태로 생성 요청이 나가면 서버가 자동 생성한다(구버전 앱 호환 — PLAN B2).
 */
export async function ensureCreationSession(): Promise<string | null> {
  if (disabled) return null;
  if (sessionId) return sessionId;
  if (!useAuthStore.getState().token) return null; // 비로그인 — 서버 세션 귀속 불가, no-op
  if (sessionStartPromise) return sessionStartPromise;
  sessionStartPromise = (async () => {
    try {
      const res = await api.post('/sessions', {
        app_version: appVersion(),
        platform: Constants.platform?.ios ? 'ios' : Constants.platform?.android ? 'android' : 'web',
        engine_list: ['suno'],
        // §4.3 실측: 참고 음악 업로드 경로(v3.91)가 존재하므로 허위 플래그 금지 — false 고정
        import_blocked: false,
        criteria_version: null,
        // v3.200(②): creation_mode는 여기서 보내지 않는다 — 배포 서버 SESSION_START 스키마가
        // §12 엄격 검증(미정의 필드 400)이라 400 위험. 창작 모드는 발매 track_type
        // ('standard'|'copyright_ready')으로만 표기하고, 세션 payload 반영은 백엔드
        // 스키마 확장 후속에서.
      }, { timeout: 15000 });
      const id = res.data?.session_id ? String(res.data.session_id) : null;
      if (id) {
        sessionId = id;
        clientSeq = 0;
        lastLyricsVersionId = null;
        lastLyricsText = null;
        useMusicStore.getState().setCreationSessionId(id);
        if (__DEV__) console.log('[CreationLog] 세션 시작:', id);
      }
      return id;
    } catch (err: any) {
      gateIfUnavailable(err, 'ensureCreationSession');
      console.error('[CreationLog] 세션 생성 실패(기록 없이 진행):', err?.response?.status, err?.message);
      return null;
    } finally {
      sessionStartPromise = null;
    }
  })();
  return sessionStartPromise;
}

/** 세션 종료(FINALIZE 확정 후) — 다음 곡 흐름은 새 세션으로 시작 */
export function endCreationSession(): void {
  if (__DEV__) console.log('[CreationLog] 세션 종료:', sessionId, '잔여 큐:', queue.length);
  sessionId = null;
  clientSeq = 0;
  queue = [];
  lastLyricsVersionId = null;
  lastLyricsText = null;
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  useMusicStore.getState().setCreationSessionId(null);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// 배포 서버 배치 상한 500 — 초과분은 순서 유지한 채 분할 전송
const MAX_BATCH_SIZE = 500;

async function sendBatch(id: string, events: QueuedEvent[]): Promise<boolean> {
  // 봉투형 {"events":[...]} 고정(배열 직송 400 — 배포 서버 §12 엄격 검증). 배치 ≤500 분할.
  if (events.length > MAX_BATCH_SIZE) {
    let ok = true;
    for (let i = 0; i < events.length; i += MAX_BATCH_SIZE) {
      ok = (await sendBatch(id, events.slice(i, i + MAX_BATCH_SIZE))) && ok;
    }
    return ok;
  }
  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
    try {
      await api.post(`/sessions/${id}/events`, { events }, { timeout: 15000 });
      if (__DEV__) console.log('[CreationLog] 이벤트 전송 완료:', events.length, '건');
      return true;
    } catch (err: any) {
      gateIfUnavailable(err, 'sendBatch');
      if (disabled) return false;
      // 409(FINALIZED 세션)·400(스키마 거부)은 재시도 무의미 — 폐기
      const status = err?.response?.status;
      if (status === 409 || status === 400) {
        console.error('[CreationLog] 이벤트 배치 거부(폐기):', status, err?.response?.data?.error);
        return false;
      }
      console.error('[CreationLog] 이벤트 전송 실패(시도', attempt, '/', MAX_SEND_ATTEMPTS, '):', status, err?.message);
      if (attempt < MAX_SEND_ATTEMPTS) await sleep(1000 * Math.pow(2, attempt - 1));
    }
  }
  return false; // 재시도 소진 — 폐기 (오프라인 영속 큐는 후속)
}

/** 큐 즉시 전송 — 화면 이탈·선택 확정·발매 직전에 호출(세션 내 순서 보존) */
export async function flushCreationEvents(): Promise<void> {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (flushing) await flushing; // 진행 중 배치 뒤에 이어붙여 순서 보존
  if (disabled || !sessionId || queue.length === 0) return;
  const id = sessionId;
  const batch = queue;
  queue = [];
  flushing = (async () => {
    await sendBatch(id, batch);
  })();
  try {
    await flushing;
  } finally {
    flushing = null;
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushCreationEvents().catch((err: any) => {
      console.error('[CreationLog] flush 실패:', err?.message);
    });
  }, FLUSH_DEBOUNCE_MS);
}

/**
 * 이벤트 기록(메모리 큐 적재 + 디바운스 배치 전송) — 동기 반환, 기능 흐름 비차단.
 * event_id=uuid(서버 중복 무시), client_seq 로컬 단조 증가(서버 seq 부여 기준 — §5.5).
 */
export function logCreationEvent(
  type: CreationEventType,
  payload: Record<string, any>,
  target?: Record<string, any>
): void {
  if (disabled) return;
  // 세션이 아직 없으면 lazy 생성 후 적재 — 생성 실패 시 해당 이벤트는 버린다(무해).
  const enqueue = () => {
    if (disabled || !sessionId) return;
    queue.push({
      event_id: uuidv4(),
      client_seq: ++clientSeq,
      type,
      client_ts: new Date().toISOString(),
      ...(target ? { target } : {}),
      payload,
    });
    if (__DEV__) console.log('[CreationLog] 이벤트 적재:', type, JSON.stringify(payload));
    scheduleFlush();
  };
  if (sessionId) {
    enqueue();
  } else {
    ensureCreationSession().then(enqueue).catch(() => {});
  }
}

/**
 * 가사 버전 커밋 — POST /sessions/{id}/lyrics.
 * body는 배포 서버 스펙 3필드 고정: text(전문)+prev_version_id+source (§12 엄격 검증 — 여분 필드 금지).
 * 직전 커밋과 동일 텍스트면 서버 호출 없이 기존 버전 id 반환(중복 버전 방지 — §7.4 커밋 시점 규칙).
 * origin 토큰 태깅·diff 계산은 서버/후속(v3.201+) — 앱은 전문 체인만 보장한다.
 */
export async function commitLyricsVersion(
  source: LyricsVersionSource,
  text: string
): Promise<string | null> {
  if (disabled) return null;
  const trimmed = (text || '').trim();
  if (!trimmed) return lastLyricsVersionId;
  if (lastLyricsText === trimmed) {
    if (__DEV__) console.log('[CreationLog] 가사 버전 동일 — 커밋 생략:', lastLyricsVersionId);
    return lastLyricsVersionId;
  }
  const id = await ensureCreationSession();
  if (!id) return null;
  try {
    const res = await api.post(`/sessions/${id}/lyrics`, {
      source,
      text: trimmed,
      prev_version_id: lastLyricsVersionId || null,
    }, { timeout: 15000 });
    const versionId = res.data?.lyrics_version_id ? String(res.data.lyrics_version_id) : null;
    if (versionId) {
      lastLyricsVersionId = versionId;
      lastLyricsText = trimmed;
      if (__DEV__) console.log('[CreationLog] 가사 버전 커밋:', source, versionId);
    }
    return versionId;
  } catch (err: any) {
    gateIfUnavailable(err, 'commitLyricsVersion');
    console.error('[CreationLog] 가사 버전 커밋 실패(기록 없이 진행):', err?.response?.status, err?.message);
    return null;
  }
}
