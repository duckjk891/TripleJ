import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import './ImageLightbox.css';

/**
 * v32 — 미리보기 이미지 클릭 확대.
 *
 * 사용법:
 *   1) App 루트 어딘가에 <ImageLightboxProvider> 로 감싼다.
 *   2) 미리보기 <img> 자리에 <ZoomableImage> drop-in 한다. props 동일.
 *   3) 또는 useImageLightbox().open(src, alt) 직접 호출도 가능.
 *
 * 동작:
 *   • dim 클릭 또는 ESC 키 누르면 닫힘.
 *   • 이미지 자체 클릭은 닫지 않음 (stopPropagation).
 *   • body scroll lock (열린 동안 페이지 스크롤 잠금).
 *   • src 빈 문자열이면 open 무시 (no-op).
 */

const PREFIX = '[ImageLightbox]';
const Ctx = createContext({ open: () => {}, close: () => {} });

export const useImageLightbox = () => useContext(Ctx);

export function ImageLightboxProvider({ children }) {
  const [state, setState] = useState({ open: false, src: '', alt: '' });

  const open = useCallback((src, alt = '') => {
    if (!src || typeof src !== 'string') {
      if (import.meta.env.DEV) {
        console.warn(`${PREFIX} open ignored — empty src`, { src });
      }
      return;
    }
    if (import.meta.env.DEV) {
      console.info(`${PREFIX} open`, { alt, src_len: src.length });
    }
    setState({ open: true, src, alt });
  }, []);

  const close = useCallback(() => {
    setState({ open: false, src: '', alt: '' });
  }, []);

  // ESC 키 닫기 + body scroll lock.
  useEffect(() => {
    if (!state.open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [state.open, close]);

  return (
    <Ctx.Provider value={{ open, close }}>
      {children}
      {state.open && (
        <div
          className="img-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="확대 이미지"
          onClick={close}
        >
          <button
            type="button"
            className="img-lightbox__close"
            onClick={close}
            aria-label="닫기"
          >
            ×
          </button>
          <img
            className="img-lightbox__img"
            src={state.src}
            alt={state.alt || ''}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </Ctx.Provider>
  );
}

/**
 * Drop-in replacement for <img>. 동일 props + 자동 onClick 으로 lightbox 열기.
 * 사용자가 onClick 을 직접 넘기면 그 핸들러를 먼저 실행하고, e.preventDefault()
 * 호출하지 않은 경우에만 lightbox 를 연다.
 */
export function ZoomableImage({
  src,
  alt = '',
  onClick,
  className = '',
  ...rest
}) {
  const { open } = useImageLightbox();
  const handleClick = (e) => {
    if (typeof onClick === 'function') {
      try {
        onClick(e);
      } catch (err) {
        console.error(`${PREFIX} user onClick threw`, { err });
      }
    }
    if (e.defaultPrevented) return;
    if (!src) return;
    open(src, alt);
  };
  const cls = `${className} img-zoomable`.trim();
  return (
    <img
      src={src}
      alt={alt}
      onClick={handleClick}
      className={cls}
      {...rest}
    />
  );
}
