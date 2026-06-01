import { ZoomableImage } from './ImageLightbox';
import { useEffect, useRef, useState } from 'react';
import * as api from '../api';
import PlaceOverwriteModal from './PlaceOverwriteModal';
import './PlaceAssetPanel.css';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const ACCEPT_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const POLL_INTERVAL_MS = 5000;
const PREFIX = '[PlaceAssetPanel]';

// 로컬 드래프트 ID (서버 미저장 슬롯). 서버에 저장되면 진짜 place_id 로 교체된다.
const makeDraftId = () =>
  `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const emptyPlace = () => ({
  place_id: makeDraftId(),
  is_draft: true,
  display_name: '',
  memo: '',
  source: null, // null | 'uploaded' | 'generated'
  object_name: null,
  preview_url: null,
  image_model: 'gpt_image_2',
  job_id: null,
  job_started_at: null,
  uploading: false,
  generating: false,
  error: '',
  // v34 — 기존 자산이 있는 상태에서 [이미지 생성] 다시 누른 경우 새 후보 자산을
  // 여기 별도로 보관한다. polling 이 done 되면 모달이 자동으로 뜬다. 슬롯의
  // place_id / object_name 은 기존 자산을 그대로 가리킨다.
  pending_candidate: null,
  // shape: { place_id, job_id, object_name, preview_url, started_at, generating }
});

export default function PlaceAssetPanel({ onMentionablesChanged }) {
  // v9.1 — 자산 변경(추가/이름수정/삭제/잡 완료) 시 부모(StoryWizardPage)의
  // mentionOptions 를 다시 fetch 하도록 알림. 콜백 미지정이면 noop.
  const notifyChanged = () => {
    try {
      if (typeof onMentionablesChanged === 'function') onMentionablesChanged();
    } catch (err) {
      console.error(`${PREFIX} onMentionablesChanged failed`, { err });
    }
  };
  const [places, setPlaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [globalError, setGlobalError] = useState('');
  // 1초 ticker — 잡 진행 중 경과 시간 표시용.
  const [tick, setTick] = useState(0);
  // useRef 로 최신 places 보존 — 폴링/타이머가 stale closure 가지지 않도록.
  const placesRef = useRef(places);
  useEffect(() => {
    placesRef.current = places;
  }, [places]);

  // --- initial load ---
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        if (import.meta.env.DEV) console.info(`${PREFIX} listPlaces start`);
        const { data } = await api.listPlaces();
        if (cancelled) return;
        const items = Array.isArray(data?.items) ? data.items : [];
        // 서버 자산을 PlaceAssetPanel 슬롯 형태로 정규화.
        const normalized = items.map((it) => ({
          place_id: it.place_id,
          is_draft: false,
          display_name: it.display_name || '',
          memo: it.memo || '',
          source: it.source || null,
          object_name: it.object_name || null,
          preview_url: it.object_name ? api.sheetPreviewUrl(it.object_name) : null,
          image_model: it.image_model || 'gpt_image_2',
          job_id: null,
          job_started_at: null,
          uploading: false,
          generating: false,
          error: '',
        }));
        setPlaces(normalized);
        if (import.meta.env.DEV)
          console.info(`${PREFIX} listPlaces ok`, { count: normalized.length });
      } catch (err) {
        const status = err?.response?.status;
        const detail = err?.response?.data?.detail || err?.message || 'list error';
        console.error(`${PREFIX} listPlaces failed`, { status, detail });
        if (!cancelled) {
          setGlobalError('장소 목록을 불러오지 못했습니다.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  // --- patch helpers ---
  const patchPlace = (placeId, patch) => {
    setPlaces((prev) =>
      prev.map((p) => (p.place_id === placeId ? { ...p, ...patch } : p)),
    );
  };

  const replacePlace = (oldId, next) => {
    setPlaces((prev) => prev.map((p) => (p.place_id === oldId ? next : p)));
  };

  const removePlace = (placeId) => {
    setPlaces((prev) => prev.filter((p) => p.place_id !== placeId));
  };

  // --- elapsed-time ticker — 잡 진행 중일 때만 켜둔다 ---
  useEffect(() => {
    const anyActive = places.some((p) => p.job_id);
    if (!anyActive) return undefined;
    const handle = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(handle);
  }, [places]);
  void tick;

  // v34 — 덮어쓰기 모달 상태. 한 번에 1개 슬롯만 모달 표시.
  const [overwrite, setOverwrite] = useState(null);
  // shape: { slot_id, display_name, old_place_id, old_preview_url,
  //          new_place_id, new_preview_url, busy }

  // --- polling effect: 모든 활성 job 을 5초마다 한꺼번에 ---
  useEffect(() => {
    // v34 — pending_candidate.job_id 도 활성 잡 풀에 포함.
    const slotJobs = places
      .filter((p) => p.job_id)
      .map((p) => ({ place_id: p.place_id, job_id: p.job_id, mode: 'slot' }));
    const candJobs = places
      .filter((p) => p.pending_candidate && p.pending_candidate.job_id)
      .map((p) => ({
        place_id: p.place_id,
        job_id: p.pending_candidate.job_id,
        mode: 'candidate',
      }));
    const activeJobs = [...slotJobs, ...candJobs];
    if (activeJobs.length === 0) return undefined;

    let cancelled = false;
    const tickPoll = async () => {
      // 매번 최신 placesRef 기준으로 활성 잡만 폴링.
      const slotJ = placesRef.current
        .filter((p) => p.job_id)
        .map((p) => ({ place_id: p.place_id, job_id: p.job_id, mode: 'slot' }));
      const candJ = placesRef.current
        .filter((p) => p.pending_candidate && p.pending_candidate.job_id)
        .map((p) => ({
          place_id: p.place_id,
          job_id: p.pending_candidate.job_id,
          mode: 'candidate',
        }));
      const current = [...slotJ, ...candJ];
      await Promise.all(
        current.map(async ({ place_id, job_id, mode }) => {
          try {
            const { data } = await api.getPlaceJob(job_id);
            if (cancelled) return;
            const status = data?.status || 'queued';
            if (status === 'done') {
              const objectName = data?.object_name || '';
              const previewUrl = objectName ? api.sheetPreviewUrl(objectName) : null;
              if (import.meta.env.DEV) {
                console.info(`${PREFIX}:${place_id} poll terminal`, {
                  job_id,
                  status,
                  mode,
                });
              }
              if (mode === 'candidate') {
                // v34 — 후보 자산 잡 완료. pending_candidate 갱신 + 모달 자동 open.
                const slot = placesRef.current.find((p) => p.place_id === place_id);
                if (slot && slot.pending_candidate) {
                  patchPlace(place_id, {
                    pending_candidate: {
                      ...slot.pending_candidate,
                      object_name: objectName || null,
                      preview_url: previewUrl,
                      generating: false,
                    },
                  });
                  setOverwrite({
                    slot_id: place_id,
                    display_name: slot.display_name || '',
                    old_place_id: place_id,           // 슬롯의 현재 자산 ID
                    old_preview_url: slot.preview_url || null,
                    new_place_id: slot.pending_candidate.place_id,
                    new_preview_url: previewUrl,
                    busy: false,
                  });
                  if (import.meta.env.DEV) {
                    console.info(`${PREFIX}:${place_id} overwrite candidate generated`, {
                      old_place_id: place_id,
                      new_place_id: slot.pending_candidate.place_id,
                    });
                  }
                }
                return;
              }
              patchPlace(place_id, {
                job_id: null,
                job_started_at: null,
                generating: false,
                object_name: objectName || null,
                preview_url: previewUrl,
                source: 'generated',
                error: '',
              });
              // 잡 완료 시 mention 풀 다시 fetch — object_name 채워진 자산 반영.
              notifyChanged();
            } else if (status === 'failed') {
              if (import.meta.env.DEV) {
                console.info(`${PREFIX}:${place_id} poll terminal`, {
                  job_id,
                  status,
                  mode,
                });
              }
              if (mode === 'candidate') {
                // v34 — 후보 잡 실패: pending_candidate 자체를 정리 + 슬롯에 에러 표시.
                patchPlace(place_id, {
                  pending_candidate: null,
                  error: data?.error_message || '새 후보 이미지 생성에 실패했습니다.',
                });
                return;
              }
              patchPlace(place_id, {
                job_id: null,
                job_started_at: null,
                generating: false,
                error: data?.error_message || '장소 이미지 생성에 실패했습니다.',
              });
            }
            // queued/running 은 무시 — 다음 tick 에서 다시 확인.
          } catch (err) {
            const status = err?.response?.status;
            const detail =
              err?.response?.data?.detail || err?.message || 'poll error';
            console.error(`${PREFIX}:${place_id} poll request failed`, {
              job_id,
              status,
              detail,
            });
          }
        }),
      );
    };

    // 즉시 1회 + 5초 인터벌.
    tickPoll();
    const handle = setInterval(tickPoll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
    // 활성 잡 id 의 set 이 바뀔 때만 effect 재시작.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    places.map((p) => p.job_id || '').join(','),
    places.map((p) => (p.pending_candidate?.job_id) || '').join(','),
  ]);

  // --- handlers ---
  const handleAdd = () => {
    if (import.meta.env.DEV) console.info(`${PREFIX} add draft slot`);
    setPlaces((prev) => [...prev, emptyPlace()]);
  };

  const handleNameChange = (placeId, val) => {
    patchPlace(placeId, { display_name: val, error: '' });
  };

  const handleMemoChange = (placeId, val) => {
    patchPlace(placeId, { memo: val });
  };

  const handleModelChange = (placeId, model) => {
    patchPlace(placeId, { image_model: model });
  };

  // 인풋 blur 시 서버에 PUT — draft 슬롯은 스킵.
  const handleNameBlur = async (place) => {
    if (place.is_draft) return;
    try {
      if (import.meta.env.DEV) {
        console.info(`${PREFIX}:${place.place_id} updatePlace name`, {
          display_name_len: (place.display_name || '').length,
        });
      }
      await api.updatePlace(place.place_id, {
        display_name: place.display_name || '',
      });
      notifyChanged();
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || err?.message || 'update error';
      console.error(`${PREFIX}:${place.place_id} updatePlace failed`, {
        status,
        detail,
      });
      patchPlace(place.place_id, { error: '장소 이름 저장 실패' });
    }
  };

  const handleMemoBlur = async (place) => {
    if (place.is_draft) return;
    try {
      if (import.meta.env.DEV) {
        console.info(`${PREFIX}:${place.place_id} updatePlace memo`, {
          memo_len: (place.memo || '').length,
        });
      }
      await api.updatePlace(place.place_id, { memo: place.memo || '' });
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || err?.message || 'update error';
      console.error(`${PREFIX}:${place.place_id} updatePlace failed`, {
        status,
        detail,
      });
      patchPlace(place.place_id, { error: '메모 저장 실패' });
    }
  };

  const validateForCreate = (place) => {
    const name = (place.display_name || '').trim();
    if (!name) {
      // 사용자 메시지 — alert 로 즉시 인지.
      alert('장소 이름을 먼저 입력해주세요.');
      return false;
    }
    return true;
  };

  const validateFile = (file, placeId) => {
    if (!ACCEPT_TYPES.includes(file.type)) {
      console.error(`${PREFIX}:${placeId} unsupported file type`, { type: file.type });
      patchPlace(placeId, { error: 'JPG/PNG/WebP 형식만 업로드 가능합니다.' });
      return false;
    }
    if (file.size > MAX_FILE_BYTES) {
      console.error(`${PREFIX}:${placeId} file too large`, { size: file.size });
      patchPlace(placeId, { error: '파일이 너무 큽니다. 10MB 이하로 업로드해 주세요.' });
      return false;
    }
    return true;
  };

  const handleUploadFile = async (place, file) => {
    if (!file) return;
    if (!validateForCreate(place)) return;
    if (!validateFile(file, place.place_id)) return;

    patchPlace(place.place_id, { uploading: true, error: '' });
    try {
      const fd = new FormData();
      fd.append('image', file);
      fd.append('display_name', place.display_name || '');
      fd.append('memo', place.memo || '');
      if (import.meta.env.DEV) {
        console.info(`${PREFIX}:${place.place_id} createPlaceUploaded start`, {
          size: file.size,
          type: file.type,
        });
      }
      const { data } = await api.createPlaceUploaded(fd);
      const objectName = data?.object_name || '';
      const newPlace = {
        place_id: data?.place_id || place.place_id,
        is_draft: false,
        display_name: data?.display_name || place.display_name || '',
        memo: data?.memo || place.memo || '',
        source: data?.source || 'uploaded',
        object_name: objectName || null,
        preview_url: objectName ? api.sheetPreviewUrl(objectName) : null,
        image_model: place.image_model || 'gpt_image_2',
        job_id: null,
        job_started_at: null,
        uploading: false,
        generating: false,
        error: '',
      };
      if (import.meta.env.DEV) {
        console.info(`${PREFIX}:${newPlace.place_id} createPlaceUploaded ok`);
      }
      replacePlace(place.place_id, newPlace);
      notifyChanged();
    } catch (err) {
      const status = err?.response?.status;
      const detail =
        err?.response?.data?.detail || err?.message || '업로드에 실패했습니다.';
      console.error(`${PREFIX}:${place.place_id} createPlaceUploaded failed`, {
        status,
        detail,
      });
      patchPlace(place.place_id, {
        uploading: false,
        error: typeof detail === 'string' ? detail : '업로드에 실패했습니다.',
      });
    }
  };

  const handleGenerate = async (place) => {
    if (!validateForCreate(place)) return;

    // v34 — 이미 저장된 자산 (is_draft=false + object_name 존재) 에서 재생성하는
    // 경우엔 기존 자산은 그대로 두고 새 자산을 pending_candidate 로 별도 보관.
    // 잡 done 시점에 자동 모달이 떠서 사용자가 덮어쓰기/취소 결정.
    const isOverwriteMode = !place.is_draft && !!place.object_name;
    if (isOverwriteMode) {
      // 기존 슬롯의 generating 은 켜지 않고, candidate.generating 만.
      patchPlace(place.place_id, { error: '' });
      try {
        if (import.meta.env.DEV) {
          console.info(`${PREFIX}:${place.place_id} candidate generatePlace start`, {
            image_model: place.image_model || 'gpt_image_2',
            memo_len: (place.memo || '').length,
          });
        }
        const { data } = await api.generatePlace({
          display_name: place.display_name || '',
          memo: place.memo || '',
          image_model: place.image_model || 'gpt_image_2',
        });
        const newPlaceId = data?.place_id;
        const jobId = data?.job_id;
        if (!newPlaceId || !jobId) {
          throw new Error('서버가 place_id 또는 job_id 를 반환하지 않았습니다.');
        }
        patchPlace(place.place_id, {
          pending_candidate: {
            place_id: newPlaceId,
            job_id: jobId,
            object_name: null,
            preview_url: null,
            started_at: Date.now(),
            generating: true,
          },
        });
        if (import.meta.env.DEV) {
          console.info(`${PREFIX}:${place.place_id} candidate job started`, {
            new_place_id: newPlaceId, job_id: jobId,
          });
        }
      } catch (err) {
        const status = err?.response?.status;
        const detail =
          err?.response?.data?.detail || err?.message || '장소 이미지 생성에 실패했습니다.';
        console.error(`${PREFIX}:${place.place_id} candidate generatePlace failed`, {
          status,
          detail,
        });
        patchPlace(place.place_id, {
          error: typeof detail === 'string' ? detail : '새 후보 이미지 생성에 실패했습니다.',
        });
      }
      return;
    }

    // 첫 생성 (빈 슬롯) — 기존 흐름.
    patchPlace(place.place_id, { generating: true, error: '' });
    try {
      if (import.meta.env.DEV) {
        console.info(`${PREFIX}:${place.place_id} generatePlace start`, {
          image_model: place.image_model || 'gpt_image_2',
          memo_len: (place.memo || '').length,
        });
      }
      const { data } = await api.generatePlace({
        display_name: place.display_name || '',
        memo: place.memo || '',
        image_model: place.image_model || 'gpt_image_2',
      });
      const newPlaceId = data?.place_id;
      const jobId = data?.job_id;
      if (!newPlaceId || !jobId) {
        throw new Error('서버가 place_id 또는 job_id 를 반환하지 않았습니다.');
      }
      if (import.meta.env.DEV) {
        console.info(`${PREFIX}:${newPlaceId} generate job started`, {
          job_id: jobId,
          status: data?.status,
        });
      }
      replacePlace(place.place_id, {
        ...place,
        place_id: newPlaceId,
        is_draft: false,
        source: 'generated',
        object_name: null,
        preview_url: null,
        job_id: jobId,
        job_started_at: Date.now(),
        generating: true,
        error: '',
      });
      // 잡 시작 시점에도 자산 doc 은 이미 mongo 에 pre-insert 됐으므로
      // mention 풀에 반영(이름은 보이지만 이미지는 잡 완료 후 노출).
      notifyChanged();
    } catch (err) {
      const status = err?.response?.status;
      const detail =
        err?.response?.data?.detail || err?.message || '장소 이미지 생성에 실패했습니다.';
      console.error(`${PREFIX}:${place.place_id} generatePlace failed`, {
        status,
        detail,
      });
      patchPlace(place.place_id, {
        generating: false,
        error: typeof detail === 'string' ? detail : '장소 이미지 생성에 실패했습니다.',
      });
    }
  };

  // v34 — 모달 [덮어쓰기 확정]: 기존 자산 DELETE, 슬롯을 새 자산으로 promote.
  const handleOverwriteConfirm = async () => {
    if (!overwrite || overwrite.busy) return;
    const { slot_id, old_place_id, new_place_id, new_preview_url } = overwrite;
    setOverwrite((o) => (o ? { ...o, busy: true } : o));
    try {
      if (import.meta.env.DEV) {
        console.info(`${PREFIX}:${slot_id} overwrite confirmed`, {
          old: old_place_id, new: new_place_id,
        });
      }
      await api.deletePlace(old_place_id);
      patchPlace(slot_id, {
        place_id: new_place_id,
        object_name: overwrite?.new_object_name || null,
        preview_url: new_preview_url || null,
        source: 'generated',
        pending_candidate: null,
        error: '',
      });
      setOverwrite(null);
      notifyChanged();
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || err?.message || '덮어쓰기에 실패했습니다.';
      console.error(`${PREFIX}:${slot_id} overwrite confirm failed`, { status, detail });
      setOverwrite((o) => (o ? { ...o, busy: false } : o));
      patchPlace(slot_id, { error: typeof detail === 'string' ? detail : '덮어쓰기에 실패했습니다.' });
    }
  };

  // v34 — 모달 [취소]: 새 후보 자산 DELETE, 슬롯 그대로 유지.
  const handleOverwriteCancel = async () => {
    if (!overwrite || overwrite.busy) return;
    const { slot_id, new_place_id } = overwrite;
    setOverwrite((o) => (o ? { ...o, busy: true } : o));
    try {
      if (import.meta.env.DEV) {
        console.info(`${PREFIX}:${slot_id} overwrite cancelled — deleting candidate`, {
          new: new_place_id,
        });
      }
      await api.deletePlace(new_place_id);
      patchPlace(slot_id, { pending_candidate: null });
      setOverwrite(null);
      notifyChanged();
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || err?.message || '취소 처리에 실패했습니다.';
      console.error(`${PREFIX}:${slot_id} overwrite cancel delete failed`, { status, detail });
      // 새 자산 삭제 실패해도 UI 의 candidate state 는 비워 사용자 흐름 막지 않음.
      patchPlace(slot_id, { pending_candidate: null });
      setOverwrite(null);
    }
  };

  const handleDelete = async (place) => {
    // draft 슬롯은 즉시 로컬 제거.
    if (place.is_draft) {
      if (import.meta.env.DEV) {
        console.info(`${PREFIX}:${place.place_id} remove local draft`);
      }
      removePlace(place.place_id);
      return;
    }
    const ok = window.confirm(
      `"${place.display_name || '이름 없음'}" 장소를 삭제하시겠습니까?`,
    );
    if (!ok) return;
    try {
      if (import.meta.env.DEV) {
        console.info(`${PREFIX}:${place.place_id} deletePlace start`);
      }
      await api.deletePlace(place.place_id);
      if (import.meta.env.DEV) {
        console.info(`${PREFIX}:${place.place_id} deletePlace ok`);
      }
      removePlace(place.place_id);
      notifyChanged();
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || err?.message || 'delete error';
      console.error(`${PREFIX}:${place.place_id} deletePlace failed`, {
        status,
        detail,
      });
      patchPlace(place.place_id, { error: '삭제에 실패했습니다.' });
    }
  };

  // --- per-place card ---
  const renderCard = (place) => {
    const elapsedSec = place.job_started_at
      ? Math.max(0, Math.floor((Date.now() - place.job_started_at) / 1000))
      : 0;
    // v34 — pending_candidate.generating 도 isBusy 에 포함 (덮어쓰기 후보 진행 중).
    const isBusy = !!(
      place.uploading
      || place.generating
      || place.job_id
      || place.pending_candidate?.generating
      || place.pending_candidate?.job_id
    );
    const candidateInProgress = !!(place.pending_candidate?.job_id);

    return (
      <div className="place-card" key={place.place_id}>
        <div className="place-card__preview">
          {place.preview_url ? (
            <>
              <ZoomableImage
                src={place.preview_url}
                alt={place.display_name || '장소 이미지'}
                className="place-card__img"
              />
              <button
                type="button"
                className="asset-download-btn"
                title="이미지 다운로드"
                onClick={async () => {
                  const objectName = place.object_name || '';
                  if (!objectName) return;
                  const safeName = (place.display_name || 'place')
                    .replace(/[\\/:*?"<>|]+/g, '_')
                    .slice(0, 60);
                  try {
                    await api.downloadAssetByObjectName(
                      objectName,
                      `${safeName}.png`,
                    );
                    if (import.meta.env.DEV) {
                      console.info(`${PREFIX} download ok`, { objectName });
                    }
                  } catch (err) {
                    console.error(`${PREFIX} download failed`, {
                      objectName,
                      err: err?.message,
                    });
                  }
                }}
              >
                ⬇
              </button>
            </>
          ) : (
            <div className="place-card__placeholder">
              <div className="place-card__placeholder-icon">+</div>
              <div className="place-card__placeholder-text">
                {place.job_id
                  ? `생성 중... ${elapsedSec}초 경과`
                  : place.uploading
                    ? '업로드 중...'
                    : '이미지 없음'}
              </div>
            </div>
          )}
        </div>

        <div className="place-card__controls">
          <input
            type="text"
            className="place-card__name"
            value={place.display_name}
            onChange={(e) => handleNameChange(place.place_id, e.target.value)}
            onBlur={() => handleNameBlur(place)}
            placeholder="장소 이름 (예: 한강 카페)"
            maxLength={80}
            disabled={isBusy}
          />
          <textarea
            className="place-card__memo"
            value={place.memo}
            onChange={(e) => handleMemoChange(place.place_id, e.target.value)}
            onBlur={() => handleMemoBlur(place)}
            placeholder="메모 (선택) — 분위기·시간대 등 프롬프트 힌트"
            rows={2}
            maxLength={300}
            disabled={isBusy}
          />

          <div className="place-card__model">
            <span className="place-card__model-label">이미지 모델</span>
            <div className="radio-row">
              <label className="radio-card">
                <input
                  type="radio"
                  name={`place-model-${place.place_id}`}
                  checked={(place.image_model || 'gpt_image_2') === 'gpt_image_2'}
                  onChange={() => handleModelChange(place.place_id, 'gpt_image_2')}
                  disabled={isBusy}
                />
                <span>GPT Image 2</span>
              </label>
              <label className="radio-card">
                <input
                  type="radio"
                  name={`place-model-${place.place_id}`}
                  checked={place.image_model === 'nb_pro'}
                  onChange={() => handleModelChange(place.place_id, 'nb_pro')}
                  disabled={isBusy}
                />
                <span>Nano Banana Pro</span>
              </label>
            </div>
          </div>

          <div className="place-card__actions">
            <label className="place-card__upload-btn">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) handleUploadFile(place, f);
                }}
                disabled={isBusy}
              />
              <span className="btn-ghost place-card__btn">
                {place.uploading ? '업로드 중...' : '이미지 업로드'}
              </span>
            </label>
            <button
              type="button"
              className="btn-primary place-card__btn"
              onClick={() => handleGenerate(place)}
              disabled={isBusy}
            >
              {place.generating || place.job_id || candidateInProgress
                ? '생성 중...'
                : (place.object_name ? '새로 생성 (덮어쓰기)' : '이미지 생성')}
            </button>
            <button
              type="button"
              className="link-btn link-btn--danger place-card__delete"
              onClick={() => handleDelete(place)}
              disabled={place.uploading || !!place.job_id}
            >
              삭제
            </button>
          </div>

          {place.job_id && place.job_started_at ? (
            <p className="place-card__elapsed">
              생성 중... {elapsedSec}초 경과 — 보통 1~5분 걸려요.
            </p>
          ) : null}

          {place.error ? (
            <div className="place-card__error" role="alert">
              {place.error}
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div className="place-asset-panel">
      <div className="place-asset-panel__head">
        <h3 className="place-asset-panel__title">
          장소 이미지 자산 <span className="opt">(선택)</span>
        </h3>
        <p className="place-asset-panel__desc muted">
          두 사람의 이야기에 등장하는 장소들의 이미지를 만들어 두세요. 영상 자동 생성 시 사용됩니다.
        </p>
        <button
          type="button"
          className="btn-ghost place-asset-panel__add"
          onClick={handleAdd}
          disabled={loading}
        >
          + 장소 추가
        </button>
      </div>

      {globalError ? (
        <div className="place-asset-panel__error" role="alert">
          {globalError}
        </div>
      ) : null}

      {loading ? (
        <div className="place-asset-panel__loading muted">불러오는 중...</div>
      ) : places.length === 0 ? (
        <div className="place-asset-panel__empty muted">
          아직 등록된 장소가 없습니다. <strong>+ 장소 추가</strong> 버튼으로 시작해주세요.
        </div>
      ) : (
        <div className="place-asset-panel__list">{places.map(renderCard)}</div>
      )}

      {/* v34 — 덮어쓰기 확정 모달 */}
      <PlaceOverwriteModal
        open={!!overwrite}
        displayName={overwrite?.display_name || ''}
        oldPreviewUrl={overwrite?.old_preview_url || ''}
        newPreviewUrl={overwrite?.new_preview_url || ''}
        busy={!!overwrite?.busy}
        onConfirm={handleOverwriteConfirm}
        onCancel={handleOverwriteCancel}
      />
    </div>
  );
}
