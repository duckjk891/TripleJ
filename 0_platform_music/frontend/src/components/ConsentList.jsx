import { useState } from 'react';
import { CONSENTS, BEHAVIOR_NOTICE } from '../constants/consentTexts';
import './ConsentList.css';

// v125 — 가입/온보딩 공용 동의 체크 리스트.
// props:
//   keys     : consentTexts 의 key 배열 (예: SIGNUP_CONSENT_KEYS)
//   values   : { [key]: bool } — 체크 상태(상위 소유)
//   onChange : (nextValues) => void
// 문구는 constants/consentTexts.js 원본을 그대로 렌더한다(수정 금지).
// 필수 미체크 판단 헬퍼는 utils/consent.js 의 areRequiredConsentsChecked 사용.
// 주의: 로그에는 key 와 agreed bool 만 남긴다.

export default function ConsentList({ keys, values, onChange }) {
  // [보기] 로 펼쳐진 항목 key 집합
  const [openKeys, setOpenKeys] = useState(() => new Set());

  const items = (keys || []).map((k) => CONSENTS[k]).filter(Boolean);
  const allChecked = items.length > 0 && items.every((it) => !!values?.[it.key]);

  const setValue = (key, agreed) => {
    if (import.meta.env.DEV) console.info('[ConsentList] change', { key, agreed });
    onChange({ ...(values || {}), [key]: agreed });
  };

  const toggleAll = () => {
    const nextAgreed = !allChecked;
    const next = { ...(values || {}) };
    items.forEach((it) => { next[it.key] = nextAgreed; });
    if (import.meta.env.DEV) console.info('[ConsentList] toggle all', { agreed: nextAgreed });
    onChange(next);
  };

  const toggleOpen = (key) => {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="consent-list">
      <label className="consent-list__all">
        <input
          type="checkbox"
          checked={allChecked}
          onChange={toggleAll}
        />
        <span className="consent-list__all-label">전체 동의</span>
      </label>

      <ul className="consent-list__items">
        {items.map((it) => {
          const opened = openKeys.has(it.key);
          return (
            <li key={it.key} className="consent-list__item">
              <div className="consent-list__row">
                <label className="consent-list__check">
                  <input
                    type="checkbox"
                    checked={!!values?.[it.key]}
                    onChange={(e) => setValue(it.key, e.target.checked)}
                  />
                  <span className="consent-list__label">{it.label}</span>
                </label>
                <button
                  type="button"
                  className="consent-list__view-btn"
                  onClick={() => toggleOpen(it.key)}
                >
                  {opened ? '접기' : '보기'}
                </button>
              </div>
              {opened && (
                <div className="consent-list__body">{it.body}</div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="consent-list__behavior-notice">{BEHAVIOR_NOTICE}</div>
    </div>
  );
}
