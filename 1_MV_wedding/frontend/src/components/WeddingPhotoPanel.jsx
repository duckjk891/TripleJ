import { useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../api';
import { useAuth } from '../contexts/AuthContext';
import MentionField from './MentionField';
import WeddingPhotoDetailModal from './WeddingPhotoDetailModal';
import './WeddingPhotoPanel.css';

/**
 * v13 — WeddingPhotoPanel
 * 작품 디테일 페이지 하단에 끼우는 "📸 웨딩사진 생성" 패널.
 *
 * Props
 *  mvJobId      : string  (작품 MVJob id)
 *  ownerUserId  : string  (작품 소유자 user id — context API 응답으로도 확인)
 *
 * 동작
 *  - owner 본인 OR admin 만 렌더 (그 외는 null 반환).
 *  - 마운트 시 `getJobContext(mvJobId)` → 시트/장소/갤러리를 한 번에 불러옴.
 *  - 입력 ① 신랑 슬롯 (groom_casual|groom_wedding) ② 신부 슬롯 (bride_casual|bride_wedding)
 *    ③ 장소(자산 또는 직접 업로드) ④ 모델(gpt_image_2|nb_pro) ⑤ 지시사항(@-멘션).
 *  - 생성 요청 시 잡 ID 받고 5초 폴링. 완료 시 컨텍스트 reload → 갤러리 새로고침.
 *  - 카드 클릭 → `WeddingPhotoDetailModal`.
 */

const PREFIX = '[WeddingPhotoPanel]';
const POLL_INTERVAL_MS = 5000;
const ACCEPT_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

const GROOM_SLOTS = [
  { slot: 'groom_casual', label: '신랑 (평상복)' },
  { slot: 'groom_wedding', label: '신랑 (웨딩)' },
];
const BRIDE_SLOTS = [
  { slot: 'bride_casual', label: '신부 (평상복)' },
  { slot: 'bride_wedding', label: '신부 (웨딩)' },
];
const IMAGE_MODELS = [
  { value: 'gpt_image_2', label: 'GPT Image 2 (정밀, 5~10분)' },
  { value: 'nb_pro', label: 'Nano Banana Pro (빠름, 1~3분)' },
];

export default function WeddingPhotoPanel({ mvJobId, ownerUserId }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isOwner = user?.id === ownerUserId;
  const canUse = Boolean(user) && (isOwner || isAdmin);

  // 권한 없으면 일찍 종료 (Hook 순서 보호를 위해 모든 Hook 위에는 못 두지만,
  //  내부 컴포넌트만 분리해서 가드 처리). 여기서는 가드 후 null 반환.
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
    <WeddingPhotoPanelInner
      mvJobId={mvJobId}
      ownerUserId={ownerUserId}
      isAdmin={isAdmin}
      currentUserId={user.id}
    />
  );
}

function WeddingPhotoPanelInner({ mvJobId, ownerUserId, isAdmin, currentUserId }) {
  const [context, setContext] = useState(null); // {owner_user_id, owner_sheets, owner_places, wedding_photos}
  const [loadingContext, setLoadingContext] = useState(true);
  const [contextError, setContextError] = useState('');

  // 폼 상태.
  const [groomSlot, setGroomSlot] = useState('groom_wedding');
  const [brideSlot, setBrideSlot] = useState('bride_wedding');
  const [placeMode, setPlaceMode] = useState('asset'); // 'asset' | 'upload'
  const [placeAssetId, setPlaceAssetId] = useState('');
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadMemo, setUploadMemo] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [imageModel, setImageModel] = useState('gpt_image_2');
  const [userText, setUserText] = useState('');
  const [userTextRefs, setUserTextRefs] = useState([]);

  // v15.2 — 활성 잡 통합 상태 (generate + refine 한꺼번에 추적).
  // 형태: { [job_id]: { job_id, photo_id, parent_photo_id?, started_at, kind } }
  // localStorage 백업으로 새로고침 시 폴링 재개 가능.
  const STORAGE_KEY = `wedding_photo_active_jobs:${mvJobId}:${currentUserId}`;
  const [activeJobIds, setActiveJobIds] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch { return {}; }
  });
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(activeJobIds));
    } catch (err) {
      console.error(`${PREFIX} persist active jobs failed`, { err });
    }
  }, [activeJobIds, STORAGE_KEY]);

  // 잡 상태 (generate 단일 — UI 호환용).
  const [activeJobId, setActiveJobId] = useState(null);
  const [activeStartedAt, setActiveStartedAt] = useState(null);
  const [activeStatus, setActiveStatus] = useState('');
  const [tick, setTick] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // 갤러리/디테일.
  const [photos, setPhotos] = useState([]);
  const [detailPhotoId, setDetailPhotoId] = useState(null);

  // v16 — 일괄 선택 모드 (다운로드/삭제).
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // upload file input ref.
  const fileInputRef = useRef(null);

  // ─────────────────────────────────────────────────────────────
  // 컨텍스트 로드/리로드
  // ─────────────────────────────────────────────────────────────
  const reloadContext = async () => {
    try {
      if (import.meta.env.DEV) {
        console.info(`${PREFIX} getJobContext`, { mv_job_id: mvJobId });
      }
      const { data } = await api.getJobContext(mvJobId);
      setContext(data);
      const list = Array.isArray(data?.wedding_photos) ? data.wedding_photos : [];
      setPhotos(list);
      setContextError('');
      // placeAssetId 자동 보정 — 현재 선택값이 사라졌다면 초기화.
      if (placeAssetId) {
        const stillExists = (data?.owner_places || []).some(
          (p) => p.place_id === placeAssetId,
        );
        if (!stillExists) setPlaceAssetId('');
      }
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || err?.message || 'context error';
      console.error(`${PREFIX} getJobContext failed`, {
        status,
        detail,
        mv_job_id: mvJobId,
      });
      setContextError('컨텍스트를 불러오지 못했습니다.');
    } finally {
      setLoadingContext(false);
    }
  };

  useEffect(() => {
    reloadContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mvJobId]);

  // v15.2 — mount 시 localStorage 복원본에 generate 잡이 있으면 단일 state 동기화.
  useEffect(() => {
    if (activeJobId) return;
    const entries = Object.values(activeJobIds || {});
    const gen = entries.find((j) => j?.kind === 'generate');
    if (gen) {
      setActiveJobId(gen.job_id);
      setActiveStartedAt(gen.started_at || Date.now());
      setActiveStatus('queued');
      if (import.meta.env.DEV) {
        console.info(`${PREFIX} restored generate job from storage`, {
          job_id: gen.job_id,
        });
      }
    }
    // mount 시 한 번만 — 의도된 단발 동기화.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─────────────────────────────────────────────────────────────
  // 1초 tick (잡 진행 중 elapsed 표시)
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeJobId) return undefined;
    const handle = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(handle);
  }, [activeJobId]);

  // ─────────────────────────────────────────────────────────────
  // 멘션 옵션 풀 빌드
  // ─────────────────────────────────────────────────────────────
  const mentionOptions = useMemo(() => {
    const opts = [];
    for (const s of context?.owner_sheets || []) {
      if (!s || !s.slot) continue;
      opts.push({
        type: 'sheet',
        asset_id: s.slot,
        display_name: s.display_name || s.slot,
        object_name: s.sheet_object_name || null,
        group_label: '🧑 캐릭터',
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
    return opts;
  }, [context]);

  // ─────────────────────────────────────────────────────────────
  // 시트 슬롯 헬퍼: 현재 owner_sheets 에서 slot 으로 자산 찾기
  // ─────────────────────────────────────────────────────────────
  const findSheet = (slot) =>
    (context?.owner_sheets || []).find((s) => s && s.slot === slot) || null;

  // v16 — 진행 중 잡의 photo_id 와 매칭되면 선택 불가.
  const isPhotoBusy = (photoId) => {
    for (const job of Object.values(activeJobIds || {})) {
      if (job?.photo_id === photoId || job?.parent_photo_id === photoId) return true;
    }
    return false;
  };

  // v16 — 카드 클릭 분기: 선택 모드 면 토글, 아니면 디테일 모달.
  const handleCardClick = (photo) => {
    if (selectMode) {
      const pid = photo.photo_id;
      if (isPhotoBusy(pid)) {
        // eslint-disable-next-line no-alert
        alert('생성 중인 사진은 선택할 수 없습니다.');
        return;
      }
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(pid)) {
          next.delete(pid);
        } else {
          next.add(pid);
        }
        return next;
      });
    } else {
      setDetailPhotoId(photo.photo_id);
    }
  };

  // v16 — 전체 선택(진행 중 사진 제외).
  const handleSelectAll = () => {
    const eligible = photos
      .filter((p) => !isPhotoBusy(p.photo_id))
      .map((p) => p.photo_id);
    setSelectedIds(new Set(eligible));
  };

  // v16 — 일괄 다운로드.
  const handleBulkDownload = async () => {
    setBulkBusy(true);
    try {
      const ids = Array.from(selectedIds);
      if (import.meta.env.DEV) {
        console.info(`${PREFIX} bulk download`, { count: ids.length });
      }
      const res = await api.downloadWeddingPhotosZip(mvJobId, ids);
      const blob = new Blob([res.data], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wedding-photos-${mvJobId.slice(0, 8)}-${ids.length}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(`${PREFIX} bulk download failed`, { err });
      // eslint-disable-next-line no-alert
      alert('일괄 다운로드에 실패했습니다.');
    } finally {
      setBulkBusy(false);
    }
  };

  // v16 — 일괄 삭제.
  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    // eslint-disable-next-line no-alert
    if (!window.confirm(`선택한 ${ids.length}장을 영구 삭제할까요? 되돌릴 수 없습니다.`)) return;
    setBulkBusy(true);
    try {
      if (import.meta.env.DEV) {
        console.info(`${PREFIX} bulk delete`, { count: ids.length });
      }
      const { data } = await api.bulkDeleteWeddingPhotos(mvJobId, ids);
      await reloadContext();
      setSelectedIds(new Set());
      if (data?.failed?.length > 0) {
        // eslint-disable-next-line no-alert
        alert(`${data.deleted_count}장 삭제 완료. ${data.failed.length}장 실패.`);
      } else {
        // eslint-disable-next-line no-alert
        alert(`${data.deleted_count}장 삭제 완료`);
      }
    } catch (err) {
      console.error(`${PREFIX} bulk delete failed`, { err });
      // eslint-disable-next-line no-alert
      alert('일괄 삭제에 실패했습니다.');
    } finally {
      setBulkBusy(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // 장소 직접 업로드 → createPlaceUploaded
  // ─────────────────────────────────────────────────────────────
  const handleUploadPlace = async () => {
    setUploadError('');
    if (!uploadFile) {
      setUploadError('파일을 선택해주세요.');
      return;
    }
    if (!ACCEPT_TYPES.includes(uploadFile.type)) {
      setUploadError('jpg/png/webp 만 업로드 가능합니다.');
      return;
    }
    if (uploadFile.size > MAX_FILE_BYTES) {
      setUploadError('파일 크기는 10MB 이하여야 합니다.');
      return;
    }
    const trimmedName = (uploadName || '').trim();
    if (trimmedName.length < 1 || trimmedName.length > 80) {
      setUploadError('장소 이름은 1~80자여야 합니다.');
      return;
    }
    try {
      setUploading(true);
      const fd = new FormData();
      // 백엔드 places.py upload_place 의 `image: UploadFile = File(...)` 와 필드명 일치 필수.
      fd.append('image', uploadFile);
      fd.append('display_name', trimmedName);
      if (uploadMemo) fd.append('memo', uploadMemo);
      // admin 이 owner 본인이 아닌 작품에 업로드 → owner 명의로 등록 요청.
      if (isAdmin && ownerUserId && ownerUserId !== currentUserId) {
        fd.append('owner_user_id', ownerUserId);
        if (import.meta.env.DEV) {
          console.info(`${PREFIX} upload as admin`, {
            mv_job_id: mvJobId,
            owner_user_id: ownerUserId,
          });
        }
      }
      const { data } = await api.createPlaceUploaded(fd);
      if (import.meta.env.DEV) {
        console.info(`${PREFIX} place uploaded`, {
          place_id: data?.place_id,
          mv_job_id: mvJobId,
        });
      }
      // 서버 단일진실 동기화: 컨텍스트 리로드 후 새 자산 자동 선택.
      await reloadContext();
      if (data?.place_id) {
        setPlaceAssetId(data.place_id);
        setPlaceMode('asset'); // 자산 모드로 자동 전환.
      }
      // 폼 리셋.
      setUploadFile(null);
      setUploadName('');
      setUploadMemo('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || err?.message || 'upload error';
      console.error(`${PREFIX} upload place failed`, {
        status,
        detail,
        mv_job_id: mvJobId,
      });
      setUploadError(detail || '업로드에 실패했습니다.');
    } finally {
      setUploading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // 생성 시작
  // ─────────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    setError('');
    if (!findSheet(groomSlot)) {
      setError('선택한 신랑 시트가 없습니다. 다른 슬롯을 선택해주세요.');
      return;
    }
    if (!findSheet(brideSlot)) {
      setError('선택한 신부 시트가 없습니다. 다른 슬롯을 선택해주세요.');
      return;
    }

    let placeObjectName = '';
    if (placeMode === 'asset') {
      const sel = (context?.owner_places || []).find(
        (p) => p.place_id === placeAssetId,
      );
      if (!sel) {
        setError('장소를 선택해주세요.');
        return;
      }
      placeObjectName = sel.object_name;
    } else {
      setError(
        '업로드 모드에서는 먼저 [업로드] 버튼을 눌러 자산으로 등록한 뒤 생성해주세요.',
      );
      return;
    }

    const payload = {
      groom_sheet_slot: groomSlot,
      bride_sheet_slot: brideSlot,
      place_object_name: placeObjectName,
      image_model: imageModel,
      user_text: userText || '',
      user_text_refs: Array.isArray(userTextRefs) ? userTextRefs : [],
    };

    try {
      setSubmitting(true);
      if (import.meta.env.DEV) {
        console.info(`${PREFIX} generate start`, {
          mv_job_id: mvJobId,
          groom_slot: groomSlot,
          bride_slot: brideSlot,
          image_model: imageModel,
          user_text_len: (userText || '').length,
          refs_count: (userTextRefs || []).length,
        });
      }
      const { data } = await api.generateWeddingPhoto(mvJobId, payload);
      if (!data?.job_id) {
        throw new Error('서버 응답에 job_id 가 없습니다.');
      }
      setActiveJobId(data.job_id);
      setActiveStartedAt(Date.now());
      setActiveStatus(data.status || 'queued');
      // v15.2 — 통합 activeJobIds 에도 등록.
      setActiveJobIds((prev) => ({
        ...prev,
        [data.job_id]: {
          job_id: data.job_id,
          photo_id: data.photo_id,
          started_at: Date.now(),
          kind: 'generate',
        },
      }));
      if (import.meta.env.DEV) {
        console.info(`${PREFIX} generate queued`, {
          mv_job_id: mvJobId,
          job_id: data.job_id,
          photo_id: data.photo_id,
          kind: 'generate',
        });
      }
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || err?.message || 'generate error';
      console.error(`${PREFIX} generate failed`, {
        status,
        detail,
        mv_job_id: mvJobId,
      });
      setError(detail || '웨딩사진 생성 시작에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // v15.2 — 통합 잡 폴링 (generate + refine).
  //   - activeJobIds 의 모든 job 을 5초마다 폴링.
  //   - done/failed 시 set 에서 제거 + reloadContext.
  //   - generate UI 호환: activeJobId 단일 state 가 set 에 포함된 동안 진행 표시 유지.
  // ─────────────────────────────────────────────────────────────
  const activeJobKeys = Object.keys(activeJobIds);
  useEffect(() => {
    const ids = Object.keys(activeJobIds);
    if (ids.length === 0) return undefined;
    let cancelled = false;

    const tickPoll = async () => {
      for (const jid of ids) {
        try {
          const { data } = await api.getWeddingPhotoJob(mvJobId, jid);
          if (cancelled) return;
          const info = activeJobIds[jid];
          // generate UI 호환 — activeJobId 의 status 표시.
          if (activeJobId === jid) {
            setActiveStatus(data?.status || '');
          }
          if (data?.status === 'done' || data?.status === 'failed') {
            if (import.meta.env.DEV) {
              console.info(`${PREFIX} job poll done`, {
                job_id: jid,
                status: data.status,
                kind: info?.kind,
                photo_id: data?.photo_id,
              });
            }
            setActiveJobIds((prev) => {
              const next = { ...prev };
              delete next[jid];
              return next;
            });
            // generate 단일 state 동기화.
            if (activeJobId === jid) {
              setActiveJobId(null);
              setActiveStartedAt(null);
              setActiveStatus('');
              if (data?.status === 'failed') {
                setError(data?.error_message || '웨딩사진 생성에 실패했습니다.');
              }
            }
            await reloadContext();
          }
        } catch (err) {
          const status = err?.response?.status;
          const detail = err?.response?.data?.detail || err?.message || 'poll error';
          console.error(`${PREFIX} poll failed`, {
            status,
            detail,
            mv_job_id: mvJobId,
            job_id: jid,
          });
        }
      }
    };

    tickPoll();
    const handle = setInterval(tickPoll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJobKeys.join(','), mvJobId]);

  // ─────────────────────────────────────────────────────────────
  // 렌더
  // ─────────────────────────────────────────────────────────────
  const elapsedSec = activeStartedAt
    ? Math.max(0, Math.floor((Date.now() - activeStartedAt) / 1000))
    : 0;
  // tick 은 강제 리렌더 트리거. 사용 표시(린트 가드).
  void tick;

  const groomSheet = findSheet(groomSlot);
  const brideSheet = findSheet(brideSlot);
  const placeCount = (context?.owner_places || []).length;
  const sheetCount = (context?.owner_sheets || []).length;

  return (
    <section className="wedding-photo">
      <div className="wedding-photo__head">
        <h2 className="wedding-photo__title">📸 웨딩사진 생성</h2>
        <p className="wedding-photo__desc">
          이 작품의 신랑·신부 캐릭터 시트와 장소 자산을 이용해 결혼 사진을 만들어요.
          멘션(@)으로 등장 인물·장소를 자유롭게 지정할 수 있습니다.
        </p>
        {isAdmin && ownerUserId && ownerUserId !== currentUserId ? (
          <p className="wedding-photo__admin-banner">관리자 모드 — 다른 사용자의 작품에 작업 중</p>
        ) : null}
      </div>

      {loadingContext && (
        <div className="wedding-photo__loading">컨텍스트를 불러오는 중...</div>
      )}

      {contextError && (
        <div className="wedding-photo__error-banner">{contextError}</div>
      )}

      {!loadingContext && !contextError && (
        <div className="wedding-photo__form">
          {/* ① 신랑 슬롯 */}
          <div className="wedding-photo__row">
            <div className="wedding-photo__row-label">① 신랑</div>
            <div className="wedding-photo__sheet-grid">
              {GROOM_SLOTS.map((s) => {
                const sheet = findSheet(s.slot);
                const disabled = !sheet;
                const selected = groomSlot === s.slot;
                return (
                  <label
                    key={s.slot}
                    className={`wedding-photo__sheet-card${selected ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`}
                  >
                    <input
                      type="radio"
                      name="groomSlot"
                      value={s.slot}
                      checked={selected}
                      disabled={disabled}
                      onChange={() => setGroomSlot(s.slot)}
                    />
                    <div className="wedding-photo__sheet-thumb">
                      {sheet?.sheet_object_name ? (
                        <img
                          src={api.sheetPreviewUrl(sheet.sheet_object_name)}
                          alt={s.label}
                        />
                      ) : (
                        <div className="wedding-photo__sheet-placeholder">
                          저장된 시트가 없습니다
                        </div>
                      )}
                    </div>
                    <div className="wedding-photo__sheet-label">
                      {sheet?.display_name || s.label}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* ② 신부 슬롯 */}
          <div className="wedding-photo__row">
            <div className="wedding-photo__row-label">② 신부</div>
            <div className="wedding-photo__sheet-grid">
              {BRIDE_SLOTS.map((s) => {
                const sheet = findSheet(s.slot);
                const disabled = !sheet;
                const selected = brideSlot === s.slot;
                return (
                  <label
                    key={s.slot}
                    className={`wedding-photo__sheet-card${selected ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`}
                  >
                    <input
                      type="radio"
                      name="brideSlot"
                      value={s.slot}
                      checked={selected}
                      disabled={disabled}
                      onChange={() => setBrideSlot(s.slot)}
                    />
                    <div className="wedding-photo__sheet-thumb">
                      {sheet?.sheet_object_name ? (
                        <img
                          src={api.sheetPreviewUrl(sheet.sheet_object_name)}
                          alt={s.label}
                        />
                      ) : (
                        <div className="wedding-photo__sheet-placeholder">
                          저장된 시트가 없습니다
                        </div>
                      )}
                    </div>
                    <div className="wedding-photo__sheet-label">
                      {sheet?.display_name || s.label}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* ③ 장소 */}
          <div className="wedding-photo__row">
            <div className="wedding-photo__row-label">③ 장소</div>
            <div className="wedding-photo__place-modes">
              <label className="wedding-photo__mode">
                <input
                  type="radio"
                  name="placeMode"
                  value="asset"
                  checked={placeMode === 'asset'}
                  onChange={() => setPlaceMode('asset')}
                />
                <span>저장된 장소 자산에서 선택</span>
              </label>
              <label className="wedding-photo__mode">
                <input
                  type="radio"
                  name="placeMode"
                  value="upload"
                  checked={placeMode === 'upload'}
                  onChange={() => setPlaceMode('upload')}
                />
                <span>새 사진 업로드 → 자산으로 등록</span>
              </label>
            </div>

            {placeMode === 'asset' && (
              <div className="wedding-photo__place-grid">
                {placeCount === 0 && (
                  <div className="wedding-photo__hint">
                    장소 자산이 없습니다. 위에서 [새 사진 업로드]를 선택해 등록하세요.
                  </div>
                )}
                {(context?.owner_places || []).map((p) => {
                  const selected = placeAssetId === p.place_id;
                  return (
                    <label
                      key={p.place_id}
                      className={`wedding-photo__place-card${selected ? ' is-selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name="placeAssetId"
                        value={p.place_id}
                        checked={selected}
                        onChange={() => setPlaceAssetId(p.place_id)}
                      />
                      <div className="wedding-photo__place-thumb">
                        {p.object_name ? (
                          <img src={api.sheetPreviewUrl(p.object_name)} alt={p.display_name || ''} />
                        ) : (
                          <div className="wedding-photo__sheet-placeholder">미리보기 없음</div>
                        )}
                      </div>
                      <div className="wedding-photo__place-label">
                        {p.display_name || '(이름 없음)'}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}

            {placeMode === 'upload' && (
              <div className="wedding-photo__upload">
                <div className="wedding-photo__upload-row">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPT_TYPES.join(',')}
                    onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                    disabled={uploading}
                  />
                </div>
                <div className="wedding-photo__upload-row">
                  <label className="wedding-photo__upload-label">장소 이름 *</label>
                  <input
                    type="text"
                    value={uploadName}
                    onChange={(e) => setUploadName(e.target.value)}
                    maxLength={80}
                    placeholder="예: 한강 카페"
                    disabled={uploading}
                  />
                </div>
                <div className="wedding-photo__upload-row">
                  <label className="wedding-photo__upload-label">메모(선택)</label>
                  <input
                    type="text"
                    value={uploadMemo}
                    onChange={(e) => setUploadMemo(e.target.value)}
                    maxLength={200}
                    placeholder="예: 일몰 시간, 강가가 보임"
                    disabled={uploading}
                  />
                </div>
                {uploadError && (
                  <div className="wedding-photo__error-text">{uploadError}</div>
                )}
                <div className="wedding-photo__upload-actions">
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleUploadPlace}
                    disabled={uploading || !uploadFile}
                  >
                    {uploading ? '업로드 중...' : '업로드 후 자산으로 등록'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ④ 모델 */}
          <div className="wedding-photo__row">
            <div className="wedding-photo__row-label">④ 이미지 모델</div>
            <div className="wedding-photo__model-grid">
              {IMAGE_MODELS.map((m) => (
                <label
                  key={m.value}
                  className={`wedding-photo__model${imageModel === m.value ? ' is-selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="imageModel"
                    value={m.value}
                    checked={imageModel === m.value}
                    onChange={() => setImageModel(m.value)}
                  />
                  <span>{m.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* ⑤ 지시사항 */}
          <div className="wedding-photo__row">
            <div className="wedding-photo__row-label">⑤ 지시사항(선택)</div>
            <MentionField
              id={`wedding-photo-text-${mvJobId}`}
              ariaLabel="웨딩사진 지시사항"
              value={userText}
              refs={userTextRefs}
              onChange={setUserText}
              onChangeRefs={setUserTextRefs}
              options={mentionOptions}
              rows={4}
              placeholder="@한강 카페 에서 @신랑(웨딩) 이 @신부(웨딩) 손을 잡고..."
            />
            <div className="wedding-photo__hint">
              `@` 입력 시 등록된 캐릭터 시트와 장소 자산을 추천합니다.
            </div>
          </div>

          {error && <div className="wedding-photo__error-banner">{error}</div>}

          <div className="wedding-photo__actions">
            <button
              type="button"
              className="btn-primary"
              onClick={handleGenerate}
              disabled={submitting || Boolean(activeJobId)}
            >
              {submitting
                ? '시작하는 중...'
                : activeJobId
                ? `${activeStatus || '진행 중'} ${elapsedSec}s`
                : '웨딩사진 생성'}
            </button>
            {activeJobId && (
              <span className="wedding-photo__hint">
                약 1~10분 소요. 5초마다 자동 새로고침합니다.
              </span>
            )}
          </div>
        </div>
      )}

      {/* 갤러리 */}
      <div className="wedding-photo__gallery-head">
        <h3 className="wedding-photo__gallery-title">갤러리</h3>
        <span className="wedding-photo__hint">{photos.length}장</span>
        <button
          type="button"
          className="btn-ghost wedding-photo__select-toggle"
          onClick={() => {
            setSelectMode((s) => !s);
            setSelectedIds(new Set());
          }}
          disabled={bulkBusy || photos.length === 0}
        >
          {selectMode ? '✕ 선택 끄기' : '☑ 선택 모드'}
        </button>
      </div>

      {selectMode && (
        <div className="wedding-photo__bulk-actions">
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
            {bulkBusy ? '...' : `⬇ 다운로드(${selectedIds.size})`}
          </button>
          <button
            type="button"
            className="btn-ghost danger"
            onClick={handleBulkDelete}
            disabled={selectedIds.size === 0 || bulkBusy}
          >
            🗑 삭제({selectedIds.size})
          </button>
        </div>
      )}

      {photos.length === 0 ? (
        <div className="wedding-photo__empty">아직 생성된 웨딩사진이 없습니다.</div>
      ) : (
        <div className="wedding-photo__gallery">
          {photos.map((ph) => {
            // v15.2 — 이 사진을 부모로 하는 refine 잡이 진행 중인지 표시.
            const refining = Object.values(activeJobIds || {}).some(
              (j) => j?.kind === 'refine' && j?.parent_photo_id === ph.photo_id,
            );
            const isSelected = selectedIds.has(ph.photo_id);
            const cardClass = `wedding-photo__photo-card${isSelected ? ' is-selected' : ''}`;
            return (
              <button
                key={ph.photo_id}
                type="button"
                className={cardClass}
                onClick={() => handleCardClick(ph)}
              >
                {selectMode && (
                  <div className="wedding-photo__card-check">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      readOnly
                    />
                  </div>
                )}
                <div className="wedding-photo__photo-thumb">
                  {ph.object_name ? (
                    <img
                      src={api.sheetPreviewUrl(ph.object_name)}
                      alt="웨딩사진"
                      loading="lazy"
                    />
                  ) : (
                    <div className="wedding-photo__sheet-placeholder">미리보기 없음</div>
                  )}
                  {refining && (
                    <div className="wedding-photo__photo-badge">수정 생성 중...</div>
                  )}
                </div>
                <div className="wedding-photo__photo-meta">
                  <span>{ph?.meta?.image_model || ''}</span>
                  {ph.created_at && (
                    <span>
                      {new Date(ph.created_at).toLocaleString('ko-KR', {
                        year: '2-digit',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {detailPhotoId && (
        <WeddingPhotoDetailModal
          mvJobId={mvJobId}
          photoId={detailPhotoId}
          mentionOptions={mentionOptions}
          activeJobIds={activeJobIds}
          onRefineStart={(jobInfo) => {
            if (!jobInfo?.job_id) return;
            setActiveJobIds((prev) => ({
              ...prev,
              [jobInfo.job_id]: {
                ...jobInfo,
                started_at: jobInfo.started_at || Date.now(),
                kind: 'refine',
              },
            }));
            if (import.meta.env.DEV) {
              console.info(`${PREFIX} refine job registered`, {
                job_id: jobInfo.job_id,
                photo_id: jobInfo.photo_id,
                parent_photo_id: jobInfo.parent_photo_id,
                kind: 'refine',
              });
            }
          }}
          onClose={() => setDetailPhotoId(null)}
          onDeleted={() => {
            setDetailPhotoId(null);
            reloadContext();
          }}
          onChained={() => {
            reloadContext();
          }}
        />
      )}

      {/* dev only — 시트/장소 카운트 표시 (없으면 안내) */}
      {import.meta.env.DEV && !loadingContext && (
        <div className="wedding-photo__debug">
          [debug] sheets={sheetCount} places={placeCount} photos={photos.length}
        </div>
      )}
    </section>
  );
}
