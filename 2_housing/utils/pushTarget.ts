// v3.436 [PushTarget] 푸시를 눌렀을 때 갈 화면 — 서버 푸시의 tag 로 정한다(순수 함수).
//  maidol-song-<곡id> · maidol-diary-<글id> · maidol-notice-<글id> · maidol-social · maidol-station · maidol-done-<종류>-<작업id>
//  maidol-carol-<신청id>
//  maidol-dm-<대화id> (v3.448) → 메시지함
//  그 밖(팔로우·댓글·좋아요 등)과 옛 서버 푸시는 예전처럼 알림함.
export interface PushTarget { name: string; params?: object }

const ID = '([0-9a-f]{24})';

/** 크리스마스 이벤트 화면 — spin = 바로 열 룰렛(신청 id, 'any' = 돌릴 수 있는 첫 곡) */
export function carolTarget(spin?: string): PushTarget & { params: object } {
  return { name: 'MainTabs', params: { screen: 'CarolEvent', params: { spin: spin || undefined } } };
}

/** null = 이동하지 않음(앱을 열면 완성 도착·제작소 팝업이 스스로 뜬다) */
export function pushTargetFor(tag: string | null | undefined): PushTarget | null {
  const t = String(tag || '');
  if (t === 'maidol-station' || t.startsWith('maidol-done-')) return null;
  if (t.startsWith('maidol-dm-')) return { name: 'DmInbox' };
  if (t === 'maidol-social') return { name: 'MainTabs', params: { screen: 'Feed' } };
  // v3.444 승인 푸시를 누르면 그 곡의 스타룰렛까지 바로(돌릴 수 없는 곡이면 이벤트 화면만)
  if (t.startsWith('maidol-carol-')) return carolTarget(t.slice('maidol-carol-'.length));
  let m = t.match(new RegExp(`^maidol-song-${ID}$`));
  if (m) return { name: 'Player', params: { track: { id: m[1] } } };
  m = t.match(new RegExp(`^maidol-(?:diary|notice)-${ID}$`));
  if (m) return { name: 'FeedDetail', params: { feedId: m[1] } };
  return { name: 'Notifications' };
}

/** 앱을 보고 있을 때는 배너를 띄우지 않을 푸시 — 앱 안에서 이미 알려 준다 */
export function hideInForeground(tag: string | null | undefined): boolean {
  const t = String(tag || '');
  return t === 'maidol-station' || t.startsWith('maidol-done-');
}

// 알림 켜기 안내(들어올 때) — 처음 쓴 날은 묻지 않고, '나중에' 뒤 3일마다, 최대 5번
export const NUDGE_FIRST_DELAY_MS = 24 * 3600 * 1000;
export const NUDGE_GAP_MS = 3 * 24 * 3600 * 1000;
export const NUDGE_MAX = 5;

export interface NudgeRecord { first: number; last: number; count: number }

export function nudgeDue(r: NudgeRecord, now: number): boolean {
  if (!r.first || now - r.first < NUDGE_FIRST_DELAY_MS) return false;
  if (r.count >= NUDGE_MAX) return false;
  return !r.last || now - r.last >= NUDGE_GAP_MS;
}
