// 메뉴 아이콘 — 글꼴에 없는 기호(⚿ 등)는 윈도우·안드로이드에서 네모(□)로 깨질 수 있어 SVG 로 그린다.
const P = {
  dashboard: 'M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z',
  items: 'M4 5h7v7H4V5Zm9 0h7v7h-7V5ZM4 14h7v6H4v-6Zm9 0h7v6h-7v-6Z',
  upload: 'M12 4 7 9h3.5v6h3V9H17l-5-5ZM5 17v3h14v-3h-2v1H7v-1H5Z',
  profile: 'M4 20V9l8-5 8 5v11h-6v-6h-4v6H4Z',
  key: 'M14.5 3a5.5 5.5 0 0 0-5.3 7L3 16.2V21h4.8v-2.2H10v-2.2h2.2l1.3-1.3A5.5 5.5 0 1 0 14.5 3Zm1.6 3.1a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4Z',
  menu: 'M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h16v2H4v-2Z',
  grid: 'M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z',
  list: 'M4 5h3v3H4V5Zm5 0h11v3H9V5ZM4 10.5h3v3H4v-3Zm5 0h11v3H9v-3ZM4 16h3v3H4v-3Zm5 0h11v3H9v-3Z',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-6h2v6Zm0-8h-2V7h2v2Z',
};

export default function Icon({ name, size = 18, className = '' }) {
  return (
    <svg className={`ico ${className}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={P[name]} fill="currentColor" />
    </svg>
  );
}
