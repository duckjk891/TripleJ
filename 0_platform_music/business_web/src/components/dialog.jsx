import { useState, useEffect } from 'react';

// 사이트 안 다이얼로그 — 시스템 alert/confirm 대신 쓴다(MAIDOL 팝업 규칙).
// App 에 <DialogHost /> 를 한 번 두고 appAlert / appConfirm 을 어디서든 호출한다.
let _open = null;

function openDialog(config) {
  return new Promise((resolve) => {
    if (!_open) { resolve(config.type === 'confirm' ? false : undefined); return; }
    _open({ ...config, resolve });
  });
}

export const appAlert = (message, opts = {}) => openDialog({ type: 'alert', message, ...opts });
export const appConfirm = (message, opts = {}) => openDialog({ type: 'confirm', message, ...opts });

export function DialogHost() {
  const [dlg, setDlg] = useState(null);
  useEffect(() => {
    _open = (config) => setDlg(config);
    return () => { _open = null; };
  }, []);
  useEffect(() => {
    if (!dlg) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') close(dlg.type === 'confirm' ? false : undefined); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  if (!dlg) return null;
  const close = (result) => { dlg.resolve(result); setDlg(null); };
  return (
    <div className="overlay" onClick={() => close(dlg.type === 'confirm' ? false : undefined)}>
      <div className="dialog dialog--sm" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {dlg.title && <h3 className="dialog__title">{dlg.title}</h3>}
        <p className="dialog__msg">{dlg.message}</p>
        <div className="dialog__actions">
          {dlg.type === 'confirm' && <button className="btn" onClick={() => close(false)}>{dlg.cancelText || '취소'}</button>}
          <button
            className={`btn ${dlg.danger ? 'btn--danger' : 'btn--primary'}`}
            autoFocus
            onClick={() => close(dlg.type === 'confirm' ? true : undefined)}
          >
            {dlg.okText || '확인'}
          </button>
        </div>
      </div>
    </div>
  );
}

// 잠깐 떴다 사라지는 안내(저장 완료 등)
let _toast = null;
export const toast = (message) => { if (_toast) _toast(message); };
export function ToastHost() {
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    let t = null;
    _toast = (m) => { setMsg(m); clearTimeout(t); t = setTimeout(() => setMsg(null), 2400); };
    return () => { _toast = null; clearTimeout(t); };
  }, []);
  return msg ? <div className="toast" role="status">{msg}</div> : null;
}
