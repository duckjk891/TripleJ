import { useEffect, useMemo, useState } from 'react';
import * as api from '../api';
import MentionField from './MentionField';
import './WeddingPhotoDetailModal.css';

/**
 * v13 — WeddingPhotoDetailModal
 * v15 — 멀티턴 refine 체인 (chain timeline + refine 폼).
 * v15.1 — 모델 락: chain 의 first 자산 model 로 고정.
 * v15.2 — refine 폴링 패널로 위임. 모달이 닫혀도 잡 계속 추적됨.
 *
 * Props
 *  mvJobId         : string
 *  photoId         : string  — 진입 시점 photo_id (chain 의 어느 한 버전)
 *  mentionOptions? : array   — 부모 패널이 빌드한 멘션 옵션 풀
 *  activeJobIds?   : object  — { [job_id]: { job_id, photo_id, parent_photo_id?, started_at, kind } }
 *  onRefineStart?  : (jobInfo) => void — 패널이 폴링 인계받도록 콜백
 *  onClose         : () => void
 *  onDeleted?      : () => void
 *  onChained?      : () => void  — refine 잡 완료 시(부모 갤러리 갱신용)
 */
const PREFIX = '[WeddingPhotoDetail]';

const MODEL_LABEL = {
  gpt_image_2: 'GPT Image 2',
  nb_pro: 'Nano Banana Pro',
};

export default function WeddingPhotoDetailModal({
  mvJobId,
  photoId,
  mentionOptions = [],
  activeJobIds = {},
  onRefineStart,
  onClose,
  onDeleted,
  onChained,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);

  // v15 — chain 상태
  const [chain, setChain] = useState([]); // 시간 순(asc)
  const [activeIdx, setActiveIdx] = useState(-1); // 현재 모달에 표시 중인 버전

  // v15 — refine 폼 상태
  const [refineRequest, setRefineRequest] = useState('');
  const [refineRefs, setRefineRefs] = useState([]);
  // v15.1 — refineModel 은 chain 의 first 모델로 락. 초기값은 placeholder, 로드 후 lockedModel 로 덮어씀.
  const [refineModel, setRefineModel] = useState('gpt_image_2');
  const [refineError, setRefineError] = useState('');
  const [tick, setTick] = useState(0);

  // ─────────────────────────────────────────────────────────────
  // 초기 fetch: detail + chain
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        if (import.meta.env.DEV) {
          console.info(`${PREFIX} fetch`, { mv_job_id: mvJobId, photo_id: photoId });
        }
        const [detailRes, chainRes] = await Promise.all([
          api.getWeddingPhoto(mvJobId, photoId),
          api.getWeddingPhotoChain(mvJobId, photoId),
        ]);
        if (cancelled) return;
        setData(detailRes.data);
        const items = Array.isArray(chainRes.data?.items) ? chainRes.data.items : [];
        setChain(items);
        const idx = items.findIndex((v) => v.photo_id === photoId);
        setActiveIdx(idx >= 0 ? idx : Math.max(items.length - 1, 0));
        // v15.1 — 모델 락: chain 의 first 자산 모델로 refineModel 초기화.
        const lockedFromChain =
          items[0]?.meta?.image_model ||
          detailRes.data?.image_model ||
          detailRes.data?.meta?.image_model ||
          '';
        if (lockedFromChain) {
          setRefineModel(lockedFromChain);
        }
        if (import.meta.env.DEV) {
          console.info(`${PREFIX} chain loaded`, {
            photo_id: photoId,
            chain_size: items.length,
            active_version: idx >= 0 ? idx + 1 : items.length,
          });
        }
      } catch (err) {
        const status = err?.response?.status;
        const detail = err?.response?.data?.detail || err?.message || 'fetch error';
        console.error(`${PREFIX} fetch failed`, {
          status,
          detail,
          photo_id: photoId,
        });
        if (!cancelled) setError('웨딩사진 정보를 불러오지 못했습니다.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mvJobId, photoId]);

  // Esc 키로 닫기.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && typeof onClose === 'function') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // ─────────────────────────────────────────────────────────────
  // v15.2 — refine 폴링은 패널이 담당. 모달 내부에서는 폴링 안 함.
  //   activeJobIds 변동(잡 완료 = 사라짐) 시 chain 을 자동 refetch.
  // ─────────────────────────────────────────────────────────────
  const activeJobsKey = useMemo(
    () => Object.keys(activeJobIds || {}).sort().join(','),
    [activeJobIds],
  );

  // 현재 chain 의 어떤 사진을 부모로 하는 refine 잡이 진행 중인지.
  const refiningChainPhotoIds = useMemo(() => {
    const set = new Set();
    for (const j of Object.values(activeJobIds || {})) {
      if (j?.kind === 'refine' && j?.parent_photo_id) {
        set.add(j.parent_photo_id);
      }
    }
    return set;
  }, [activeJobIds]);

  // activeVersion 의 photo_id 가 진행 중 refine 의 parent 인지.
  const activeChainPhotoId = chain[activeIdx]?.photo_id || photoId;
  const isRefiningActive =
    refiningChainPhotoIds.has(activeChainPhotoId) ||
    refiningChainPhotoIds.has(photoId);

  // refine 잡 진행 중일 때 1초 ticker 로 elapsed 갱신 (UI 용).
  useEffect(() => {
    if (!isRefiningActive) return undefined;
    const handle = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(handle);
  }, [isRefiningActive]);
  // tick 사용 표시(린트 가드)
  void tick;

  // refine 잡이 완료(activeJobIds 에서 사라짐) 또는 chain 변동 시 chain refetch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: chainData } = await api.getWeddingPhotoChain(mvJobId, photoId);
        if (cancelled) return;
        const items = Array.isArray(chainData?.items) ? chainData.items : [];
        setChain((prev) => {
          // 새 버전이 추가됐다면 최신 버전 자동 선택 + 폼 리셋.
          if (items.length > prev.length) {
            setActiveIdx(items.length - 1);
            setRefineRequest('');
            setRefineRefs([]);
            if (typeof onChained === 'function') onChained();
            if (import.meta.env.DEV) {
              console.info(`${PREFIX} chain extended`, {
                photo_id: photoId,
                chain_size: items.length,
              });
            }
          }
          return items;
        });
      } catch (err) {
        const status = err?.response?.status;
        const detail = err?.response?.data?.detail || err?.message || 'chain error';
        console.error(`${PREFIX} chain refetch failed`, {
          status,
          detail,
          photo_id: photoId,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mvJobId, photoId, activeJobsKey]);

  // ─────────────────────────────────────────────────────────────
  // 핸들러
  // ─────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!window.confirm('이 웨딩사진을 삭제하시겠습니까?')) return;
    try {
      setDeleting(true);
      const activePhotoId = (chain[activeIdx] || {}).photo_id || photoId;
      if (import.meta.env.DEV) {
        console.info(`${PREFIX} delete`, {
          mv_job_id: mvJobId,
          photo_id: activePhotoId,
        });
      }
      await api.deleteWeddingPhoto(mvJobId, activePhotoId);
      // chain refetch — 비었으면 모달 닫기
      try {
        const { data: chainData } = await api.getWeddingPhotoChain(mvJobId, photoId);
        const items = Array.isArray(chainData?.items) ? chainData.items : [];
        if (items.length === 0) {
          if (typeof onDeleted === 'function') onDeleted();
          return;
        }
        setChain(items);
        setActiveIdx(Math.min(activeIdx, items.length - 1));
        if (typeof onChained === 'function') onChained();
      } catch (chainErr) {
        // chain refetch 실패(예: 진입 photo_id 자체가 삭제됨) → 모달 닫기
        console.error(`${PREFIX} chain refetch after delete failed`, {
          err: chainErr?.message,
          photo_id: photoId,
        });
        if (typeof onDeleted === 'function') onDeleted();
      }
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || err?.message || 'delete error';
      console.error(`${PREFIX} delete failed`, {
        status,
        detail,
        photo_id: photoId,
      });
      // eslint-disable-next-line no-alert
      alert('삭제에 실패했습니다.');
    } finally {
      setDeleting(false);
    }
  };

  // v16 — 단일 다운로드.
  const handleDownload = async () => {
    if (!activeVersion?.photo_id) return;
    try {
      if (import.meta.env.DEV) {
        console.info(`${PREFIX} download`, { photo_id: activeVersion.photo_id });
      }
      const res = await api.downloadWeddingPhoto(mvJobId, activeVersion.photo_id);
      const blob = new Blob([res.data], { type: 'image/png' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wedding-${mvJobId.slice(0, 8)}-${activeVersion.photo_id.slice(0, 8)}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(`${PREFIX} download failed`, { err });
      // eslint-disable-next-line no-alert
      alert('다운로드에 실패했습니다.');
    }
  };

  const handleRefine = async () => {
    setRefineError('');
    try {
      const activePhotoId = (chain[activeIdx] || {}).photo_id || photoId;
      // v15.1 — 락된 모델 사용 (UI 라디오는 disabled, state 만 명시 전달).
      const lockedModel =
        chain[0]?.meta?.image_model ||
        data?.image_model ||
        data?.meta?.image_model ||
        refineModel;
      if (import.meta.env.DEV) {
        console.info(`${PREFIX} refine start`, {
          mv_job_id: mvJobId,
          parent: activePhotoId,
          model: lockedModel,
          text_len: (refineRequest || '').length,
          ref_count: (refineRefs || []).length,
          refine_phase: 'start',
        });
      }
      const { data: resp } = await api.refineWeddingPhoto(mvJobId, activePhotoId, {
        refine_request: refineRequest,
        refine_request_refs: refineRefs,
        image_model: lockedModel,
      });
      // v15.2 — 폴링은 패널에 위임.
      if (typeof onRefineStart === 'function') {
        onRefineStart({
          job_id: resp.job_id,
          photo_id: resp.photo_id,
          parent_photo_id: activePhotoId,
          started_at: Date.now(),
        });
      }
      if (import.meta.env.DEV) {
        console.info(`${PREFIX} refine started (delegated to panel)`, {
          job_id: resp.job_id,
          photo_id: resp.photo_id,
          parent_photo_id: activePhotoId,
        });
      }
    } catch (err) {
      const status = err?.response?.status;
      const detail =
        err?.response?.data?.detail || err?.message || '수정 요청 실패';
      console.error(`${PREFIX} refine failed`, {
        status,
        detail,
        photo_id: photoId,
      });
      setRefineError(detail);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // 활성 버전 (chain 우선, fallback 은 단일 fetch)
  // ─────────────────────────────────────────────────────────────
  const activeVersion = useMemo(() => {
    if (activeIdx >= 0 && chain[activeIdx]) return chain[activeIdx];
    return data || null;
  }, [chain, activeIdx, data]);

  const activeMeta = activeVersion?.meta || {};
  // 사용 자산은 v1 부터 공통이므로 detail 의 groom/bride/place 우선,
  // 없으면 activeVersion 의 meta 에서 추출.
  const groom = data?.groom || activeMeta?.groom || null;
  const bride = data?.bride || activeMeta?.bride || null;
  const place = data?.place || activeMeta?.place || null;
  const isOriginal = activeIdx <= 0;
  // 활성 버전 메타 — v1 이면 user_text, 그 외에는 refine_request.
  const v1UserText = chain[0]?.meta?.user_text ?? data?.user_text ?? '';
  const activeRefineRequest = activeMeta?.refine_request || '';
  const imageModel =
    activeMeta?.image_model || data?.image_model || data?.meta?.image_model || '';
  const createdAt = activeVersion?.created_at || data?.created_at;
  // v15.1 — 락된 모델 (chain 의 first 자산 기준).
  const lockedModel =
    chain[0]?.meta?.image_model ||
    data?.image_model ||
    data?.meta?.image_model ||
    refineModel;
  // v15.2 — 진행 중인 refine 잡의 started_at 으로 elapsed 계산.
  const activeRefineJob = useMemo(() => {
    for (const j of Object.values(activeJobIds || {})) {
      if (
        j?.kind === 'refine' &&
        (j?.parent_photo_id === activeChainPhotoId || j?.parent_photo_id === photoId)
      ) {
        return j;
      }
    }
    return null;
  }, [activeJobIds, activeChainPhotoId, photoId]);
  const refineElapsedSec = activeRefineJob?.started_at
    ? Math.max(0, Math.floor((Date.now() - activeRefineJob.started_at) / 1000))
    : 0;

  return (
    <div className="wp-modal" role="dialog" aria-modal="true" aria-label="웨딩사진 디테일">
      <div className="wp-modal__backdrop" onClick={onClose} />
      <div className="wp-modal__card">
        <div className="wp-modal__head">
          <h3 className="wp-modal__title">웨딩사진</h3>
          <button
            type="button"
            className="wp-modal__close"
            onClick={onClose}
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        {loading && <p className="wp-modal__muted">불러오는 중...</p>}
        {error && <p className="wp-modal__error">{error}</p>}

        {data && !loading && !error && (
          <div className="wp-modal__body">
            <div className="wp-modal__left">
              {/* v15 — chain 타임라인 */}
              {chain.length > 1 && (
                <div className="wp-modal__chain">
                  {chain.map((v, idx) => (
                    <button
                      key={v.photo_id}
                      type="button"
                      className={`wp-modal__chain-item${idx === activeIdx ? ' is-active' : ''}`}
                      onClick={() => setActiveIdx(idx)}
                      title={v.meta?.refine_request || (idx === 0 ? '원본' : '')}
                    >
                      {v.object_name ? (
                        <img src={api.sheetPreviewUrl(v.object_name)} alt="" />
                      ) : (
                        <div className="wp-modal__chain-empty">···</div>
                      )}
                      <span>v{idx + 1}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="wp-modal__main">
                {activeVersion?.object_name ? (
                  <img
                    src={api.sheetPreviewUrl(activeVersion.object_name)}
                    alt="웨딩사진"
                  />
                ) : (
                  <div className="wp-modal__placeholder">미리보기를 사용할 수 없습니다</div>
                )}
              </div>
            </div>

            <div className="wp-modal__meta">
              <h4>사용 자산</h4>
              <AssetRow asset={groom} fallback="신랑 시트" />
              <AssetRow asset={bride} fallback="신부 시트" />
              <AssetRow asset={place} fallback="장소" />

              <h4>지시사항</h4>
              {isOriginal ? (
                <p className="wp-modal__text">
                  {v1UserText ? (
                    v1UserText
                  ) : (
                    <span className="wp-modal__muted">(없음)</span>
                  )}
                </p>
              ) : (
                <p className="wp-modal__text">
                  <strong>v{activeIdx + 1} 수정 지시:</strong>{' '}
                  {activeRefineRequest || (
                    <span className="wp-modal__muted">(없음)</span>
                  )}
                </p>
              )}

              <h4>메타</h4>
              <p className="wp-modal__muted">모델: {imageModel || '-'}</p>
              <p className="wp-modal__muted">
                생성일: {createdAt ? new Date(createdAt).toLocaleString('ko-KR') : '-'}
              </p>

              {/* v15 — refine 폼 */}
              <div className="wp-modal__refine">
                <h4>🔧 다시 수정 요청</h4>
                {/* v15.1 — 모델 락 안내 (라디오는 readonly 표시) */}
                <div className="wp-modal__refine-models" aria-disabled="true">
                  <span className="wp-modal__muted">
                    이 작품은{' '}
                    <strong>{MODEL_LABEL[lockedModel] || lockedModel || '-'}</strong>{' '}
                    로 시작했어요. 같은 모델로 수정됩니다.
                  </span>
                </div>
                <MentionField
                  id={`wedding-photo-refine-${photoId}`}
                  ariaLabel="refine-request"
                  value={refineRequest}
                  refs={refineRefs}
                  onChange={setRefineRequest}
                  onChangeRefs={setRefineRefs}
                  options={mentionOptions}
                  placeholder="예: @서울야경 을 노을 톤으로, @bride_wedding 표정 더 환하게"
                  rows={3}
                  disabled={isRefiningActive}
                />
                {refineError && <p className="wp-modal__error">{refineError}</p>}
                {isRefiningActive ? (
                  <p className="wp-modal__muted">
                    수정 생성 중... {refineElapsedSec}초
                  </p>
                ) : (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleRefine}
                    disabled={!refineRequest.trim() || isRefiningActive}
                  >
                    ✨ 수정 생성
                  </button>
                )}
              </div>

              <div className="wp-modal__actions">
                <button
                  type="button"
                  className="btn-ghost wp-modal__danger"
                  onClick={handleDelete}
                  disabled={deleting || isRefiningActive}
                >
                  {deleting ? '삭제 중...' : '🗑 삭제'}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={handleDownload}
                  disabled={!activeVersion?.object_name}
                >
                  ⬇ 다운로드
                </button>
                <button type="button" className="btn-ghost" onClick={onClose}>
                  닫기
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AssetRow({ asset, fallback }) {
  if (!asset) {
    return (
      <div className="wp-modal__asset">
        <div className="wp-modal__asset-thumb wp-modal__asset-thumb--empty" aria-hidden="true">
          ?
        </div>
        <div className="wp-modal__asset-name wp-modal__muted">{fallback} (정보 없음)</div>
      </div>
    );
  }
  return (
    <div className="wp-modal__asset">
      <div className="wp-modal__asset-thumb">
        {asset.object_name ? (
          <img src={api.sheetPreviewUrl(asset.object_name)} alt="" />
        ) : (
          <span aria-hidden="true">?</span>
        )}
      </div>
      <div className="wp-modal__asset-name">
        {asset.display_name || asset.slot || fallback || '(직접 업로드)'}
      </div>
    </div>
  );
}
