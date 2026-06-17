import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '../api';
import MentionField from './MentionField';
import './ExtraVideoDetailModal.css';

/**
 * v23.3 — ExtraVideoDetailModal
 * v23.4 — Continue (이어붙이기) 섹션 추가
 *
 * 추가영상생성 B 영역 카드 클릭 시 띄우는 멀티턴 refine 모달.
 *  - chain timeline (v1/v2/v3...)
 *  - active 미리보기 (큰 video)
 *  - 메타 (source_kind, video_model lock, motion_presets, user_text)
 *  - refine 폼 (user_text, motion chips, lock video_model, use_seconds)
 *  - **v23.4** continue 폼 (자유 video_model, last frame → 새 chain root)
 *  - 모달 내부 폴링 (active 또는 chain 에 generating/queued 가 있으면 5s)
 *
 * Props
 *  mvJobId        : string
 *  initialId      : string  — 진입 시점 extra_video_id
 *  onClose        : () => void
 *  onChanged?     : () => void  — refine queued / 삭제 시 부모 갤러리 갱신
 *  onDeletedAll?  : () => void  — chain 전체가 비면 모달 닫기
 *  onContinueDone?: () => void  — continue queued 직후. 부모 갤러리 reload + (옵션) 모달 닫기
 */

const PREFIX = '[ExtraVideoDetailModal]';
const POLL_MS = 5000;

const MODEL_LABEL = {
  veo: 'Veo 3.1',
  kling: 'Kling 3.0 Omni',
  seedance: 'Seedance 2.0',
  grok: 'Grok',
};

const VIDEO_LENGTH_OPTIONS = {
  veo: [8],
  kling: [3, 5, 8, 10, 15],
  seedance: [5, 8, 10, 12, 15],
  grok: [1, 3, 5, 8, 10],
};

const STATUS_LABEL = {
  queued: '대기 중',
  video_generating: '영상 생성 중...',
  generating: '생성 중...',
  completed: '완료',
  failed: '실패',
};

const CAMERA_MOTIONS = [
  { value: 'zoom_in', label: 'Zoom In' },
  { value: 'push_in', label: 'Push In' },
  { value: 'pull_out', label: 'Pull Out' },
  { value: 'pan_left', label: 'Pan Left' },
  { value: 'pan_right', label: 'Pan Right' },
  { value: 'crane_up', label: 'Crane Up' },
  { value: 'crane_down', label: 'Crane Down' },
  { value: 'tilt', label: 'Tilt' },
  { value: 'bullet_time', label: 'Bullet Time' },
  { value: 'static', label: 'Static' },
  { value: 'tracking', label: 'Tracking' },
];

function isBusyStatus(s) {
  return s === 'queued' || s === 'video_generating' || s === 'generating';
}

export default function ExtraVideoDetailModal({
  mvJobId, // 사용은 안 하지만 향후 확장 / 로그용
  initialId,
  onClose,
  onChanged,
  onDeletedAll,
  onContinueDone,
}) {
  const [chain, setChain] = useState([]); // asc
  const [activeIdx, setActiveIdx] = useState(-1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // refine form
  const [refineText, setRefineText] = useState('');
  const [refineMotions, setRefineMotions] = useState([]);
  const [refineUseSeconds, setRefineUseSeconds] = useState(null);
  const [refineSubmitting, setRefineSubmitting] = useState(false);
  const [refineError, setRefineError] = useState('');
  // v24.4 — @멘션 refs for refine.
  const [refineRefs, setRefineRefs] = useState([]);

  // v23.4 — continue form (이어붙이기)
  const [contText, setContText] = useState('');
  const [contMotions, setContMotions] = useState([]);
  // continue 는 video_model 자유 — 부모와 같아도 다른 모델도 가능.
  const [contModel, setContModel] = useState('');
  const [contUseSeconds, setContUseSeconds] = useState(null);
  const [contSubmitting, setContSubmitting] = useState(false);
  const [contError, setContError] = useState('');
  // v24.4 — @멘션 refs for continue.
  const [contRefs, setContRefs] = useState([]);

  // v24.4 — 멘션 컨텍스트 (modal 내부에서 1회 로드).
  const [mentionContext, setMentionContext] = useState(null);

  // action state
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  // ── fetch chain ─────────────────────────────────────────────────
  const fetchChain = useCallback(async ({ preserveActive = false } = {}) => {
    try {
      if (import.meta.env.DEV) {
        console.info(`${PREFIX} fetch chain`, { id: initialId });
      }
      const { data } = await api.getExtraVideoChain(initialId);
      const items = Array.isArray(data?.items) ? data.items : [];
      setChain((prev) => {
        // preserveActive: 길이 같으면 그대로 유지. 늘었으면 최신 선택.
        if (preserveActive && items.length === prev.length) {
          return items;
        }
        return items;
      });
      setError('');
      return items;
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || err?.message || 'chain error';
      console.error(`${PREFIX} fetch chain failed`, { status, detail, id: initialId });
      setError('영상 체인을 불러오지 못했습니다.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [initialId]);

  // initial fetch
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const items = await fetchChain();
      if (cancelled || !items) return;
      // active 를 initialId 로 맞추되, 없으면 마지막 버전.
      const idx = items.findIndex((it) => it.extra_video_id === initialId);
      setActiveIdx(idx >= 0 ? idx : Math.max(items.length - 1, 0));
      if (import.meta.env.DEV) {
        console.info(`${PREFIX} chain loaded`, {
          id: initialId,
          size: items.length,
          activeVersion: idx >= 0 ? idx + 1 : items.length,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialId]);

  // Esc to close
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && typeof onClose === 'function') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // v24.4 — modal 진입 시 1회 mentionContext 로드.
  useEffect(() => {
    if (!mvJobId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        if (import.meta.env.DEV) {
          console.info(`${PREFIX} getJobContext`, { mv_job_id: mvJobId });
        }
        const { data } = await api.getJobContext(mvJobId);
        if (!cancelled) setMentionContext(data);
      } catch (err) {
        console.error(`${PREFIX} getJobContext failed`, {
          status: err?.response?.status,
          detail: err?.response?.data?.detail || err?.message,
          mv_job_id: mvJobId,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mvJobId]);

  // v24.4 — 멘션 옵션 풀 빌드 (sheet/place/wedding_photo/scene_image).
  const mentionOptions = useMemo(() => {
    const opts = [];
    for (const s of mentionContext?.owner_sheets || []) {
      if (!s || !s.slot) continue;
      opts.push({
        type: 'sheet',
        asset_id: s.slot,
        display_name: s.display_name || s.slot,
        object_name: s.sheet_object_name || null,
        group_label: '🧑 시트',
      });
    }
    for (const p of mentionContext?.owner_places || []) {
      if (!p || !p.place_id) continue;
      opts.push({
        type: 'place',
        asset_id: p.place_id,
        display_name: p.display_name || '(이름 없음)',
        object_name: p.object_name || null,
        group_label: '📍 장소',
      });
    }
    for (const ph of mentionContext?.wedding_photos || []) {
      if (!ph || !ph.photo_id) continue;
      const shortId = String(ph.photo_id).slice(0, 6);
      opts.push({
        type: 'wedding_photo',
        asset_id: ph.photo_id,
        display_name: `웨딩사진-${shortId}`,
        object_name: ph.object_name || null,
        group_label: '💞 웨딩사진',
      });
    }
    for (const sc of mentionContext?.pre_mv_scenes || []) {
      if (!sc || !sc.token) continue;
      opts.push({
        type: 'scene_image',
        asset_id: sc.token,
        display_name: sc.token,
        object_name: sc.object_name || null,
        group_label: '🎬 식전영상 씬',
      });
    }
    return opts;
  }, [mentionContext]);

  // ── derived ─────────────────────────────────────────────────────
  const active = (activeIdx >= 0 && chain[activeIdx]) ? chain[activeIdx] : null;
  const firstItem = chain[0] || null;
  const lockedModel = firstItem?.video_model || active?.video_model || '';
  const lockedModelLabel = MODEL_LABEL[lockedModel] || lockedModel || '-';

  // length options 는 lockedModel 기준.
  const lengthOptions = useMemo(
    () => (VIDEO_LENGTH_OPTIONS[lockedModel] || [5]),
    [lockedModel],
  );

  // refineUseSeconds 초기화 — active 가 바뀔 때 parent.use_seconds 로 default.
  useEffect(() => {
    if (!active) return;
    const parentSec = active.use_seconds;
    if (parentSec && lengthOptions.includes(parentSec)) {
      setRefineUseSeconds(parentSec);
    } else if (lengthOptions.length > 0) {
      setRefineUseSeconds(lengthOptions[0]);
    }
    // refine 폼은 active 변경 시 초기화하지 않음 — 폼 본문은 사용자 입력 보존.
    // 단, 길이만 부모 따라 default.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.extra_video_id]);

  // v23.4 — continue model default: active.video_model. active 바뀔 때만 초기화.
  useEffect(() => {
    if (!active) return;
    const m = active.video_model;
    if (m && MODEL_LABEL[m]) {
      setContModel(m);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.extra_video_id]);

  // v23.4 — continue use_seconds: contModel 의 옵션 중 active.use_seconds 우선,
  // 없으면 첫 옵션.
  const contLengthOptions = useMemo(
    () => (VIDEO_LENGTH_OPTIONS[contModel] || [5]),
    [contModel],
  );
  useEffect(() => {
    if (!contModel) return;
    const opts = VIDEO_LENGTH_OPTIONS[contModel] || [];
    const parentSec = active?.use_seconds;
    if (parentSec && opts.includes(parentSec)) {
      setContUseSeconds(parentSec);
    } else if (opts.length > 0) {
      setContUseSeconds(opts[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contModel]);

  // ── 폴링 — chain 에 busy 아이템 있으면 5초마다 chain refetch ──────
  const hasBusy = useMemo(
    () => chain.some((it) => isBusyStatus(it.status)),
    [chain],
  );

  useEffect(() => {
    if (!hasBusy) return undefined;
    if (import.meta.env.DEV) {
      console.info(`${PREFIX} polling start`, { id: initialId });
    }
    const handle = setInterval(async () => {
      const items = await fetchChain({ preserveActive: true });
      if (!items) return;
      // 새 아이템이 추가됐다면 마지막으로 activeIdx 이동.
      setChain((curPrev) => {
        // chain 은 이미 위 fetchChain 안에서 set 됐음. 여기서는 length 만 비교.
        return curPrev;
      });
      setActiveIdx((curIdx) => {
        if (items.length === 0) return -1;
        // 길이 변동이 있으면 최신으로.
        if (curIdx < 0) return items.length - 1;
        // 새로 생긴 버전 있으면 그쪽으로 점프 (사용자가 굳이 다른 버전 보고있지 않다면).
        // 단순화: 길이 변동 시 active 가 마지막보다 작아도 그대로 유지.
        return Math.min(curIdx, items.length - 1);
      });
    }, POLL_MS);
    return () => {
      clearInterval(handle);
      if (import.meta.env.DEV) {
        console.info(`${PREFIX} polling stop`, { id: initialId });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasBusy, initialId]);

  // ── motion chip toggle ──────────────────────────────────────────
  const toggleMotion = (value) => {
    setRefineMotions((prev) => {
      if (prev.includes(value)) return prev.filter((v) => v !== value);
      return [...prev, value];
    });
  };

  // v23.4 — continue motion chip toggle
  const toggleContMotion = (value) => {
    setContMotions((prev) => {
      if (prev.includes(value)) return prev.filter((v) => v !== value);
      return [...prev, value];
    });
  };

  // ── refine 제출 ─────────────────────────────────────────────────
  const canRefine = !!active && active.status === 'completed';

  const handleRefine = async () => {
    setRefineError('');
    if (!active) return;
    if (active.status !== 'completed') {
      setRefineError('완료된 영상에만 추가 수정을 요청할 수 있어요.');
      return;
    }
    const text = (refineText || '').trim();
    if (!text && refineMotions.length === 0) {
      setRefineError('지시문 또는 카메라 모션 중 1개 이상은 필요합니다.');
      return;
    }
    const payload = {
      user_text: refineText || '',
      motion_presets: refineMotions.slice(),
      refs: refineRefs.slice(), // v24.4 — @멘션 refs.
    };
    if (refineUseSeconds != null) {
      payload.use_seconds = refineUseSeconds;
    }
    try {
      setRefineSubmitting(true);
      if (import.meta.env.DEV) {
        console.info(`${PREFIX} refine start`, {
          parent: active.extra_video_id,
          text_len: text.length,
          motions: refineMotions,
          use_seconds: refineUseSeconds,
          refs_count: refineRefs.length,
        });
      }
      const { data } = await api.refineExtraVideo(active.extra_video_id, payload);
      if (import.meta.env.DEV) {
        console.info(`${PREFIX} refine queued`, {
          new_id: data?.id,
          status: data?.status,
          chain_root: data?.chain_root_video_id,
          parent: data?.parent_video_id,
        });
      }
      // chain refetch 후 마지막 버전 자동 선택 + 폼 일부 리셋.
      const items = await fetchChain();
      if (items) {
        setActiveIdx(items.length - 1);
      }
      setRefineText('');
      setRefineMotions([]);
      setRefineRefs([]); // v24.4
      if (typeof onChanged === 'function') onChanged();
    } catch (err) {
      const status = err?.response?.status;
      const detail =
        err?.response?.data?.detail
        || err?.response?.data?.error
        || err?.message
        || 'refine error';
      console.error(`${PREFIX} refine failed`, {
        status,
        detail,
        parent: active?.extra_video_id,
      });
      setRefineError(detail || '추가 수정 요청에 실패했습니다.');
    } finally {
      setRefineSubmitting(false);
    }
  };

  // ── v23.4 continue 제출 ────────────────────────────────────────
  const canContinue = !!active && active.status === 'completed';

  const handleContinue = async () => {
    setContError('');
    if (!active) return;
    if (active.status !== 'completed') {
      setContError('완료된 영상에만 이어붙이기를 요청할 수 있어요.');
      return;
    }
    if (!contModel || !MODEL_LABEL[contModel]) {
      setContError('영상 모델을 선택해 주세요.');
      return;
    }
    const text = (contText || '').trim();
    if (!text && contMotions.length === 0) {
      setContError('지시문 또는 카메라 모션 중 1개 이상은 필요합니다.');
      return;
    }
    const payload = {
      user_text: contText || '',
      motion_presets: contMotions.slice(),
      video_model: contModel,
      refs: contRefs.slice(), // v24.4 — @멘션 refs.
    };
    if (contUseSeconds != null) {
      payload.use_seconds = contUseSeconds;
    }
    try {
      setContSubmitting(true);
      if (import.meta.env.DEV) {
        console.info(`${PREFIX} continue start`, {
          parent: active.extra_video_id,
          video_model: contModel,
          text_len: text.length,
          motions: contMotions,
          use_seconds: contUseSeconds,
          refs_count: contRefs.length,
        });
      }
      const { data } = await api.continueExtraVideo(active.extra_video_id, payload);
      if (import.meta.env.DEV) {
        console.info(`${PREFIX} continue queued`, {
          new_id: data?.id,
          status: data?.status,
          parent: data?.parent_video_id,
          source_object_name_len: (data?.source_object_name || '').length,
        });
      }
      // Continue 는 **별개 chain root** — 현 모달의 chain 에는 안 들어옴.
      // 부모 갤러리만 reload 시키고, 폼 일부 리셋.
      setContText('');
      setContMotions([]);
      setContRefs([]); // v24.4
      if (typeof onContinueDone === 'function') {
        onContinueDone();
      } else if (typeof onChanged === 'function') {
        onChanged();
      }
    } catch (err) {
      const status = err?.response?.status;
      const detail =
        err?.response?.data?.detail
        || err?.response?.data?.error
        || err?.message
        || 'continue error';
      console.error(`${PREFIX} continue failed`, {
        status,
        detail,
        parent: active?.extra_video_id,
      });
      setContError(detail || '이어붙이기 요청에 실패했습니다.');
    } finally {
      setContSubmitting(false);
    }
  };

  // ── 다운로드 ────────────────────────────────────────────────────
  const handleDownload = async () => {
    setActionError('');
    if (!active || active.status !== 'completed') return;
    try {
      if (import.meta.env.DEV) {
        console.info(`${PREFIX} download`, { id: active.extra_video_id });
      }
      const res = await api.downloadExtraVideo(active.extra_video_id);
      const blob = new Blob([res.data], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const shortId = (active.extra_video_id || '').slice(0, 8);
      a.download = `extra-video-${shortId}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || err?.message || 'download error';
      console.error(`${PREFIX} download failed`, {
        status,
        detail,
        id: active?.extra_video_id,
      });
      setActionError(detail || '다운로드에 실패했습니다.');
    }
  };

  // ── 삭제 (현 active) ───────────────────────────────────────────
  const handleDelete = async () => {
    setActionError('');
    if (!active) return;
    // eslint-disable-next-line no-alert
    if (!window.confirm('이 버전을 영구 삭제할까요? 되돌릴 수 없습니다.')) return;
    try {
      setBusy(true);
      if (import.meta.env.DEV) {
        console.info(`${PREFIX} delete`, { id: active.extra_video_id });
      }
      await api.deleteExtraVideo(active.extra_video_id);
      const items = await fetchChain();
      if (typeof onChanged === 'function') onChanged();
      if (!items || items.length === 0) {
        if (typeof onDeletedAll === 'function') onDeletedAll();
        return;
      }
      setActiveIdx((idx) => Math.min(Math.max(idx - 1, 0), items.length - 1));
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || err?.message || 'delete error';
      console.error(`${PREFIX} delete failed`, {
        status,
        detail,
        id: active?.extra_video_id,
      });
      setActionError(detail || '삭제에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  // ── 렌더 ───────────────────────────────────────────────────────
  const cacheBuster = active?.updated_at || active?.created_at || '';
  const streamSrc = active && active.status === 'completed'
    ? `${api.extraVideoStreamUrl(active.extra_video_id)}&v=${encodeURIComponent(cacheBuster)}`
    : '';

  const activeBusy = active && isBusyStatus(active.status);

  return (
    <div
      className="extra-video-detail-modal"
      role="dialog"
      aria-modal="true"
      aria-label="추가영상 디테일"
    >
      <div className="extra-video-detail-modal__backdrop" onClick={onClose} />
      <div className="extra-video-detail-modal__card">
        <div className="extra-video-detail-modal__head">
          <h3 className="extra-video-detail-modal__title">
            씬 영상 — {lockedModelLabel}
            {active?.source_kind === 'prev_video_last_frame' && (
              <span
                className="extra-video-detail-modal__source-badge"
                title="이전 영상의 마지막 프레임에서 이어진 컷"
              >
                ▶ 이어진 컷
              </span>
            )}
          </h3>
          <button
            type="button"
            className="extra-video-detail-modal__close"
            onClick={onClose}
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        {loading && (
          <p className="extra-video-detail-modal__muted">불러오는 중...</p>
        )}
        {error && (
          <p className="extra-video-detail-modal__error">{error}</p>
        )}

        {!loading && !error && (
          <div className="extra-video-detail-modal__body">
            {/* chain timeline */}
            {chain.length > 1 && (
              <div className="extra-video-detail-modal__chain" aria-label="버전 타임라인">
                {chain.map((v, idx) => {
                  const sel = idx === activeIdx;
                  const vBusy = isBusyStatus(v.status);
                  return (
                    <button
                      key={v.extra_video_id}
                      type="button"
                      className={
                        `extra-video-detail-modal__chain-item`
                        + (sel ? ' is-active' : '')
                        + (vBusy ? ' is-busy' : '')
                      }
                      onClick={() => setActiveIdx(idx)}
                      title={v.user_text || (idx === 0 ? '원본' : `v${idx + 1}`)}
                    >
                      <div className="extra-video-detail-modal__chain-thumb">
                        {v.status === 'completed' ? (
                          <video
                            muted
                            playsInline
                            preload="metadata"
                            src={`${api.extraVideoStreamUrl(v.extra_video_id)}&v=${encodeURIComponent(v.updated_at || v.created_at || '')}#t=0.1`}
                          />
                        ) : v.status === 'failed' ? (
                          <span aria-hidden="true">⚠</span>
                        ) : (
                          <span aria-hidden="true">···</span>
                        )}
                      </div>
                      <span className="extra-video-detail-modal__chain-label">
                        v{idx + 1}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* main preview */}
            <div className="extra-video-detail-modal__preview">
              {active && active.status === 'completed' && streamSrc ? (
                <video controls preload="metadata" src={streamSrc} />
              ) : active && active.status === 'failed' ? (
                <div className="extra-video-detail-modal__failed">
                  <div>⚠</div>
                  <div>{active.error_message || '생성 실패'}</div>
                </div>
              ) : active ? (
                <div className="extra-video-detail-modal__spinner">
                  <div className="extra-video-detail-modal__dot" />
                  <span>{STATUS_LABEL[active.status] || active.status}</span>
                </div>
              ) : (
                <div className="extra-video-detail-modal__muted">선택된 버전이 없습니다.</div>
              )}
            </div>

            {/* 메타 */}
            {active && (
              <div className="extra-video-detail-modal__meta">
                <h4>메타</h4>
                <div className="extra-video-detail-modal__meta-row">
                  <span className="extra-video-detail-modal__meta-key">버전</span>
                  <span>v{activeIdx + 1} / {chain.length}</span>
                </div>
                <div className="extra-video-detail-modal__meta-row">
                  <span className="extra-video-detail-modal__meta-key">상태</span>
                  <span>{STATUS_LABEL[active.status] || active.status}</span>
                </div>
                <div className="extra-video-detail-modal__meta-row">
                  <span className="extra-video-detail-modal__meta-key">모델 (lock)</span>
                  <span>{MODEL_LABEL[active.video_model] || active.video_model || '-'}</span>
                </div>
                <div className="extra-video-detail-modal__meta-row">
                  <span className="extra-video-detail-modal__meta-key">소스</span>
                  <span>
                    {active.source_kind === 'scene_image' && '씬 이미지'}
                    {active.source_kind === 'uploaded' && '업로드 이미지'}
                    {active.source_kind === 'prev_video_last_frame' && '이전 영상의 마지막 프레임'}
                    {!['scene_image', 'uploaded', 'prev_video_last_frame'].includes(active.source_kind) && (active.source_kind || '-')}
                  </span>
                </div>
                <div className="extra-video-detail-modal__meta-row">
                  <span className="extra-video-detail-modal__meta-key">길이</span>
                  <span>{active.use_seconds ?? '-'}s</span>
                </div>
                {Array.isArray(active.motion_presets) && active.motion_presets.length > 0 && (
                  <div className="extra-video-detail-modal__meta-row">
                    <span className="extra-video-detail-modal__meta-key">카메라</span>
                    <span>
                      {active.motion_presets
                        .map((m) => (CAMERA_MOTIONS.find((c) => c.value === m)?.label) || m)
                        .join(', ')}
                    </span>
                  </div>
                )}
                <div className="extra-video-detail-modal__meta-row extra-video-detail-modal__meta-row--block">
                  <span className="extra-video-detail-modal__meta-key">지시문</span>
                  <span className="extra-video-detail-modal__text">
                    {active.user_text || (
                      <span className="extra-video-detail-modal__muted">(없음)</span>
                    )}
                  </span>
                </div>
                {active.created_at && (
                  <div className="extra-video-detail-modal__meta-row">
                    <span className="extra-video-detail-modal__meta-key">생성</span>
                    <span>{new Date(active.created_at).toLocaleString('ko-KR')}</span>
                  </div>
                )}
              </div>
            )}

            {/* refine form */}
            <div className="extra-video-detail-modal__refine-form">
              <h4>🔧 추가 수정 (멀티턴)</h4>
              <p className="extra-video-detail-modal__muted">
                이 작품은 <strong>{lockedModelLabel}</strong> 으로 시작했어요. 같은 모델로 수정됩니다.
              </p>

              <label className="extra-video-detail-modal__label">
                연출 지시문
              </label>
              <MentionField
                id={`extra-video-refine-${initialId}`}
                ariaLabel="추가 수정 연출 지시문"
                value={refineText}
                refs={refineRefs}
                onChange={setRefineText}
                onChangeRefs={setRefineRefs}
                options={mentionOptions}
                rows={3}
                placeholder="예: @bride_wedding 표정 좀 더 환하게, 따뜻한 노을 톤..."
                disabled={!canRefine || refineSubmitting}
              />

              <label className="extra-video-detail-modal__label">
                카메라 모션 (선택, 다중)
              </label>
              <div
                className="extra-video-detail-modal__camera-chips extra-video-camera-chips"
                role="group"
                aria-label="카메라 모션 프리셋"
              >
                {CAMERA_MOTIONS.map((m) => {
                  const sel = refineMotions.includes(m.value);
                  return (
                    <button
                      key={m.value}
                      type="button"
                      className={
                        `extra-video-camera-chips__chip`
                        + (sel ? ' is-selected' : '')
                      }
                      onClick={() => toggleMotion(m.value)}
                      disabled={!canRefine || refineSubmitting}
                      aria-pressed={sel}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>

              <label className="extra-video-detail-modal__label">
                길이 (초) — 모델: {lockedModelLabel}
              </label>
              <div className="extra-video-detail-modal__length-radio">
                {lengthOptions.map((s) => (
                  <label
                    key={s}
                    className={
                      `extra-video-detail-modal__length-opt`
                      + (refineUseSeconds === s ? ' is-selected' : '')
                    }
                  >
                    <input
                      type="radio"
                      name="extraVideoRefineSeconds"
                      value={s}
                      checked={refineUseSeconds === s}
                      onChange={() => setRefineUseSeconds(s)}
                      disabled={!canRefine || refineSubmitting || lengthOptions.length === 1}
                    />
                    <span>{s}s</span>
                  </label>
                ))}
              </div>

              {refineError && (
                <p className="extra-video-detail-modal__error">{refineError}</p>
              )}

              {!canRefine && active && (
                <p className="extra-video-detail-modal__muted">
                  {activeBusy
                    ? '생성 중인 버전에는 수정을 걸 수 없어요. 완료될 때까지 기다려 주세요.'
                    : '실패한 버전에는 수정을 걸 수 없어요. 다른 버전을 선택해 주세요.'}
                </p>
              )}

              <div className="extra-video-detail-modal__refine-actions">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleRefine}
                  disabled={!canRefine || refineSubmitting}
                >
                  {refineSubmitting ? '시작하는 중...' : '✨ 추가 수정 만들기'}
                </button>
                {hasBusy && (
                  <span className="extra-video-detail-modal__muted">
                    진행 중인 버전이 있어 5초마다 자동 새로고침합니다.
                  </span>
                )}
              </div>
            </div>

            {/* v23.4 — continue (이어붙이기) form */}
            <div className="extra-video-detail-modal__continue-form">
              <h4>▶ 이어붙이기 (Continue)</h4>
              <p className="extra-video-detail-modal__muted">
                이전 영상의 <strong>마지막 프레임</strong>에서 이어지는 새 영상을 만듭니다.
                <br />
                결과는 <strong>별개의 새 작품</strong>으로 갤러리에 추가돼요 (현 체인에는 포함되지 않음).
              </p>

              <label className="extra-video-detail-modal__label">
                영상 모델 (자유 선택)
              </label>
              <div className="extra-video-detail-modal__model-radio">
                {Object.entries(MODEL_LABEL).map(([val, label]) => {
                  const sel = contModel === val;
                  return (
                    <label
                      key={val}
                      className={
                        `extra-video-detail-modal__model-opt`
                        + (sel ? ' is-selected' : '')
                      }
                    >
                      <input
                        type="radio"
                        name="extraVideoContinueModel"
                        value={val}
                        checked={sel}
                        onChange={() => setContModel(val)}
                        disabled={!canContinue || contSubmitting}
                      />
                      <span>{label}</span>
                    </label>
                  );
                })}
              </div>

              <label className="extra-video-detail-modal__label">
                연출 지시문
              </label>
              <MentionField
                id={`extra-video-continue-${initialId}`}
                ariaLabel="이어붙이기 연출 지시문"
                value={contText}
                refs={contRefs}
                onChange={setContText}
                onChangeRefs={setContRefs}
                options={mentionOptions}
                rows={3}
                placeholder="예: 카메라가 천천히 뒤로 빠지며 @bride_wedding 과 @groom_wedding 이 손을 잡고 걸어 나간다..."
                disabled={!canContinue || contSubmitting}
              />

              <label className="extra-video-detail-modal__label">
                카메라 모션 (선택, 다중)
              </label>
              <div
                className="extra-video-detail-modal__camera-chips extra-video-camera-chips"
                role="group"
                aria-label="카메라 모션 프리셋 (이어붙이기)"
              >
                {CAMERA_MOTIONS.map((m) => {
                  const sel = contMotions.includes(m.value);
                  return (
                    <button
                      key={m.value}
                      type="button"
                      className={
                        `extra-video-camera-chips__chip`
                        + (sel ? ' is-selected' : '')
                      }
                      onClick={() => toggleContMotion(m.value)}
                      disabled={!canContinue || contSubmitting}
                      aria-pressed={sel}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>

              <label className="extra-video-detail-modal__label">
                길이 (초) — 모델: {MODEL_LABEL[contModel] || '-'}
              </label>
              <div className="extra-video-detail-modal__length-radio">
                {contLengthOptions.map((s) => (
                  <label
                    key={s}
                    className={
                      `extra-video-detail-modal__length-opt`
                      + (contUseSeconds === s ? ' is-selected' : '')
                    }
                  >
                    <input
                      type="radio"
                      name="extraVideoContinueSeconds"
                      value={s}
                      checked={contUseSeconds === s}
                      onChange={() => setContUseSeconds(s)}
                      disabled={!canContinue || contSubmitting || contLengthOptions.length === 1}
                    />
                    <span>{s}s</span>
                  </label>
                ))}
              </div>

              {contError && (
                <p className="extra-video-detail-modal__error">{contError}</p>
              )}

              {!canContinue && active && (
                <p className="extra-video-detail-modal__muted">
                  {activeBusy
                    ? '생성 중인 버전에서는 이어붙이기를 시작할 수 없어요. 완료될 때까지 기다려 주세요.'
                    : '실패한 버전에서는 이어붙이기를 시작할 수 없어요. 완료된 다른 버전을 선택해 주세요.'}
                </p>
              )}

              <div className="extra-video-detail-modal__refine-actions">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleContinue}
                  disabled={!canContinue || contSubmitting}
                >
                  {contSubmitting ? '시작하는 중...' : '▶ 이어붙이기로 새 영상 만들기'}
                </button>
              </div>
            </div>

            {actionError && (
              <p className="extra-video-detail-modal__error">{actionError}</p>
            )}

            <div className="extra-video-detail-modal__actions">
              <button
                type="button"
                className="btn-ghost danger"
                onClick={handleDelete}
                disabled={busy || !active}
              >
                🗑 이 버전 삭제
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={handleDownload}
                disabled={!active || active.status !== 'completed'}
              >
                ⬇ 다운로드
              </button>
              <button type="button" className="btn-ghost" onClick={onClose}>
                닫기
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
