import { useEffect, useState } from 'react';
import { thumbUrl, imageUrl } from '../api';

// 상품 이미지 — 목록용은 320px 썸네일 먼저, 없거나 실패하면 원본으로 한 번 바꾼다.
export default function ItemImage({ obj, thumb = true, className = '', alt = '' }) {
  const first = thumb ? thumbUrl(obj) : imageUrl(obj);
  const [src, setSrc] = useState(first);
  const [failed, setFailed] = useState(!first);
  useEffect(() => { setSrc(first); setFailed(!first); }, [first]);
  if (failed) return <div className={`img-ph ${className}`} aria-label="이미지 없음">사진 없음</div>;
  return (
    <img
      className={className}
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => {
        const orig = imageUrl(obj);
        if (src !== orig && orig) setSrc(orig);
        else setFailed(true);
      }}
    />
  );
}
