import api from './api';
import { parseServerUtc } from './characterService';
import { newRequestId, type GenKind, type GenJobSnapshot } from './genJobs';

// ── v3.228 [GenJobs] 비아티스트 생성 원장 서버 계약 매퍼 (PLAN v3.228 S1 계약) ─────────────
//   GET  /api/generate/jobs/recoverable?kinds=a,b   → {jobs:[Job], count, swept}
//   GET  /api/generate/jobs/req/{request_id}        → Job | 404
//   POST /api/generate/jobs/{kind}/{job_id}/ack     → 200 {job_id, kind, acked:true, already} | 404 | 409 {code:"job_processing"}
//   Job = {job_id, request_id, kind, status, created_at(ISO Z), elapsed_sec, meta, result|null, error|null, refunded, not_charged?}
//   409(생성 요청) = {error, detail, code:"generation_in_progress", kind, job_id, request_id, created_at, meta}
// 구서버(엔드포인트 없음 404·405)·킬스위치는 조용히 폴백(supported=false / null). 과금 여부는 서버가 명시할 때만 단정(X-K1).

export { newRequestId };

const GEN_KINDS: ReadonlySet<string> = new Set(['lyrics', 'music', 'inst', 'cover', 'cover_refine', 'video']);
const TIMEOUT_MS = 20000;

export function isGenKind(v: unknown): v is GenKind {
  return typeof v === 'string' && GEN_KINDS.has(v);
}

/** 동기 kind 요청 헤더 — `api.post(url, body, { headers: genRequestHeaders(rid) })` */
export function genRequestHeaders(requestId: string | null | undefined): Record<string, string> {
  return requestId ? { 'X-Gen-Request-Id': requestId } : {};
}

/** 서버 UTC ISO → epoch ms(없으면 undefined) */
export function parseServerUtcSafe(v: unknown): number | undefined {
  return parseServerUtc(v) ?? undefined;
}

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s ? s : null;
}

/** 서버 상태 문자열 → 스냅샷 상태(원장 Job·generations·inst_jobs 공용) */
export function mapGenStatus(st: unknown): GenJobSnapshot['status'] {
  switch (st) {
    case 'processing':
    case 'pending':
    case 'queued':
      return 'processing';
    case 'done':
    case 'completed':
    case 'complete':
    case 'success':
      return 'done';
    case 'failed':
    // 종료형 비정상 상태(현 서버 계약엔 없음 — 방어): 실패로 처리, 과금 안내는 refunded 명시 때만(X-K1)
    case 'expired':
    case 'cancelled':
    case 'canceled':
    case 'error':
    case 'timeout':
      return 'failed';
    default:
      return 'unknown';
  }
}

/** 서버 Job(회수 목록·req 조회·409 본문 공용) → 스냅샷. kind를 모르면 fallbackKind */
export function mapServerGenJob(raw: any, fallbackKind?: GenKind | null): GenJobSnapshot | null {
  const jobId = strOrNull(raw?.job_id ?? raw?.gen_job_id);
  if (!jobId) return null;
  const kind = isGenKind(raw?.kind) ? raw.kind : fallbackKind ?? null;
  if (!kind) return null;
  let createdAtMs = parseServerUtc(raw?.created_at);
  if (typeof raw?.elapsed_sec === 'number' && raw.elapsed_sec >= 0) {
    createdAtMs = Date.now() - raw.elapsed_sec * 1000;
  }
  return {
    jobId,
    requestId: strOrNull(raw?.request_id),
    kind,
    status: mapGenStatus(raw?.status),
    createdAtMs: createdAtMs ?? undefined,
    result: raw?.result ?? null,
    error: strOrNull(raw?.error),
    refunded: typeof raw?.refunded === 'boolean' ? raw.refunded : null,
    notCharged: raw?.not_charged === true ? true : null,
    acked: !!raw?.acked || !!raw?.acked_at,
    meta: raw?.meta && typeof raw.meta === 'object' ? raw.meta : null,
  };
}

/**
 * 생성 요청의 409 generation_in_progress(비아티스트)면 진행 중 job 스냅샷, 아니면 null.
 * 신서버 `code`, 아티스트형 `error` 둘 다 수용. kind가 비아티스트가 아니면 null(아티스트 409는 characterService).
 */
export function parseGenInProgress(err: any, fallbackKind?: GenKind | null): GenJobSnapshot | null {
  if (err?.response?.status !== 409) return null;
  const data = err?.response?.data;
  if (data?.code !== 'generation_in_progress' && data?.error !== 'generation_in_progress') return null;
  const snap = mapServerGenJob({ ...data, status: 'processing' }, fallbackKind);
  if (!snap) console.warn('[GenJobs] 409 generation_in_progress — job 정보 없음', { kind: data?.kind ?? fallbackKind ?? null });
  return snap;
}

/** 같은 X-Gen-Request-Id가 이미 실패로 끝남(409 request_already_failed) → 새 request_id로 재시도해야 함 */
export function isRequestAlreadyFailed(err: any): boolean {
  return err?.response?.status === 409 && err?.response?.data?.code === 'request_already_failed';
}

/** 성공·실패(500/502) 응답 본문의 원장 필드 — `{gen_job_id, request_id, replayed}` (원장 off·구서버면 null) */
export function genLedgerFields(data: any): { genJobId: string | null; requestId: string | null; replayed: boolean } {
  return {
    genJobId: strOrNull(data?.gen_job_id),
    requestId: strOrNull(data?.request_id),
    replayed: data?.replayed === true,
  };
}

/** GET /generate/jobs/recoverable — supported=false면 구서버(404·405). 그 외 오류는 throw */
export async function listGenRecoverable(kinds: GenKind[]): Promise<{ supported: boolean; jobs: GenJobSnapshot[] }> {
  try {
    const res = await api.get('/generate/jobs/recoverable', {
      params: kinds.length ? { kinds: kinds.join(',') } : undefined,
      timeout: TIMEOUT_MS,
    });
    const raw = Array.isArray(res.data?.jobs) ? res.data.jobs : [];
    const jobs = raw
      .map((r: any) => mapServerGenJob(r))
      .filter((j: GenJobSnapshot | null): j is GenJobSnapshot => !!j);
    console.info('[GenJobs] recoverable', { kinds, n: jobs.length, swept: res.data?.swept ?? null });
    return { supported: true, jobs };
  } catch (err: any) {
    const status = err?.response?.status;
    if (status === 404 || status === 405) return { supported: false, jobs: [] };
    throw err;
  }
}

/** GET /generate/jobs/req/{request_id} — 404(없음·타인·구서버)는 null, 그 외 오류는 throw(추적기 백오프) */
export async function getGenJobByRequest(requestId: string, fallbackKind?: GenKind | null): Promise<GenJobSnapshot | null> {
  try {
    const res = await api.get(`/generate/jobs/req/${encodeURIComponent(requestId)}`, { timeout: TIMEOUT_MS });
    return mapServerGenJob({ request_id: requestId, ...res.data }, fallbackKind);
  } catch (err: any) {
    const status = err?.response?.status;
    if (status === 404 || status === 405) return null;
    throw err;
  }
}

export type GenAckOutcome = 'acked' | 'processing' | 'gone' | 'error';

/**
 * POST /generate/jobs/{kind}/{job_id}/ack — 서버에 확인 영속(재배달 방지). 환불과 무관.
 * 404·405(없음·타인·구서버) = 'gone'(조용히), 409 job_processing = 'processing', 네트워크·5xx = 'error'.
 */
export async function ackGenJobOnServer(kind: GenKind, jobId: string): Promise<GenAckOutcome> {
  try {
    const res = await api.post(
      `/generate/jobs/${encodeURIComponent(kind)}/${encodeURIComponent(jobId)}/ack`,
      {},
      { timeout: TIMEOUT_MS }
    );
    console.info('[GenJobs] ack', { kind, jobId, already: !!res.data?.already });
    return 'acked';
  } catch (err: any) {
    const status = err?.response?.status;
    if (status === 404 || status === 405) return 'gone';
    if (status === 409) return 'processing';
    console.warn('[GenJobs] ack 실패', { kind, jobId, status: status ?? null, message: err?.message });
    return 'error';
  }
}
