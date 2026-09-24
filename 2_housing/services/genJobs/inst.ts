import { getInstrumentalStatus } from '../trackService';
import { mapGenStatus, parseServerUtcSafe } from '../genJobsService';
import { listUserGenJobs, type TrackedJob } from '../../stores/generationJobStore';
import { goStudioScreen } from './music';
import { registerKind, type GenKindAdapter, type GenKindText, type GenJobSnapshot } from './index';

// ── v3.228 W1 [GenJob:inst] 연주곡(Inst.) 어댑터(1조) — 작곡 디렉터 슬롯 공유 ─────────────────
// 서버: POST /api/tracks/{id}/instrumental 202 {job_id} — 곡별 active claim 유지(사용자별 차단 없음, 헤더 불필요).
//   조회 GET /api/tracks/{id}/instrumental/status → {status, job_id, result_track_id, error, refunded, created_at}
//   (최신 job 기준, 죽은 active는 조회 시 failed+refunded로 정리 → 곡 잠김 해소).
// 소비: InstLoading이 완료·실패 카드를 보여준 순간 settleGenJob(ack). meta = {trackId(원곡), title}.
// 등록: 이 모듈 import 시 1회(InstLoadingScreen이 import).

export const INST_CAP_MS = 30 * 60 * 1000;
export const INST_SLOW_MS = 4 * 60 * 1000;

export const INST_TEXT: GenKindText = {
  busyTitle: '이미 Inst. 버전을 만드는 중이에요',
  busyBody: '완성된 뒤에 새로 만들 수 있어요.',
  doneTitle: 'Inst. 버전이 완성됐어요',
  doneBody: '내 곡에 추가됐어요.',
  failTitle: 'Inst. 버전을 끝내지 못했어요',
};

/** 이 원곡의 추적 레코드(최신) — 없으면 null */
export function findInstJobForTrack(trackId: string): TrackedJob | null {
  return listUserGenJobs(['inst']).find((j) => String(j.meta?.trackId ?? '') === String(trackId)) ?? null;
}

/** status 응답 → 스냅샷. 최신 job이 내 job이 아니면(내 job은 이미 종료) null */
export function mapInstStatus(data: any, job: Pick<TrackedJob, 'serverJobId'>): GenJobSnapshot | null {
  const latestId = data?.job_id ? String(data.job_id) : null;
  if (latestId && job.serverJobId && latestId !== job.serverJobId) return null;
  const status = mapGenStatus(String(data?.status || '').toLowerCase());
  const jobId = latestId || job.serverJobId || '';
  if (!jobId) return null;
  return {
    jobId,
    kind: 'inst',
    status,
    createdAtMs: parseServerUtcSafe(data?.created_at),
    result: status === 'done' ? { result_track_id: data?.result_track_id ?? null } : null,
    error: status === 'failed' ? (data?.error || null) : null,
    refunded: typeof data?.refunded === 'boolean' ? data.refunded : null,
  };
}

async function fetchInstJob(job: TrackedJob): Promise<GenJobSnapshot | null> {
  const trackId = job.meta?.trackId ? String(job.meta.trackId) : '';
  if (!trackId) return null;
  try {
    const data = await getInstrumentalStatus(trackId);
    return mapInstStatus(data, job);
  } catch (err: any) {
    const st = err?.response?.status;
    if (st === 404 || st === 403 || st === 400) return null;
    throw err;
  }
}

/** 진행·완료·실패 모두 InstLoading resume(POST 없음 — 폴링·완료 카드·미리듣기는 기존 화면이 처리) */
async function openInstJob(job: TrackedJob, navigation?: any): Promise<void> {
  const trackId = job.meta?.trackId ? String(job.meta.trackId) : '';
  if (!trackId) return;
  console.info('[GenJob:inst] 열기', { jobId: job.jobId, trackId, status: job.lastStatus });
  goStudioScreen(
    'InstLoading',
    { trackId, title: job.meta?.title ?? '', resume: true, nonce: `gen-${Date.now()}` },
    navigation
  );
}

export const INST_ADAPTER: GenKindAdapter = {
  kind: 'inst',
  director: 'composer',
  capMs: INST_CAP_MS,
  slowMs: INST_SLOW_MS,
  fetch: fetchInstJob,
  open: openInstJob,
  text: INST_TEXT,
};

registerKind(INST_ADAPTER);
