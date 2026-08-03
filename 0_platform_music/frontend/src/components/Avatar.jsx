import { useState } from 'react';
import * as api from '../api';
import './Avatar.css';

// 이니셜 폴백 배경 팔레트 — name 해시로 고정 선택 (8색)
const PALETTE = [
  '#6c5ce7', '#0984e3', '#00b894', '#e17055',
  '#d63031', '#e84393', '#f39c12', '#00cec9',
];

function nameHash(name) {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * 공용 원형 프로필 아바타.
 * - src 가 http(s) 외부 URL(OAuth 프로필) → 그대로 사용
 * - src 가 `profiles/...` MinIO object name → api.profileImageUrl 프록시 경유
 * - src 없음 / 이미지 로드 실패 → name 이니셜 원형 폴백
 * size 미지정 시 CSS 변수(--avatar-size) 기본 40px — 클래스로 반응형 크기 제어 가능.
 */
export default function Avatar({ src, name, size = 40, className = '' }) {
  // 로드 실패한 src 를 기억 — src 가 바뀌면 자동으로 다시 시도 (effect 불필요)
  const [failedSrc, setFailedSrc] = useState(null);
  const failed = !!src && failedSrc === src;

  let url = '';
  if (src && !failed) {
    url = /^https?:\/\//i.test(src) ? src : api.profileImageUrl(src);
  }

  const style = size ? { '--avatar-size': `${size}px` } : undefined;

  if (url) {
    return (
      <img
        className={`avatar ${className}`.trim()}
        style={style}
        src={url}
        alt={name || '프로필'}
        onError={() => {
          console.warn('[Avatar] image load failed, falling back to initial');
          setFailedSrc(src);
        }}
      />
    );
  }

  const initial = name ? name.charAt(0).toUpperCase() : '?';
  const bg = PALETTE[nameHash(name || '?') % PALETTE.length];
  return (
    <span
      className={`avatar avatar--fallback ${className}`.trim()}
      style={{ ...style, background: bg }}
      role="img"
      aria-label={name || '프로필'}
    >
      {initial}
    </span>
  );
}
