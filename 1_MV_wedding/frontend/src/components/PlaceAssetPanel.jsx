import { useEffect, useRef, useState } from 'react';
import * as api from '../api';
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

  // --- polling effect: 모든 활성 job 을 5초마다 한꺼번에 ---
  useEffect(() => {
    const activeJobs = places
      .filter((p) => p.job_id)
      .map((p) => ({ place_id: p.place_id, job_id: p.job_id }));
    if (activeJobs.length === 0) return undefined;

    let cancelled = false;
    const tickPoll = async () => {
      // 매번 최신 placesRef 기준으로 활성 잡만 폴링.
      const current = placesRef.current
        .filter((p) => p.job_id)
        .map((p) => ({ place_id: p.place_id, job_id: p.job_id }));
      await Promise.all(
        current.map(async ({ place_id, job_id }) => {
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
                });
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
                });
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
  }, [places.map((p) => p.job_id || '').join(',')]);

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
    const isBusy = !!(place.uploading || place.generating || place.job_id);

    return (
      <div className="place-card" key={place.place_id}>
        <div className="place-card__preview">
          {place.preview_url ? (
            <>
              <img
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
              {place.generating || place.job_id ? '생성 중...' : '이미지 생성'}
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
    </div>
  );
}
