import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../api';
import { useAuth } from '../contexts/AuthContext';
import './PreCeremonyMVPanel.css';

/**
 * v17.3 — PreCeremonyMVPanel
 * 작품 디테일 페이지의 [식전영상] 탭. owner 또는 admin 만 렌더.
 *
 * Props
 *  mvJobId      : string  — 부모 mv_jobs._id
 *  ownerUserId  : string  — 작품 소유자
 *  mvJob        : object  — GenerationStatusPage 가 로드한 mv_job 전체 객체
 *                           (status / lyric_timestamps_status 게이팅용)
 *
 * 동작 (v17.3 범위)
 *  - mount 시 listPreMVJobs(mvJobId) → 가장 최근 잡 자동 로드.
 *  - 잡 없으면 [식전영상 만들기 시작] 버튼 노출. createPreMVJob 호출.
 *  - mv_job.status !== 'music_ready' 면 생성 자체 차단.
 *  - mv_job.lyric_timestamps_status !== 'ready' 면 차단(가사 타임스탬프 미준비).
 *  - 5 step card:
 *     Step 1  Phase 0 — 스토리⇄가사 매핑 (Claude / GPT 선택)
 *     Step 2  Phase 1 — 씬 분할
 *     Step 3  Phase 2 — 씬 이미지         (v17.2 활성: 모델 lock + 진행도 + 씬별 재생성)
 *     Step 4  Phase 3 — 씬 영상           (v17.3 활성: 모델 lock + 진행도 + 씬별 재생성)
 *     Step 5  Phase 4 — 최종 합치기       (v17.3 활성: 결과 영상 + 다운로드)
 *  - phase0_mapping / phase1_splitting / phase2_images / phase3_videos / phase4_compositing
 *    상태에서 5초 폴링(getPreMVJobStatus).
 *    light status 가 ready/failed/partial 로 전이되면 폴링 중단 + getPreMVJob 으로 전체 새로고침.
 *  - 단일 씬 regenerate 호출 시 백엔드가 잡 status 를 phase2/3_videos 로 일시 승격 → 같은 폴링 루프 자연 추종.
 *  - 씬 카드별 [편집] 토글 → patchPreMVScene. image_prompt 변경은 이미지+영상 모두 invalidate,
 *    video_prompt 만 변경은 영상만 invalidate(백엔드 처리).
 *  - 25개 초과 시 페이지당 12개 페이지네이션 적용.
 *
 * 로그 prefix:
 *  [PreCeremonyMVPanel] / [PreMVScenarioStep] / [PreMVScenesStep] / [PreMVImagesStep]
 *  [PreMVVideosStep] / [PreMVFinalStep] / [SceneCard]
 */

const PREFIX = '[PreCeremonyMVPanel]';
const STEP_SCEN_PREFIX = '[PreMVScenarioStep]';
const STEP_SCENES_PREFIX = '[PreMVScenesStep]';
const STEP_IMAGES_PREFIX = '[PreMVImagesStep]';
const STEP_VIDEOS_PREFIX = '[PreMVVideosStep]';
const STEP_FINAL_PREFIX = '[PreMVFinalStep]';
const SCENE_CARD_PREFIX = '[SceneCard]';

const POLL_INTERVAL_MS = 5000;
const SCENE_WARN_THRESHOLD = 50;
const PAGINATION_THRESHOLD = 25;
const SCENES_PER_PAGE = 12;

const SCENARIO_MODELS = [
  { value: 'claude_4_7_opus', label: 'Claude 4.7 Opus (기본)' },
  { value: 'gpt_latest', label: 'GPT 최신' },
];

const IMAGE_MODELS = [
  { value: 'gpt_image_2', label: 'GPT Image 2 (기본)' },
  { value: 'nb_pro', label: 'Gemini 3 Pro Image' },
];

const IMAGE_MODEL_LABEL = IMAGE_MODELS.reduce((acc, m) => {
  acc[m.value] = m.label;
  return acc;
}, {});

// v17.3 — Phase 3 video models (잡 단위 lock).
const VIDEO_MODELS = [
  { value: 'veo',      label: 'Veo 3.1 (기본)',       desc: '구글 — 8초 고정, 안정적·고품질' },
  { value: 'kling',    label: 'Kling 3.0 Omni',       desc: 'Kling — 3~15초, 다중 reference 지원' },
  { value: 'seedance', label: 'Seedance 2.0',         desc: 'fal.ai — 5~15초, 자연스러운 모션' },
  { value: 'grok',     label: 'Grok Imagine Video',   desc: 'xAI — 1~10초, 빠른 처리' },
];

const VIDEO_MODEL_LABEL = VIDEO_MODELS.reduce((acc, m) => {
  acc[m.value] = m.label;
  return acc;
}, {});

const SLOT_LABEL_KO = {
  meeting: '첫 만남',
  first_date: '첫 데이트',
  memories: '추억',
  proposal: '프로포즈',
  wedding_prep: '웨딩 준비',
  rituals: '의식·약속',
};

const STATUS_LABEL_KO = {
  draft: '시작 전',
  phase0_mapping: '매핑 중',
  phase0_ready: '매핑 완료',
  phase0_failed: '매핑 실패',
  phase1_splitting: '씬 분할 중',
  phase1_ready: '씬 분할 완료',
  phase1_failed: '씬 분할 실패',
  phase2_images: '씬 이미지 생성 중',
  phase2_ready: '씬 이미지 완료',
  phase2_partial: '씬 이미지 일부 실패',
  phase2_failed: '씬 이미지 실패',
  phase3_videos: '씬 영상 생성 중',
  phase3_ready: '씬 영상 완료',
  phase3_partial: '씬 영상 일부 실패',
  phase3_failed: '씬 영상 실패',
  phase4_compositing: '최종 합치는 중',
  phase4_failed: '최종 합치기 실패',
  completed: '완성',
};

// 폴링이 필요한 진행중 상태(서버 백그라운드 잡 돌고있음).
const RUNNING_STATUSES = new Set([
  'phase0_mapping',
  'phase1_splitting',
  'phase2_images',
  'phase3_videos',
  'phase4_compositing',
]);

// Phase 2 활성 상태 집합. Phase 1 완료 이상 + Phase 2 진행/실패/일부 실패 포함.
const PHASE2_ACTIVE_STATUSES = new Set([
  'phase1_ready',
  'phase2_images',
  'phase2_ready',
  'phase2_partial',
  'phase2_failed',
]);

// Phase 3 활성 상태 집합. Phase 2 완료 이상 + Phase 3 모든 단계.
const PHASE3_ACTIVE_STATUSES = new Set([
  'phase2_ready',
  'phase3_videos',
  'phase3_ready',
  'phase3_partial',
  'phase3_failed',
  // phase4 진입 후에도 step 4 카드의 영상 그리드는 계속 보여줘야 함.
  'phase4_compositing',
  'phase4_failed',
  'completed',
]);

// Phase 4 활성 상태 집합.
const PHASE4_ACTIVE_STATUSES = new Set([
  'phase3_ready',
  'phase4_compositing',
  'phase4_failed',
  'completed',
]);

// 모든 씬 카드의 영상 영역에서 비디오 src 사용 가능한 상태(=씬 video_status=completed)는
// scene 단위에서 판단. step 헤더의 게이팅은 위 상수로 결정.

// ──────────────────────────────────────────────────────────────────────────
// 권한 가드 외피
// ──────────────────────────────────────────────────────────────────────────

export default function PreCeremonyMVPanel({ mvJobId, ownerUserId, mvJob }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isOwner = user?.id === ownerUserId;
  const canUse = Boolean(user) && (isOwner || isAdmin);

  if (!canUse) {
    if (import.meta.env.DEV) {
      console.info(`${PREFIX} hidden — no permission`, {
        mvJobId,
        ownerUserId,
        userId: user?.id,
        role: user?.role,
      });
    }
    return null;
  }

  return (
    <PreCeremonyMVPanelInner
      mvJobId={mvJobId}
      ownerUserId={ownerUserId}
      mvJob={mvJob}
      isAdmin={isAdmin}
      isOwner={isOwner}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Inner — 권한 확정 후 본문
// ──────────────────────────────────────────────────────────────────────────

function PreCeremonyMVPanelInner({ mvJobId, ownerUserId, mvJob, isAdmin, isOwner }) {
  const [preMVJob, setPreMVJob] = useState(null);          // pre_mv_job 전체 (Phase 0/1 결과 포함)
  const [loading, setLoading] = useState(true);            // 초기 list 로딩
  const [listError, setListError] = useState('');
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState('');      // Phase 0/1 시작 시 발생한 에러
  // v19 — 식전영상 시작 전 variant(트랙) 선택. 기본 1.
  const [selectedVariant, setSelectedVariant] = useState(1);

  const pollTimerRef = useRef(null);
  const cancelledRef = useRef(false);

  // ──────────────────────────────────────────────────────────────────────
  // 게이팅: mv_job.status / lyric_timestamps_status
  // ──────────────────────────────────────────────────────────────────────
  const mvStatus = mvJob?.status || '';
  const tsStatus = mvJob?.lyric_timestamps_status || 'missing';
  const musicReady = mvStatus === 'music_ready';
  const timestampsReady = tsStatus === 'ready';

  // ──────────────────────────────────────────────────────────────────────
  // v19 — variant timestamps 준비 상태
  //   mv_job.lyric_timestamps_variants_count: { "1": N, "2": M }
  //   해당 키의 count > 0 이면 그 variant 로 식전영상 생성 가능.
  // ──────────────────────────────────────────────────────────────────────
  const variantsCountRaw = mvJob?.lyric_timestamps_variants_count;
  const variantsCount =
    variantsCountRaw && typeof variantsCountRaw === 'object' && !Array.isArray(variantsCountRaw)
      ? variantsCountRaw
      : {};
  const variant1Count = Number(variantsCount?.['1']) || 0;
  const variant2Count = Number(variantsCount?.['2']) || 0;
  const variant1Ready = variant1Count > 0;
  const variant2Ready = variant2Count > 0;
  const bothVariantsReady = variant1Ready && variant2Ready;
  const onlyOneVariantReady = (variant1Ready || variant2Ready) && !bothVariantsReady;
  const autoVariant = variant1Ready ? 1 : (variant2Ready ? 2 : null);

  // 한 variant 만 ready 인 경우 selectedVariant 를 그 값으로 자동 보정.
  useEffect(() => {
    if (onlyOneVariantReady && autoVariant && selectedVariant !== autoVariant) {
      if (import.meta.env.DEV) {
        console.info(`${PREFIX} variant auto-pick`, {
          mv_job_id: mvJobId,
          variant: autoVariant,
          variant1_count: variant1Count,
          variant2_count: variant2Count,
        });
      }
      setSelectedVariant(autoVariant);
    }
  }, [onlyOneVariantReady, autoVariant, selectedVariant, mvJobId, variant1Count, variant2Count]);

  // ──────────────────────────────────────────────────────────────────────
  // 잡 로드 (목록 → 첫번째)
  // ──────────────────────────────────────────────────────────────────────
  const loadJob = useCallback(async () => {
    if (!mvJobId) return;
    try {
      if (import.meta.env.DEV) {
        console.info(`${PREFIX} listPreMVJobs`, { mv_job_id: mvJobId });
      }
      const { data } = await api.listPreMVJobs(mvJobId);
      const items = Array.isArray(data?.items) ? data.items : [];
      if (items.length === 0) {
        if (!cancelledRef.current) {
          setPreMVJob(null);
          setListError('');
        }
        return;
      }
      const latest = items[0];
      const preId = latest?.pre_mv_job_id;
      if (!preId) {
        if (!cancelledRef.current) {
          setPreMVJob(null);
        }
        return;
      }
      try {
        const { data: full } = await api.getPreMVJob(preId);
        if (cancelledRef.current) return;
        setPreMVJob(full);
        setListError('');
        if (import.meta.env.DEV) {
          console.info(`${PREFIX} job loaded`, {
            pre_mv_job_id: preId,
            status: full?.status,
            scene_plan_count: Array.isArray(full?.scene_plan) ? full.scene_plan.length : 0,
            scenes_count: Array.isArray(full?.scenes) ? full.scenes.length : 0,
          });
        }
      } catch (err) {
        console.error(`${PREFIX} getPreMVJob failed`, {
          pre_mv_job_id: preId,
          status: err?.response?.status,
          detail: err?.response?.data,
        });
        if (!cancelledRef.current) {
          setListError(err?.response?.data?.error
            || err?.response?.data?.detail
            || '식전영상 잡을 불러오지 못했어요.');
        }
      }
    } catch (err) {
      console.error(`${PREFIX} listPreMVJobs failed`, {
        mv_job_id: mvJobId,
        status: err?.response?.status,
        detail: err?.response?.data,
      });
      if (!cancelledRef.current) {
        setListError(err?.response?.data?.error
          || err?.response?.data?.detail
          || '식전영상 잡 목록을 불러오지 못했어요.');
      }
    }
  }, [mvJobId]);

  // ──────────────────────────────────────────────────────────────────────
  // mount: 잡 로드. 폴링은 별도 useEffect.
  // ──────────────────────────────────────────────────────────────────────
  useEffect(() => {
    cancelledRef.current = false;
    setLoading(true);
    loadJob().finally(() => {
      if (!cancelledRef.current) setLoading(false);
    });
    return () => {
      cancelledRef.current = true;
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
    // loadJob 은 mvJobId 의존이라 사실상 mvJobId 변경 시에만 재실행
  }, [loadJob]);

  // ──────────────────────────────────────────────────────────────────────
  // 폴링: 진행중 상태일 때만 5초 간격으로 status 만 가져옴.
  //  ready/failed 로 바뀌면 전체 doc 재로드 후 폴링 종료.
  // ──────────────────────────────────────────────────────────────────────
  const currentStatus = preMVJob?.status || '';
  const isRunning = RUNNING_STATUSES.has(currentStatus);
  const preMVJobId = preMVJob?.pre_mv_job_id || null;

  useEffect(() => {
    if (!isRunning || !preMVJobId) {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return undefined;
    }

    if (import.meta.env.DEV) {
      console.info(`${PREFIX} polling start`, {
        pre_mv_job_id: preMVJobId,
        status: currentStatus,
      });
    }

    const tick = async () => {
      try {
        const { data } = await api.getPreMVJobStatus(preMVJobId);
        const nextStatus = data?.status;
        if (cancelledRef.current) return;
        if (!RUNNING_STATUSES.has(nextStatus)) {
          if (import.meta.env.DEV) {
            console.info(`${PREFIX} polling transition`, {
              pre_mv_job_id: preMVJobId,
              from: currentStatus,
              to: nextStatus,
            });
          }
          // 전이 — 전체 doc 새로고침
          await loadJob();
        } else {
          // 같은 상태 유지 — progress 정도만 반영
          setPreMVJob((prev) => prev ? { ...prev, status: nextStatus, progress: data?.progress ?? prev.progress } : prev);
        }
      } catch (err) {
        console.error(`${PREFIX} polling failed`, {
          pre_mv_job_id: preMVJobId,
          status: err?.response?.status,
          detail: err?.response?.data,
        });
      }
    };

    pollTimerRef.current = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [isRunning, preMVJobId, currentStatus, loadJob]);

  // ──────────────────────────────────────────────────────────────────────
  // [식전영상 만들기 시작] 핸들러
  // ──────────────────────────────────────────────────────────────────────
  const onCreate = useCallback(async () => {
    if (!musicReady) {
      setCreateError('먼저 음악을 완성해 주세요.');
      return;
    }
    if (!timestampsReady) {
      setCreateError('가사 타임스탬프가 준비되지 않았어요. 음악을 다시 생성하거나 잠시 후 다시 시도해 주세요.');
      return;
    }
    setCreating(true);
    setCreateError('');
    if (import.meta.env.DEV) {
      console.info(`${PREFIX} start clicked variant=${selectedVariant}`, {
        mv_job_id: mvJobId,
        variant: selectedVariant,
      });
    }
    try {
      const { data } = await api.createPreMVJob(mvJobId, { variant: selectedVariant });
      if (cancelledRef.current) return;
      setPreMVJob(data);
      if (import.meta.env.DEV) {
        console.info(`${PREFIX} createPreMVJob ok`, {
          pre_mv_job_id: data?.pre_mv_job_id,
          status: data?.status,
          audio_variant: data?.audio_variant,
        });
      }
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data;
      // error 는 prod 도 남김.
      console.error(`${PREFIX} create failed status=${status} detail=`, detail);
      let msg = detail?.error || detail?.detail || '식전영상 잡 생성에 실패했어요.';
      if (status === 422) {
        msg = detail?.error || detail?.detail || '가사 타임스탬프가 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요.';
      } else if (status === 409) {
        // v19 — 이미 다른 variant 로 pre_mv_job 진행중이면 백엔드가 한국어 detail 을 내려줌.
        msg = detail?.error || detail?.detail || '음악 생성이 완료된 작품에서만 식전영상을 시작할 수 있어요.';
      } else if (status === 403) {
        msg = '권한이 없어요.';
      }
      setCreateError(msg);
    } finally {
      if (!cancelledRef.current) setCreating(false);
    }
  }, [mvJobId, musicReady, timestampsReady, selectedVariant]);

  // ──────────────────────────────────────────────────────────────────────
  // Phase 0/1 시작 핸들러
  // ──────────────────────────────────────────────────────────────────────
  const startPhase0 = useCallback(async (scenarioModel, force = false) => {
    if (!preMVJobId) return;
    setActionError('');
    if (import.meta.env.DEV) {
      console.info(`${STEP_SCEN_PREFIX} startPhase0`, {
        pre_mv_job_id: preMVJobId,
        scenario_model: scenarioModel,
        force,
      });
    }
    try {
      const { data } = await api.runPreMVPhase0(preMVJobId, {
        scenario_model: scenarioModel,
        force,
      });
      if (cancelledRef.current) return;
      // 백엔드가 즉시 phase0_mapping 으로 응답 → state 반영해 폴링 시작
      setPreMVJob((prev) => prev ? {
        ...prev,
        status: data?.status || 'phase0_mapping',
        scenario_model: scenarioModel,
        phase0_error: null,
      } : prev);
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data;
      console.error(`${STEP_SCEN_PREFIX} startPhase0 failed`, {
        pre_mv_job_id: preMVJobId,
        status,
        detail,
      });
      let msg = detail?.error || detail?.detail || 'Phase 0 시작에 실패했어요.';
      if (status === 422 && /force/i.test(JSON.stringify(detail || ''))) {
        msg = '기존 씬이 모두 사라져요. 다시 매핑하려면 [다시 매핑] 버튼을 눌러주세요.';
      }
      setActionError(msg);
    }
  }, [preMVJobId]);

  const startPhase1 = useCallback(async (force = false) => {
    if (!preMVJobId) return;
    setActionError('');
    if (import.meta.env.DEV) {
      console.info(`${STEP_SCENES_PREFIX} startPhase1`, {
        pre_mv_job_id: preMVJobId,
        force,
      });
    }
    try {
      const { data } = await api.runPreMVPhase1(preMVJobId, { force });
      if (cancelledRef.current) return;
      setPreMVJob((prev) => prev ? {
        ...prev,
        status: data?.status || 'phase1_splitting',
        phase1_error: null,
      } : prev);
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data;
      console.error(`${STEP_SCENES_PREFIX} startPhase1 failed`, {
        pre_mv_job_id: preMVJobId,
        status,
        detail,
      });
      let msg = detail?.error || detail?.detail || 'Phase 1 시작에 실패했어요.';
      if (status === 409) {
        msg = detail?.error || '현재 상태에서는 씬 분할을 시작할 수 없어요.';
      }
      setActionError(msg);
    }
  }, [preMVJobId]);

  // ──────────────────────────────────────────────────────────────────────
  // Phase 2 시작 (씬 이미지)
  // ──────────────────────────────────────────────────────────────────────
  const startPhase2 = useCallback(async (imageModel, force = false) => {
    if (!preMVJobId) return;
    setActionError('');
    if (import.meta.env.DEV) {
      console.info(`${STEP_IMAGES_PREFIX} startPhase2`, {
        pre_mv_job_id: preMVJobId,
        image_model: imageModel,
        force,
      });
    }
    try {
      const { data } = await api.runPreMVPhase2(preMVJobId, {
        image_model: imageModel,
        force,
      });
      if (cancelledRef.current) return;
      const queued = Array.isArray(data?.queued_scene_numbers)
        ? data.queued_scene_numbers
        : [];
      if (import.meta.env.DEV) {
        console.info(`${STEP_IMAGES_PREFIX} startPhase2 ok`, {
          pre_mv_job_id: preMVJobId,
          status: data?.status,
          image_model: data?.image_model || imageModel,
          queued_count: queued.length,
        });
      }
      // status / image_model 즉시 반영 → 폴링 시작
      setPreMVJob((prev) => prev ? {
        ...prev,
        status: data?.status || 'phase2_images',
        image_model: data?.image_model || imageModel,
        phase2_error: null,
        // 큐잉된 씬은 generating 으로 옵티미스틱 갱신
        scenes: Array.isArray(prev.scenes)
          ? prev.scenes.map((s) =>
              queued.includes(s.scene_number)
                ? { ...s, image_status: 'generating', image_error: null }
                : s,
            )
          : prev.scenes,
      } : prev);
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data;
      console.error(`${STEP_IMAGES_PREFIX} startPhase2 failed`, {
        pre_mv_job_id: preMVJobId,
        image_model: imageModel,
        force,
        status,
        detail,
      });
      let msg = detail?.error || detail?.detail || 'Phase 2 시작에 실패했어요.';
      if (status === 409) {
        msg = detail?.error || '현재 상태에서는 이미지 생성을 시작할 수 없어요.';
      } else if (status === 503) {
        msg = detail?.error || '선택한 이미지 모델의 API 키가 준비되지 않았어요.';
      }
      setActionError(msg);
    }
  }, [preMVJobId]);

  // ──────────────────────────────────────────────────────────────────────
  // Phase 3 시작 (씬 영상) — video_model lock
  // ──────────────────────────────────────────────────────────────────────
  const startPhase3 = useCallback(async (videoModel, force = false) => {
    if (!preMVJobId) return;
    setActionError('');
    if (import.meta.env.DEV) {
      console.info(`${STEP_VIDEOS_PREFIX} startPhase3`, {
        pre_mv_job_id: preMVJobId,
        video_model: videoModel,
        force,
      });
    }
    try {
      const { data } = await api.runPreMVPhase3(preMVJobId, {
        video_model: videoModel,
        force,
      });
      if (cancelledRef.current) return;
      const queued = Array.isArray(data?.queued_scene_numbers)
        ? data.queued_scene_numbers
        : [];
      if (import.meta.env.DEV) {
        console.info(`${STEP_VIDEOS_PREFIX} startPhase3 ok`, {
          pre_mv_job_id: preMVJobId,
          status: data?.status,
          video_model: data?.video_model || videoModel,
          queued_count: queued.length,
        });
      }
      setPreMVJob((prev) => prev ? {
        ...prev,
        status: data?.status || 'phase3_videos',
        video_model: data?.video_model || videoModel,
        phase3_error: null,
        scenes: Array.isArray(prev.scenes)
          ? prev.scenes.map((s) =>
              queued.includes(s.scene_number)
                ? { ...s, video_status: 'generating', video_error: null }
                : s,
            )
          : prev.scenes,
      } : prev);
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data;
      console.error(`${STEP_VIDEOS_PREFIX} startPhase3 failed`, {
        pre_mv_job_id: preMVJobId,
        video_model: videoModel,
        force,
        status,
        detail,
      });
      let msg = detail?.error || detail?.detail || 'Phase 3 시작에 실패했어요.';
      if (status === 409) {
        msg = detail?.error || '현재 상태에서는 영상 생성을 시작할 수 없어요.';
      } else if (status === 422) {
        msg = detail?.error || '씬 이미지가 먼저 모두 완료돼야 해요.';
      } else if (status === 503) {
        msg = detail?.error || '선택한 영상 모델의 API 키가 준비되지 않았어요. 운영자에게 문의해 주세요.';
      }
      setActionError(msg);
    }
  }, [preMVJobId]);

  // ──────────────────────────────────────────────────────────────────────
  // 단일 씬 영상 재생성 (잡 video_model 사용)
  // ──────────────────────────────────────────────────────────────────────
  const regenerateSceneVideo = useCallback(async (sceneNumber) => {
    if (!preMVJobId) return { ok: false, error: '잡 식별자 없음' };
    if (import.meta.env.DEV) {
      console.info(`${STEP_VIDEOS_PREFIX} regenerateSceneVideo`, {
        pre_mv_job_id: preMVJobId,
        scene_number: sceneNumber,
      });
    }
    try {
      const { data } = await api.regeneratePreMVSceneVideo(preMVJobId, sceneNumber);
      if (cancelledRef.current) return { ok: true, data };
      setPreMVJob((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        next.status = 'phase3_videos';
        next.scenes = Array.isArray(prev.scenes)
          ? prev.scenes.map((s) =>
              s.scene_number === sceneNumber
                ? { ...s, video_status: 'generating', video_error: null }
                : s,
            )
          : prev.scenes;
        return next;
      });
      return { ok: true, data };
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data;
      console.error(`${STEP_VIDEOS_PREFIX} regenerateSceneVideo failed`, {
        pre_mv_job_id: preMVJobId,
        scene_number: sceneNumber,
        status,
        detail,
      });
      let msg = detail?.error || detail?.detail || '씬 영상 재생성에 실패했어요.';
      if (status === 503) {
        msg = detail?.error || '영상 모델 API 키가 준비되지 않았어요. 운영자에게 문의해 주세요.';
      }
      return { ok: false, error: msg };
    }
  }, [preMVJobId]);

  // ──────────────────────────────────────────────────────────────────────
  // Phase 4 시작 (최종 합치기)
  // ──────────────────────────────────────────────────────────────────────
  const startPhase4 = useCallback(async (force = false) => {
    if (!preMVJobId) return;
    setActionError('');
    if (import.meta.env.DEV) {
      console.info(`${STEP_FINAL_PREFIX} startPhase4`, {
        pre_mv_job_id: preMVJobId,
        force,
      });
    }
    try {
      const { data } = await api.runPreMVPhase4(preMVJobId, { force });
      if (cancelledRef.current) return;
      setPreMVJob((prev) => prev ? {
        ...prev,
        status: data?.status || 'phase4_compositing',
        phase4_error: null,
      } : prev);
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data;
      console.error(`${STEP_FINAL_PREFIX} startPhase4 failed`, {
        pre_mv_job_id: preMVJobId,
        force,
        status,
        detail,
      });
      let msg = detail?.error || detail?.detail || '최종 합치기 시작에 실패했어요.';
      if (status === 409) {
        msg = detail?.error || '현재 상태에서는 최종 합치기를 시작할 수 없어요.';
      } else if (status === 422) {
        msg = detail?.error || '씬 영상이 먼저 모두 완료돼야 해요.';
      } else if (status === 503) {
        msg = detail?.error || 'ffmpeg 가 서버에 설치되어 있지 않아요. 운영자에게 문의해 주세요.';
      }
      setActionError(msg);
    }
  }, [preMVJobId]);

  // ──────────────────────────────────────────────────────────────────────
  // 단일 씬 이미지 재생성
  // ──────────────────────────────────────────────────────────────────────
  const regenerateSceneImage = useCallback(async (sceneNumber) => {
    if (!preMVJobId) return { ok: false, error: '잡 식별자 없음' };
    if (import.meta.env.DEV) {
      console.info(`${STEP_IMAGES_PREFIX} regenerateSceneImage`, {
        pre_mv_job_id: preMVJobId,
        scene_number: sceneNumber,
      });
    }
    try {
      const { data } = await api.regeneratePreMVSceneImage(preMVJobId, sceneNumber);
      if (cancelledRef.current) return { ok: true, data };
      // 옵티미스틱: 해당 씬 image_status=generating, 잡 status 도 일시 승격
      setPreMVJob((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        next.status = 'phase2_images';
        next.scenes = Array.isArray(prev.scenes)
          ? prev.scenes.map((s) =>
              s.scene_number === sceneNumber
                ? { ...s, image_status: 'generating', image_error: null }
                : s,
            )
          : prev.scenes;
        return next;
      });
      return { ok: true, data };
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data;
      console.error(`${STEP_IMAGES_PREFIX} regenerateSceneImage failed`, {
        pre_mv_job_id: preMVJobId,
        scene_number: sceneNumber,
        status,
        detail,
      });
      const msg = detail?.error || detail?.detail || '씬 재생성에 실패했어요.';
      return { ok: false, error: msg };
    }
  }, [preMVJobId]);

  // ──────────────────────────────────────────────────────────────────────
  // 씬 patch 핸들러 (낙관적 적용 → 실패 시 새로고침)
  // ──────────────────────────────────────────────────────────────────────
  const patchScene = useCallback(async (sceneNumber, payload) => {
    if (!preMVJobId) return { ok: false, error: '잡 식별자 없음' };
    if (import.meta.env.DEV) {
      console.info(`${STEP_SCENES_PREFIX} patchScene`, {
        pre_mv_job_id: preMVJobId,
        scene_number: sceneNumber,
        keys: Object.keys(payload || {}),
      });
    }
    try {
      const { data } = await api.patchPreMVScene(preMVJobId, sceneNumber, payload);
      // 백엔드가 updated scene 을 반환 — 새로고침
      await loadJob();
      return { ok: true, data };
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data;
      console.error(`${STEP_SCENES_PREFIX} patchScene failed`, {
        pre_mv_job_id: preMVJobId,
        scene_number: sceneNumber,
        status,
        detail,
      });
      const msg = detail?.error || detail?.detail || '씬 편집에 실패했어요.';
      return { ok: false, error: msg };
    }
  }, [preMVJobId, loadJob]);

  // ──────────────────────────────────────────────────────────────────────
  // 렌더
  // ──────────────────────────────────────────────────────────────────────
  const hasJob = !!preMVJob;
  const status = preMVJob?.status || 'draft';
  const scenePlan = Array.isArray(preMVJob?.scene_plan) ? preMVJob.scene_plan : [];
  const scenes = Array.isArray(preMVJob?.scenes) ? preMVJob.scenes : [];

  // 한 번 phaseN 이상으로 진행됐으면 phaseN-1 은 done — UI 게이팅용.
  const phase0Done = [
    'phase0_ready', 'phase1_splitting', 'phase1_ready', 'phase1_failed',
    'phase2_images', 'phase2_ready', 'phase2_partial', 'phase2_failed',
    'phase3_videos', 'phase3_ready', 'phase3_partial', 'phase3_failed',
    'phase4_compositing', 'phase4_failed', 'completed',
  ].includes(status);
  const phase1Done = [
    'phase1_ready',
    'phase2_images', 'phase2_ready', 'phase2_partial', 'phase2_failed',
    'phase3_videos', 'phase3_ready', 'phase3_partial', 'phase3_failed',
    'phase4_compositing', 'phase4_failed', 'completed',
  ].includes(status);
  const phase2Done = [
    'phase2_ready',
    'phase3_videos', 'phase3_ready', 'phase3_partial', 'phase3_failed',
    'phase4_compositing', 'phase4_failed', 'completed',
  ].includes(status);
  const phase3Done = [
    'phase3_ready',
    'phase4_compositing', 'phase4_failed', 'completed',
  ].includes(status);

  // Phase 2 가 partial(일부 실패) 일 때 — Phase 3 시작 가드용.
  const phase2Partial = status === 'phase2_partial';
  // Phase 3 가 partial(일부 실패) 일 때 — Phase 4 시작 가드용.
  const phase3Partial = status === 'phase3_partial';

  return (
    <section className="pre-mv">
      <div className="pre-mv__head">
        <h2 className="pre-mv__title">식전영상 만들기</h2>
        <p className="pre-mv__desc">
          가사 라인별로 짧은 영상을 만들어 음악과 합쳐드려요. 단계마다 결과를 확인한 뒤 다음으로 넘어가세요.
        </p>
        {isAdmin && !isOwner && (
          <p className="pre-mv__admin-banner">관리자 권한으로 작업 중입니다.</p>
        )}
      </div>

      {/* 게이팅: 음악/타임스탬프 미준비 안내 */}
      {!musicReady && (
        <div className="pre-mv__cta">
          <p className="pre-mv__cta-msg">먼저 음악을 완성해 주세요.</p>
        </div>
      )}
      {musicReady && !timestampsReady && (
        <div className="pre-mv__cta">
          <p className="pre-mv__cta-msg">
            가사 타임스탬프가 준비되지 않았어요. 음악을 다시 생성하거나 잠시 후 다시 시도해 주세요.
          </p>
        </div>
      )}

      {/* 로딩 / 잡 없음 */}
      {loading && <div className="pre-mv__loading">불러오는 중...</div>}
      {!loading && listError && (
        <div className="pre-mv__error-banner">{listError}</div>
      )}

      {!loading && !hasJob && musicReady && timestampsReady && (
        <div className="pre-mv__cta">
          <p className="pre-mv__cta-msg">아직 식전영상 잡이 없어요. 시작해 볼까요?</p>

          {/* v19 — variant 선택. 두 트랙 모두 ready 면 라디오, 한 쪽만 ready 면 안내. */}
          {bothVariantsReady && (
            <div className="pre-mv__variant-pick">
              <span>어느 트랙으로 만들어요?</span>
              <label className="radio-card">
                <input
                  type="radio"
                  name="pre-mv-variant"
                  value={1}
                  checked={selectedVariant === 1}
                  onChange={() => {
                    if (import.meta.env.DEV) {
                      console.info(`${PREFIX} variant pick`, { variant: 1 });
                    }
                    setSelectedVariant(1);
                  }}
                />
                <span>트랙 1번 <small>({variant1Count} 라인)</small></span>
              </label>
              <label className="radio-card">
                <input
                  type="radio"
                  name="pre-mv-variant"
                  value={2}
                  checked={selectedVariant === 2}
                  onChange={() => {
                    if (import.meta.env.DEV) {
                      console.info(`${PREFIX} variant pick`, { variant: 2 });
                    }
                    setSelectedVariant(2);
                  }}
                />
                <span>트랙 2번 <small>({variant2Count} 라인)</small></span>
              </label>
            </div>
          )}
          {onlyOneVariantReady && autoVariant && (
            <p className="pre-mv__variant-hint">
              트랙 {autoVariant}번만 가사 타임스탬프가 준비됐어요. 이 트랙으로 만들어요.
            </p>
          )}

          <div className="pre-mv-step__actions">
            <button
              type="button"
              className="btn-primary pre-mv-step__btn"
              onClick={onCreate}
              disabled={creating}
            >
              {creating
                ? '시작하는 중...'
                : (bothVariantsReady ? '선택한 트랙으로 시작' : '식전영상 만들기 시작')}
            </button>
          </div>
          {createError && <div className="pre-mv-step__error">{createError}</div>}
        </div>
      )}

      {/* 본문: 잡이 있을 때 5단계 카드 */}
      {!loading && hasJob && (
        <>
          <div className="pre-mv__job-meta">
            <span>식전영상 잡 <strong>{preMVJob.pre_mv_job_id}</strong></span>
            <span>상태 <strong>{STATUS_LABEL_KO[status] || status}</strong></span>
            {/* v19 — 시작 시 선택된 트랙 표시 (이미 시작된 잡은 변경 불가) */}
            {(preMVJob?.audio_variant === 1 || preMVJob?.audio_variant === 2) && (
              <span className="pre-mv__variant-badge" title="식전영상이 만들어지고 있는 트랙">
                🎵 트랙 {preMVJob.audio_variant}번
              </span>
            )}
          </div>

          {actionError && <div className="pre-mv-step__error">{actionError}</div>}

          <PreMVScenarioStep
            preMVJob={preMVJob}
            status={status}
            scenePlan={scenePlan}
            onStart={startPhase0}
            disabled={false}
          />

          <PreMVScenesStep
            preMVJob={preMVJob}
            status={status}
            scenes={scenes}
            phase0Done={phase0Done}
            onStart={startPhase1}
            onPatchScene={patchScene}
            onRegenerateSceneImage={regenerateSceneImage}
            onRegenerateSceneVideo={regenerateSceneVideo}
            preMVJobId={preMVJobId}
          />

          <PreMVImagesStep
            preMVJob={preMVJob}
            status={status}
            scenes={scenes}
            phase1Done={phase1Done}
            onStart={startPhase2}
          />

          <PreMVVideosStep
            preMVJob={preMVJob}
            status={status}
            scenes={scenes}
            phase2Done={phase2Done}
            phase2Partial={phase2Partial}
            onStart={startPhase3}
          />

          <PreMVFinalStep
            preMVJob={preMVJob}
            status={status}
            scenes={scenes}
            phase3Done={phase3Done}
            phase3Partial={phase3Partial}
            preMVJobId={preMVJobId}
            onStart={startPhase4}
          />
        </>
      )}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Step 1 — Phase 0 (스토리⇄가사 매핑)
// ──────────────────────────────────────────────────────────────────────────

function PreMVScenarioStep({ preMVJob, status, scenePlan, onStart, disabled }) {
  const [selectedModel, setSelectedModel] = useState(
    preMVJob?.scenario_model || 'claude_4_7_opus'
  );
  const [busy, setBusy] = useState(false);

  // preMVJob.scenario_model 이 외부에서 바뀌면 동기화
  useEffect(() => {
    if (preMVJob?.scenario_model) {
      setSelectedModel(preMVJob.scenario_model);
    }
  }, [preMVJob?.scenario_model]);

  const isRunning = status === 'phase0_mapping';
  const isReady = ['phase0_ready', 'phase1_splitting', 'phase1_ready', 'phase1_failed'].includes(status);
  const isFailed = status === 'phase0_failed';

  const badge = (() => {
    if (isRunning) return { cls: 'is-running', text: '진행 중' };
    if (isReady) return { cls: 'is-ready', text: '완료' };
    if (isFailed) return { cls: 'is-failed', text: '실패' };
    return { cls: '', text: '대기' };
  })();

  const onClickStart = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onStart(selectedModel, false);
    } finally {
      setBusy(false);
    }
  };

  const onClickRerun = async () => {
    if (busy) return;
    const ok = window.confirm(
      '기존 씬이 모두 사라져요. 계속할까요?'
    );
    if (!ok) return;
    setBusy(true);
    try {
      await onStart(selectedModel, true);
    } finally {
      setBusy(false);
    }
  };

  const canStart = (status === 'draft' || status === 'phase0_failed') && !isRunning && !disabled;
  const canRerun = isReady && !isRunning && !disabled;

  return (
    <div className={`pre-mv-step ${disabled ? 'is-disabled' : ''}`}>
      <div className="pre-mv-step__head">
        <h3 className="pre-mv-step__title">Step 1. 스토리⇄가사 매핑 (Phase 0)</h3>
        <span className={`pre-mv-step__badge ${badge.cls}`}>{badge.text}</span>
      </div>
      <p className="pre-mv-step__desc">
        AI 가 가사 한 줄 한 줄을 두 분 스토리의 어느 시점에 해당하는지 매핑합니다.
      </p>

      <div className="pre-mv-step__row">
        <span className="pre-mv-step__row-label">모델</span>
        {SCENARIO_MODELS.map((m) => (
          <label key={m.value} className="pre-mv-step__radio">
            <input
              type="radio"
              name="pre-mv-scenario-model"
              value={m.value}
              checked={selectedModel === m.value}
              onChange={() => setSelectedModel(m.value)}
              disabled={isRunning || busy}
            />
            {m.label}
          </label>
        ))}
      </div>

      <div className="pre-mv-step__actions">
        {canStart && (
          <button
            type="button"
            className="btn-primary pre-mv-step__btn"
            onClick={onClickStart}
            disabled={busy || isRunning}
          >
            {busy ? '시작하는 중...' : '매핑 시작'}
          </button>
        )}
        {canRerun && (
          <button
            type="button"
            className="btn-ghost pre-mv-step__btn"
            onClick={onClickRerun}
            disabled={busy || isRunning}
          >
            다시 매핑
          </button>
        )}
        {isRunning && (
          <span className="pre-mv-step__hint">AI 가 가사와 스토리를 연결하는 중이에요. 30초~1분 정도 걸려요.</span>
        )}
      </div>

      {preMVJob?.phase0_error && (
        <div className="pre-mv-step__error">{preMVJob.phase0_error}</div>
      )}

      {isReady && scenePlan.length > 0 && (
        <div className="pre-mv-plan" role="list" aria-label="가사-스토리 매핑 결과">
          {scenePlan.map((item, idx) => (
            <div className="pre-mv-plan__line" key={idx} role="listitem">
              <span className="pre-mv-plan__idx">#{idx + 1}</span>
              <span className="pre-mv-plan__slot">
                {SLOT_LABEL_KO[item?.story_slot] || item?.story_slot || '?'}
              </span>
              <div>
                <div className="pre-mv-plan__lyric">{item?.lyric_line || '(가사 라인 없음)'}</div>
                {item?.story_excerpt && (
                  <div className="pre-mv-plan__excerpt">{item.story_excerpt}</div>
                )}
                {Array.isArray(item?.refs) && item.refs.length > 0 && (
                  <div className="pre-mv-plan__refs">
                    {item.refs.map((r, i) => (
                      <span key={i} className="pre-mv-plan__refchip">
                        @{r?.display_name || r?.asset_id || '?'}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Step 2 — Phase 1 (씬 분할)
// ──────────────────────────────────────────────────────────────────────────

function PreMVScenesStep({
  preMVJob,
  status,
  scenes,
  phase0Done,
  onStart,
  onPatchScene,
  onRegenerateSceneImage,
  onRegenerateSceneVideo,
  preMVJobId,
}) {
  const [busy, setBusy] = useState(false);
  const isRunning = status === 'phase1_splitting';
  // Phase 1 이 완료된 모든 상태(phase2_* 포함)에서 씬 카드 자체는 노출.
  const isReady = ['phase1_ready', 'phase2_images', 'phase2_ready',
    'phase2_partial', 'phase2_failed'].includes(status);
  const isFailed = status === 'phase1_failed';

  const badge = (() => {
    if (isRunning) return { cls: 'is-running', text: '진행 중' };
    if (isReady) return { cls: 'is-ready', text: '완료' };
    if (isFailed) return { cls: 'is-failed', text: '실패' };
    if (!phase0Done) return { cls: '', text: '대기' };
    return { cls: '', text: '준비' };
  })();

  const onClickStart = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onStart(false);
    } finally {
      setBusy(false);
    }
  };

  const onClickRerun = async () => {
    if (busy) return;
    const ok = window.confirm(
      '기존 씬 분할을 다시 만들어요. 편집된 씬 내용도 모두 초기화돼요. 계속할까요?'
    );
    if (!ok) return;
    setBusy(true);
    try {
      await onStart(true);
    } finally {
      setBusy(false);
    }
  };

  const canStart = phase0Done && (status === 'phase0_ready' || status === 'phase1_failed') && !isRunning;
  // 한 번 phase1_ready 가 되면 [다시 씬 분할] 가능. phase2 진행/완료 후엔 위험하므로 phase1_ready 일 때만.
  const canRerun = status === 'phase1_ready' && !isRunning;
  const disabled = !phase0Done;

  return (
    <div className={`pre-mv-step ${disabled ? 'is-disabled' : ''}`}>
      <div className="pre-mv-step__head">
        <h3 className="pre-mv-step__title">Step 2. 씬 분할 (Phase 1)</h3>
        <span className={`pre-mv-step__badge ${badge.cls}`}>{badge.text}</span>
      </div>
      <p className="pre-mv-step__desc">
        가사 한 줄을 영상 한 씬으로 분리하고, 각 씬의 묘사·카메라 워크 프롬프트를 만들어요.
      </p>

      <div className="pre-mv-step__actions">
        {canStart && (
          <button
            type="button"
            className="btn-primary pre-mv-step__btn"
            onClick={onClickStart}
            disabled={busy || isRunning}
          >
            {busy ? '시작하는 중...' : '씬 분할 시작'}
          </button>
        )}
        {canRerun && (
          <button
            type="button"
            className="btn-ghost pre-mv-step__btn"
            onClick={onClickRerun}
            disabled={busy || isRunning}
          >
            다시 씬 분할
          </button>
        )}
        {!phase0Done && (
          <span className="pre-mv-step__hint">먼저 Step 1 매핑을 완료해 주세요.</span>
        )}
        {isRunning && (
          <span className="pre-mv-step__hint">씬을 만들고 프롬프트를 작성하는 중이에요. 1~2분 정도 걸려요.</span>
        )}
      </div>

      {preMVJob?.phase1_error && (
        <div className="pre-mv-step__error">{preMVJob.phase1_error}</div>
      )}

      {scenes.length > SCENE_WARN_THRESHOLD && (
        <div className="pre-mv-scenes__warn">
          씬이 {scenes.length} 개로 많아요. 다음 버전에서 페이지네이션이 적용될 예정이에요.
        </div>
      )}

      {isReady && scenes.length > 0 && (
        <SceneList
          scenes={scenes}
          onPatchScene={onPatchScene}
          onRegenerateSceneImage={onRegenerateSceneImage}
          onRegenerateSceneVideo={onRegenerateSceneVideo}
          preMVJobId={preMVJobId}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// SceneList + SceneCard (편집 토글 + 이미지 영역 + 영상 영역 + 재생성)
// 25개 초과 시 SCENES_PER_PAGE(12) 단위 클라이언트 페이지네이션.
// ──────────────────────────────────────────────────────────────────────────

function SceneList({
  scenes,
  onPatchScene,
  onRegenerateSceneImage,
  onRegenerateSceneVideo,
  preMVJobId,
}) {
  const [page, setPage] = useState(1);
  const paginated = scenes.length > PAGINATION_THRESHOLD;
  const totalPages = paginated ? Math.ceil(scenes.length / SCENES_PER_PAGE) : 1;

  // scenes 길이 변경(예: phase1 재분할)으로 현재 페이지가 범위 밖이면 1로 리셋
  useEffect(() => {
    if (page > totalPages) {
      if (import.meta.env.DEV) {
        console.info(`${STEP_SCENES_PREFIX} page reset`, {
          page,
          totalPages,
          scenes_count: scenes.length,
        });
      }
      setPage(1);
    }
  }, [page, totalPages, scenes.length]);

  const pageStart = (page - 1) * SCENES_PER_PAGE;
  const pageScenes = paginated
    ? scenes.slice(pageStart, pageStart + SCENES_PER_PAGE)
    : scenes;

  const goPrev = () => {
    if (page <= 1) return;
    setPage((p) => Math.max(1, p - 1));
  };
  const goNext = () => {
    if (page >= totalPages) return;
    setPage((p) => Math.min(totalPages, p + 1));
  };

  return (
    <>
      <div className="pre-mv-scenes">
        {pageScenes.map((scene) => (
          <SceneCard
            key={scene.scene_number}
            scene={scene}
            onPatchScene={onPatchScene}
            onRegenerateSceneImage={onRegenerateSceneImage}
            onRegenerateSceneVideo={onRegenerateSceneVideo}
            preMVJobId={preMVJobId}
          />
        ))}
      </div>
      {paginated && (
        <div className="pre-mv-scenes__pager">
          <button
            type="button"
            className="btn-ghost pre-mv-step__btn"
            onClick={goPrev}
            disabled={page <= 1}
          >
            이전
          </button>
          <span className="pre-mv-scenes__pager-label">
            {page} / {totalPages} 페이지
            <span className="pre-mv-scenes__pager-meta">
              (씬 {pageStart + 1}–{Math.min(pageStart + SCENES_PER_PAGE, scenes.length)} / {scenes.length})
            </span>
          </span>
          <button
            type="button"
            className="btn-ghost pre-mv-step__btn"
            onClick={goNext}
            disabled={page >= totalPages}
          >
            다음
          </button>
        </div>
      )}
    </>
  );
}

function SceneCard({
  scene,
  onPatchScene,
  onRegenerateSceneImage,
  onRegenerateSceneVideo,
  preMVJobId,
}) {
  const [editing, setEditing] = useState(false);
  const [descKo, setDescKo] = useState(scene.description_ko || '');
  const [imgPrompt, setImgPrompt] = useState(scene.image_prompt || '');
  const [vidPrompt, setVidPrompt] = useState(scene.video_prompt || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedInvalidated, setSavedInvalidated] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const [regenError, setRegenError] = useState('');
  const [videoRegenBusy, setVideoRegenBusy] = useState(false);
  const [videoRegenError, setVideoRegenError] = useState('');

  // scene prop 이 외부에서 갱신되면 폼 동기화
  useEffect(() => {
    setDescKo(scene.description_ko || '');
    setImgPrompt(scene.image_prompt || '');
    setVidPrompt(scene.video_prompt || '');
  }, [scene.description_ko, scene.image_prompt, scene.video_prompt]);

  // 백엔드가 invalidate 한 경우(예: phase1 재실행 또는 외부 갱신) 메시지 클리어
  useEffect(() => {
    if (scene.image_status !== 'pending') {
      setSavedInvalidated(false);
    }
  }, [scene.image_status]);

  const toggleEdit = () => {
    setError('');
    setSavedInvalidated(false);
    setEditing((prev) => !prev);
  };

  const onSave = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    const payload = {};
    if (descKo !== (scene.description_ko || '')) payload.description_ko = descKo;
    if (imgPrompt !== (scene.image_prompt || '')) payload.image_prompt = imgPrompt;
    if (vidPrompt !== (scene.video_prompt || '')) payload.video_prompt = vidPrompt;
    if (Object.keys(payload).length === 0) {
      setError('바뀐 내용이 없어요.');
      setSaving(false);
      return;
    }
    const result = await onPatchScene(scene.scene_number, payload);
    setSaving(false);
    if (result?.ok) {
      setSavedInvalidated(true);
      setEditing(false);
    } else {
      setError(result?.error || '저장에 실패했어요.');
    }
  };

  const onRegenerate = async ({ confirmFirst }) => {
    if (regenBusy) return;
    if (!onRegenerateSceneImage) return;
    if (confirmFirst) {
      const ok = window.confirm('이 씬 이미지를 다시 만들어요. 계속할까요?');
      if (!ok) return;
    }
    setRegenBusy(true);
    setRegenError('');
    if (import.meta.env.DEV) {
      console.info(`${SCENE_CARD_PREFIX} regenerate image`, {
        pre_mv_job_id: preMVJobId,
        scene_number: scene.scene_number,
        prev_status: scene.image_status,
      });
    }
    const result = await onRegenerateSceneImage(scene.scene_number);
    setRegenBusy(false);
    if (!result?.ok) {
      setRegenError(result?.error || '재생성에 실패했어요.');
    }
  };

  const onRegenerateVideo = async ({ confirmFirst }) => {
    if (videoRegenBusy) return;
    if (!onRegenerateSceneVideo) return;
    if (confirmFirst) {
      const ok = window.confirm('이 씬 영상을 다시 만들어요. 영상 생성은 비용·시간이 많이 들어요. 계속할까요?');
      if (!ok) return;
    }
    setVideoRegenBusy(true);
    setVideoRegenError('');
    if (import.meta.env.DEV) {
      console.info(`${SCENE_CARD_PREFIX} regenerate video`, {
        pre_mv_job_id: preMVJobId,
        scene_number: scene.scene_number,
        prev_status: scene.video_status,
      });
    }
    const result = await onRegenerateSceneVideo(scene.scene_number);
    setVideoRegenBusy(false);
    if (!result?.ok) {
      setVideoRegenError(result?.error || '영상 재생성에 실패했어요.');
    }
  };

  const slotLabel = SLOT_LABEL_KO[scene.story_slot] || scene.story_slot || '';
  const useSec = typeof scene.use_seconds === 'number' ? scene.use_seconds.toFixed(1) : '?';

  const imageStatus = scene.image_status || 'pending';
  const imageReady = imageStatus === 'completed';
  const imageGenerating = imageStatus === 'generating';
  const imageFailed = imageStatus === 'failed';

  // 캐시 무효화용 버스터. preMVSceneImageUrl 이 이미 ?token 을 붙이므로 &v= 만 추가.
  // image_generated_at(완료시각) 우선, 그 외엔 finished_at, 그 외엔 'pending' 으로 폴백.
  const cacheKey = scene.image_generated_at
    || scene.image_finished_at
    || scene.image_started_at
    || 'pending';
  const imgSrc = preMVJobId && imageReady
    ? `${api.preMVSceneImageUrl(preMVJobId, scene.scene_number)}&v=${encodeURIComponent(cacheKey)}`
    : null;

  // 영상 상태 및 캐시 버스터(완료시각 우선).
  const videoStatus = scene.video_status || 'pending';
  const videoReady = videoStatus === 'completed';
  const videoGenerating = videoStatus === 'generating';
  const videoFailed = videoStatus === 'failed';
  const videoCacheKey = scene.video_finished_at
    || scene.video_started_at
    || 'pending';
  const videoSrc = preMVJobId && videoReady
    ? `${api.preMVSceneVideoUrl(preMVJobId, scene.scene_number)}&v=${encodeURIComponent(videoCacheKey)}`
    : null;

  // 영상 영역 노출 게이팅: 이미지가 완료되지 않았으면 안내만.
  const showVideoArea = imageReady;

  return (
    <div className="pre-mv-scene-card">
      <div className="pre-mv-scene-card__head">
        <h4 className="pre-mv-scene-card__title">씬 #{scene.scene_number}</h4>
        <div className="pre-mv-scene-card__meta">
          {slotLabel && (
            <span className="pre-mv-plan__slot">{slotLabel}</span>
          )}
          <span className="pre-mv-scene-card__use">{useSec}s</span>
          {imageReady && onRegenerateSceneImage && (
            <button
              type="button"
              className="btn-ghost pre-mv-step__btn"
              onClick={() => onRegenerate({ confirmFirst: true })}
              disabled={regenBusy}
              title="이 씬 이미지를 다시 만듭니다"
            >
              {regenBusy ? '재생성 중...' : '이미지 재생성'}
            </button>
          )}
          <button
            type="button"
            className="btn-ghost pre-mv-step__btn"
            onClick={toggleEdit}
          >
            {editing ? '편집 닫기' : '편집'}
          </button>
        </div>
      </div>

      {/* 이미지 영역 (16:9 200x113 썸네일) */}
      <div className={`pre-mv-scene-card__image is-${imageStatus}`}>
        {imageReady && imgSrc && (
          <img
            src={imgSrc}
            alt={`씬 ${scene.scene_number} 이미지`}
            width={200}
            height={113}
            onError={(e) => {
              console.warn(`${SCENE_CARD_PREFIX} img load failed`, {
                pre_mv_job_id: preMVJobId,
                scene_number: scene.scene_number,
                src: imgSrc,
              });
              e.currentTarget.style.display = 'none';
            }}
          />
        )}
        {imageGenerating && (
          <div className="pre-mv-scene-card__image-status is-generating">
            <span className="pre-mv-scene-card__spinner" aria-hidden="true" />
            <span>생성 중...</span>
          </div>
        )}
        {imageFailed && (
          <div className="pre-mv-scene-card__image-status is-failed">
            <span className="pre-mv-scene-card__warn-icon" aria-hidden="true">⚠</span>
            <span className="pre-mv-scene-card__image-error">
              {scene.image_error
                ? (scene.image_error.length > 60
                    ? `${scene.image_error.slice(0, 60)}…`
                    : scene.image_error)
                : '이미지 생성에 실패했어요.'}
            </span>
            {onRegenerateSceneImage && (
              <button
                type="button"
                className="btn-ghost pre-mv-step__btn"
                onClick={() => onRegenerate({ confirmFirst: false })}
                disabled={regenBusy}
              >
                {regenBusy ? '재시도 중...' : '다시 시도'}
              </button>
            )}
          </div>
        )}
        {imageStatus === 'pending' && (
          <div className="pre-mv-scene-card__image-status is-pending">
            <span>대기 중</span>
          </div>
        )}
      </div>

      {regenError && <div className="pre-mv-step__error">{regenError}</div>}

      {/* 영상 영역 (v17.3) — 200x113 16:9. 이미지가 완료된 씬에서만 노출. */}
      {showVideoArea && (
        <div className={`pre-mv-scene-card__video is-${videoStatus}`}>
          {videoReady && videoSrc && (
            <video
              className="pre-mv-scene-card__video-player"
              src={videoSrc}
              controls
              preload="metadata"
              width={200}
              height={113}
              onError={() => {
                console.warn(`${SCENE_CARD_PREFIX} video load failed`, {
                  pre_mv_job_id: preMVJobId,
                  scene_number: scene.scene_number,
                });
              }}
            />
          )}
          {videoGenerating && (
            <div className="pre-mv-scene-card__video-status is-generating">
              <span className="pre-mv-scene-card__spinner" aria-hidden="true" />
              <span>영상 생성 중...</span>
            </div>
          )}
          {videoFailed && (
            <div className="pre-mv-scene-card__video-status is-failed">
              <span className="pre-mv-scene-card__warn-icon" aria-hidden="true">⚠</span>
              <span className="pre-mv-scene-card__video-error">
                {scene.video_error
                  ? (scene.video_error.length > 80
                      ? `${scene.video_error.slice(0, 80)}…`
                      : scene.video_error)
                  : '영상 생성에 실패했어요.'}
              </span>
              {onRegenerateSceneVideo && (
                <button
                  type="button"
                  className="btn-ghost pre-mv-step__btn"
                  onClick={() => onRegenerateVideo({ confirmFirst: false })}
                  disabled={videoRegenBusy}
                >
                  {videoRegenBusy ? '재시도 중...' : '다시 시도'}
                </button>
              )}
            </div>
          )}
          {videoStatus === 'pending' && (
            <div className="pre-mv-scene-card__video-status is-pending">
              <span>대기 중</span>
            </div>
          )}
          {videoReady && onRegenerateSceneVideo && (
            <div className="pre-mv-scene-card__video-actions">
              <button
                type="button"
                className="btn-ghost pre-mv-step__btn"
                onClick={() => onRegenerateVideo({ confirmFirst: true })}
                disabled={videoRegenBusy}
                title="이 씬 영상을 다시 만듭니다 (비용·시간 발생)"
              >
                {videoRegenBusy ? '재생성 중...' : '영상 재생성'}
              </button>
            </div>
          )}
        </div>
      )}

      {videoRegenError && <div className="pre-mv-step__error">{videoRegenError}</div>}

      {scene.description_ko && (
        <p className="pre-mv-scene-card__desc">{scene.description_ko}</p>
      )}
      {scene.image_prompt_ko && !editing && (
        <p className="pre-mv-scene-card__lyric">{scene.image_prompt_ko}</p>
      )}

      {savedInvalidated && (
        <div className="pre-mv-scene-card__edit-hint">
          저장됨. 이미지/영상이 무효화돼요. [이미지 재생성] / [영상 재생성] 으로 다시 만들어 주세요.
        </div>
      )}

      {editing && (
        <div className="pre-mv-scene-card__edit">
          <label htmlFor={`scene-desc-${scene.scene_number}`}>씬 설명 (한국어)</label>
          <textarea
            id={`scene-desc-${scene.scene_number}`}
            value={descKo}
            onChange={(e) => setDescKo(e.target.value)}
          />
          <label htmlFor={`scene-img-${scene.scene_number}`}>이미지 프롬프트 (영문)</label>
          <textarea
            id={`scene-img-${scene.scene_number}`}
            value={imgPrompt}
            onChange={(e) => setImgPrompt(e.target.value)}
          />
          <label htmlFor={`scene-vid-${scene.scene_number}`}>영상 프롬프트 (영문)</label>
          <textarea
            id={`scene-vid-${scene.scene_number}`}
            value={vidPrompt}
            onChange={(e) => setVidPrompt(e.target.value)}
          />
          <div className="pre-mv-scene-card__edit-hint">
            이미지/영상이 무효화돼요. 이미지 프롬프트를 바꾸면 이미지·영상 둘 다,
            영상 프롬프트만 바꾸면 영상만 다시 만들어야 해요.
            [이미지 재생성] / [영상 재생성] 으로 다시 만들어 주세요.
          </div>
          {error && <div className="pre-mv-step__error">{error}</div>}
          <div className="pre-mv-scene-card__edit-actions">
            <button
              type="button"
              className="btn-primary pre-mv-step__btn"
              onClick={onSave}
              disabled={saving}
            >
              {saving ? '저장 중...' : '저장'}
            </button>
            <button
              type="button"
              className="btn-ghost pre-mv-step__btn"
              onClick={toggleEdit}
              disabled={saving}
            >
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Step 3 — Phase 2 (씬 이미지) — v17.2 활성
// ──────────────────────────────────────────────────────────────────────────

function PreMVImagesStep({ preMVJob, status, scenes, phase1Done, onStart }) {
  // 잡 단위 image_model lock — 한 번이라도 phase2 가 실행되었으면 prevModel 고정.
  const lockedModel = preMVJob?.image_model || null;
  const initialModel = lockedModel || 'gpt_image_2';
  const [selectedModel, setSelectedModel] = useState(initialModel);
  const [busy, setBusy] = useState(false);

  // preMVJob.image_model 외부 변경 시 동기화
  useEffect(() => {
    if (preMVJob?.image_model) {
      setSelectedModel(preMVJob.image_model);
    }
  }, [preMVJob?.image_model]);

  const isRunning = status === 'phase2_images';
  const isReady = status === 'phase2_ready';
  const isPartial = status === 'phase2_partial';
  const isFailed = status === 'phase2_failed';
  const isPhase1Ready = status === 'phase1_ready';

  // 활성 조건 — phase1 완료 또는 phase2 어느 상태든
  const active = PHASE2_ACTIVE_STATUSES.has(status);
  const disabled = !phase1Done;

  // 진행도 계산
  const totalScenes = Array.isArray(scenes) ? scenes.length : 0;
  const completedScenes = totalScenes > 0
    ? scenes.filter((s) => s.image_status === 'completed').length
    : 0;
  const failedScenes = totalScenes > 0
    ? scenes.filter((s) => s.image_status === 'failed').length
    : 0;
  const progressPct = totalScenes > 0
    ? Math.round((completedScenes / totalScenes) * 100)
    : 0;

  // 백엔드가 보내준 progress 우선(있다면), 없으면 위 계산값.
  const serverProgress = typeof preMVJob?.progress === 'number'
    ? Math.max(0, Math.min(100, Math.round(preMVJob.progress)))
    : null;
  const displayProgress = serverProgress != null ? serverProgress : progressPct;

  const badge = (() => {
    if (isRunning) return { cls: 'is-running', text: '진행 중' };
    if (isReady) return { cls: 'is-ready', text: '완료' };
    if (isPartial) return { cls: 'is-failed', text: '일부 실패' };
    if (isFailed) return { cls: 'is-failed', text: '실패' };
    if (isPhase1Ready) return { cls: '', text: '준비' };
    return { cls: '', text: '대기' };
  })();

  const statusText = (() => {
    if (isPhase1Ready) return '씬 이미지 생성 대기 중';
    if (isRunning) return `생성 중 (${displayProgress}%)`;
    if (isReady) return '전 씬 완료';
    if (isPartial) return `일부 씬 실패 (${failedScenes}/${totalScenes})`;
    if (isFailed) return '이미지 생성 실패';
    return '';
  })();

  // 시작 버튼은 phase1_ready / phase2_partial / phase2_failed 일 때만 노출(label="이미지 생성 시작").
  // phase2_ready 에서는 [전체 재생성] (force=true). phase2_images 중엔 둘 다 비활성.
  const canStart = !isRunning && (isPhase1Ready || isPartial || isFailed);
  const canForceRerun = !isRunning && isReady;

  const onClickStart = async () => {
    if (busy) return;
    setBusy(true);
    if (import.meta.env.DEV) {
      console.info(`${STEP_IMAGES_PREFIX} click start`, {
        image_model: selectedModel,
        status,
        scene_count: totalScenes,
      });
    }
    try {
      await onStart(selectedModel, false);
    } finally {
      setBusy(false);
    }
  };

  const onClickForceRerun = async () => {
    if (busy) return;
    const ok = window.confirm('기존 이미지가 모두 사라져요. 계속할까요?');
    if (!ok) return;
    setBusy(true);
    if (import.meta.env.DEV) {
      console.info(`${STEP_IMAGES_PREFIX} click force_rerun`, {
        image_model: selectedModel,
        status,
        scene_count: totalScenes,
      });
    }
    try {
      await onStart(selectedModel, true);
    } finally {
      setBusy(false);
    }
  };

  if (disabled) {
    return (
      <div className="pre-mv-step is-disabled">
        <div className="pre-mv-step__head">
          <h3 className="pre-mv-step__title">Step 3. 씬 이미지 (Phase 2)</h3>
          <span className="pre-mv-step__badge">대기</span>
        </div>
        <p className="pre-mv-step__desc">
          각 씬의 인물·장소 합성 이미지를 만들어요.
        </p>
        <span className="pre-mv-step__hint">씬 분할이 먼저 완료돼야 해요.</span>
      </div>
    );
  }

  return (
    <div className="pre-mv-step">
      <div className="pre-mv-step__head">
        <h3 className="pre-mv-step__title">Step 3. 씬 이미지 (Phase 2)</h3>
        <span className={`pre-mv-step__badge ${badge.cls}`}>{badge.text}</span>
      </div>
      <p className="pre-mv-step__desc">
        가사 라인별 씬에 어울리는 인물·장소 합성 이미지를 만들어요.
      </p>

      <div className="pre-mv-step__row">
        <span className="pre-mv-step__row-label">이미지 모델</span>
        {IMAGE_MODELS.map((m) => (
          <label key={m.value} className="pre-mv-step__radio">
            <input
              type="radio"
              name="pre-mv-image-model"
              value={m.value}
              checked={selectedModel === m.value}
              onChange={() => setSelectedModel(m.value)}
              disabled={isRunning || busy || !!lockedModel}
            />
            {m.label}
          </label>
        ))}
      </div>

      {lockedModel && (
        <span className="pre-mv-step__hint">
          이 작품은 {IMAGE_MODEL_LABEL[lockedModel] || lockedModel} 으로 시작했어요.
          같은 모델로 재생성돼요.
        </span>
      )}

      {statusText && (
        <div className="pre-mv-images__status">
          <span className="pre-mv-images__status-text">{statusText}</span>
          {totalScenes > 0 && !isPhase1Ready && (
            <span className="pre-mv-images__status-count">
              {completedScenes}/{totalScenes} 씬 완료
            </span>
          )}
        </div>
      )}

      {isRunning && (
        <div
          className="pre-mv-images__progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={displayProgress}
        >
          <div
            className="pre-mv-images__progress-bar"
            style={{ width: `${displayProgress}%` }}
          />
        </div>
      )}

      <div className="pre-mv-step__actions">
        {canStart && (
          <button
            type="button"
            className="btn-primary pre-mv-step__btn"
            onClick={onClickStart}
            disabled={busy || isRunning}
          >
            {busy ? '시작하는 중...' : (isPartial || isFailed ? '실패 씬 다시 만들기' : '이미지 생성 시작')}
          </button>
        )}
        {canForceRerun && (
          <button
            type="button"
            className="btn-ghost pre-mv-step__btn"
            onClick={onClickForceRerun}
            disabled={busy || isRunning}
          >
            전체 재생성
          </button>
        )}
        {isRunning && (
          <span className="pre-mv-step__hint">
            씬마다 약 30초~1분 정도 걸려요. 완료될 때까지 잠시만 기다려 주세요.
          </span>
        )}
      </div>

      {preMVJob?.phase2_error && (
        <div className="pre-mv-step__error">{preMVJob.phase2_error}</div>
      )}

      {isPartial && (
        <div className="pre-mv-step__hint">
          실패한 씬 카드에서 [다시 시도] 버튼을 누르거나, 위 버튼으로 실패 씬을 한 번에 다시 만들 수 있어요.
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Step 4 — Phase 3 (씬 영상) — v17.3 활성
// ──────────────────────────────────────────────────────────────────────────

function PreMVVideosStep({ preMVJob, status, scenes, phase2Done, phase2Partial, onStart }) {
  // 잡 단위 video_model lock.
  const lockedModel = preMVJob?.video_model || null;
  const initialModel = lockedModel || 'veo';
  const [selectedModel, setSelectedModel] = useState(initialModel);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (preMVJob?.video_model) {
      setSelectedModel(preMVJob.video_model);
    }
  }, [preMVJob?.video_model]);

  const isRunning = status === 'phase3_videos';
  const isReady = status === 'phase3_ready'
    || status === 'phase4_compositing'
    || status === 'phase4_failed'
    || status === 'completed';
  const isPartial = status === 'phase3_partial';
  const isFailed = status === 'phase3_failed';
  const isPhase2Ready = status === 'phase2_ready';

  // disabled — Phase 2 가 끝나지 않았으면 카드 자체 비활성.
  const disabled = !phase2Done;

  // 진행도 계산 (video_status 기준).
  const totalScenes = Array.isArray(scenes) ? scenes.length : 0;
  const completedVideos = totalScenes > 0
    ? scenes.filter((s) => s.video_status === 'completed').length
    : 0;
  const failedVideos = totalScenes > 0
    ? scenes.filter((s) => s.video_status === 'failed').length
    : 0;
  const progressPct = totalScenes > 0
    ? Math.round((completedVideos / totalScenes) * 100)
    : 0;

  const serverProgress = isRunning && typeof preMVJob?.progress === 'number'
    ? Math.max(0, Math.min(100, Math.round(preMVJob.progress)))
    : null;
  const displayProgress = serverProgress != null ? serverProgress : progressPct;

  const badge = (() => {
    if (isRunning) return { cls: 'is-running', text: '진행 중' };
    if (isReady) return { cls: 'is-ready', text: '완료' };
    if (isPartial) return { cls: 'is-failed', text: '일부 실패' };
    if (isFailed) return { cls: 'is-failed', text: '실패' };
    if (isPhase2Ready) return { cls: '', text: '준비' };
    return { cls: '', text: '대기' };
  })();

  const statusText = (() => {
    if (isPhase2Ready) return '씬 영상 생성 대기 중';
    if (isRunning) return `생성 중 (${completedVideos}/${totalScenes})`;
    if (status === 'phase3_ready') return '전 씬 완료';
    if (status === 'phase4_compositing' || status === 'phase4_failed' || status === 'completed') {
      return '전 씬 완료';
    }
    if (isPartial) return `일부 씬 실패 (${failedVideos}/${totalScenes})`;
    if (isFailed) return '영상 생성 실패';
    return '';
  })();

  // 시작 버튼 게이팅.
  // Phase 2 partial(일부 실패) 이면 phase3 시작 비활성 — 백엔드도 422.
  const canStart = !isRunning && !phase2Partial && (isPhase2Ready || isPartial || isFailed);
  const canForceRerun = !isRunning && status === 'phase3_ready';

  const onClickStart = async () => {
    if (busy) return;
    setBusy(true);
    if (import.meta.env.DEV) {
      console.info(`${STEP_VIDEOS_PREFIX} click start`, {
        video_model: selectedModel,
        status,
        scene_count: totalScenes,
      });
    }
    try {
      await onStart(selectedModel, false);
    } finally {
      setBusy(false);
    }
  };

  const onClickForceRerun = async () => {
    if (busy) return;
    const ok = window.confirm(
      '기존 영상이 모두 사라져요. 영상 생성은 비용·시간이 많이 들어요. 계속할까요?'
    );
    if (!ok) return;
    setBusy(true);
    if (import.meta.env.DEV) {
      console.info(`${STEP_VIDEOS_PREFIX} click force_rerun`, {
        video_model: selectedModel,
        status,
        scene_count: totalScenes,
      });
    }
    try {
      await onStart(selectedModel, true);
    } finally {
      setBusy(false);
    }
  };

  if (disabled) {
    return (
      <div className="pre-mv-step is-disabled">
        <div className="pre-mv-step__head">
          <h3 className="pre-mv-step__title">Step 4. 씬 영상 (Phase 3)</h3>
          <span className="pre-mv-step__badge">대기</span>
        </div>
        <p className="pre-mv-step__desc">
          이미지에 카메라 워크·미세 동작을 더해 짧은 영상을 만들어요.
        </p>
        <span className="pre-mv-step__hint">
          씬 이미지가 먼저 모두 완료돼야 해요. (실패한 씬을 재생성해 주세요)
        </span>
      </div>
    );
  }

  return (
    <div className="pre-mv-step">
      <div className="pre-mv-step__head">
        <h3 className="pre-mv-step__title">Step 4. 씬 영상 (Phase 3)</h3>
        <span className={`pre-mv-step__badge ${badge.cls}`}>{badge.text}</span>
      </div>
      <p className="pre-mv-step__desc">
        각 씬 이미지에 카메라 워크·미세 동작을 더해 짧은 영상으로 만들어요. 모델별 길이가 달라요.
      </p>

      <div className="pre-mv-step__row pre-mv-step__row--column">
        <span className="pre-mv-step__row-label">영상 모델</span>
        <div className="pre-mv-videos__models">
          {VIDEO_MODELS.map((m) => (
            <label
              key={m.value}
              className="pre-mv-step__radio pre-mv-videos__radio"
              title={m.desc}
            >
              <input
                type="radio"
                name="pre-mv-video-model"
                value={m.value}
                checked={selectedModel === m.value}
                onChange={() => setSelectedModel(m.value)}
                disabled={isRunning || busy || !!lockedModel}
              />
              <span className="pre-mv-videos__radio-label">{m.label}</span>
              <span className="pre-mv-videos__radio-desc">{m.desc}</span>
            </label>
          ))}
        </div>
      </div>

      {lockedModel && (
        <span className="pre-mv-step__hint">
          이 작품은 {VIDEO_MODEL_LABEL[lockedModel] || lockedModel} 으로 시작했어요.
          같은 모델로 재생성돼요.
        </span>
      )}

      {phase2Partial && (
        <span className="pre-mv-step__hint">
          실패한 씬 이미지를 먼저 재생성해 주세요. 모든 씬 이미지가 완료돼야 영상 생성을 시작할 수 있어요.
        </span>
      )}

      {statusText && (
        <div className="pre-mv-images__status">
          <span className="pre-mv-images__status-text">{statusText}</span>
          {totalScenes > 0 && !isPhase2Ready && (
            <span className="pre-mv-images__status-count">
              {completedVideos}/{totalScenes} 씬 완료
            </span>
          )}
        </div>
      )}

      {isRunning && (
        <div
          className="pre-mv-images__progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={displayProgress}
        >
          <div
            className="pre-mv-images__progress-bar"
            style={{ width: `${displayProgress}%` }}
          />
        </div>
      )}

      <div className="pre-mv-step__actions">
        {canStart && (
          <button
            type="button"
            className="btn-primary pre-mv-step__btn"
            onClick={onClickStart}
            disabled={busy || isRunning}
          >
            {busy
              ? '시작하는 중...'
              : (isPartial || isFailed ? '실패 씬 다시 만들기' : '영상 생성 시작')}
          </button>
        )}
        {canForceRerun && (
          <button
            type="button"
            className="btn-ghost pre-mv-step__btn"
            onClick={onClickForceRerun}
            disabled={busy || isRunning}
          >
            전체 재생성
          </button>
        )}
        {isRunning && (
          <span className="pre-mv-step__hint">
            씬마다 30초~3분 정도 걸려요. 모델·길이에 따라 더 오래 걸릴 수 있어요.
          </span>
        )}
      </div>

      {preMVJob?.phase3_error && (
        <div className="pre-mv-step__error">{preMVJob.phase3_error}</div>
      )}

      {isPartial && (
        <div className="pre-mv-step__hint">
          실패한 씬 카드에서 [다시 시도] 버튼을 누르거나, 위 버튼으로 실패 씬을 한 번에 다시 만들 수 있어요.
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Step 5 — Phase 4 (최종 합치기) — v17.3 활성
// ──────────────────────────────────────────────────────────────────────────

function PreMVFinalStep({
  preMVJob,
  status,
  scenes,
  phase3Done,
  phase3Partial,
  preMVJobId,
  onStart,
}) {
  const [busy, setBusy] = useState(false);

  const isRunning = status === 'phase4_compositing';
  const isCompleted = status === 'completed';
  const isFailed = status === 'phase4_failed';
  const isPhase3Ready = status === 'phase3_ready';
  const disabled = !phase3Done;

  const badge = (() => {
    if (isRunning) return { cls: 'is-running', text: '진행 중' };
    if (isCompleted) return { cls: 'is-ready', text: '완성' };
    if (isFailed) return { cls: 'is-failed', text: '실패' };
    if (isPhase3Ready) return { cls: '', text: '준비' };
    return { cls: '', text: '대기' };
  })();

  const statusText = (() => {
    if (isPhase3Ready) return '최종 합치기 대기 중';
    if (isRunning) return '최종 영상 만드는 중...';
    if (isCompleted) return '완성! 🎉';
    if (isFailed) return '합치기 실패';
    return '';
  })();

  const canStart = !isRunning && (isPhase3Ready || isFailed);
  const canRecomposite = !isRunning && isCompleted;

  const onClickStart = async () => {
    if (busy) return;
    setBusy(true);
    if (import.meta.env.DEV) {
      console.info(`${STEP_FINAL_PREFIX} click start`, { status });
    }
    try {
      await onStart(false);
    } finally {
      setBusy(false);
    }
  };

  const onClickRecomposite = async () => {
    if (busy) return;
    const ok = window.confirm(
      '기존 최종 영상이 사라져요. 합치기를 다시 진행할까요?'
    );
    if (!ok) return;
    setBusy(true);
    if (import.meta.env.DEV) {
      console.info(`${STEP_FINAL_PREFIX} click recomposite`, { status });
    }
    try {
      await onStart(true);
    } finally {
      setBusy(false);
    }
  };

  // 결과 영상 URL + cachebuster (result_video_generated_at).
  const resultCacheKey = preMVJob?.result_video_generated_at || preMVJob?.updated_at || 'pending';
  const resultSrc = (isCompleted && preMVJobId)
    ? `${api.preMVResultVideoUrl(preMVJobId)}&v=${encodeURIComponent(resultCacheKey)}`
    : null;

  const onDownload = () => {
    if (!resultSrc) return;
    if (import.meta.env.DEV) {
      console.info(`${STEP_FINAL_PREFIX} download click`, {
        pre_mv_job_id: preMVJobId,
      });
    }
    const a = document.createElement('a');
    a.href = resultSrc;
    a.download = `wedding-mv-${preMVJobId || 'final'}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (disabled) {
    return (
      <div className="pre-mv-step is-disabled">
        <div className="pre-mv-step__head">
          <h3 className="pre-mv-step__title">Step 5. 최종 합치기 (Phase 4)</h3>
          <span className="pre-mv-step__badge">대기</span>
        </div>
        <p className="pre-mv-step__desc">
          모든 씬 영상을 순서대로 이어 붙이고 음악과 합쳐드려요.
        </p>
        <span className="pre-mv-step__hint">
          씬 영상이 먼저 모두 완료돼야 해요.
        </span>
      </div>
    );
  }

  return (
    <div className="pre-mv-step">
      <div className="pre-mv-step__head">
        <h3 className="pre-mv-step__title">Step 5. 최종 합치기 (Phase 4)</h3>
        <span className={`pre-mv-step__badge ${badge.cls}`}>{badge.text}</span>
      </div>
      <p className="pre-mv-step__desc">
        모든 씬 영상을 순서대로 이어 붙이고 음악과 합쳐 한 편의 식전영상을 만들어드려요.
      </p>

      {phase3Partial && (
        <span className="pre-mv-step__hint">
          실패한 씬 영상을 먼저 재생성해 주세요. 모든 씬 영상이 완료돼야 최종 합치기를 시작할 수 있어요.
        </span>
      )}

      {statusText && (
        <div className="pre-mv-images__status">
          <span className="pre-mv-images__status-text">{statusText}</span>
        </div>
      )}

      <div className="pre-mv-step__actions">
        {canStart && (
          <button
            type="button"
            className="btn-primary pre-mv-step__btn"
            onClick={onClickStart}
            disabled={busy || isRunning || phase3Partial}
          >
            {busy ? '시작하는 중...' : (isFailed ? '다시 시도' : '최종 영상 만들기')}
          </button>
        )}
        {canRecomposite && (
          <button
            type="button"
            className="btn-ghost pre-mv-step__btn"
            onClick={onClickRecomposite}
            disabled={busy || isRunning}
          >
            다시 합치기
          </button>
        )}
        {isRunning && (
          <span className="pre-mv-step__hint">
            ffmpeg 로 씬을 이어 붙이고 음악과 합치는 중이에요. 1~3분 정도 걸려요.
          </span>
        )}
      </div>

      {preMVJob?.phase4_error && (
        <div className="pre-mv-step__error">{preMVJob.phase4_error}</div>
      )}

      {/* 완성 — 큰 사이즈 비디오 플레이어 + 다운로드 */}
      {isCompleted && resultSrc && (
        <div className="pre-mv-final__result">
          <video
            className="pre-mv-final__player"
            src={resultSrc}
            controls
            preload="metadata"
            onError={() => {
              console.warn(`${STEP_FINAL_PREFIX} result video load failed`, {
                pre_mv_job_id: preMVJobId,
              });
            }}
          />
          <div className="pre-mv-step__actions">
            <button
              type="button"
              className="btn-primary pre-mv-step__btn"
              onClick={onDownload}
            >
              ⬇ 다운로드
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
