import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from './authStore';

// ── v3.227 A-보완 [GenJobStore]: 생성 job 영속 레코드 ─────────────────────────
// 서버는 접수 즉시 백그라운드로 끝까지 생성한다 → 앱은 "화면"이 아니라 "job"을 추적한다.
// POST가 job_id를 돌려준 직후(화면 전환 전) 여기에 기록하고, 전역 추적기
// (services/generationTracker.ts)가 화면과 무관하게 상태를 갱신한다.
// - 텍스트만 저장(파일 URI 금지 — 2026-09-07 보존 정책). 사진 파일은 추적기 메모리 맵에만.
// - ownerUserId가 현재 로그인 사용자와 다르면 숨김(로그아웃·계정 전환) → 재로그인 시 다시 보임.
// - 30일 지난 레코드는 하이드레이션 시 정리.
// - kind는 확장 지점. v3.228 W0: 'artist' 외 6종(GenJobKind) 레코드 수용 — 어댑터는 services/genJobs/*.
//   아티스트 선택자(listUserArtistJobs 등)는 kind==='artist' 필터 그대로(구버전 앱도 비아티스트 레코드 무시).

/** v3.228: 비아티스트 생성 kind(작사·작곡·연주곡·커버·다듬기·영상) — services/genJobs/index.ts의 GenKind와 동일 */
export type GenJobKind = 'lyrics' | 'music' | 'inst' | 'cover' | 'cover_refine' | 'video';
export type TrackedJobKind = 'artist' | GenJobKind;
/** 작업실 디렉터(말풍선 슬롯) — MapScreen DirectorType 부분집합 */
export type GenJobDirector = 'lyricist' | 'composer' | 'image' | 'video';
/** kind → 작업실 디렉터(작곡 디렉터는 music·inst 공용, 이미지 디렉터는 cover·cover_refine 공용) */
export const GEN_KIND_DIRECTOR: Record<GenJobKind, GenJobDirector> = {
  lyrics: 'lyricist',
  music: 'composer',
  inst: 'composer',
  cover: 'image',
  cover_refine: 'image',
  video: 'video',
};
export type TrackedJobMode = 'sheet' | 'outfit';
/** 서버 기준 상태. 'done' 레코드가 남아 있으면 = 아직 저장하지 않은 완성본(done-unsaved) */
export type TrackedJobStatus = 'processing' | 'done' | 'failed' | 'unknown';

export interface TrackedJobResult {
  object_name: string;
  /** 서버 상대 경로(/api/character/preview/...) */
  preview_url: string;
  original_object_name?: string | null;
  character_id?: string | null;
  art_style?: string | null;
}

/** save used_items 페이로드 원천(텍스트만) — 앱 재시작 후 finalize에서도 코디 기록 유지 */
export interface TrackedUsedItem {
  name?: string;
  image_object_name: string;
  product_url?: string;
  category?: string;
}

// ── v3.235 [CoverWardrobe]: 커버 대화 '의상 바꾸러 가기'로 시작한 옷 입히기 — 완성 저장 후 복귀할 곳 ──
/** 'cover' = 작업실 이미지 디렉터(Studio CoverGeneration) · 'albumCover' = 앨범 AI 커버(RootStack AlbumCoverGeneration) */
export type CoverReturnTo = 'cover' | 'albumCover';
export interface CoverReturnMeta {
  /** 옷을 입힌 커버 아티스트 cid(레거시 계정 = null) */
  characterId: string | null;
  /** 곡 커버 대화의 곡 id — 복귀 시 같은 곡 대화가 남아 있을 때만 커버로 돌아간다 */
  trackId?: string | null;
  /** 앨범 모드 복귀 파라미터(AlbumCoverGeneration albumMode) */
  albumMode?: { albumId: string; albumTitle: string; trackTitles?: string[] } | null;
}

export interface TrackedJob {
  jobId: string;
  kind: TrackedJobKind;
  mode: TrackedJobMode;
  characterKind: 'real' | 'virtual';
  /** 재생성·코디 대상 cid(없으면 신규) */
  targetCharacterId: string | null;
  legacyContract: boolean;
  photoIntent: 'photo' | 'text' | null;
  pendingName: string | null;
  pendingGender: string | null;
  pendingAge: string | null;
  usedItems: TrackedUsedItem[];
  /** 가상 저장 art_style 폴백(잡 결과에 art_style이 없을 때) */
  artStyleHint: string | null;
  startedAt: number;
  lastStatus: TrackedJobStatus;
  lastCheckedAt: number | null;
  result?: TrackedJobResult;
  error?: string | null;
  refunded?: boolean | null;
  ownerUserId: string;
  /** local=이 기기 접수 / recovered=서버 회수 목록 편입 / conflict=409 generation_in_progress 편입 */
  source: 'local' | 'recovered' | 'conflict';
  /** 뷰어 밖 done 앱 내 알림 1회 표시 시각 */
  notifiedAt?: number | null;
  /** startedAt+30분 경과 시 recoverable 1회 호출(서버 lazy 정리) 시각 (v3.228: 비아티스트는 kind별 상한) */
  staleProbeAt?: number | null;
  // ── v3.228 비아티스트 kind 전용(선택 필드 — 아티스트 레코드엔 없음, 마이그레이션 불필요) ──
  /** 동기 kind 요청 헤더 X-Gen-Request-Id(32hex) — 응답 유실 시 GET /api/generate/jobs/req/{id}로 회수 */
  requestId?: string | null;
  /** 서버 job id(gen_jobs _id · generation_id · inst job_id) */
  serverJobId?: string | null;
  /** kind별 부가 정보(trackId·format·cover_session_id 등 — 텍스트만) */
  meta?: Record<string, any> | null;
  /** 비아티스트 완성 결과(서버 result 원문) — 아티스트 result(TrackedJobResult)와 분리 */
  genResult?: any;
  /** 서버가 미차감을 명시한 실패(not_charged) — 이때만 "차감되지 않았어요" 안내(X-K1) */
  notCharged?: boolean | null;
  /** 결과 확인(ack) 시각 — 이후 선택자에서 제외 */
  ackedAt?: number | null;
  /** 작업실 디렉터(말풍선 슬롯) */
  director?: GenJobDirector | null;
  // ── v3.235 [CoverWardrobe](선택 필드 — 구 영속본·회수·일반 꾸미기 job 엔 없음 = 현행 ArtistResult 착지) ──
  /** 옷 입히기 완성 저장 후 복귀할 커버 화면 */
  returnTo?: CoverReturnTo | null;
  returnMeta?: CoverReturnMeta | null;
}

/**
 * v3.228: 비아티스트 레코드의 아티스트 전용 필수 필드 중립값(TrackedJob 형태 유지용 — 아티스트 경로는 kind 필터로 미사용).
 * 아티스트 필드를 optional로 바꾸면 아티스트 화면 타입이 흔들리므로 형태를 유지한다.
 */
export const GEN_NEUTRAL_ARTIST_FIELDS: Pick<
  TrackedJob,
  | 'mode' | 'characterKind' | 'targetCharacterId' | 'legacyContract' | 'photoIntent'
  | 'pendingName' | 'pendingGender' | 'pendingAge' | 'usedItems' | 'artStyleHint'
> = {
  mode: 'sheet',
  characterKind: 'real',
  targetCharacterId: null,
  legacyContract: false,
  photoIntent: null,
  pendingName: null,
  pendingGender: null,
  pendingAge: null,
  usedItems: [],
  artStyleHint: null,
};

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DISMISSED_KEEP = 50;

interface GenerationJobState {
  jobs: Record<string, TrackedJob>;
  /** 사용자가 닫은(버린·실패 확인) job — 회수 목록 재편입 방지(구서버 dismiss 404 대비) */
  dismissedIds: string[];
  upsertJob: (job: TrackedJob) => void;
  patchJob: (jobId: string, patch: Partial<TrackedJob>) => void;
  removeJob: (jobId: string, opts?: { dismissed?: boolean }) => void;
  pruneOld: () => void;
}

export const useGenerationJobStore = create<GenerationJobState>()(
  persist(
    (set) => ({
      jobs: {},
      dismissedIds: [],
      upsertJob: (job) => set((s) => ({ jobs: { ...s.jobs, [job.jobId]: job } })),
      patchJob: (jobId, patch) =>
        set((s) => {
          const cur = s.jobs[jobId];
          if (!cur) return s;
          return { jobs: { ...s.jobs, [jobId]: { ...cur, ...patch } } };
        }),
      removeJob: (jobId, opts) =>
        set((s) => {
          const { [jobId]: _gone, ...rest } = s.jobs;
          const dismissedIds = opts?.dismissed
            ? [jobId, ...s.dismissedIds.filter((id) => id !== jobId)].slice(0, DISMISSED_KEEP)
            : s.dismissedIds;
          return { jobs: rest, dismissedIds };
        }),
      pruneOld: () =>
        set((s) => {
          const now = Date.now();
          const next: Record<string, TrackedJob> = {};
          let pruned = 0;
          for (const [id, j] of Object.entries(s.jobs)) {
            if (now - (j.startedAt || 0) > RETENTION_MS) pruned++;
            else next[id] = j;
          }
          if (pruned > 0) console.info('[GenJobStore] 30일 경과 레코드 정리', { pruned });
          return pruned > 0 ? { jobs: next } : s;
        }),
    }),
    {
      name: 'maidol-generation-jobs-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ jobs: s.jobs, dismissedIds: s.dismissedIds }),
    }
  )
);

// ── 선택자(현재 로그인 사용자 기준) ─────────────────────────────────────────

function currentUserId(): string | null {
  const id = useAuthStore.getState().user?.id;
  return id ? String(id) : null;
}

/** 현재 사용자의 artist job 목록(최신순) — ownerUserId 불일치는 숨김 */
export function listUserArtistJobs(
  jobs: Record<string, TrackedJob> = useGenerationJobStore.getState().jobs,
  userId: string | null = currentUserId()
): TrackedJob[] {
  if (!userId) return [];
  return Object.values(jobs)
    .filter((j) => j.kind === 'artist' && j.ownerUserId === userId && j.lastStatus !== 'unknown')
    .sort((a, b) => b.startedAt - a.startedAt);
}

/** 새 생성을 막는 job(진행 중 우선, 없으면 저장 안 된 완성본) — 없으면 null */
export function pickBlockingArtistJob(list: TrackedJob[]): TrackedJob | null {
  return list.find((j) => j.lastStatus === 'processing') ?? list.find((j) => j.lastStatus === 'done') ?? null;
}

/** 비반응형 조회 — 중복 생성 가드용 */
export function getBlockingArtistJob(): TrackedJob | null {
  return pickBlockingArtistJob(listUserArtistJobs());
}

/** 반응형: 현재 사용자의 artist job 전체(카드 렌더용 — processing/done/failed) */
export function useUserArtistJobs(): TrackedJob[] {
  const jobs = useGenerationJobStore((s) => s.jobs);
  const userId = useAuthStore((s) => (s.user?.id ? String(s.user.id) : null));
  return listUserArtistJobs(jobs, userId);
}

/** 반응형: 새 생성을 막는 job(processing → done-unsaved 순) */
export function useActiveArtistJob(): TrackedJob | null {
  return pickBlockingArtistJob(useUserArtistJobs());
}

/**
 * [2조 전달용] 반응형: 추적 중(processing·done-unsaved)인 아티스트 job이 있는가.
 * ArtistCody 등 화면에서 버튼 상태 표시에 사용. 실제 차단(팝업 포함)은
 * services/generationTracker.ts의 guardArtistGeneration()을 handleApply 첫 줄에서 호출.
 */
export function useHasActiveArtistJob(): boolean {
  return useActiveArtistJob() !== null;
}

/**
 * v3.235 [CoverWardrobe]: 이 아티스트(cid)에게 옷을 입히는 중인 job — processing 우선, 없으면 done-unsaved.
 * 커버 대화 1.7(의상 확인)에서 "아직 옷을 입히는 중" 안내·'이 의상 그대로' 확인 팝업 판정에 쓴다.
 * cid 없음(레거시)·다른 아티스트·신규 생성(sheet) job 은 대상 아님.
 */
export function pickDressingArtistJob(list: TrackedJob[], cid: string | null | undefined): TrackedJob | null {
  if (!cid) return null;
  const mine = list.filter((j) => j.kind === 'artist' && j.mode === 'outfit' && j.targetCharacterId === cid);
  return mine.find((j) => j.lastStatus === 'processing') ?? mine.find((j) => j.lastStatus === 'done') ?? null;
}

/** 비반응형: pickDressingArtistJob(현재 사용자) */
export function getDressingArtistJob(cid: string | null | undefined): TrackedJob | null {
  return pickDressingArtistJob(listUserArtistJobs(), cid);
}

/** 반응형: pickDressingArtistJob(현재 사용자) */
export function useDressingArtistJob(cid: string | null | undefined): TrackedJob | null {
  return pickDressingArtistJob(useUserArtistJobs(), cid);
}

// ── v3.228 비아티스트 선택자 ─────────────────────────────────────────────

/** 현재 사용자의 비아티스트 job(미확인만, 최신순). kinds 지정 시 그 kind만 */
export function listUserGenJobs(
  kinds?: GenJobKind[] | null,
  jobs: Record<string, TrackedJob> = useGenerationJobStore.getState().jobs,
  userId: string | null = currentUserId()
): TrackedJob[] {
  if (!userId) return [];
  const allow = kinds && kinds.length ? new Set<TrackedJobKind>(kinds) : null;
  return Object.values(jobs)
    .filter(
      (j) =>
        j.kind !== 'artist' &&
        (!allow || allow.has(j.kind)) &&
        j.ownerUserId === userId &&
        j.lastStatus !== 'unknown' &&
        !j.ackedAt
    )
    .sort((a, b) => b.startedAt - a.startedAt);
}

/** 디렉터 슬롯 대표 job — processing → done(미확인) → failed(미확인) 순, 없으면 null */
export function pickDirectorJob(list: TrackedJob[]): TrackedJob | null {
  return (
    list.find((j) => j.lastStatus === 'processing') ??
    list.find((j) => j.lastStatus === 'done') ??
    list.find((j) => j.lastStatus === 'failed') ??
    null
  );
}

/** 비반응형: 디렉터의 대표 job. accept로 대상 한정(예: 어댑터 등록된 kind만 — 스토어는 레지스트리를 모름) */
export function getDirectorJob(director: GenJobDirector, accept?: (j: TrackedJob) => boolean): TrackedJob | null {
  return pickDirectorJob(listUserGenJobs().filter((j) => j.director === director && (!accept || accept(j))));
}

/** 반응형: 디렉터의 대표 job(작업실 말풍선). accept로 대상 한정(작곡 = music·inst 중 등록된 것만) */
export function useDirectorJob(director: GenJobDirector, accept?: (j: TrackedJob) => boolean): TrackedJob | null {
  const jobs = useGenerationJobStore((s) => s.jobs);
  const userId = useAuthStore((s) => (s.user?.id ? String(s.user.id) : null));
  return pickDirectorJob(
    listUserGenJobs(null, jobs, userId).filter((j) => j.director === director && (!accept || accept(j)))
  );
}

/** 반응형: 단일 job 구독(추적 뷰어) */
export function useTrackedJob(jobId: string | null | undefined): TrackedJob | null {
  return useGenerationJobStore((s) => (jobId ? s.jobs[jobId] ?? null : null));
}
