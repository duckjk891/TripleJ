// 접속 기기 표시 — 서버 dm.py client_info 와 같은 규칙.
// DM 은 서버가 저장한 client({platform, device, app_build, app_version}) 를,
// 오류 신고는 저장된 User-Agent 를 이 규칙으로 해석한다(과거 신고도 표시됨).

export function clientFromUA(ua) {
  const s = (ua || '').trim();
  let platform = 'other';
  let appBuild = null;
  if (s.startsWith('MAIDOL/') && s.includes('CFNetwork')) {
    platform = 'ios';
    appBuild = s.split('/')[1]?.split(' ')[0] || null;
  } else if (s.toLowerCase().startsWith('okhttp')) {
    platform = 'android';
  } else if (s.startsWith('Mozilla/')) {
    platform = 'web';
  }
  let device = null;
  if (platform === 'web') {
    if (s.includes('iPhone')) device = 'iphone';
    else if (s.includes('iPad')) device = 'ipad';
    else if (s.includes('Android')) device = 'android';
    else device = 'pc';
  }
  return { platform, device, app_build: appBuild, app_version: null, ua: s || null };
}

const WEB_DEVICE = { iphone: '아이폰', ipad: '아이패드', android: '안드로이드 폰', pc: 'PC' };

export function clientLabel(c) {
  if (!c) return null;
  if (c.platform === 'ios') return '아이폰 앱';
  if (c.platform === 'android') return '안드로이드 앱';
  if (c.platform === 'web') return c.device ? `웹 · ${WEB_DEVICE[c.device] || c.device}` : '웹';
  return '기타';
}

const BADGE_CLASS = { ios: 'badge--purple', android: 'badge--green', web: 'badge--amber', other: 'badge--gray' };

export default function ClientBadge({ client, ua, appVersion }) {
  const c = client || (ua ? clientFromUA(ua) : null);
  if (!c) return <span className="cell-sub">-</span>;
  const version = appVersion || c.app_version;
  const extra = version ? ` ${version}` : c.app_build ? ` (빌드 ${c.app_build})` : '';
  return (
    <span className={`badge ${BADGE_CLASS[c.platform] || 'badge--gray'}`} title={c.ua || ''}>
      {clientLabel(c)}{extra}
    </span>
  );
}
