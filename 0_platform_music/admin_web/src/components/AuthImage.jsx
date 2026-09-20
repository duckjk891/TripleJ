import { useState, useEffect } from 'react';
import { fetchMediaBlob } from '../api';

// MinIO 이미지를 어드민 인증 프록시(/api/admin/media/*)로 받아 blob URL 로 표시.
// <img src> 는 Authorization 헤더를 못 붙이므로 axios blob fetch 가 필요하다.
export default function AuthImage({ objectName, alt = '', className = 'thumb' }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let revoked = null;
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    if (!objectName) { setFailed(true); return undefined; }
    fetchMediaBlob(objectName)
      .then((res) => {
        if (cancelled) return;
        revoked = URL.createObjectURL(res.data);
        setUrl(revoked);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [objectName]);

  if (failed) return <div className={`${className} thumb--placeholder`}>no img</div>;
  if (!url) return <div className={`${className} thumb--placeholder`}>…</div>;
  return <img src={url} alt={alt} className={className} />;
}
