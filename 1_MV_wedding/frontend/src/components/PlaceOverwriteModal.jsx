import { useEffect } from 'react';
import { ZoomableImage } from './ImageLightbox';
import './PlaceOverwriteModal.css';

/**
 * v34 — 장소 자산 덮어쓰기 확정 모달.
 *
 * Props:
 *   open: boolean
 *   displayName: string
 *   oldPreviewUrl: string  (기존)
 *   newPreviewUrl: string  (후보)
 *   busy: boolean          (확정/취소 진행 중 — 버튼 잠금)
 *   onConfirm: () => Promise<void>  (덮어쓰기 확정)
 *   onCancel: () => Promise<void>   (새 후보 폐기, 기존 유지)
 *
 * 동작:
 *   - 좌(기존) ↔ 우(후보) 큰 미리보기 비교
 *   - 이미지는 <ZoomableImage> — 클릭 시 v32 lightbox 풀스크린
 *   - ESC = onCancel (취소). dim 클릭은 동작 안 함 (실수 방지)
 */
const PREFIX = '[PlaceOverwriteModal]';

export default function PlaceOverwriteModal({
  open,
  displayName,
  oldPreviewUrl,
  newPreviewUrl,
  busy,
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) {
        if (import.meta.env.DEV) console.info(`${PREFIX} ESC → cancel`);
        onCancel?.();
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div className="place-overwrite-modal" role="dialog" aria-modal="true">
      <div className="place-overwrite-modal__card" onClick={(e) => e.stopPropagation()}>
        <div className="place-overwrite-modal__head">
          <h3>
            <span className="place-overwrite-modal__title-prefix">덮어쓸까요?</span>
            <span className="place-overwrite-modal__name">{displayName || '(이름 없음)'}</span>
          </h3>
          <p className="place-overwrite-modal__desc">
            새로 생성된 이미지가 마음에 들면 [덮어쓰기] — 기존 이미지는 사라져요.
            그렇지 않으면 [취소] — 새 이미지가 폐기되고 기존 이미지가 유지돼요.
            이미지를 클릭하면 더 크게 볼 수 있어요.
          </p>
        </div>

        <div className="place-overwrite-modal__grid">
          <div className="place-overwrite-modal__col">
            <div className="place-overwrite-modal__col-label">현재 (기존)</div>
            {oldPreviewUrl ? (
              <ZoomableImage
                src={oldPreviewUrl}
                alt={`현재 ${displayName} 이미지`}
                className="place-overwrite-modal__img"
              />
            ) : (
              <div className="place-overwrite-modal__img-placeholder">
                (이미지 없음)
              </div>
            )}
          </div>

          <div className="place-overwrite-modal__col">
            <div className="place-overwrite-modal__col-label">새 후보</div>
            {newPreviewUrl ? (
              <ZoomableImage
                src={newPreviewUrl}
                alt={`새 후보 ${displayName} 이미지`}
                className="place-overwrite-modal__img"
              />
            ) : (
              <div className="place-overwrite-modal__img-placeholder">
                (이미지 없음)
              </div>
            )}
          </div>
        </div>

        <div className="place-overwrite-modal__actions">
          <button
            type="button"
            className="btn-ghost"
            onClick={onCancel}
            disabled={busy}
          >
            취소 (새 후보 폐기)
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? '적용 중...' : '덮어쓰기 확정'}
          </button>
        </div>
      </div>
    </div>
  );
}
