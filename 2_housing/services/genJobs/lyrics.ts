import { getGenJobByRequest, listGenRecoverable } from '../genJobsService';
import { listLyricsAssets } from '../lyricsService';
import { applyLyricsResult, lyricsTextOf } from '../../utils/lyricsHydrate';
import { showAlert } from '../../utils/appAlert';
import { useLyricsStore } from '../../stores/lyricsStore';
import { useGemsStore } from '../../stores/gemsStore';
import { usePointsStore } from '../../stores/pointsStore';
import { GEM_REWARDS } from '../../data/directors';
import type { TrackedJob } from '../../stores/generationJobStore';
import { ackGenJob } from './runtime';
import { goStudioScreen } from './music';
import { registerKind, failureBody, type GenKindAdapter, type GenKindText, type GenJobSnapshot } from './index';

// ── v3.228 W3 [GenJob:lyrics] 작사 디렉터 어댑터(1조) ────────────────────────────────
// 서버: POST /api/generate/lyrics/(동기, 헤더 X-Gen-Request-Id — 원장 gen_jobs kind=lyrics, save:true면 자산 자동 저장)
//   조회 GET /api/generate/jobs/req/{rid}(404 = 서버 미도달), result(done) = {lyrics_id, title, lyrics(≤20KB)}.
// 진행 뷰어 = LyricsLoading {jobId}(POST 없음 — 추적 레코드 구독), 결과 = LyricsResult(+ack).
// 등록: 이 모듈 import 시 1회(LyricsLoadingScreen이 import — App.tsx 정적 import라 앱 기동 시 평가).

export const LYRICS_CAP_MS = 10 * 60 * 1000; // 서버 상한(p50 18s·최대 35s)
export const LYRICS_SLOW_MS = 60 * 1000;

export const LYRICS_TEXT: GenKindText = {
  busyTitle: '이미 가사를 쓰는 중이에요',
  busyBody: '완성된 뒤에 새로 만들 수 있어요.',
  doneTitle: '가사가 완성됐어요',
  doneBody: '완성된 가사를 확인해 주세요.',
  failTitle: '가사를 끝내지 못했어요',
};

/**
 * 서버 조회 — requestId 우선(GET /jobs/req/{rid}), 없으면(다른 기기 요청을 409로 편입) 회수 목록에서 job_id로.
 * null = 없음(404·구서버·확인 완료로 목록 제외). 네트워크·5xx는 throw(추적기 백오프).
 */
export async function fetchLyricsJob(job: Pick<TrackedJob, 'requestId' | 'serverJobId'>): Promise<GenJobSnapshot | null> {
  if (job.requestId) return getGenJobByRequest(job.requestId, 'lyrics');
  if (job.serverJobId) {
    const { supported, jobs } = await listGenRecoverable(['lyrics']);
    if (!supported) return null;
    return jobs.find((j) => j.kind === 'lyrics' && j.jobId === job.serverJobId) ?? null;
  }
  return null;
}

/**
 * 원장 result → 작사 store 반영(본문이 비면 가사 보관함에서 lyrics_id로 보충). 본문을 끝내 못 구하면 false.
 * 성공 시 LyricsLoading 성공 경로와 같은 부수효과(젬 보상·별 잔액 갱신).
 */
export async function hydrateLyricsFromResult(result: any): Promise<boolean> {
  const r = { ...(result || {}) };
  if (!lyricsTextOf(r) && r.lyrics_id) {
    try {
      const asset = (await listLyricsAssets()).find((a) => a.lyrics_id === r.lyrics_id);
      if (asset) {
        r.lyrics = asset.content;
        r.title = r.title || asset.title;
      }
    } catch (err: any) {
      console.warn('[GenJob:lyrics] 가사 보관함 조회 실패', { status: err?.response?.status ?? null });
    }
  }
  if (!lyricsTextOf(r)) return false;
  applyLyricsResult(r);
  useLyricsStore.getState().setIsLoading(false);
  useLyricsStore.getState().setError(null);
  useGemsStore.getState().earn(GEM_REWARDS.TRACK_LYRICS_DONE, 'track_lyrics_done');
  usePointsStore.getState().fetchBalance();
  return true;
}

async function openLyricsJob(job: TrackedJob, navigation?: any): Promise<void> {
  if (job.lastStatus === 'failed') {
    showAlert(LYRICS_TEXT.failTitle, failureBody(job.error, job.refunded, job.notCharged), [
      { text: '확인', onPress: () => { ackGenJob(job.jobId); } },
    ]);
    return;
  }
  if (job.lastStatus === 'processing') {
    console.info('[GenJob:lyrics] 진행 뷰어', { jobId: job.jobId });
    goStudioScreen('LyricsLoading', { jobId: job.jobId }, navigation);
    return;
  }
  const ok = await hydrateLyricsFromResult(job.genResult);
  if (!ok) {
    showAlert('가사를 불러오지 못했어요', '가사 보관함에서 확인해 주세요.');
    return;
  }
  console.info('[GenJob:lyrics] 결과 열기', { jobId: job.jobId, lyricsId: job.genResult?.lyrics_id ?? null });
  goStudioScreen('LyricsResult', {}, navigation);
  ackGenJob(job.jobId);
}

export const LYRICS_ADAPTER: GenKindAdapter = {
  kind: 'lyrics',
  director: 'lyricist',
  capMs: LYRICS_CAP_MS,
  slowMs: LYRICS_SLOW_MS,
  fetch: fetchLyricsJob,
  open: openLyricsJob,
  text: LYRICS_TEXT,
};

registerKind(LYRICS_ADAPTER);
