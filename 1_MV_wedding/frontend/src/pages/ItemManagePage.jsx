import { ZoomableImage } from '../components/ImageLightbox';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../api';
import { useAuth } from '../contexts/AuthContext';
import './ItemManagePage.css';

const PREFIX = '[ItemManagePage]';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const ACCEPT_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

const ROLE_STYLE_OPTIONS = [
  { value: 'groom_casual', label: '신랑·평상복' },
  { value: 'groom_wedding', label: '신랑·웨딩' },
  { value: 'bride_casual', label: '신부·평상복' },
  { value: 'bride_wedding', label: '신부·웨딩' },
];

const CATEGORY_OPTIONS = [
  { value: 'top', label: '상의' },
  { value: 'bottom', label: '하의' },
  { value: 'shoes', label: '신발' },
];

const FILTER_TABS = [
  { value: 'all', label: '전체' },
  { value: 'groom_casual', label: '신랑·평상복' },
  { value: 'groom_wedding', label: '신랑·웨딩' },
  { value: 'bride_casual', label: '신부·평상복' },
  { value: 'bride_wedding', label: '신부·웨딩' },
];

const ROLE_LABEL = { groom: '신랑', bride: '신부' };
const STYLE_LABEL = { casual: '평상복', wedding: '웨딩' };
const CATEGORY_LABEL = { top: '상의', bottom: '하의', shoes: '신발' };

const INITIAL_FORM = {
  mode: 'create',
  editingId: null,
  name: '',
  role_style: 'groom_casual',
  category: 'top',
  image_file: null,
  image_preview: '', // blob: URL for new file, or existing preview_url for edit mode
  image_is_existing: false, // true → preview is server-side URL, no new file picked
  product_url: '',
  submitting: false,
  error: '',
};

function formatDate(value) {
  if (!value) return '';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch {
    return '';
  }
}

function extractErrorDetail(err, fallback) {
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string' && detail.length > 0) return detail;
  return fallback;
}

export default function ItemManagePage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [form, setForm] = useState(INITIAL_FORM);
  const fileInputRef = useRef(null);
  const blobUrlRef = useRef(''); // tracks current blob URL for cleanup

  // v20 — 일괄 선택/삭제 상태
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const BULK_LIMIT = 50;
  const REASON_LABEL = {
    invalid_id: '잘못된 ID',
    not_found: '찾을 수 없음',
    forbidden: '권한 없음',
    exception: '서버 오류',
  };

  if (import.meta.env.DEV) {
    console.info(`${PREFIX} role check`, { isAdmin });
  }

  // --- initial load ---
  useEffect(() => {
    let cancelled = false;
    console.info(`${PREFIX} calling getMyOutfitItems`, { isAdmin });
    setLoading(true);
    setListError('');
    api
      .getMyOutfitItems()
      .then(({ data }) => {
        if (cancelled) return;
        const next = Array.isArray(data?.items) ? data.items : [];
        if (import.meta.env.DEV) {
          console.info(`${PREFIX} items loaded`, { count: next.length, isAdmin });
        }
        setItems(next);
      })
      .catch((e) => {
        console.error(`${PREFIX} list failed`, { err: e?.message, isAdmin });
        if (!cancelled) {
          setListError(
            extractErrorDetail(e, '아이템 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.'),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  // --- cleanup blob URL on unmount ---
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        try {
          URL.revokeObjectURL(blobUrlRef.current);
        } catch {
          /* noop */
        }
      }
    };
  }, []);

  // --- client-side filtered list ---
  const filteredItems = useMemo(() => {
    if (activeFilter === 'all') return items;
    const [r, s] = activeFilter.split('_');
    return items.filter((it) => it.role === r && it.style === s);
  }, [items, activeFilter]);

  // --- auto-bind form.role_style to the active tab when filter is specific AND
  //     the form is in create mode. Edit mode keeps the editing row's value.
  useEffect(() => {
    if (activeFilter === 'all') return;
    if (form.mode !== 'create') return;
    if (form.role_style === activeFilter) return;
    if (import.meta.env.DEV) {
      console.info(`${PREFIX} auto-bind role_style from active tab`, {
        from: form.role_style,
        to: activeFilter,
      });
    }
    setForm((prev) => ({ ...prev, role_style: activeFilter }));
  }, [activeFilter, form.mode, form.role_style]);

  // --- form field helpers ---
  const patchForm = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const releaseBlobPreview = () => {
    if (blobUrlRef.current) {
      try {
        URL.revokeObjectURL(blobUrlRef.current);
      } catch {
        /* noop */
      }
      blobUrlRef.current = '';
    }
  };

  const acceptFile = (file) => {
    if (!file) return;
    if (!ACCEPT_TYPES.includes(file.type)) {
      console.error(`${PREFIX} unsupported file type`, { type: file.type });
      patchForm({ error: 'JPG/PNG/WebP 형식만 업로드 가능합니다.' });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      console.error(`${PREFIX} file too large`, { size: file.size });
      patchForm({ error: '파일이 너무 큽니다. 10MB 이하로 업로드해 주세요.' });
      return;
    }
    if (import.meta.env.DEV) {
      console.info(`${PREFIX} image file selected`, {
        name: file.name,
        size: file.size,
        type: file.type,
      });
    }
    releaseBlobPreview();
    const blobUrl = URL.createObjectURL(file);
    blobUrlRef.current = blobUrl;
    patchForm({
      image_file: file,
      image_preview: blobUrl,
      image_is_existing: false,
      error: '',
    });
  };

  const handleFileInput = (e) => {
    const file = e.target.files?.[0];
    acceptFile(file);
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

  const resetForm = () => {
    releaseBlobPreview();
    setForm(INITIAL_FORM);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleStartEdit = (item) => {
    if (import.meta.env.DEV) {
      console.info(`${PREFIX} edit start`, { item_id: item.id });
    }
    releaseBlobPreview();
    const itemRoleStyle = `${item.role}_${item.style}`;
    setForm({
      mode: 'edit',
      editingId: item.id,
      name: item.name || '',
      role_style: itemRoleStyle,
      category: item.category || 'top',
      image_file: null,
      image_preview: item.image_object_name
        ? api.sheetPreviewUrl(item.image_object_name)
        : '',
      image_is_existing: true,
      product_url: item.product_url || '',
      submitting: false,
      error: '',
    });
    // Keep tab and form's role_style in sync (option a) — jump the active tab
    // to the editing item's combo so the (now hidden) radio stays consistent.
    if (activeFilter !== itemRoleStyle) {
      if (import.meta.env.DEV) {
        console.info(`${PREFIX} edit auto-switch active tab`, {
          from: activeFilter,
          to: itemRoleStyle,
        });
      }
      setActiveFilter(itemRoleStyle);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
    // scroll the form into view for convenience
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // v20 — 리스트 강제 새로고침. 일괄 삭제 후 서버 단일진실 동기화에 사용.
  const reloadItems = async () => {
    if (import.meta.env.DEV) {
      console.info(`${PREFIX} reloadItems begin`, { isAdmin });
    }
    try {
      const { data } = await api.getMyOutfitItems();
      const next = Array.isArray(data?.items) ? data.items : [];
      if (import.meta.env.DEV) {
        console.info(`${PREFIX} reloadItems ok`, { count: next.length });
      }
      setItems(next);
    } catch (e) {
      console.error(`${PREFIX} reloadItems failed`, { err: e?.message });
      setListError(
        extractErrorDetail(e, '아이템 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.'),
      );
    }
  };

  // v20 — 선택모드 토글 / 단일 행 체크박스 / 전체 토글 / 일괄 삭제
  const enterSelectMode = () => {
    if (import.meta.env.DEV) {
      console.info(`${PREFIX} selectMode on`);
    }
    setSelectMode(true);
    setSelectedIds(new Set());
  };

  const exitSelectMode = () => {
    if (import.meta.env.DEV) {
      console.info(`${PREFIX} selectMode off`);
    }
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const toggleRowSelected = (itemId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const selectAllVisible = () => {
    const ids = filteredItems.map((it) => it.id);
    if (import.meta.env.DEV) {
      console.info(`${PREFIX} select all visible`, { count: ids.length });
    }
    setSelectedIds(new Set(ids));
  };

  const clearSelected = () => {
    if (import.meta.env.DEV) {
      console.info(`${PREFIX} clear selected`);
    }
    setSelectedIds(new Set());
  };

  // thead 의 마스터 체크박스 — 전체 토글
  const handleHeaderToggle = () => {
    if (selectedIds.size === filteredItems.length && filteredItems.length > 0) {
      clearSelected();
    } else {
      selectAllVisible();
    }
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (ids.length > BULK_LIMIT) {
      console.warn(`${PREFIX} bulk delete over limit`, { count: ids.length });
      window.alert(`한 번에 최대 ${BULK_LIMIT}개까지 삭제할 수 있어요.`);
      return;
    }
    if (!window.confirm(`선택한 ${ids.length}개 아이템을 삭제할까요? 되돌릴 수 없어요.`)) {
      return;
    }
    console.info(`${PREFIX} calling bulkDeleteOutfitItems`, { count: ids.length });
    setBulkBusy(true);
    try {
      const { data } = await api.bulkDeleteOutfitItems(ids);
      const deletedCount = Number(data?.deleted_count || 0);
      const failed = Array.isArray(data?.failed) ? data.failed : [];
      if (import.meta.env.DEV) {
        console.info(`${PREFIX} bulkDeleteOutfitItems ok`, {
          deleted_count: deletedCount,
          failed_count: failed.length,
          total_requested: data?.total_requested,
        });
      }
      // reason 별 카운트 집계
      let failMsg = '';
      if (failed.length > 0) {
        const reasonCounts = failed.reduce((acc, f) => {
          const r = f?.reason || 'exception';
          acc[r] = (acc[r] || 0) + 1;
          return acc;
        }, {});
        const parts = Object.entries(reasonCounts).map(
          ([r, n]) => `${REASON_LABEL[r] || r}: ${n}`,
        );
        failMsg = `실패 ${failed.length}개 (${parts.join(', ')})`;
        console.warn(`${PREFIX} bulkDelete partial failures`, { reasonCounts });
      }
      // 서버 단일진실로 리스트 새로고침
      await reloadItems();
      // 편집 중인 아이템이 삭제됐으면 폼 초기화
      if (form.mode === 'edit' && form.editingId && selectedIds.has(form.editingId)) {
        resetForm();
      }
      // 알림
      if (deletedCount > 0 && failMsg) {
        window.alert(`${deletedCount}개 삭제됨. ${failMsg}`);
      } else if (deletedCount > 0) {
        window.alert(`${deletedCount}개 삭제됨`);
      } else if (failMsg) {
        window.alert(failMsg);
      }
      // 사용자 편의 — selectMode 자동 종료
      setSelectedIds(new Set());
      setSelectMode(false);
    } catch (err) {
      console.error(`${PREFIX} bulk delete failed`, { err, count: ids.length });
      const msg = extractErrorDetail(
        err,
        '일괄 삭제에 실패했습니다. 잠시 후 다시 시도해주세요.',
      );
      window.alert(msg);
    } finally {
      setBulkBusy(false);
    }
  };

  const handleDelete = async (item) => {
    if (!window.confirm('정말 삭제하시겠습니까?')) return;
    console.info(`${PREFIX} calling deleteOutfitItem`, { item_id: item.id });
    try {
      await api.deleteOutfitItem(item.id);
      if (import.meta.env.DEV) {
        console.info(`${PREFIX} item deleted`, { item_id: item.id });
      }
      setItems((prev) => prev.filter((it) => it.id !== item.id));
      // if the deleted item was currently being edited, reset the form
      if (form.mode === 'edit' && form.editingId === item.id) {
        resetForm();
      }
    } catch (err) {
      console.error(`${PREFIX} deleteOutfitItem failed`, {
        err,
        item_id: item.id,
      });
      const msg = extractErrorDetail(err, '삭제에 실패했습니다. 잠시 후 다시 시도해주세요.');
      window.alert(msg);
    }
  };

  const validateForm = () => {
    const name = form.name.trim();
    if (!name) return '아이템명을 입력해 주세요.';
    if (name.length > 80) return '아이템명은 80자 이하로 입력해 주세요.';
    if (!form.role_style) return '의상 종류를 선택해 주세요.';
    if (!form.category) return '카테고리를 선택해 주세요.';
    if (form.mode === 'create' && !form.image_file) {
      return '이미지를 업로드해 주세요.';
    }
    if (form.product_url && form.product_url.length > 500) {
      return '구매처 URL은 500자 이하로 입력해 주세요.';
    }
    return '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validationError = validateForm();
    if (validationError) {
      patchForm({ error: validationError });
      return;
    }

    const [role, style] = form.role_style.split('_');
    const fd = new FormData();
    // For edit mode, send all fields anyway — backend treats them as optional
    // and overwriting with current values is a no-op. Only image is conditional.
    fd.append('name', form.name.trim());
    fd.append('role', role);
    fd.append('style', style);
    fd.append('category', form.category);
    fd.append('product_url', form.product_url.trim());
    if (form.image_file) {
      fd.append('image', form.image_file);
    }

    patchForm({ submitting: true, error: '' });

    if (form.mode === 'edit') {
      const editingId = form.editingId;
      console.info(`${PREFIX} calling updateOutfitItem`, {
        item_id: editingId,
        role,
        style,
        category: form.category,
        has_new_image: !!form.image_file,
      });
      try {
        const { data } = await api.updateOutfitItem(editingId, fd);
        if (import.meta.env.DEV) {
          console.info(`${PREFIX} item updated`, { item_id: data?.id });
        }
        setItems((prev) =>
          prev.map((it) => (it.id === editingId ? { ...it, ...data } : it)),
        );
        resetForm();
      } catch (err) {
        console.error(`${PREFIX} updateOutfitItem failed`, {
          err,
          item_id: editingId,
        });
        patchForm({
          submitting: false,
          error: extractErrorDetail(err, '수정에 실패했습니다. 잠시 후 다시 시도해주세요.'),
        });
      }
    } else {
      console.info(`${PREFIX} calling createOutfitItem`, {
        role,
        style,
        category: form.category,
      });
      try {
        const { data } = await api.createOutfitItem(fd);
        if (import.meta.env.DEV) {
          console.info(`${PREFIX} item created`, { item_id: data?.id });
        }
        setItems((prev) => [data, ...prev]);
        resetForm();
      } catch (err) {
        console.error(`${PREFIX} createOutfitItem failed`, { err });
        patchForm({
          submitting: false,
          error: extractErrorDetail(err, '등록에 실패했습니다. 잠시 후 다시 시도해주세요.'),
        });
      }
    }
  };

  const isEdit = form.mode === 'edit';

  return (
    <section className="item-manage">
      <div className="item-manage__head">
        <h1 className="item-manage__title">
          아이템관리
          {isAdmin && (
            <span className="item-manage__admin-flag">🛡 관리자 모드</span>
          )}
        </h1>
        <p className="item-manage__desc">
          위저드의 의상 그리드에 함께 노출될 사용자 아이템을 직접 등록·관리합니다.
        </p>
      </div>

      {/* Filter tabs */}
      <div className="item-manage__tabs" role="tablist">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={activeFilter === tab.value}
            className={
              'item-manage__tab' +
              (activeFilter === tab.value ? ' item-manage__tab--active' : '')
            }
            onClick={() => setActiveFilter(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Add / Edit form */}
      <form className="item-manage__form card" onSubmit={handleSubmit}>
        <div className="item-manage__form-head">
          <h2 className="item-manage__form-title">
            {isEdit ? '아이템 수정' : '아이템 추가'}
          </h2>
          {isEdit && (
            <span className="item-manage__form-mode">편집 모드</span>
          )}
        </div>

        <div className="field">
          <label htmlFor="item-name">아이템명 *</label>
          <input
            id="item-name"
            type="text"
            maxLength={80}
            value={form.name}
            onChange={(e) => patchForm({ name: e.target.value })}
            placeholder="예) 베이지 린넨 셔츠"
            disabled={form.submitting}
          />
        </div>

        {activeFilter === 'all' && (
          <div className="field">
            <label>누구의 의상 *</label>
            <div className="radio-row">
              {ROLE_STYLE_OPTIONS.map((opt) => (
                <label key={opt.value} className="radio-card">
                  <input
                    type="radio"
                    name="item-role-style"
                    value={opt.value}
                    checked={form.role_style === opt.value}
                    onChange={() => patchForm({ role_style: opt.value })}
                    disabled={form.submitting}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <label>카테고리 *</label>
          <div className="radio-row">
            {CATEGORY_OPTIONS.map((opt) => (
              <label key={opt.value} className="radio-card">
                <input
                  type="radio"
                  name="item-category"
                  value={opt.value}
                  checked={form.category === opt.value}
                  onChange={() => patchForm({ category: opt.value })}
                  disabled={form.submitting}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="field">
          <label>이미지 {isEdit ? '(교체 시에만 선택)' : '*'}</label>
          <div
            className={
              'item-manage__dropzone' +
              (form.image_preview ? ' item-manage__dropzone--filled' : '')
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
            {form.image_preview ? (
              <ZoomableImage
                src={form.image_preview}
                alt="아이템 미리보기"
                className="item-manage__dropzone-preview"
              />
            ) : (
              <div className="item-manage__dropzone-placeholder">
                <div className="item-manage__dropzone-icon">+</div>
                <div>클릭 또는 파일을 끌어다 놓으세요</div>
                <div className="item-manage__dropzone-hint">
                  JPG · PNG · WebP / 10MB 이하
                </div>
              </div>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: 'none' }}
            onChange={handleFileInput}
          />
          {isEdit && form.image_is_existing && (
            <div className="item-manage__form-hint muted">
              새 파일을 선택하면 기존 이미지를 교체합니다.
            </div>
          )}
        </div>

        <div className="field">
          <label htmlFor="item-product-url">구매처 URL (선택)</label>
          <input
            id="item-product-url"
            type="text"
            maxLength={500}
            value={form.product_url}
            onChange={(e) => patchForm({ product_url: e.target.value })}
            placeholder="https://..."
            disabled={form.submitting}
          />
        </div>

        {form.error && (
          <div className="error-text" role="alert">
            {form.error}
          </div>
        )}

        <div className="item-manage__form-actions">
          <button
            type="submit"
            className="btn-primary"
            disabled={form.submitting}
          >
            {form.submitting
              ? '처리 중…'
              : isEdit
              ? '수정 저장'
              : '+ 추가'}
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={resetForm}
            disabled={form.submitting}
          >
            {isEdit ? '편집 취소' : '폼 초기화'}
          </button>
        </div>
      </form>

      {/* Items table */}
      <div className="item-manage__list">
        <div className="item-manage__list-head">
          <h2 className="item-manage__list-title">
            {isAdmin ? '전체 아이템' : '내 아이템'}
          </h2>
          <span className="item-manage__list-count muted">
            {loading
              ? ''
              : isAdmin
              ? `전체 ${items.length}개 (필터 ${filteredItems.length})`
              : `${filteredItems.length} / ${items.length}`}
          </span>
        </div>

        {/* v20 — 일괄 삭제 액션 바 */}
        {!loading && !listError && items.length > 0 && (
          <div className="item-manage__action-bar">
            {!selectMode ? (
              <button
                type="button"
                className="btn-ghost item-manage__btn-sm"
                onClick={enterSelectMode}
              >
                ☑ 선택
              </button>
            ) : (
              <>
                <span className="item-manage__select-count">
                  선택 {selectedIds.size}개
                </span>
                <button
                  type="button"
                  className="btn-ghost item-manage__btn-sm"
                  onClick={selectAllVisible}
                  disabled={bulkBusy || filteredItems.length === 0}
                >
                  전체 선택
                </button>
                <button
                  type="button"
                  className="btn-ghost item-manage__btn-sm"
                  onClick={clearSelected}
                  disabled={bulkBusy || selectedIds.size === 0}
                >
                  전체 해제
                </button>
                <button
                  type="button"
                  className="btn-ghost item-manage__btn-sm item-manage__btn-danger"
                  onClick={handleBulkDelete}
                  disabled={selectedIds.size === 0 || bulkBusy}
                >
                  {bulkBusy ? '삭제 중…' : `🗑 선택 삭제 (${selectedIds.size})`}
                </button>
                <button
                  type="button"
                  className="btn-ghost item-manage__btn-sm"
                  onClick={exitSelectMode}
                  disabled={bulkBusy}
                >
                  취소
                </button>
              </>
            )}
          </div>
        )}

        {loading && (
          <div className="muted" style={{ padding: '16px 0' }}>
            아이템을 불러오는 중…
          </div>
        )}

        {!loading && listError && (
          <div className="error-text" role="alert">
            {listError}
          </div>
        )}

        {!loading && !listError && items.length === 0 && (
          <div className="muted item-manage__empty">
            {isAdmin
              ? '등록된 아이템이 없습니다.'
              : '아직 등록한 아이템이 없습니다. 위 폼에서 첫 아이템을 추가해보세요.'}
          </div>
        )}

        {!loading && !listError && items.length > 0 && filteredItems.length === 0 && (
          <div className="muted item-manage__empty">
            선택한 필터에 해당하는 아이템이 없습니다.
          </div>
        )}

        {!loading && !listError && filteredItems.length > 0 && (
          <div className="item-manage__table-wrap">
            <table className="item-manage__table">
              <thead>
                <tr>
                  {selectMode && (
                    <th className="item-manage__check-cell">
                      <input
                        type="checkbox"
                        aria-label="현재 결과 전체 선택/해제"
                        checked={
                          filteredItems.length > 0 &&
                          selectedIds.size === filteredItems.length
                        }
                        onChange={handleHeaderToggle}
                        disabled={bulkBusy}
                      />
                    </th>
                  )}
                  <th>이미지</th>
                  <th>이름</th>
                  {isAdmin && <th>소유자</th>}
                  <th>신랑/신부</th>
                  <th>스타일</th>
                  <th>카테고리</th>
                  <th>등록일</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((it) => {
                  const editingThis =
                    form.mode === 'edit' && form.editingId === it.id;
                  const isChecked = selectedIds.has(it.id);
                  return (
                    <tr
                      key={it.id}
                      className={
                        editingThis ? 'item-manage__row--editing' : undefined
                      }
                    >
                      {selectMode && (
                        <td className="item-manage__check-cell">
                          <input
                            type="checkbox"
                            aria-label={`${it.name} 선택`}
                            checked={isChecked}
                            onChange={() => toggleRowSelected(it.id)}
                            disabled={bulkBusy}
                          />
                        </td>
                      )}
                      <td className="item-manage__cell-image">
                        {it.image_object_name ? (
                          <ZoomableImage
                            src={api.sheetPreviewUrl(it.image_object_name)}
                            alt={it.name}
                            loading="lazy"
                          />
                        ) : (
                          <div className="item-manage__thumb-placeholder" />
                        )}
                      </td>
                      <td>{it.name}</td>
                      {isAdmin && (
                        <td>
                          <span className="item-manage__owner-badge">
                            {it.owner_nickname || it.owner_email || '—'}
                          </span>
                        </td>
                      )}
                      <td>{ROLE_LABEL[it.role] || it.role}</td>
                      <td>{STYLE_LABEL[it.style] || it.style}</td>
                      <td>{CATEGORY_LABEL[it.category] || it.category}</td>
                      <td>{formatDate(it.created_at)}</td>
                      <td className="item-manage__cell-actions">
                        <button
                          type="button"
                          className="btn-ghost item-manage__btn-sm"
                          onClick={() => handleStartEdit(it)}
                        >
                          수정
                        </button>
                        <button
                          type="button"
                          className="btn-ghost item-manage__btn-sm item-manage__btn-danger"
                          onClick={() => handleDelete(it)}
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
