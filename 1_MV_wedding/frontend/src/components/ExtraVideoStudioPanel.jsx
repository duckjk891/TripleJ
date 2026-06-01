import { ZoomableImage } from './ImageLightbox';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../api';
import { useAuth } from '../contexts/AuthContext';
import MentionField from './MentionField';
import ExtraVideoDetailModal from './ExtraVideoDetailModal';
import './ExtraVideoStudioPanel.css';

/**
 * v23.2 — ExtraVideoStudioPanel
 *
 * 작품 디테일 페이지의 [추가영상생성] 탭. Higgsfield 스타일 편집자 공간.
 *  - A. 씬 이미지 만들기 (v23.1 — 활성화)
 *  - B. 씬 영상 만들기 (v23.2 — 본 커밋에서 활성화)
 *
 * Props
 *  mvJobId      : string  — 부모 mv_jobs._id
 *  mvJob        : object  — GenerationStatusPage 가 로드한 mv_job 전체 객체
 *  ownerUserId  : string  — 작품 소유자 user_id (mvJob.user_id 와 동일)
 *
 * 로그 prefix: [ExtraVideoStudioPanel] / [ExtraSceneImageSection] / [ExtraVideoSection]
 */

const PREFIX = '[ExtraVideoStudioPanel]';

export default function ExtraVideoStudioPanel({ mvJobId, mvJob, ownerUserId }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isOwner = Boolean(user) && user?.id === ownerUserId;
  const canUse = Boolean(user) && (isOwner || isAdmin);

  if (import.meta.env.DEV) {
    console.info(`${PREFIX} render`, {
      mvJobId,
      ownerUserId,
      userId: user?.id,
      role: user?.role,
      isOwner,
      isAdmin,
      canUse,
    });
  }

  if (!canUse) {
    if (import.meta.env.DEV) {
      console.error(`${PREFIX} blocked — no permission`, {
        mvJobId,
        ownerUserId,
        userId: user?.id,
        role: user?.role,
      });
    }
    return (
      <section className="extra-video-studio extra-video-studio--denied" aria-label="추가영상생성 — 접근 제한">
        <p className="extra-video-studio__denied-msg">접근 권한이 없습니다.</p>
      </section>
    );
  }

  // v23.2 — A 카드 [📹 이걸로 영상 만들기] hook. B 폼으로 lift up.
  const [pickedSceneImage, setPickedSceneImage] = useState(null);

  const handleSelectImageForVideo = (item) => {
    if (import.meta.env.DEV) {
      console.info(`${PREFIX} onSelectImageForVideo`, {
        extra_scene_image_id: item?.extra_scene_image_id,
        object_name: item?.object_name,
      });
    }
    setPickedSceneImage(item || null);
  };

  const handleConsumePickedImage = () => {
    setPickedSceneImage(null);
  };

  return (
    <section className="extra-video-studio" aria-label="추가영상생성 스튜디오">
      <header className="extra-video-studio__head">
        <h2 className="extra-video-studio__title">추가영상생성</h2>
        <p className="extra-video-studio__desc">
          자유롭게 씬 이미지와 영상을 만들고 다듬는 편집자 공간이에요.
        </p>
        {isAdmin && !isOwner && (
          <p className="extra-video-studio__admin-banner">관리자 모드로 열람 중 (작성자: {ownerUserId})</p>
        )}
      </header>

      {/* A. 씬 이미지 만들기 — v23.1 */}
      <article className="extra-video-studio__section" aria-label="씬 이미지 만들기">
        <header className="extra-video-studio__section-head">
          <h3 className="extra-video-studio__section-title">A. 씬 이미지 만들기</h3>
          <span className="extra-video-studio__section-badge">v23.1</span>
        </header>
        <ExtraSceneImageSection
          mvJobId={mvJobId}
          ownerUserId={ownerUserId}
          isAdmin={isAdmin}
          currentUserId={user.id}
          onSelectImageForVideo={handleSelectImageForVideo}
        />
      </article>

      {/* B. 씬 영상 만들기 — v23.2 활성화 */}
      <article className="extra-video-studio__section" aria-label="씬 영상 만들기">
        <header className="extra-video-studio__section-head">
          <h3 className="extra-video-studio__section-title">B. 씬 영상 만들기</h3>
          <span className="extra-video-studio__section-badge">v23.2</span>
        </header>
        <ExtraVideoSection
          mvJobId={mvJobId}
          ownerUserId={ownerUserId}
          isAdmin={isAdmin}
          currentUserId={user.id}
          pickedSceneImage={pickedSceneImage}
          onConsumePickedImage={handleConsumePickedImage}
        />
      </article>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ExtraSceneImageSection — v23.1 A 영역
// ─────────────────────────────────────────────────────────────────────────────

const SEC = '[ExtraSceneImageSection]';
const POLL_INTERVAL_MS = 5000;
const MAX_TOTAL_REFS = 4;           // (멘션 + 업로드) 합산
const BULK_MAX = 50;                // 일괄 작업 한계
const ACCEPT_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB

const IMAGE_MODELS = [
  { value: 'gpt_image_2', label: 'GPT Image 2 (기본, 5~10분)' },
  { value: 'nb_pro', label: 'Nano Banana Pro (Gemini 3 Pro Image, 1~3분)' },
];

const STATUS_LABEL = {
  queued: '대기 중',
  generating: '생성 중...',
  completed: '완료',
  failed: '실패',
};

function ExtraSceneImageSection({
  mvJobId,
  ownerUserId,
  isAdmin,
  currentUserId,
  onSelectImageForVideo,
}) {
  // 멘션 풀.
  const [context, setContext] = useState(null);
  const [loadingContext, setLoadingContext] = useState(true);
  const [contextError, setContextError] = useState('');

  // 입력 폼.
  const [userText, setUserText] = useState('');
  const [selectedRefs, setSelectedRefs] = useState([]);    // 멘션 refs
  const [uploadedNames, setUploadedNames] = useState([]);  // 업로드된 object_name 들
  const [imageModel, setImageModel] = useState('gpt_image_2');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // 갤러리.
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');

  // 선택 모드.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  // 업로드 input ref.
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // ── 컨텍스트 로드 ─────────────────────────────────────────────────────────
  const reloadContext = async () => {
    try {
      if (import.meta.env.DEV) {
        console.info(`${SEC} getJobContext`, { mv_job_id: mvJobId });
      }
      const { data } = await api.getJobContext(mvJobId);
      setContext(data);
      setContextError('');
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || err?.message || 'context error';
      console.error(`${SEC} getJobContext failed`, {
        status,
        detail,
        mv_job_id: mvJobId,
      });
      setContextError('컨텍스트를 불러오지 못했습니다.');
    } finally {
      setLoadingContext(false);
    }
  };

  // ── 갤러리 reload ─────────────────────────────────────────────────────────
  const reloadItems = async () => {
    try {
      if (import.meta.env.DEV) {
        console.info(`${SEC} list`, { mv_job_id: mvJobId });
      }
      const { data } = await api.listExtraSceneImages(mvJobId);
      const list = Array.isArray(data?.items) ? data.items : [];
      setItems(list);
      setListError('');
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || err?.message || 'list error';
      console.error(`${SEC} list failed`, {
        status,
        detail,
        mv_job_id: mvJobId,
      });
      setListError('씬 이미지 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reloadContext();
    reloadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mvJobId]);

  // ── 멘션 옵션 풀 빌드 ─────────────────────────────────────────────────────
  const mentionOptions = useMemo(() => {
    const opts = [];
    for (const s of context?.owner_sheets || []) {
      if (!s || !s.slot) continue;
      opts.push({
        type: 'sheet',
        asset_id: s.slot,
        display_name: s.display_name || s.slot,
        object_name: s.sheet_object_name || null,
        group_label: '🧑 시트',
      });
    }
    for (const p of context?.owner_places || []) {
      if (!p || !p.place_id) continue;
      opts.push({
        type: 'place',
        asset_id: p.place_id,
        display_name: p.display_name || '(이름 없음)',
        object_name: p.object_name || null,
        group_label: '📍 장소',
      });
    }
    for (const ph of context?.wedding_photos || []) {
      if (!ph || !ph.photo_id) continue;
      // wedding_photo 자산은 display_name 이 별도 없음 — 짧은 id 로 라벨.
      const shortId = String(ph.photo_id).slice(0, 6);
      opts.push({
        type: 'wedding_photo',
        asset_id: ph.photo_id,
        display_name: `웨딩사진-${shortId}`,
        object_name: ph.object_name || null,
        group_label: '💞 웨딩사진',
      });
    }
    // v26 — 식전영상에서 만들어진 씬 이미지들도 @멘션 풀에 노출.
    for (const sc of context?.pre_mv_scenes || []) {
      if (!sc || !sc.token) continue;
      opts.push({
        type: 'scene_image',
        asset_id: sc.token,
        display_name: sc.token,
        object_name: sc.object_name || null,
        group_label: '🎬 식전영상 씬',
      });
    }
    if (import.meta.env.DEV) {
      console.info(`${SEC} mentionOptions built`, {
        sheets: (context?.owner_sheets || []).length,
        places: (context?.owner_places || []).length,
        wedding_photos: (context?.wedding_photos || []).length,
        pre_mv_scenes: (context?.pre_mv_scenes || []).length,
      });
    }
    return opts;
  }, [context]);

  // ── 폴링 — queued/generating 가 있을 때만 5초 ──────────────────────────────
  const hasActive = useMemo(
    () => items.some((it) => it.status === 'queued' || it.status === 'generating'),
    [items],
  );

  useEffect(() => {
    if (!hasActive) return undefined;
    if (import.meta.env.DEV) {
      console.info(`${SEC} polling start`, { mv_job_id: mvJobId });
    }
    const handle = setInterval(() => {
      reloadItems();
    }, POLL_INTERVAL_MS);
    return () => {
      clearInterval(handle);
      if (import.meta.env.DEV) {
        console.info(`${SEC} polling stop`, { mv_job_id: mvJobId });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasActive, mvJobId]);

  // ── 업로드 (참조 이미지) ──────────────────────────────────────────────────
  const handleUpload = async (file) => {
    setUploadError('');
    if (!file) return;
    if (!ACCEPT_TYPES.includes(file.type)) {
      setUploadError('jpg/png/webp 만 업로드 가능합니다.');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setUploadError('파일 크기는 10MB 이하여야 합니다.');
      return;
    }
    const totalAfter = selectedRefs.length + uploadedNames.length + 1;
    if (totalAfter > MAX_TOTAL_REFS) {
      setUploadError(
        `참조 자산은 (멘션 + 업로드) 합산 최대 ${MAX_TOTAL_REFS}장입니다.`,
      );
      return;
    }
    try {
      setUploading(true);
      if (import.meta.env.DEV) {
        console.info(`${SEC} upload start`, {
          name: file.name,
          size: file.size,
          type: file.type,
        });
      }
      const { data } = await api.uploadAsset(file, 'photo');
      if (!data?.object_name) {
        throw new Error('서버 응답에 object_name 이 없습니다.');
      }
      setUploadedNames((prev) => [...prev, data.object_name]);
      if (import.meta.env.DEV) {
        console.info(`${SEC} upload ok`, { object_name: data.object_name });
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || err?.message || 'upload error';
      console.error(`${SEC} upload failed`, { status, detail });
      setUploadError(detail || '업로드에 실패했습니다.');
    } finally {
      setUploading(false);
    }
  };

  const removeUploaded = (objectName) => {
    setUploadedNames((prev) => prev.filter((n) => n !== objectName));
  };

  // ── 씬 이미지 생성 시작 ───────────────────────────────────────────────────
  const handleGenerate = async () => {
    setSubmitError('');
    const totalRefs = selectedRefs.length + uploadedNames.length;
    if (totalRefs > MAX_TOTAL_REFS) {
      setSubmitError(
        `참조 자산은 (멘션 + 업로드) 합산 최대 ${MAX_TOTAL_REFS}장입니다. 현재 ${totalRefs}장.`,
      );
      return;
    }
    if (totalRefs === 0 && !(userText || '').trim()) {
      setSubmitError('지시문 또는 참조 이미지 중 1개 이상은 필요합니다.');
      return;
    }
    const payload = {
      refs: selectedRefs.map((r) => ({
        type: r.type,
        asset_id: r.asset_id,
        display_name: r.display_name,
        object_name: r.object_name ?? null,
      })),
      extra_image_object_names: uploadedNames.slice(),
      user_text: userText || '',
      image_model: imageModel,
    };
    try {
      setSubmitting(true);
      if (import.meta.env.DEV) {
        console.info(`${SEC} generate start`, {
          mv_job_id: mvJobId,
          image_model: imageModel,
          refs_count: payload.refs.length,
          uploaded_count: payload.extra_image_object_names.length,
          text_len: (payload.user_text || '').length,
        });
      }
      const { data } = await api.createExtraSceneImage(mvJobId, payload);
      if (!data?.extra_scene_image_id) {
        throw new Error('서버 응답에 extra_scene_image_id 가 없습니다.');
      }
      if (import.meta.env.DEV) {
        console.info(`${SEC} generate queued`, {
          extra_scene_image_id: data.extra_scene_image_id,
          status: data.status,
        });
      }
      // 갤러리 즉시 reload + 폴링은 hasActive 이펙트가 자동으로 켬.
      await reloadItems();
    } catch (err) {
      const status = err?.response?.status;
      const detail =
        err?.response?.data?.detail ||
        err?.response?.data?.error ||
        err?.message ||
        'generate error';
      console.error(`${SEC} generate failed`, {
        status,
        detail,
        mv_job_id: mvJobId,
      });
      setSubmitError(detail || '씬 이미지 생성 시작에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── 단일 액션: 다운로드 ───────────────────────────────────────────────────
  const handleDownload = async (item) => {
    setActionError('');
    try {
      if (import.meta.env.DEV) {
        console.info(`${SEC} download`, {
          extra_scene_image_id: item.extra_scene_image_id,
        });
      }
      const res = await api.downloadExtraSceneImage(item.extra_scene_image_id);
      const blob = new Blob([res.data], { type: 'image/png' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const shortId = (item.extra_scene_image_id || '').slice(0, 8);
      a.download = `extra-scene-${shortId}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || err?.message || 'download error';
      console.error(`${SEC} download failed`, {
        status,
        detail,
        extra_scene_image_id: item?.extra_scene_image_id,
      });
      setActionError(detail || '다운로드에 실패했습니다.');
    }
  };

  // ── 단일 액션: 삭제 ───────────────────────────────────────────────────────
  const handleDelete = async (item) => {
    setActionError('');
    // eslint-disable-next-line no-alert
    if (!window.confirm('이 씬 이미지를 영구 삭제할까요? 되돌릴 수 없습니다.')) return;
    try {
      if (import.meta.env.DEV) {
        console.info(`${SEC} delete`, {
          extra_scene_image_id: item.extra_scene_image_id,
        });
      }
      await api.deleteExtraSceneImage(item.extra_scene_image_id);
      await reloadItems();
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(item.extra_scene_image_id);
        return next;
      });
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || err?.message || 'delete error';
      console.error(`${SEC} delete failed`, {
        status,
        detail,
        extra_scene_image_id: item?.extra_scene_image_id,
      });
      setActionError(detail || '삭제에 실패했습니다.');
    }
  };

  // ── 선택 모드 토글/전체선택 ───────────────────────────────────────────────
  const toggleSelectMode = () => {
    setSelectMode((s) => !s);
    setSelectedIds(new Set());
    setActionError('');
  };

  const isItemBusy = (it) => it.status === 'queued' || it.status === 'generating';

  const toggleSelect = (item) => {
    if (isItemBusy(item)) {
      // eslint-disable-next-line no-alert
      alert('생성 중인 이미지는 선택할 수 없습니다.');
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const id = item.extra_scene_image_id;
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    const eligible = items
      .filter((it) => !isItemBusy(it))
      .map((it) => it.extra_scene_image_id);
    if (eligible.length > BULK_MAX) {
      // eslint-disable-next-line no-alert
      alert(`일괄 작업은 한 번에 최대 ${BULK_MAX}개까지 가능합니다. 처음 ${BULK_MAX}개만 선택합니다.`);
    }
    setSelectedIds(new Set(eligible.slice(0, BULK_MAX)));
  };

  // ── 일괄 다운로드 (백엔드 zip 없음 — 순차 단일 다운로드) ────────────────────
  const handleBulkDownload = async () => {
    setActionError('');
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (ids.length > BULK_MAX) {
      setActionError(`일괄 다운로드는 한 번에 최대 ${BULK_MAX}개까지 가능합니다.`);
      return;
    }
    setBulkBusy(true);
    try {
      if (import.meta.env.DEV) {
        console.info(`${SEC} bulk download`, { count: ids.length });
      }
      // 순차 anchor.click — 브라우저별 동시 다운로드 차단 회피용으로 약간 간격.
      for (const id of ids) {
        const it = items.find((x) => x.extra_scene_image_id === id);
        if (!it) continue;
        // eslint-disable-next-line no-await-in-loop
        await handleDownload(it);
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch (err) {
      console.error(`${SEC} bulk download failed`, { err });
      setActionError('일괄 다운로드에 실패했습니다.');
    } finally {
      setBulkBusy(false);
    }
  };

  // ── 일괄 삭제 ─────────────────────────────────────────────────────────────
  const handleBulkDelete = async () => {
    setActionError('');
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (ids.length > BULK_MAX) {
      setActionError(`일괄 삭제는 한 번에 최대 ${BULK_MAX}개까지 가능합니다.`);
      return;
    }
    // eslint-disable-next-line no-alert
    if (!window.confirm(`선택한 ${ids.length}장을 영구 삭제할까요? 되돌릴 수 없습니다.`)) return;
    setBulkBusy(true);
    try {
      if (import.meta.env.DEV) {
        console.info(`${SEC} bulk delete`, { count: ids.length });
      }
      const { data } = await api.bulkDeleteExtraSceneImages(ids);
      await reloadItems();
      setSelectedIds(new Set());
      const dCount = data?.deleted_count || 0;
      const failed = Array.isArray(data?.failed) ? data.failed : [];
      if (failed.length > 0) {
        // eslint-disable-next-line no-alert
        alert(`${dCount}장 삭제 완료. ${failed.length}장 실패.`);
      } else {
        // eslint-disable-next-line no-alert
        alert(`${dCount}장 삭제 완료`);
      }
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || err?.message || 'bulk delete error';
      console.error(`${SEC} bulk delete failed`, { status, detail });
      setActionError(detail || '일괄 삭제에 실패했습니다.');
    } finally {
      setBulkBusy(false);
    }
  };

  // ── 렌더 ─────────────────────────────────────────────────────────────────
  const totalRefsNow = selectedRefs.length + uploadedNames.length;
  const refsExceeded = totalRefsNow > MAX_TOTAL_REFS;

  return (
    <div className="extra-scene-img-section">
      {isAdmin && ownerUserId && ownerUserId !== currentUserId && (
        <div className="extra-scene-img-section__admin-banner">
          관리자 모드 — 다른 사용자의 작품에 작업 중
        </div>
      )}

      {loadingContext && (
        <div className="extra-scene-img-section__hint">컨텍스트를 불러오는 중...</div>
      )}
      {contextError && (
        <div className="extra-scene-img-section__error">{contextError}</div>
      )}

      {/* 입력 영역 */}
      <div className="extra-scene-img-section__form">
        <div className="extra-scene-img-section__row">
          <label className="extra-scene-img-section__row-label">① 지시사항 & 멘션</label>
          <MentionField
            id={`extra-scene-img-text-${mvJobId}`}
            ariaLabel="씬 이미지 지시사항"
            value={userText}
            refs={selectedRefs}
            onChange={setUserText}
            onChangeRefs={setSelectedRefs}
            options={mentionOptions}
            rows={4}
            placeholder="예: @meeting_1 톤으로 @groom_casual 이 벤치에 앉아있는 장면..."
          />
          <div className="extra-scene-img-section__hint">
            `@` 입력 → 시트 / 장소 / 웨딩사진 / 식전영상 씬 자산 추천. 멘션 + 업로드 합산 최대 {MAX_TOTAL_REFS}장.
          </div>
        </div>

        <div className="extra-scene-img-section__row">
          <label className="extra-scene-img-section__row-label">② 추가 이미지 업로드(선택)</label>
          <div className="extra-scene-img-section__upload-zone">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT_TYPES.join(',')}
              onChange={(e) => handleUpload(e.target.files?.[0] || null)}
              disabled={uploading || totalRefsNow >= MAX_TOTAL_REFS}
            />
            {uploading && <span className="extra-scene-img-section__hint">업로드 중...</span>}
            {uploadError && (
              <div className="extra-scene-img-section__error">{uploadError}</div>
            )}
            {uploadedNames.length > 0 && (
              <ul className="extra-scene-img-section__upload-list">
                {uploadedNames.map((nm) => (
                  <li key={nm} className="extra-scene-img-section__upload-item">
                    <ZoomableImage src={api.sheetPreviewUrl(nm)} alt="업로드 미리보기" />
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => removeUploaded(nm)}
                    >
                      제거
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="extra-scene-img-section__hint">
            현재 참조: 멘션 {selectedRefs.length}장 + 업로드 {uploadedNames.length}장
            {' '}= 총 {totalRefsNow}장
            {refsExceeded && <span className="extra-scene-img-section__warn"> (초과!)</span>}
          </div>
        </div>

        <div className="extra-scene-img-section__row">
          <label className="extra-scene-img-section__row-label">③ 이미지 모델</label>
          <div className="extra-scene-img-section__model-radio">
            {IMAGE_MODELS.map((m) => (
              <label
                key={m.value}
                className={`extra-scene-img-section__model${imageModel === m.value ? ' is-selected' : ''}`}
              >
                <input
                  type="radio"
                  name="extraSceneImgModel"
                  value={m.value}
                  checked={imageModel === m.value}
                  onChange={() => setImageModel(m.value)}
                />
                <span>{m.label}</span>
              </label>
            ))}
          </div>
        </div>

        {submitError && (
          <div className="extra-scene-img-section__error">{submitError}</div>
        )}

        <div className="extra-scene-img-section__actions">
          <button
            type="button"
            className="btn-primary"
            onClick={handleGenerate}
            disabled={submitting || refsExceeded}
          >
            {submitting ? '시작하는 중...' : '🎨 씬 이미지 만들기'}
          </button>
          {hasActive && (
            <span className="extra-scene-img-section__hint">
              진행 중인 잡이 있어 5초마다 자동 새로고침합니다.
            </span>
          )}
        </div>
      </div>

      {/* 갤러리 헤더 */}
      <div className="extra-scene-img-section__gallery-head">
        <h4 className="extra-scene-img-section__gallery-title">생성 갤러리</h4>
        <span className="extra-scene-img-section__hint">{items.length}개</span>
        <button
          type="button"
          className="btn-ghost"
          onClick={toggleSelectMode}
          disabled={bulkBusy || items.length === 0}
        >
          {selectMode ? '✕ 선택 끄기' : '☑ 선택'}
        </button>
      </div>

      {selectMode && (
        <div className="extra-scene-img-section__bulk-actions">
          <span>선택: {selectedIds.size}개</span>
          <button
            type="button"
            className="btn-ghost"
            onClick={handleSelectAll}
            disabled={bulkBusy}
          >
            전체 선택
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={handleBulkDownload}
            disabled={selectedIds.size === 0 || bulkBusy}
          >
            {bulkBusy ? '...' : `⬇ 일괄 다운로드(${selectedIds.size})`}
          </button>
          <button
            type="button"
            className="btn-ghost danger"
            onClick={handleBulkDelete}
            disabled={selectedIds.size === 0 || bulkBusy}
          >
            🗑 일괄 삭제({selectedIds.size})
          </button>
        </div>
      )}

      {actionError && (
        <div className="extra-scene-img-section__error">{actionError}</div>
      )}
      {listError && (
        <div className="extra-scene-img-section__error">{listError}</div>
      )}

      {/* 갤러리 */}
      {loading ? (
        <div className="extra-scene-img-section__hint">목록을 불러오는 중...</div>
      ) : items.length === 0 ? (
        <div className="extra-scene-img-section__empty">
          아직 생성한 씬 이미지가 없습니다.
        </div>
      ) : (
        <div className="extra-scene-img-section__gallery">
          {items.map((it) => {
            const isSelected = selectedIds.has(it.extra_scene_image_id);
            const busy = isItemBusy(it);
            const cardClass =
              `extra-scene-img-card`
              + (isSelected ? ' is-selected' : '')
              + (busy ? ' is-busy' : '');
            return (
              <div key={it.extra_scene_image_id} className={cardClass}>
                {selectMode && !busy && (
                  <div className="extra-scene-img-card__check">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(it)}
                    />
                  </div>
                )}
                <div className="extra-scene-img-card__thumb">
                  {it.status === 'completed' && it.object_name ? (
                    <ZoomableImage
                      src={api.extraSceneImagePreviewUrl(it.object_name)}
                      alt="씬 이미지"
                      loading="lazy"
                    />
                  ) : it.status === 'failed' ? (
                    <div className="extra-scene-img-card__failed">
                      <div>⚠</div>
                      <div className="extra-scene-img-card__failed-msg">
                        {it.error_message || '생성 실패'}
                      </div>
                    </div>
                  ) : (
                    <div className="extra-scene-img-card__spinner">
                      <div className="extra-scene-img-card__dot" />
                      <span>{STATUS_LABEL[it.status] || it.status}</span>
                    </div>
                  )}
                </div>

                <div className={`extra-scene-img-card__status-badge is-${it.status}`}>
                  {STATUS_LABEL[it.status] || it.status}
                </div>

                <div className="extra-scene-img-card__meta">
                  <span>{it.image_model}</span>
                  {it.created_at && (
                    <span>
                      {new Date(it.created_at).toLocaleString('ko-KR', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  )}
                </div>

                <div className="extra-scene-img-card__actions">
                  {it.status === 'completed' && (
                    <>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => onSelectImageForVideo?.(it)}
                        title="이 이미지로 영상 만들기 (v23.2 에서 활성화)"
                      >
                        📹 이걸로 영상 만들기
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => handleDownload(it)}
                      >
                        ⬇ 다운로드
                      </button>
                    </>
                  )}
                  {(it.status === 'completed' || it.status === 'failed') && (
                    <button
                      type="button"
                      className="btn-ghost danger"
                      onClick={() => handleDelete(it)}
                    >
                      🗑 삭제
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// ExtraVideoSection — v23.2 B 영역 (씬 영상 만들기)
// ─────────────────────────────────────────────────────────────────────────────

const VSEC = '[ExtraVideoSection]';
const VIDEO_POLL_INTERVAL_MS = 5000;
const VIDEO_BULK_MAX = 50;
const VIDEO_UPLOAD_ACCEPT = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const VIDEO_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

const VIDEO_MODELS = [
  { value: 'veo', label: 'Veo 3.1 (8s 고정)' },
  { value: 'kling', label: 'Kling 3.0 Omni' },
  { value: 'seedance', label: 'Seedance 2.0' },
  { value: 'grok', label: 'Grok' },
];

// 모델별 선택 가능 길이 옵션.
const VIDEO_LENGTH_OPTIONS = {
  veo: [8],
  kling: [3, 5, 8, 10, 15],
  seedance: [5, 8, 10, 12, 15],
  grok: [1, 3, 5, 8, 10],
};

const VIDEO_STATUS_LABEL = {
  queued: '대기 중',
  video_generating: '영상 생성 중...',
  generating: '생성 중...',
  completed: '완료',
  failed: '실패',
};

// v23.3 — Higgsfield 스타일 카메라 모션 프리셋 (백엔드 CAMERA_MOTION_PRESETS 와 일치).
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

function ExtraVideoSection({
  mvJobId,
  ownerUserId,
  isAdmin,
  currentUserId,
  pickedSceneImage,
  onConsumePickedImage,
}) {
  // 소스 모드.
  const [sourceMode, setSourceMode] = useState('scene_image'); // 'scene_image' | 'uploaded'
  const [selectedSceneImageId, setSelectedSceneImageId] = useState('');
  const [uploadedObjectName, setUploadedObjectName] = useState('');

  // 씬 이미지 풀 (자체 fetch — A 영역과 독립).
  const [sceneImages, setSceneImages] = useState([]);
  const [sceneLoading, setSceneLoading] = useState(true);
  const [sceneError, setSceneError] = useState('');

  // 폼 본문.
  const [motionPresets, setMotionPresets] = useState([]); // v23.3 활성화 — chips UI.
  const [videoModel, setVideoModel] = useState('veo');
  const [useSeconds, setUseSeconds] = useState(8);
  const [userText, setUserText] = useState('');
  const variantCount = 1; // v23.2: disabled, 항상 1.

  // 업로드.
  const uploadRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // 제출.
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // 갤러리.
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');

  // 선택 모드.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  // v23.3 — 디테일 모달 (멀티턴 refine).
  const [detailVideoId, setDetailVideoId] = useState(null);

  const openDetail = (item) => {
    if (!item?.extra_video_id) return;
    if (import.meta.env.DEV) {
      console.info(`${VSEC} openDetail`, {
        extra_video_id: item.extra_video_id,
        status: item.status,
      });
    }
    setDetailVideoId(item.extra_video_id);
  };

  const closeDetail = () => setDetailVideoId(null);

  const handleMotionToggle = (value) => {
    setMotionPresets((prev) => {
      if (prev.includes(value)) return prev.filter((v) => v !== value);
      return [...prev, value];
    });
  };

  // ── 씬 이미지 풀 reload ───────────────────────────────────────────────────
  const reloadSceneImages = async () => {
    try {
      if (import.meta.env.DEV) {
        console.info(`${VSEC} listScene`, { mv_job_id: mvJobId });
      }
      const { data } = await api.listExtraSceneImages(mvJobId);
      const all = Array.isArray(data?.items) ? data.items : [];
      // completed 만 picker 에 노출.
      const completed = all.filter((it) => it.status === 'completed' && it.object_name);
      setSceneImages(completed);
      setSceneError('');
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || err?.message || 'scene list error';
      console.error(`${VSEC} listScene failed`, {
        status,
        detail,
        mv_job_id: mvJobId,
      });
      setSceneError('씬 이미지 목록을 불러오지 못했습니다.');
    } finally {
      setSceneLoading(false);
    }
  };

  // ── 갤러리 reload ─────────────────────────────────────────────────────────
  const reloadItems = async () => {
    try {
      if (import.meta.env.DEV) {
        console.info(`${VSEC} list`, { mv_job_id: mvJobId });
      }
      const { data } = await api.listExtraVideos(mvJobId);
      const list = Array.isArray(data?.items) ? data.items : [];
      setItems(list);
      setListError('');
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || err?.message || 'list error';
      console.error(`${VSEC} list failed`, {
        status,
        detail,
        mv_job_id: mvJobId,
      });
      setListError('영상 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reloadSceneImages();
    reloadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mvJobId]);

  // ── A → B prop drilling: pickedSceneImage 가 들어오면 자동 채우기 ────────
  useEffect(() => {
    if (!pickedSceneImage) return;
    if (import.meta.env.DEV) {
      console.info(`${VSEC} consume pickedSceneImage`, {
        extra_scene_image_id: pickedSceneImage?.extra_scene_image_id,
        object_name: pickedSceneImage?.object_name,
      });
    }
    setSourceMode('scene_image');
    if (pickedSceneImage.extra_scene_image_id) {
      setSelectedSceneImageId(pickedSceneImage.extra_scene_image_id);
    }
    // 풀에 없어도 미리보기 보이도록, 항목을 임시로 prepend.
    setSceneImages((prev) => {
      const id = pickedSceneImage.extra_scene_image_id;
      if (!id) return prev;
      if (prev.find((x) => x.extra_scene_image_id === id)) return prev;
      return [pickedSceneImage, ...prev];
    });
    onConsumePickedImage?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedSceneImage]);

  // ── 폴링 ─────────────────────────────────────────────────────────────────
  const hasActive = useMemo(
    () => items.some(
      (it) =>
        it.status === 'queued'
        || it.status === 'video_generating'
        || it.status === 'generating',
    ),
    [items],
  );

  useEffect(() => {
    if (!hasActive) return undefined;
    if (import.meta.env.DEV) {
      console.info(`${VSEC} polling start`, { mv_job_id: mvJobId });
    }
    const h = setInterval(() => {
      reloadItems();
    }, VIDEO_POLL_INTERVAL_MS);
    return () => {
      clearInterval(h);
      if (import.meta.env.DEV) {
        console.info(`${VSEC} polling stop`, { mv_job_id: mvJobId });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasActive, mvJobId]);

  // ── 모델 변경 시 useSeconds 클램프 ────────────────────────────────────────
  useEffect(() => {
    const opts = VIDEO_LENGTH_OPTIONS[videoModel] || [5];
    if (!opts.includes(useSeconds)) {
      // 가장 가까운 옵션으로 스냅.
      const next = opts.reduce(
        (best, o) => (Math.abs(o - useSeconds) < Math.abs(best - useSeconds) ? o : best),
        opts[0],
      );
      setUseSeconds(next);
      if (import.meta.env.DEV) {
        console.info(`${VSEC} clamp use_seconds`, {
          model: videoModel,
          from: useSeconds,
          to: next,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoModel]);

  // ── 업로드 ───────────────────────────────────────────────────────────────
  const handleUpload = async (file) => {
    setUploadError('');
    if (!file) return;
    if (!VIDEO_UPLOAD_ACCEPT.includes(file.type)) {
      setUploadError('jpg/png/webp 만 업로드 가능합니다.');
      return;
    }
    if (file.size > VIDEO_UPLOAD_MAX_BYTES) {
      setUploadError('파일 크기는 10MB 이하여야 합니다.');
      return;
    }
    try {
      setUploading(true);
      if (import.meta.env.DEV) {
        console.info(`${VSEC} upload start`, {
          name: file.name,
          size: file.size,
          type: file.type,
        });
      }
      const { data } = await api.uploadAsset(file, 'photo');
      if (!data?.object_name) {
        throw new Error('서버 응답에 object_name 이 없습니다.');
      }
      setUploadedObjectName(data.object_name);
      if (import.meta.env.DEV) {
        console.info(`${VSEC} upload ok`, { object_name: data.object_name });
      }
      if (uploadRef.current) uploadRef.current.value = '';
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || err?.message || 'upload error';
      console.error(`${VSEC} upload failed`, { status, detail });
      setUploadError(detail || '업로드에 실패했습니다.');
    } finally {
      setUploading(false);
    }
  };

  // ── 영상 생성 시작 ───────────────────────────────────────────────────────
  const handleGenerate = async () => {
    setSubmitError('');
    if (sourceMode === 'scene_image' && !selectedSceneImageId) {
      setSubmitError('씬 이미지를 선택해 주세요.');
      return;
    }
    if (sourceMode === 'uploaded' && !uploadedObjectName) {
      setSubmitError('영상의 출발 이미지를 업로드해 주세요.');
      return;
    }
    const payload = {
      source_kind: sourceMode,
      source_scene_image_id:
        sourceMode === 'scene_image' ? selectedSceneImageId : null,
      source_object_name:
        sourceMode === 'uploaded' ? uploadedObjectName : null,
      user_text: userText || '',
      motion_presets: motionPresets, // v23.3 까진 빈 배열.
      video_model: videoModel,
      use_seconds: useSeconds,
      variant_count: variantCount,
    };
    try {
      setSubmitting(true);
      if (import.meta.env.DEV) {
        console.info(`${VSEC} generate start`, {
          mv_job_id: mvJobId,
          source_kind: payload.source_kind,
          video_model: payload.video_model,
          use_seconds: payload.use_seconds,
          motion_count: payload.motion_presets.length,
          text_len: (payload.user_text || '').length,
          variant_count: payload.variant_count,
        });
      }
      const { data } = await api.createExtraVideo(mvJobId, payload);
      const newId = data?.extra_video_id || data?.id;
      if (!newId) {
        throw new Error('서버 응답에 extra_video_id 가 없습니다.');
      }
      if (import.meta.env.DEV) {
        console.info(`${VSEC} generate queued`, {
          extra_video_id: newId,
          status: data?.status,
        });
      }
      await reloadItems();
    } catch (err) {
      const status = err?.response?.status;
      const detail =
        err?.response?.data?.detail
        || err?.response?.data?.error
        || err?.message
        || 'generate error';
      console.error(`${VSEC} generate failed`, {
        status,
        detail,
        mv_job_id: mvJobId,
      });
      setSubmitError(detail || '영상 생성 시작에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── 단일 액션: 다운로드 ───────────────────────────────────────────────────
  const handleDownload = async (item) => {
    setActionError('');
    try {
      if (import.meta.env.DEV) {
        console.info(`${VSEC} download`, { extra_video_id: item.extra_video_id });
      }
      const res = await api.downloadExtraVideo(item.extra_video_id);
      const blob = new Blob([res.data], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const shortId = (item.extra_video_id || '').slice(0, 8);
      a.download = `extra-video-${shortId}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || err?.message || 'download error';
      console.error(`${VSEC} download failed`, {
        status,
        detail,
        extra_video_id: item?.extra_video_id,
      });
      setActionError(detail || '다운로드에 실패했습니다.');
    }
  };

  // ── 단일 액션: 삭제 ───────────────────────────────────────────────────────
  const handleDelete = async (item) => {
    setActionError('');
    // eslint-disable-next-line no-alert
    if (!window.confirm('이 영상을 영구 삭제할까요? 되돌릴 수 없습니다.')) return;
    try {
      if (import.meta.env.DEV) {
        console.info(`${VSEC} delete`, { extra_video_id: item.extra_video_id });
      }
      await api.deleteExtraVideo(item.extra_video_id);
      await reloadItems();
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(item.extra_video_id);
        return next;
      });
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || err?.message || 'delete error';
      console.error(`${VSEC} delete failed`, {
        status,
        detail,
        extra_video_id: item?.extra_video_id,
      });
      setActionError(detail || '삭제에 실패했습니다.');
    }
  };

  // ── 선택 모드 ────────────────────────────────────────────────────────────
  const toggleSelectMode = () => {
    setSelectMode((s) => !s);
    setSelectedIds(new Set());
    setActionError('');
  };

  const isItemBusy = (it) =>
    it.status === 'queued'
    || it.status === 'video_generating'
    || it.status === 'generating';

  const toggleSelect = (item) => {
    if (isItemBusy(item)) {
      // eslint-disable-next-line no-alert
      alert('생성 중인 영상은 선택할 수 없습니다.');
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const id = item.extra_video_id;
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    const eligible = items
      .filter((it) => !isItemBusy(it))
      .map((it) => it.extra_video_id);
    if (eligible.length > VIDEO_BULK_MAX) {
      // eslint-disable-next-line no-alert
      alert(`일괄 작업은 한 번에 최대 ${VIDEO_BULK_MAX}개까지 가능합니다. 처음 ${VIDEO_BULK_MAX}개만 선택합니다.`);
    }
    setSelectedIds(new Set(eligible.slice(0, VIDEO_BULK_MAX)));
  };

  const handleBulkDownload = async () => {
    setActionError('');
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (ids.length > VIDEO_BULK_MAX) {
      setActionError(`일괄 다운로드는 한 번에 최대 ${VIDEO_BULK_MAX}개까지 가능합니다.`);
      return;
    }
    setBulkBusy(true);
    try {
      if (import.meta.env.DEV) {
        console.info(`${VSEC} bulk download`, { count: ids.length });
      }
      for (const id of ids) {
        const it = items.find((x) => x.extra_video_id === id);
        if (!it) continue;
        // eslint-disable-next-line no-await-in-loop
        await handleDownload(it);
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch (err) {
      console.error(`${VSEC} bulk download failed`, { err });
      setActionError('일괄 다운로드에 실패했습니다.');
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkDelete = async () => {
    setActionError('');
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (ids.length > VIDEO_BULK_MAX) {
      setActionError(`일괄 삭제는 한 번에 최대 ${VIDEO_BULK_MAX}개까지 가능합니다.`);
      return;
    }
    // eslint-disable-next-line no-alert
    if (!window.confirm(`선택한 ${ids.length}개를 영구 삭제할까요? 되돌릴 수 없습니다.`)) return;
    setBulkBusy(true);
    try {
      if (import.meta.env.DEV) {
        console.info(`${VSEC} bulk delete`, { count: ids.length });
      }
      const { data } = await api.bulkDeleteExtraVideos(ids);
      await reloadItems();
      setSelectedIds(new Set());
      const dCount = data?.deleted_count || 0;
      const failed = Array.isArray(data?.failed) ? data.failed : [];
      if (failed.length > 0) {
        // eslint-disable-next-line no-alert
        alert(`${dCount}개 삭제 완료. ${failed.length}개 실패.`);
      } else {
        // eslint-disable-next-line no-alert
        alert(`${dCount}개 삭제 완료`);
      }
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || err?.message || 'bulk delete error';
      console.error(`${VSEC} bulk delete failed`, { status, detail });
      setActionError(detail || '일괄 삭제에 실패했습니다.');
    } finally {
      setBulkBusy(false);
    }
  };

  // ── 렌더 헬퍼 ────────────────────────────────────────────────────────────
  const selectedScene = sceneImages.find(
    (it) => it.extra_scene_image_id === selectedSceneImageId,
  );

  const lengthOptions = VIDEO_LENGTH_OPTIONS[videoModel] || [5];

  return (
    <div className="extra-video-section">
      {isAdmin && ownerUserId && ownerUserId !== currentUserId && (
        <div className="extra-video-section__admin-banner">
          관리자 모드 — 다른 사용자의 작품에 작업 중
        </div>
      )}

      {/* 입력 영역 */}
      <div className="extra-video-section__form">
        {/* 소스 모드 */}
        <div className="extra-video-section__row">
          <label className="extra-video-section__row-label">① 영상의 출발 이미지</label>
          <div className="extra-video-source-picker">
            <label
              className={
                `extra-video-source-picker__opt`
                + (sourceMode === 'scene_image' ? ' is-selected' : '')
              }
            >
              <input
                type="radio"
                name="extraVideoSource"
                value="scene_image"
                checked={sourceMode === 'scene_image'}
                onChange={() => setSourceMode('scene_image')}
              />
              <span>씬 이미지에서 가져오기</span>
            </label>
            <label
              className={
                `extra-video-source-picker__opt`
                + (sourceMode === 'uploaded' ? ' is-selected' : '')
              }
            >
              <input
                type="radio"
                name="extraVideoSource"
                value="uploaded"
                checked={sourceMode === 'uploaded'}
                onChange={() => setSourceMode('uploaded')}
              />
              <span>직접 이미지 업로드</span>
            </label>
          </div>

          {/* scene_image 모드 */}
          {sourceMode === 'scene_image' && (
            <div className="extra-video-section__scene-picker">
              {sceneLoading ? (
                <div className="extra-video-section__hint">씬 이미지 목록 불러오는 중...</div>
              ) : sceneError ? (
                <div className="extra-video-section__error">{sceneError}</div>
              ) : sceneImages.length === 0 ? (
                <div className="extra-video-section__empty">
                  A 영역에서 먼저 씬 이미지를 만들어 주세요. (완료된 것만 선택할 수 있어요)
                </div>
              ) : (
                <>
                  <div className="extra-video-section__scene-grid">
                    {sceneImages.map((it) => {
                      const id = it.extra_scene_image_id;
                      const sel = id === selectedSceneImageId;
                      return (
                        <button
                          key={id}
                          type="button"
                          className={
                            `extra-video-section__scene-thumb`
                            + (sel ? ' is-selected' : '')
                          }
                          onClick={() => setSelectedSceneImageId(id)}
                          title={id}
                        >
                          <ZoomableImage
                            src={api.extraSceneImagePreviewUrl(it.object_name)}
                            alt="씬 이미지"
                            loading="lazy"
                          />
                        </button>
                      );
                    })}
                  </div>
                  {selectedScene && (
                    <div className="extra-video-section__scene-preview">
                      <ZoomableImage
                        src={api.extraSceneImagePreviewUrl(selectedScene.object_name)}
                        alt="선택된 씬 이미지"
                      />
                      <div className="extra-video-section__hint">
                        선택됨: {(selectedScene.extra_scene_image_id || '').slice(0, 8)}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* uploaded 모드 */}
          {sourceMode === 'uploaded' && (
            <div className="extra-video-section__upload-zone">
              <input
                ref={uploadRef}
                type="file"
                accept={VIDEO_UPLOAD_ACCEPT.join(',')}
                onChange={(e) => handleUpload(e.target.files?.[0] || null)}
                disabled={uploading}
              />
              {uploading && (
                <span className="extra-video-section__hint">업로드 중...</span>
              )}
              {uploadError && (
                <div className="extra-video-section__error">{uploadError}</div>
              )}
              {uploadedObjectName && (
                <div className="extra-video-section__upload-preview">
                  <ZoomableImage
                    src={api.sheetPreviewUrl(uploadedObjectName)}
                    alt="업로드 미리보기"
                  />
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => setUploadedObjectName('')}
                  >
                    제거
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 연출 프롬프트 */}
        <div className="extra-video-section__row">
          <label className="extra-video-section__row-label">② 연출 프롬프트</label>
          <textarea
            className="extra-video-section__textarea"
            value={userText}
            onChange={(e) => setUserText(e.target.value)}
            rows={4}
            placeholder="예: 카메라가 천천히 줌인하며 신부가 미소짓는다, 따뜻한 노을 색조..."
          />
          <div className="extra-video-section__hint">
            자유 텍스트로 영상 연출 의도를 알려주세요. 자산 멘션은 A 영역에서 끝났어요.
          </div>
        </div>

        {/* 카메라 모션 (v23.3 활성화 — Higgsfield 스타일 chips) */}
        <div className="extra-video-section__row">
          <label className="extra-video-section__row-label">③ 카메라 모션 프리셋 (선택, 다중)</label>
          <div
            className="extra-video-section__motion-chips extra-video-camera-chips"
            role="group"
            aria-label="카메라 모션 프리셋"
          >
            {CAMERA_MOTIONS.map((m) => {
              const sel = motionPresets.includes(m.value);
              return (
                <button
                  key={m.value}
                  type="button"
                  className={
                    `extra-video-camera-chips__chip`
                    + (sel ? ' is-selected' : '')
                  }
                  onClick={() => handleMotionToggle(m.value)}
                  aria-pressed={sel}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
          <div className="extra-video-section__hint">
            선택된 모션: {motionPresets.length > 0 ? motionPresets.length : '없음'}
            {motionPresets.length > 0 && ` (${motionPresets.join(', ')})`}
          </div>
        </div>

        {/* 모델 */}
        <div className="extra-video-section__row">
          <label className="extra-video-section__row-label">④ 영상 모델</label>
          <div className="extra-video-model-radio">
            {VIDEO_MODELS.map((m) => (
              <label
                key={m.value}
                className={
                  `extra-video-model-radio__opt`
                  + (videoModel === m.value ? ' is-selected' : '')
                }
              >
                <input
                  type="radio"
                  name="extraVideoModel"
                  value={m.value}
                  checked={videoModel === m.value}
                  onChange={() => setVideoModel(m.value)}
                />
                <span>{m.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* 클립 길이 */}
        <div className="extra-video-section__row">
          <label className="extra-video-section__row-label">⑤ 클립 길이 (초)</label>
          <div className="extra-video-length-radio">
            {lengthOptions.map((s) => (
              <label
                key={s}
                className={
                  `extra-video-length-radio__opt`
                  + (useSeconds === s ? ' is-selected' : '')
                }
              >
                <input
                  type="radio"
                  name="extraVideoUseSeconds"
                  value={s}
                  checked={useSeconds === s}
                  onChange={() => setUseSeconds(s)}
                  disabled={videoModel === 'veo'}
                />
                <span>{s}s</span>
              </label>
            ))}
          </div>
          {videoModel === 'veo' && (
            <div className="extra-video-section__hint">Veo 3.1 은 8초 고정이에요.</div>
          )}
        </div>

        {/* 변주 N개 (비활성) */}
        <div className="extra-video-section__row">
          <label className="extra-video-section__row-label">⑥ 변주 개수</label>
          <select
            className="extra-video-section__variant-select"
            value={variantCount}
            disabled
          >
            <option value={1}>1개</option>
          </select>
          <div className="extra-video-section__hint">
            v23.2 에선 단일 영상만 생성해요. N개 동시 생성은 후속 단계에서 활성화됩니다.
          </div>
        </div>

        {submitError && (
          <div className="extra-video-section__error">{submitError}</div>
        )}

        <div className="extra-video-section__actions">
          <button
            type="button"
            className="btn-primary"
            onClick={handleGenerate}
            disabled={submitting}
          >
            {submitting ? '시작하는 중...' : '🎬 영상 만들기'}
          </button>
          {hasActive && (
            <span className="extra-video-section__hint">
              진행 중인 잡이 있어 5초마다 자동 새로고침합니다.
            </span>
          )}
        </div>
      </div>

      {/* 갤러리 헤더 */}
      <div className="extra-video-section__gallery-head">
        <h4 className="extra-video-section__gallery-title">영상 갤러리</h4>
        <span className="extra-video-section__hint">{items.length}개</span>
        <button
          type="button"
          className="btn-ghost"
          onClick={toggleSelectMode}
          disabled={bulkBusy || items.length === 0}
        >
          {selectMode ? '✕ 선택 끄기' : '☑ 선택'}
        </button>
      </div>

      {selectMode && (
        <div className="extra-video-section__bulk-actions">
          <span>선택: {selectedIds.size}개</span>
          <button
            type="button"
            className="btn-ghost"
            onClick={handleSelectAll}
            disabled={bulkBusy}
          >
            전체 선택
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={handleBulkDownload}
            disabled={selectedIds.size === 0 || bulkBusy}
          >
            {bulkBusy ? '...' : `⬇ 일괄 다운로드(${selectedIds.size})`}
          </button>
          <button
            type="button"
            className="btn-ghost danger"
            onClick={handleBulkDelete}
            disabled={selectedIds.size === 0 || bulkBusy}
          >
            🗑 일괄 삭제({selectedIds.size})
          </button>
        </div>
      )}

      {actionError && (
        <div className="extra-video-section__error">{actionError}</div>
      )}
      {listError && (
        <div className="extra-video-section__error">{listError}</div>
      )}

      {/* 갤러리 */}
      {loading ? (
        <div className="extra-video-section__hint">목록을 불러오는 중...</div>
      ) : items.length === 0 ? (
        <div className="extra-video-section__empty">
          아직 생성한 영상이 없습니다.
        </div>
      ) : (
        <div className="extra-video-section__gallery">
          {items.map((it) => {
            const isSelected = selectedIds.has(it.extra_video_id);
            const busy = isItemBusy(it);
            const cardClass =
              `extra-video-card`
              + (isSelected ? ' is-selected' : '')
              + (busy ? ' is-busy' : '');
            const cacheBuster = it.updated_at || it.created_at || '';
            const streamSrc = it.status === 'completed'
              ? `${api.extraVideoStreamUrl(it.extra_video_id)}&v=${encodeURIComponent(cacheBuster)}`
              : '';
            // v23.3 — 카드 thumb 클릭 시 모달 진입 (selectMode 아닐 때 + 진행/실패 제외).
            const canOpenDetail = !selectMode && it.status === 'completed';
            return (
              <div key={it.extra_video_id} className={cardClass}>
                {selectMode && !busy && (
                  <div className="extra-video-card__check">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(it)}
                    />
                  </div>
                )}
                <div
                  className={
                    `extra-video-card__video`
                    + (canOpenDetail ? ' is-clickable' : '')
                  }
                  onClick={() => {
                    if (canOpenDetail) openDetail(it);
                  }}
                  role={canOpenDetail ? 'button' : undefined}
                  tabIndex={canOpenDetail ? 0 : undefined}
                  onKeyDown={(e) => {
                    if (canOpenDetail && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      openDetail(it);
                    }
                  }}
                  title={canOpenDetail ? '클릭해 디테일 / 추가 수정 열기' : undefined}
                >
                  {it.status === 'completed' && streamSrc ? (
                    <video
                      controls
                      preload="metadata"
                      src={streamSrc}
                      onClick={(e) => {
                        // controls 클릭이 모달 열기로 이어지지 않도록 stopPropagation.
                        e.stopPropagation();
                      }}
                    />
                  ) : it.status === 'failed' ? (
                    <div className="extra-video-card__failed">
                      <div>⚠</div>
                      <div className="extra-video-card__failed-msg">
                        {it.error_message || '생성 실패'}
                      </div>
                    </div>
                  ) : (
                    <div className="extra-video-card__spinner">
                      <div className="extra-video-card__dot" />
                      <span>{VIDEO_STATUS_LABEL[it.status] || it.status}</span>
                    </div>
                  )}
                </div>

                <div className={`extra-video-card__status-badge is-${it.status}`}>
                  {VIDEO_STATUS_LABEL[it.status] || it.status}
                </div>

                {/* v23.4 — Continue (이전 영상 마지막 프레임 → 새 영상) 뱃지 */}
                {it.source_kind === 'prev_video_last_frame' && (
                  <div
                    className="extra-video-card__source-badge"
                    title="이전 영상에서 이어진 컷"
                    aria-label="이전 영상에서 이어진 컷"
                  >
                    ▶
                  </div>
                )}

                <div className="extra-video-card__meta">
                  <span>{it.video_model}</span>
                  <span>{it.use_seconds}s</span>
                  {it.created_at && (
                    <span>
                      {new Date(it.created_at).toLocaleString('ko-KR', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  )}
                </div>

                <div className="extra-video-card__actions">
                  {it.status === 'completed' && (
                    <>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => openDetail(it)}
                        title="디테일 보기 / 멀티턴 수정"
                      >
                        🔄 추가 수정
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => handleDownload(it)}
                      >
                        ⬇ 다운로드
                      </button>
                    </>
                  )}
                  {(it.status === 'completed' || it.status === 'failed') && (
                    <button
                      type="button"
                      className="btn-ghost danger"
                      onClick={() => handleDelete(it)}
                    >
                      🗑 삭제
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* v23.3 — 디테일 모달 / v23.4 — onContinueDone */}
      {detailVideoId && (
        <ExtraVideoDetailModal
          mvJobId={mvJobId}
          initialId={detailVideoId}
          onClose={closeDetail}
          onChanged={() => {
            // refine 큐잉/삭제 → 부모 갤러리 즉시 reload (폴링 트리거).
            reloadItems();
          }}
          onDeletedAll={() => {
            closeDetail();
            reloadItems();
          }}
          onContinueDone={() => {
            // v23.4 — continue 는 별개 chain root → 갤러리에 새 카드로 노출.
            // 현 모달은 자동으로 닫고 갤러리만 갱신.
            closeDetail();
            reloadItems();
          }}
        />
      )}
    </div>
  );
}
