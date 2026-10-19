import { useEffect, useRef, useState } from 'react';
import { createItem, updateItem, deleteItem, friendlyError, imageUrl, CATEGORIES, GENDERS } from '../api';
import { appConfirm } from './dialog';

const MAX_MB = 10;
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const FIELDS = ['name', 'product_url', 'category', 'gender', 'brand', 'color', 'product_name'];

// 상품 등록·수정 창 — POST/PUT /api/business/ads (multipart)
export default function ItemDialog({ item, onClose, onSaved }) {
  const isNew = !item;
  const [f, setF] = useState(() => Object.fromEntries(FIELDS.map((k) => [k, item?.[k] || ''])));
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(item ? imageUrl(item.image_object_name) : null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => () => { if (preview && preview.startsWith('blob:')) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const pick = (fl) => {
    if (!fl) return;
    if (!TYPES.includes(fl.type)) { setError('JPG·PNG·WEBP 사진만 올릴 수 있어요.'); return; }
    if (fl.size > MAX_MB * 1024 * 1024) { setError(`사진은 ${MAX_MB}MB 이하로 올려 주세요.`); return; }
    setError('');
    setFile(fl);
    setPreview(URL.createObjectURL(fl));
  };

  const validate = () => {
    if (isNew && !file) return '상품 사진을 올려 주세요.';
    if (!f.name.trim()) return '착장에 보일 이름을 입력해 주세요.';
    if (!/^https?:\/\/\S+\.\S+/.test(f.product_url.trim())) return '상품 페이지 주소를 https:// 로 시작하게 입력해 주세요.';
    if (!CATEGORIES.includes(f.category) && !(item && f.category === item.category)) return '카테고리를 골라 주세요.';
    if (!GENDERS.includes(f.gender) && !(item && f.gender === item.gender)) return '대상(남성용·여성용·공용)을 골라 주세요.';
    return '';
  };

  const save = async () => {
    const v = validate();
    if (v) { setError(v); return; }
    const fd = new FormData();
    FIELDS.forEach((k) => {
      const val = (f[k] || '').trim();
      if (isNew || val !== (item?.[k] || '')) fd.append(k, val);
    });
    if (file) fd.append('image', file);
    if (!isNew && [...fd.keys()].length === 0) { onClose(); return; }
    setBusy(true);
    setError('');
    try {
      if (isNew) await createItem(fd);
      else await updateItem(item.id, fd);
      onSaved(isNew ? '상품을 등록했어요. 착장 목록에 바로 보여요.' : '저장했어요.');
    } catch (err) {
      setError(friendlyError(err, '저장하지 못했어요. 잠시 후 다시 시도해 주세요.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await appConfirm(`'${item.name}' 상품을 삭제할까요?\n삭제하면 되돌릴 수 없고, 지금까지의 성과도 더 볼 수 없어요. 잠시 빼 두려면 '노출' 스위치를 끄세요.`, { okText: '삭제', danger: true });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteItem(item.id);
      onSaved('상품을 삭제했어요.');
    } catch (err) {
      setError(friendlyError(err, '삭제하지 못했어요. 잠시 후 다시 시도해 주세요.'));
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={() => !busy && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={isNew ? '상품 등록' : '상품 수정'} onClick={(e) => e.stopPropagation()}>
        <h3 className="dialog__title">{isNew ? '상품 등록' : '상품 수정'}</h3>
        {item?.admin_hidden && <div className="notice">운영 정책으로 숨겨진 상품이에요. 수정은 할 수 있지만 착장 목록에는 보이지 않아요.</div>}
        <div className="idlg">
          <div
            className={`drop ${drag ? 'is-drag' : ''}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click(); }}
            aria-label="상품 사진 선택"
          >
            {preview ? <img src={preview} alt="상품 사진 미리보기" /> : <span>상품 사진<br />끌어 놓거나 눌러서 선택<br /><small>JPG·PNG·WEBP, {MAX_MB}MB 이하</small></span>}
            {preview && <em className="drop__change">사진 바꾸기</em>}
            <input ref={fileRef} type="file" accept={TYPES.join(',')} hidden onChange={(e) => pick(e.target.files?.[0])} />
          </div>
          <div className="idlg__fields">
            <label className="field">착장에 보일 이름 *<input className="input" value={f.name} maxLength={60} onChange={(e) => set('name', e.target.value)} placeholder="예: 오버핏 니트 라벤더" /></label>
            <label className="field">상품 페이지 주소 *<input className="input" value={f.product_url} onChange={(e) => set('product_url', e.target.value)} placeholder="https://" inputMode="url" /></label>
          </div>
        </div>
        <div className="field">카테고리 *
          <div className="chips">{CATEGORIES.map((c) => <button type="button" key={c} className={`chip ${f.category === c ? 'is-on' : ''}`} onClick={() => set('category', c)}>{c}</button>)}</div>
        </div>
        <div className="field">대상 *
          <div className="chips">{GENDERS.map((g) => <button type="button" key={g} className={`chip ${f.gender === g ? 'is-on' : ''}`} onClick={() => set('gender', g)}>{g}</button>)}</div>
        </div>
        <div className="grid2">
          <label className="field">브랜드<input className="input" value={f.brand} maxLength={60} onChange={(e) => set('brand', e.target.value)} /></label>
          <label className="field">색상<input className="input" value={f.color} maxLength={30} onChange={(e) => set('color', e.target.value)} /></label>
        </div>
        <label className="field">판매 페이지 상품명 (선택)<input className="input" value={f.product_name} maxLength={120} onChange={(e) => set('product_name', e.target.value)} placeholder="쇼핑몰에 등록된 정식 상품명" /></label>
        {error && <div className="notice notice--err" role="alert">{error}</div>}
        <div className="dialog__actions dialog__actions--split">
          {!isNew ? <button className="btn btn--text-danger" disabled={busy} onClick={remove}>상품 삭제</button> : <span />}
          <div className="row">
            <button className="btn" disabled={busy} onClick={onClose}>취소</button>
            <button className="btn btn--primary" disabled={busy} onClick={save}>{busy ? '저장 중…' : isNew ? '등록하기' : '저장'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
