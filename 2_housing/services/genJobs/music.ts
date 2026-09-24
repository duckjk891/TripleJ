import { navigationRef, navigateGlobal } from '../navigationRef';
import { getGenerationStatus } from '../musicService';
import { getGenJobByRequest, mapGenStatus } from '../genJobsService';
import { hydrateMusicStoresFromGeneration } from '../../utils/musicHydrate';
import { showAlert } from '../../utils/appAlert';
import type { TrackedJob } from '../../stores/generationJobStore';
import type { GenerationItem } from '../../types';
import { ackGenJob } from './runtime';
import { registerKind, failureBody, type GenKindAdapter, type GenKindText, type GenJobSnapshot } from './index';

// ── v3.228 W1 [GenJob:music] 작곡 디렉터 어댑터(1조) ─────────────────────────────────
// 서버: POST /api/generate/(start_music_gen=true, 헤더 X-Gen-Request-Id → doc.client_request_id) 201 {generation_id…}
//   조회 GET /api/generate/{id}(재시작 뒤 첫 조회에서 failed+refunded:true로 정리됨), 응답 유실 시 /jobs/req/{rid}.
// 소비: 결과 화면(MusicResult) 열기 = ack, 발매(result_track_id)도 서버가 소비로 간주.
// 등록: 이 모듈 import 시 1회(MusicLoadingScreen이 import — App.tsx 정적 import라 앱 기동 시 평가).

export const MUSIC_CAP_MS = 30 * 60 * 1000; // 서버 상한(보이스클론 suno 폴링 20분 + 다운로드·정규화)
export const MUSIC_SLOW_MS = 3 * 60 * 1000;
/** 보이스클론(내 목소리) 작곡은 실측 114~135초 — "오래 걸림" 안내 기준을 2배로 */
export const MUSIC_SLOW_VOICE_MS = 6 * 60 * 1000;

export const MUSIC_TEXT: GenKindText = {
  busyTitle: '이미 곡을 만드는 중이에요',
  busyBody: '완성된 뒤에 새로 만들 수 있어요.',
  doneTitle: '곡이 완성됐어요',
  doneBody: '완성된 곡을 들어보고 발매해 주세요.',
  failTitle: '곡을 끝내지 못했어요',
};

/** GET /generate/{id} 문서 → 스냅샷. 발매(result_track_id)·acked_at = 소비됨(acked) */
export function mapGenerationDoc(doc: any, fallbackId: string): GenJobSnapshot | null {
  const jobId = String(doc?.id || doc?._id || fallbackId || '');
  if (!jobId) return null;
  const status = mapGenStatus(doc?.status);
  return {
    jobId,
    requestId: doc?.client_request_id ? String(doc.client_request_id) : null,
    kind: 'music',
    status,
    result:
      status === 'done'
        ? { generation_id: jobId, title: doc?.title ?? null, result_track_id: doc?.result_track_id ?? null }
        : null,
    error: status === 'failed' ? (doc?.error_message || doc?.error || null) : null,
    refunded: typeof doc?.refunded === 'boolean' ? doc.refunded : null,
    acked: !!doc?.acked_at || !!doc?.result_track_id,
    meta: { title: doc?.title ?? null, progress: typeof doc?.progress === 'number' ? doc.progress : null },
  };
}

async function resolveGenerationId(job: TrackedJob): Promise<string | null> {
  if (job.serverJobId) return job.serverJobId;
  if (!job.requestId) return null;
  return (await getGenJobByRequest(job.requestId, 'music'))?.jobId ?? null;
}

/** null = 없음(404·403·400 — 삭제·타인), 네트워크·5xx는 throw(추적기 백오프) */
async function fetchMusicJob(job: TrackedJob): Promise<GenJobSnapshot | null> {
  if (!job.serverJobId && job.requestId) {
    // 201 응답을 잃은 요청 — client_request_id로 회수(없으면 서버 미도달)
    return getGenJobByRequest(job.requestId, 'music');
  }
  if (!job.serverJobId) return null;
  try {
    const doc = await getGenerationStatus(job.serverJobId);
    return mapGenerationDoc(doc, job.serverJobId);
  } catch (err: any) {
    const st = err?.response?.status;
    if (st === 404 || st === 403 || st === 400) return null;
    throw err;
  }
}

function currentRouteName(): string | undefined {
  try {
    return navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : undefined;
  } catch {
    return undefined;
  }
}

/** StudioStack 화면 이동 — 같은 화면이 떠 있으면 replace(effect 재시작), 화면 밖이면 전역 */
export function goStudioScreen(screen: string, params: Record<string, any>, navigation?: any): void {
  if (navigation?.navigate) {
    if (currentRouteName() === screen && navigation.replace) navigation.replace(screen, params);
    else navigation.navigate(screen, params);
  } else {
    navigateGlobal('Studio', { screen, params });
  }
}

async function openMusicJob(job: TrackedJob, navigation?: any): Promise<void> {
  if (job.lastStatus === 'failed') {
    showAlert(MUSIC_TEXT.failTitle, failureBody(job.error, job.refunded, job.notCharged), [
      { text: '확인', onPress: () => { ackGenJob(job.jobId); } },
    ]);
    return;
  }
  let genId: string | null = null;
  let doc: GenerationItem | null = null;
  try {
    genId = await resolveGenerationId(job);
    if (genId) doc = await getGenerationStatus(genId);
  } catch (err: any) {
    console.warn('[GenJob:music] 열기 — 생성 정보 조회 실패', { jobId: job.jobId, status: err?.response?.status ?? null });
  }
  if (!genId) {
    showAlert('곡 정보를 불러오지 못했어요', '잠시 후 다시 시도해주세요.');
    return;
  }
  if (job.lastStatus === 'processing') {
    if (doc) hydrateMusicStoresFromGeneration(doc);
    console.info('[GenJob:music] 진행 뷰어', { jobId: job.jobId, genId });
    goStudioScreen('MusicLoading', { resumeGenerationId: genId }, navigation);
    return;
  }
  // done — 결과 화면(발매 전 비교 카드) + 확인
  if (!doc) {
    showAlert('곡 정보를 불러오지 못했어요', '잠시 후 다시 시도해주세요.');
    return;
  }
  hydrateMusicStoresFromGeneration(doc);
  console.info('[GenJob:music] 결과 열기', { jobId: job.jobId, genId, released: !!doc.result_track_id });
  goStudioScreen('MusicResult', { alreadySaved: !!doc.result_track_id }, navigation);
  ackGenJob(job.jobId);
}

export const MUSIC_ADAPTER: GenKindAdapter = {
  kind: 'music',
  director: 'composer',
  capMs: MUSIC_CAP_MS,
  slowMs: MUSIC_SLOW_MS,
  fetch: fetchMusicJob,
  open: openMusicJob,
  text: MUSIC_TEXT,
};

registerKind(MUSIC_ADAPTER);
