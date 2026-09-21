import { useState, useEffect } from 'react';

// 앱 내 다이얼로그 — window.confirm/prompt/alert 대체 (시스템 팝업 금지 규칙과 일관,
// prompt() 미지원 웹뷰에서도 안전). App 에 <DialogHost /> 를 한 번 마운트하고
// appConfirm / appPrompt / appAlert 를 어디서든 호출한다.

let _open = null; // DialogHost 가 마운트되면 setState 주입

function openDialog(config) {
  return new Promise((resolve) => {
    if (!_open) { resolve(config.type === 'confirm' ? false : null); return; }
    _open({ ...config, resolve });
  });
}

export const appAlert = (message) => openDialog({ type: 'alert', message });
export const appConfirm = (message) => openDialog({ type: 'confirm', message });
export const appPrompt = (message, placeholder = '') => openDialog({ type: 'prompt', message, placeholder });

export function DialogHost() {
  const [dlg, setDlg] = useState(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    _open = (config) => { setValue(''); setDlg(config); };
    return () => { _open = null; };
  }, []);

  if (!dlg) return null;

  const close = (result) => {
    dlg.resolve(result);
    setDlg(null);
  };

  const okResult = dlg.type === 'prompt' ? value : true;

  return (
    <div className="modal-overlay" onClick={() => close(dlg.type === 'confirm' ? false : dlg.type === 'prompt' ? null : undefined)}>
      <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <p style={{ whiteSpace: 'pre-line', lineHeight: 1.5 }}>{dlg.message}</p>
        {dlg.type === 'prompt' && (
          <div className="form-row" style={{ marginTop: 12 }}>
            <input
              className="input" autoFocus value={value} placeholder={dlg.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') close(value); }}
            />
          </div>
        )}
        <div className="modal__footer">
          {dlg.type !== 'alert' && (
            <button className="btn" onClick={() => close(dlg.type === 'confirm' ? false : null)}>취소</button>
          )}
          <button className="btn btn--primary" onClick={() => close(dlg.type === 'alert' ? undefined : okResult)}>확인</button>
        </div>
      </div>
    </div>
  );
}
