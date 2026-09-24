import { navigateGlobal } from '../navigationRef';
import { getGenJobByRequest, listGenRecoverable } from '../genJobsService';
import { registerKind, type GenKindAdapter, type GenKindText, type GenJobSnapshot } from './index';

// ── v3.228 [GenJob:cover] 이미지 디렉터 어댑터(cover·cover_refine) — **2조 소유** ──────────
// registerKind()로 등록 → 전역 추적기가 폴링·회수·도착 알림. 등록 시점: 이 모듈 import 시 1회
// (CoverGenerationScreen이 import — App.tsx 정적 import라 앱 기동 시 평가).
// cover·cover_refine은 중복 차단 그룹 'image' 하나(GEN_KIND_GROUP) — 서버도 한 슬롯(409).
// 서버 계약(DEPLOY.md §6-3):
//   cover        meta {title, image_model, source, has_character} · result {cover_session_id, object_name, image_url, image_model}
//   cover_refine meta {cover_session_id, base_version, image_model} · result {cover_session_id, cover_object_name, image_url, current_version}
// 이 기기에서 등록한 레코드는 meta에 track_id·album_id·album_title을 더 싣는다(결과 화면 확정 대상 복원용).
// 구서버(원장 없음): req 조회 404 → null. 화면은 v3.202 I-lite(cover-sessions)·v3.204(cover-history) 폴링으로 폴백.

export const COVER_CAP_MS = 15 * 60 * 1000;
export const COVER_SLOW_MS = 5 * 60 * 1000;

export const COVER_TEXT: GenKindText = {
  busyTitle: '이미 이미지를 만드는 중이에요',
  busyBody: '완성된 뒤에 새로 만들 수 있어요.',
  doneTitle: '커버 이미지가 완성됐어요',
  doneBody: '완성된 이미지를 확인해 주세요.',
  failTitle: '커버 이미지를 끝내지 못했어요',
};

export const COVER_REFINE_TEXT: GenKindText = {
  busyTitle: '이미 이미지를 만드는 중이에요',
  busyBody: '완성된 뒤에 새로 만들 수 있어요.',
  doneTitle: '이미지 다듬기가 끝났어요',
  doneBody: '다듬은 이미지를 확인해 주세요.',
  failTitle: '이미지 다듬기를 끝내지 못했어요',
};

type ImageKind = 'cover' | 'cover_refine';

/**
 * 서버 조회 — requestId 우선(GET /jobs/req/{rid}), 없으면(409 편입·다른 기기) 회수 목록에서 job_id로.
 * null = 없음(404·구서버·확인 완료). 네트워크·5xx는 throw(추적기 백오프 — 실패 표시 안 함).
 */
export async function fetchImageJob(job: {
  kind: ImageKind;
  requestId?: string | null;
  serverJobId?: string | null;
}): Promise<GenJobSnapshot | null> {
  if (job.requestId) return getGenJobByRequest(job.requestId, job.kind);
  if (job.serverJobId) {
    const { supported, jobs } = await listGenRecoverable([job.kind]);
    if (!supported) return null;
    return jobs.find((j) => j.kind === job.kind && j.jobId === job.serverJobId) ?? null;
  }
  return null;
}

/** 진행 뷰어·결과 화면 = CoverGeneration {recoverJobId}(POST 없음). 앨범 커버는 AlbumCoverGeneration(앨범 모드) */
export function openCoverForJob(jobKey: string, meta: Record<string, any> | null | undefined, navigation?: any): void {
  const albumId = meta?.album_id ? String(meta.album_id) : null;
  console.info('[GenJob:cover] 열기', { jobId: jobKey, album: !!albumId, via: albumId ? 'root' : navigation?.navigate ? 'stack' : 'global' });
  if (albumId) {
    navigateGlobal('AlbumCoverGeneration', {
      albumMode: { albumId, albumTitle: String(meta?.album_title ?? ''), trackTitles: [] },
      recoverJobId: jobKey,
    });
    return;
  }
  const params = { recoverJobId: jobKey };
  if (navigation?.navigate) navigation.navigate('CoverGeneration', params);
  else navigateGlobal('Studio', { screen: 'CoverGeneration', initial: false, params });
}

function makeAdapter(kind: ImageKind, text: GenKindText): GenKindAdapter {
  return {
    kind,
    director: 'image',
    capMs: COVER_CAP_MS,
    slowMs: COVER_SLOW_MS,
    fetch: async (job) => {
      const snap = await fetchImageJob({ kind, requestId: job.requestId, serverJobId: job.serverJobId });
      if (__DEV__) console.info('[GenJob:cover] 조회', { kind, jobId: job.jobId, status: snap?.status ?? '404' });
      return snap;
    },
    open: async (job, navigation) => {
      openCoverForJob(job.jobId, job.meta, navigation);
    },
    text,
  };
}

export const COVER_ADAPTER = makeAdapter('cover', COVER_TEXT);
export const COVER_REFINE_ADAPTER = makeAdapter('cover_refine', COVER_REFINE_TEXT);

registerKind(COVER_ADAPTER);
registerKind(COVER_REFINE_ADAPTER);
