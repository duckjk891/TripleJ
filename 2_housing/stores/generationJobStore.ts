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
// - kind는 확장 지점('artist'만 구현 — 차기 cover/video/inst 어댑터 후보).

export type TrackedJobKind = 'artist';
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
  /** startedAt+30분 경과 시 recoverable 1회 호출(서버 lazy 정리) 시각 */
  staleProbeAt?: number | null;
}

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

/** 반응형: 단일 job 구독(추적 뷰어) */
export function useTrackedJob(jobId: string | null | undefined): TrackedJob | null {
  return useGenerationJobStore((s) => (jobId ? s.jobs[jobId] ?? null : null));
}
