import { navigateGlobal } from '../navigationRef';
import { getGenJobByRequest, listGenRecoverable } from '../genJobsService';
import { registerKind, type GenKindAdapter, type GenKindText, type GenJobSnapshot } from './index';

// ── v3.228 [GenJob:video] 영상 디렉터 어댑터 — **2조 소유** ────────────────────────────
// registerKind()로 등록 → 전역 추적기가 video kind를 폴링·회수·도착 알림한다.
// 등록 시점: 이 모듈 import 시 1회(VideoDirectorScreen이 import — App.tsx 정적 import라 앱 기동 시 평가).
// 서버 계약: DEPLOY.md §6 — POST share-video 에 X-Gen-Request-Id, 조회 GET /api/generate/jobs/req/{rid},
//   result(done) = {video_url, format, subtitles, track_id}(캐시 URL — 재생 무과금), meta = {track_id, format, style, video_url}.
// 구서버(원장 없음): req 조회 404 → null(추적기가 유예·화면 판정), 화면은 1단계 파일 조회 확인으로 폴백.

export const VIDEO_CAP_MS = 25 * 60 * 1000; // 서버 상한(ffmpeg 600s + heavy 대기 + 전송)
export const VIDEO_SLOW_MS = 6 * 60 * 1000;

export const VIDEO_TEXT: GenKindText = {
  busyTitle: '이미 영상을 만드는 중이에요',
  busyBody: '완성된 뒤에 새로 만들 수 있어요.',
  doneTitle: '영상이 완성됐어요',
  doneBody: '미리 보고 저장하거나 공유해 보세요.',
  failTitle: '영상을 끝내지 못했어요',
};

/**
 * 서버 조회 — requestId 우선(GET /jobs/req/{rid}), 없으면(다른 기기·구앱 요청을 409로 편입) 회수 목록에서 job_id로.
 * null = 없음(404·구서버·확인 완료로 목록 제외). 네트워크·5xx는 throw(추적기 백오프 — 실패 표시 안 함).
 */
export async function fetchVideoJob(job: {
  requestId?: string | null;
  serverJobId?: string | null;
}): Promise<GenJobSnapshot | null> {
  if (job.requestId) return getGenJobByRequest(job.requestId, 'video');
  if (job.serverJobId) {
    const { supported, jobs } = await listGenRecoverable(['video']);
    if (!supported) return null;
    return jobs.find((j) => j.kind === 'video' && j.jobId === job.serverJobId) ?? null;
  }
  return null;
}

/** 진행 뷰어·결과 화면 = VideoDirector {recoverJobId} (POST 없음 — 'making' 추적 또는 'done' 재생) */
export function openVideoDirectorForJob(jobKey: string, trackId?: string | null, navigation?: any): void {
  const params: Record<string, any> = { recoverJobId: jobKey };
  if (trackId) params.initialTrackId = String(trackId);
  console.info('[GenJob:video] 열기', { jobId: jobKey, trackId: trackId ?? null, via: navigation?.navigate ? 'stack' : 'global' });
  if (navigation?.navigate) navigation.navigate('VideoDirector', params);
  else navigateGlobal('Studio', { screen: 'VideoDirector', initial: false, params });
}

export const VIDEO_ADAPTER: GenKindAdapter = {
  kind: 'video',
  director: 'video',
  capMs: VIDEO_CAP_MS,
  slowMs: VIDEO_SLOW_MS,
  fetch: async (job) => {
    const snap = await fetchVideoJob({ requestId: job.requestId, serverJobId: job.serverJobId });
    if (__DEV__) console.info('[GenJob:video] 조회', { jobId: job.jobId, status: snap?.status ?? '404' });
    return snap;
  },
  open: async (job, navigation) => {
    const trackId = job.meta?.track_id ?? job.meta?.trackId ?? job.genResult?.track_id ?? null;
    openVideoDirectorForJob(job.jobId, trackId, navigation);
  },
  text: VIDEO_TEXT,
};

registerKind(VIDEO_ADAPTER);
