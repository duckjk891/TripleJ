import { ZoomableImage } from './ImageLightbox';
import { useEffect, useRef, useState } from 'react';
import * as api from '../api';
import './CharacterSheetPanel.css';

const CATEGORY_ORDER = ['top', 'bottom', 'shoes'];
const CATEGORY_LABEL = { top: '상의', bottom: '하의', shoes: '신발' };

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const ACCEPT_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

// v6 — async sheet job polling.
const POLL_INTERVAL_MS = 5000;
const TERMINAL_STATUSES = new Set(['done', 'failed']);

export default function CharacterSheetPanel({
  role,
  style,
  value,
  onChange,
  title,
  onNavigateOutfit,
  onMentionablesChanged,
  // v31 — 같은 slot 에 이미 저장된 시트가 있는지. true 면 재생성 후 자동 저장
  // 직전에 confirm 다이얼로그 띄움. false 면 즉시 자동 저장.
  hasExistingSaved = false,
}) {
  const fileInputRef = useRef(null);
  const prefix = `[CharSheetPanel:${role}_${style}]`;

  const setError = (msg) => onChange({ error: msg });

  // Keep onChange in a ref so polling intervals always see the latest reference
  // without forcing the effect to restart (which would clear/recreate the timer).
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // v31 — polling done 분기에서 항상 최신 hasExistingSaved 와 handleSave 를
  // 참조하기 위해 ref 보관 (effect 재기동 회피).
  const hasExistingSavedRef = useRef(hasExistingSaved);
  useEffect(() => {
    hasExistingSavedRef.current = hasExistingSaved;
  }, [hasExistingSaved]);
  const handleSaveRef = useRef(null);

  // Track last-seen status per job so we only patch state when it changes
  // (avoids per-tick re-renders).
  const generateLastStatusRef = useRef(null);
  const refineLastStatusRef = useRef(null);

  // Local tick state purely to drive elapsed-time re-renders. Bumped by a
  // separate 1s interval while any job is in flight.
  const [tick, setTick] = useState(0);

  // --- face photo handlers ---
  // Post-v6 fix: pre-upload the face photo to MinIO at file-selection time so
  // the resulting object_name (a string) survives sessionStorage across the
  // outfit-selection round-trip. The File object itself does not survive.
  const acceptFile = async (file) => {
    if (!file) return;
    if (!ACCEPT_TYPES.includes(file.type)) {
      console.error(`${prefix} unsupported file type`, { type: file.type });
      setError('JPG/PNG/WebP 형식만 업로드 가능합니다.');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      console.error(`${prefix} file too large`, { size: file.size });
      setError('파일이 너무 큽니다. 10MB 이하로 업로드해 주세요.');
      return;
    }
    if (import.meta.env.DEV) {
      console.info(`${prefix} face photo selected`, {
        name: file.name,
        size: file.size,
        type: file.type,
      });
    }
    // revoke previous preview to avoid leaks
    if (value.face_preview && value.face_preview.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(value.face_preview);
      } catch {
        /* noop */
      }
    }
    const preview = URL.createObjectURL(file);
    // Show preview and flip face_uploading on immediately; clear any stale
    // face_object_name in case a prior upload succeeded.
    onChange({
      face_file: file,
      face_preview: preview,
      face_object_name: null,
      face_uploading: true,
      error: '',
    });

    console.info(`${prefix} uploading face`);
    try {
      const { data } = await api.uploadAsset(file, 'photo');
      const objectName = data?.object_name || '';
      if (!objectName) {
        throw new Error('서버가 object_name 을 반환하지 않았습니다.');
      }
      console.info(`${prefix} face uploaded`, { object_name: objectName });
      onChange({
        face_file: file,
        face_preview: preview,
        face_object_name: objectName,
        face_uploading: false,
        error: '',
      });
    } catch (err) {
      const status = err?.response?.status;
      const detail =
        err?.response?.data?.detail ||
        err?.response?.data?.error ||
        err?.message ||
        '얼굴 사진 업로드에 실패했습니다.';
      console.error(`${prefix} face upload failed`, { err, status, detail });
      onChange({
        face_uploading: false,
        face_object_name: null,
        error: typeof detail === 'string' ? detail : '얼굴 사진 업로드에 실패했습니다.',
      });
    }
  };

  const handleFileInput = (e) => {
    const file = e.target.files?.[0];
    acceptFile(file);
    // reset so picking the same file again triggers change
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    acceptFile(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleRemovePhoto = () => {
    if (value.face_preview && value.face_preview.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(value.face_preview);
      } catch {
        /* noop */
      }
    }
    onChange({
      face_file: null,
      face_preview: '',
      face_object_name: null,
      face_uploading: false,
    });
  };

  // --- outfit slot handlers ---
  const handleRemoveOutfit = (category) => {
    onChange({
      items: { ...value.items, [category]: null },
    });
  };

  // --- generate / save / refine ---
  // Post-v6 fix: send face_object_name (string, pre-uploaded via /assets/upload)
  // instead of a File. The backend loads the bytes from MinIO directly.
  const buildBaseFormData = () => {
    const fd = new FormData();
    fd.append('face_object_name', value.face_object_name || '');
    fd.append('role', role);
    fd.append('style', style);
    fd.append('user_text', value.user_text || '');
    fd.append('image_model', value.image_model || 'gpt_image_2');
    const slotKey = (cat) => `${cat}_image_object_name`;
    CATEGORY_ORDER.forEach((cat) => {
      const it = value.items?.[cat];
      if (it?.image_object_name) {
        fd.append(slotKey(cat), it.image_object_name);
      }
    });
    return fd;
  };

  const handleGenerate = async () => {
    if (!value.face_object_name) {
      setError('얼굴 사진을 먼저 업로드해 주세요.');
      return;
    }
    // Mark generating immediately so the button locks; the polling effect
    // takes over once we get the job_id back.
    onChange({ generating: true, error: '' });
    console.info(`${prefix} calling generateCharacterSheet`, {
      image_model: value.image_model,
      has_top: !!value.items?.top,
      has_bottom: !!value.items?.bottom,
      has_shoes: !!value.items?.shoes,
      user_text_len: (value.user_text || '').length,
    });
    try {
      const fd = buildBaseFormData();
      const { data } = await api.generateCharacterSheet(fd);
      const jobId = data?.job_id || '';
      if (!jobId) {
        throw new Error('서버가 job_id 를 반환하지 않았습니다.');
      }
      console.info(`${prefix} job started`, { job_id: jobId, type: 'generate' });
      generateLastStatusRef.current = data?.status || 'queued';
      onChange({
        generate_job_id: jobId,
        generate_started_at: Date.now(),
        generating: true,
        error: '',
      });
    } catch (err) {
      const status = err?.response?.status;
      const detail =
        err?.response?.data?.detail ||
        err?.response?.data?.error ||
        err?.message ||
        '캐릭터 시트 생성에 실패했습니다.';
      console.error(`${prefix} generateCharacterSheet failed`, {
        status,
        detail,
      });
      onChange({
        generating: false,
        generate_job_id: null,
        generate_started_at: null,
        error: typeof detail === 'string' ? detail : '캐릭터 시트 생성에 실패했습니다.',
      });
    }
  };

  // v31 — polling done 분기에서 호출되므로 ref 최신화.
  useEffect(() => {
    handleSaveRef.current = (objArg) => handleSave(objArg);
  });

  const handleSave = async (objectNameArg) => {
    const objectName = objectNameArg || value.generated?.object_name;
    if (!objectName) return;
    onChange({ error: '' });
    const usedItems = CATEGORY_ORDER.map((cat) => {
      const it = value.items?.[cat];
      if (!it) return null;
      return {
        id: it.id,
        name: it.name,
        image_object_name: it.image_object_name,
        category: cat,
      };
    }).filter(Boolean);
    try {
      if (import.meta.env.DEV) {
        console.info(`${prefix} calling saveCharacterSheet`, {
          object_name: objectName,
          used_count: usedItems.length,
          display_name_len: (value.display_name || '').length,
          auto_save: !objectNameArg ? false : true,
        });
      }
      await api.saveCharacterSheet({
        sheet_object_name: objectName,
        role,
        style,
        used_items: usedItems,
        image_model: value.image_model || 'gpt_image_2',
        display_name: value.display_name || '',
      });
      if (import.meta.env.DEV) console.info(`${prefix} saveCharacterSheet ok`);
      // v9.1 — 시트 저장 시 display_name 이 mention 풀에 반영되도록 부모에게 알림.
      try {
        if (typeof onMentionablesChanged === 'function') onMentionablesChanged();
      } catch (cbErr) {
        console.error(`${prefix} onMentionablesChanged failed`, { err: cbErr });
      }
    } catch (err) {
      const status = err?.response?.status;
      const detail =
        err?.response?.data?.detail ||
        err?.response?.data?.error ||
        '시트 저장에 실패했습니다.';
      console.error(`${prefix} saveCharacterSheet failed`, { status, detail });
      onChange({
        error: typeof detail === 'string' ? detail : '시트 저장에 실패했습니다.',
      });
    }
  };

  const handleRefine = async () => {
    const reqText = (value.refine_request || '').trim();
    if (!reqText) {
      setError('보정 요청 내용을 입력해주세요.');
      return;
    }
    if (!value.generated?.object_name) {
      setError('먼저 시트를 생성해주세요.');
      return;
    }
    if (!value.face_object_name) {
      setError('원본 얼굴 사진이 필요합니다.');
      return;
    }
    onChange({ refining: true, error: '' });
    try {
      const fd = new FormData();
      fd.append('role', role);
      fd.append('style', style);
      fd.append('refine_request', reqText);
      fd.append('sheet_object_name', value.generated.object_name);
      // Post-v6 fix: send the pre-uploaded photo object key (string), not the File.
      fd.append('photo_object_name', value.face_object_name);
      fd.append('image_model', value.image_model || 'gpt_image_2');
      if (import.meta.env.DEV) {
        console.info(`${prefix} calling refineCharacterSheet`, {
          object_name: value.generated.object_name,
          request_len: reqText.length,
        });
      }
      const { data } = await api.refineCharacterSheet(fd);
      const jobId = data?.job_id || '';
      if (!jobId) {
        throw new Error('서버가 job_id 를 반환하지 않았습니다.');
      }
      console.info(`${prefix} job started`, { job_id: jobId, type: 'refine' });
      refineLastStatusRef.current = data?.status || 'queued';
      onChange({
        refine_job_id: jobId,
        refine_started_at: Date.now(),
        refining: true,
        error: '',
      });
    } catch (err) {
      const status = err?.response?.status;
      const detail =
        err?.response?.data?.detail ||
        err?.response?.data?.error ||
        err?.message ||
        '시트 보정에 실패했습니다.';
      console.error(`${prefix} refineCharacterSheet failed`, { status, detail });
      onChange({
        refining: false,
        refine_job_id: null,
        refine_started_at: null,
        error: typeof detail === 'string' ? detail : '시트 보정에 실패했습니다.',
      });
    }
  };

  // --- v6: polling effects ---
  // Pull just the ids out for stable effect deps. We deliberately exclude
  // `value` itself so a slot patch from another panel field doesn't restart
  // the interval. Status changes are tracked via *LastStatusRef.
  const generateJobId = value.generate_job_id || null;
  const refineJobId = value.refine_job_id || null;

  // Resume-after-refresh: on mount (or whenever a job_id reappears without the
  // matching in-flight flag), flip `generating`/`refining` back on so the UI
  // shows the pending state and the polling effect picks it up.
  useEffect(() => {
    if (generateJobId && !value.generating) {
      console.info(`${prefix} resume polling on mount`, {
        job_id: generateJobId,
        type: 'generate',
      });
      onChangeRef.current({ generating: true });
    }
    if (refineJobId && !value.refining) {
      console.info(`${prefix} resume polling on mount`, {
        job_id: refineJobId,
        type: 'refine',
      });
      onChangeRef.current({ refining: true });
    }
    // We only want this on mount / when ids appear (e.g. session rehydrate).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generateJobId, refineJobId]);

  // Generate-job poll loop.
  useEffect(() => {
    if (!generateJobId) {
      generateLastStatusRef.current = null;
      return undefined;
    }
    let cancelled = false;
    const tickPoll = async () => {
      try {
        const { data } = await api.getSheetJob(generateJobId);
        if (cancelled) return;
        const next = data?.status || 'queued';
        const prev = generateLastStatusRef.current;
        if (next !== prev) {
          console.info(`${prefix} poll status changed`, {
            job_id: generateJobId,
            prev,
            next,
          });
          generateLastStatusRef.current = next;
        }
        if (next === 'done') {
          const objectName = data?.sheet_object_name || '';
          // Always rebuild the preview URL on the client — the backend's
          // `preview_url` is a path-only string (`/api/character/preview/...`),
          // which the browser would resolve against the frontend origin and
          // without the auth token. `sheetPreviewUrl` returns the full
          // backend URL + ?token= so the <img> actually renders.
          const previewUrl = objectName ? api.sheetPreviewUrl(objectName) : '';
          console.info(`${prefix} poll terminal`, {
            job_id: generateJobId,
            status: next,
          });
          onChangeRef.current({
            generating: false,
            generate_job_id: null,
            generate_started_at: null,
            generated: { object_name: objectName, preview_url: previewUrl },
            error: '',
          });
          // v31 — 폴링 done 후 자동 저장 / 덮어쓰기 확인.
          //   • hasExistingSaved === false → 즉시 자동 저장 (첫 시트)
          //   • hasExistingSaved === true  → window.confirm 으로 덮어쓰기 확인.
          //     취소 시 새 PNG state(generated) 만 비워 폐기하고 기존 시트 유지.
          if (objectName) {
            if (!hasExistingSavedRef.current) {
              console.info(`${prefix} auto-save (first sheet)`, {
                object_name: objectName,
              });
              handleSaveRef.current(objectName).catch((e) => {
                console.error(`${prefix} auto-save failed`, { err: e });
              });
            } else {
              const ok = window.confirm(
                '새 시트로 덮어쓰시겠습니까?\n취소하면 새로 생성한 시트는 폐기되고 기존 시트가 그대로 유지됩니다.',
              );
              if (ok) {
                console.info(`${prefix} overwrite confirmed — saving`, {
                  object_name: objectName,
                });
                handleSaveRef.current(objectName).catch((e) => {
                  console.error(`${prefix} overwrite save failed`, { err: e });
                });
              } else {
                console.info(`${prefix} overwrite cancelled — discarding new PNG`, {
                  object_name: objectName,
                });
                onChangeRef.current({ generated: null });
              }
            }
          }
        } else if (next === 'failed') {
          console.info(`${prefix} poll terminal`, {
            job_id: generateJobId,
            status: next,
          });
          onChangeRef.current({
            generating: false,
            generate_job_id: null,
            generate_started_at: null,
            error: data?.error_message || '시트 생성 실패',
          });
        }
      } catch (err) {
        // Network blips during polling: log and keep polling — terminal status
        // resolves on next successful tick.
        const status = err?.response?.status;
        const detail =
          err?.response?.data?.detail || err?.message || 'poll error';
        console.error(`${prefix} poll request failed`, {
          job_id: generateJobId,
          status,
          detail,
        });
      }
    };
    // Kick a poll immediately so the UI doesn't sit blank for 5s after a
    // refresh / job start.
    tickPoll();
    const handle = setInterval(tickPoll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [generateJobId, prefix]);

  // Refine-job poll loop — mirror of the generate loop.
  useEffect(() => {
    if (!refineJobId) {
      refineLastStatusRef.current = null;
      return undefined;
    }
    let cancelled = false;
    const tickPoll = async () => {
      try {
        const { data } = await api.getSheetJob(refineJobId);
        if (cancelled) return;
        const next = data?.status || 'queued';
        const prev = refineLastStatusRef.current;
        if (next !== prev) {
          console.info(`${prefix} poll status changed`, {
            job_id: refineJobId,
            prev,
            next,
          });
          refineLastStatusRef.current = next;
        }
        if (next === 'done') {
          const objectName = data?.sheet_object_name || '';
          // Same rebuild as generate path — backend preview_url is path-only.
          const previewUrl = objectName ? api.sheetPreviewUrl(objectName) : '';
          console.info(`${prefix} poll terminal`, {
            job_id: refineJobId,
            status: next,
          });
          onChangeRef.current({
            refining: false,
            refine_job_id: null,
            refine_started_at: null,
            generated: { object_name: objectName, preview_url: previewUrl },
            refine_request: '',
            error: '',
          });
          // v53.3 — refine done 시 자동 save. generate 와 달리 refine 은
          // 이미 슬롯에 시트가 있는 상태에서 사용자가 "보정" 을 명시적으로 요청한
          // 흐름이라 confirm 없이 즉시 덮어쓴다. 예전엔 save 자체가 빠져
          // permanent slot (wedding_character_sheets) 이 갱신 안 됨 → 가사
          // 생성 화면 등에서 이전 시트가 그대로 보이던 버그.
          if (objectName) {
            console.info(`${prefix} refine auto-save (overwrite)`, {
              object_name: objectName,
            });
            handleSaveRef.current(objectName).catch((e) => {
              console.error(`${prefix} refine auto-save failed`, { err: e });
            });
          }
        } else if (next === 'failed') {
          console.info(`${prefix} poll terminal`, {
            job_id: refineJobId,
            status: next,
          });
          onChangeRef.current({
            refining: false,
            refine_job_id: null,
            refine_started_at: null,
            error: data?.error_message || '시트 보정 실패',
          });
        }
      } catch (err) {
        const status = err?.response?.status;
        const detail =
          err?.response?.data?.detail || err?.message || 'poll error';
        console.error(`${prefix} poll request failed`, {
          job_id: refineJobId,
          status,
          detail,
        });
      }
    };
    tickPoll();
    const handle = setInterval(tickPoll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [refineJobId, prefix]);

  const generating = !!value.generating;
  const refining = !!value.refining;
  const hasGenerated = !!value.generated?.object_name;

  // Elapsed-time ticker — bump `tick` once per second whenever any job is in
  // flight so the "N초 경과" text re-renders.
  useEffect(() => {
    if (!generating && !refining) return undefined;
    const handle = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(handle);
  }, [generating, refining]);

  // Read `tick` so React knows the elapsed text depends on it (the values
  // themselves are derived below directly from started_at / Date.now()).
  void tick;

  const generateElapsedSec = value.generate_started_at
    ? Math.max(0, Math.floor((Date.now() - value.generate_started_at) / 1000))
    : 0;
  const refineElapsedSec = value.refine_started_at
    ? Math.max(0, Math.floor((Date.now() - value.refine_started_at) / 1000))
    : 0;

  return (
    <div className="sheet-panel">
      <div className="sheet-panel__head">
        <h3 className="sheet-panel__title">{title}</h3>
      </div>

      {/* face photo dropzone */}
      <div className="sheet-panel__photo">
        <div
          className={
            'sheet-photo-zone' + (value.face_preview ? ' sheet-photo-zone--filled' : '')
          }
          onClick={() => fileInputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
        >
          {(() => {
            // Prefer the durable network preview when we have an object_name —
            // this protects against stale blob: URLs left in sessionStorage
            // from a previous page lifetime (the blob registry is dead after
            // a refresh, so the <img> would render broken otherwise).
            const facePreviewSrc = value.face_object_name
              ? api.sheetPreviewUrl(value.face_object_name)
              : value.face_preview;
            return facePreviewSrc ? (
              <ZoomableImage
                src={facePreviewSrc}
                alt="얼굴 사진 미리보기"
                className="sheet-photo-zone__preview"
              />
            ) : (
              <div className="sheet-photo-zone__placeholder">
                <div className="sheet-photo-zone__icon">+</div>
                <div className="sheet-photo-zone__text">얼굴 사진 업로드</div>
                <div className="sheet-photo-zone__hint">JPG · PNG · WebP / 10MB 이하</div>
              </div>
            );
          })()}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: 'none' }}
          onChange={handleFileInput}
        />
        {value.face_preview && (
          <button
            type="button"
            className="sheet-photo-zone__remove"
            onClick={handleRemovePhoto}
          >
            사진 제거
          </button>
        )}
      </div>

      {/* display_name */}
      <div className="sheet-panel__name">
        <input
          type="text"
          value={value.display_name || ''}
          onChange={(e) => onChange({ display_name: e.target.value })}
          placeholder="시트 이름 (예: 평상복 신랑)"
          maxLength={80}
        />
      </div>

      {/* user_text */}
      <div className="sheet-panel__text">
        <input
          type="text"
          value={value.user_text || ''}
          onChange={(e) => onChange({ user_text: e.target.value })}
          placeholder="예) 키 178, 부드러운 분위기 (선택)"
          maxLength={200}
        />
      </div>

      {/* image model radio */}
      <div className="sheet-panel__model">
        <span className="sheet-panel__model-label">이미지 모델</span>
        <div className="radio-row">
          <label className="radio-card">
            <input
              type="radio"
              name={`img-model-${role}-${style}`}
              checked={(value.image_model || 'gpt_image_2') === 'gpt_image_2'}
              onChange={() => onChange({ image_model: 'gpt_image_2' })}
            />
            <span>GPT Image 2</span>
          </label>
          <label className="radio-card">
            <input
              type="radio"
              name={`img-model-${role}-${style}`}
              checked={value.image_model === 'nb_pro'}
              onChange={() => onChange({ image_model: 'nb_pro' })}
            />
            <span>Nano Banana Pro</span>
          </label>
        </div>
      </div>

      {/* outfit slots */}
      <div className="sheet-panel__outfits">
        {CATEGORY_ORDER.map((cat) => {
          const it = value.items?.[cat];
          return (
            <div key={cat} className="outfit-slot">
              <div className="outfit-slot__label">{CATEGORY_LABEL[cat]}</div>
              {it ? (
                <div className="outfit-slot__filled">
                  <ZoomableImage
                    className="outfit-thumb"
                    src={api.sheetPreviewUrl(it.image_object_name)}
                    alt={it.name || CATEGORY_LABEL[cat]}
                  />
                  <div className="outfit-slot__name" title={it.name}>
                    {it.name}
                  </div>
                  <div className="outfit-slot__actions">
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => onNavigateOutfit(cat)}
                    >
                      변경
                    </button>
                    <button
                      type="button"
                      className="link-btn link-btn--danger"
                      onClick={() => handleRemoveOutfit(cat)}
                    >
                      제거
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="outfit-slot__empty"
                  onClick={() => onNavigateOutfit(cat)}
                >
                  선택하기 →
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* actions */}
      <div className="sheet-panel__actions">
        <button
          type="button"
          className="btn-primary"
          onClick={handleGenerate}
          disabled={
            !value.face_object_name || generating || refining || !!value.face_uploading
          }
        >
          {value.face_uploading
            ? '업로드 중...'
            : generating
              ? '생성 중...'
              : hasGenerated
                ? '다시 생성'
                : '시트 생성'}
        </button>
        {generating && value.generate_started_at ? (
          <p className="sheet-panel__elapsed">
            생성 중... {generateElapsedSec}초 경과 — GPT Image 2 는 보통 2~5분 걸려요.
          </p>
        ) : null}
      </div>

      {/* error */}
      {value.error ? (
        <div className="sheet-panel__error" role="alert">
          {value.error}
        </div>
      ) : null}

      {/* result */}
      {hasGenerated && (
        <div className="sheet-panel__result">
          <div className="sheet-panel__result-img-wrap">
            <ZoomableImage
              className="sheet-panel__result-img"
              src={value.generated.preview_url}
              alt="생성된 캐릭터 시트"
            />
            <button
              type="button"
              className="asset-download-btn"
              title="이미지 다운로드"
              onClick={async () => {
                const objectName = value.generated?.object_name || '';
                if (!objectName) return;
                try {
                  await api.downloadAssetByObjectName(
                    objectName,
                    `${role}_${style}.png`,
                  );
                  if (import.meta.env.DEV) {
                    console.info(`${prefix} download ok`, { objectName });
                  }
                } catch (err) {
                  console.error(`${prefix} download failed`, {
                    objectName,
                    err: err?.message,
                  });
                }
              }}
            >
              ⬇
            </button>
          </div>
          <div className="sheet-panel__result-actions">
            <button
              type="button"
              className="btn-ghost"
              onClick={handleGenerate}
              disabled={generating}
            >
              {generating ? '생성 중...' : '다시 생성'}
            </button>
            {/* v31 — [저장] 버튼 제거. 생성 직후 자동 저장 (또는 덮어쓰기 확인). */}
          </div>
          <div className="sheet-panel__refine">
            <input
              type="text"
              value={value.refine_request || ''}
              onChange={(e) => onChange({ refine_request: e.target.value })}
              placeholder="보정 요청 (예: 셔츠 색을 베이지로)"
              disabled={refining}
            />
            <button
              type="button"
              className="btn-ghost"
              onClick={handleRefine}
              disabled={refining || !(value.refine_request || '').trim()}
            >
              {refining ? '보정 중...' : '보정'}
            </button>
          </div>
          {refining && value.refine_started_at ? (
            <p className="sheet-panel__elapsed">
              보정 중... {refineElapsedSec}초 경과 — GPT Image 2 는 보통 2~5분 걸려요.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
