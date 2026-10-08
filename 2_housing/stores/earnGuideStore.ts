// v3.304 [EarnNews] ⭐ 얻는 방법·미션 업데이트 알림 — "새로 바뀐 게 있다"를 일반 사용자도 알 수 있게(대표 10-08).
// v3.306: 항목 단위로 전환 — 새 미션·적립 방법을 EARN_NEWS_ITEMS 에 추가하면
//   ① 상단 ⭐ 배지에 '안 본 개수' 숫자 배지(메시지 배지처럼), ② 로그인 사용자에게 항목당 1회 안내 팝업,
//   ③ ⭐ 안내 팝업에서 해당 줄 옆 NEW 표시. ⭐ 안내 팝업을 열면 전부 '봤음'(기기 저장 — 다른 기기는 각자).
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface EarnNewsItem {
  /** 고정 id — 한 번 정하면 바꾸지 않는다(바꾸면 다시 '새 소식'이 됨) */
  id: string;
  title: string;
  short: string;
}

/** 새 미션·적립 방법이 생기면 맨 아래에 추가 */
export const EARN_NEWS_ITEMS: EarnNewsItem[] = [
  { id: 'weekly_mission', title: '주간 미션', short: '내 아티스트로 곡 3곡 발매 ⭐15 · 커버 이미지 3개 ⭐5' },
  { id: 'club_album', title: '크루 앨범 참여', short: '크루 테마 앨범에 새 곡을 내서 수록되면 ⭐5' },
];

const SEEN_KEY = 'maidol-earn-news-seen-v2';
const PROMPTED_KEY = 'maidol-earn-news-prompted-v2';
// v3.304 구버전 키(버전 문자열) — 1회 이전
const LEGACY_SEEN_KEY = 'maidol-earn-guide-seen';
const LEGACY_PROMPTED_KEY = 'maidol-earn-guide-prompted';
const LEGACY_MAP: Record<string, string[]> = {
  '2026-10-08-weekly-mission': ['weekly_mission'],
  '2026-10-08-club-album': ['weekly_mission', 'club_album'],
};

const ALL_IDS = () => EARN_NEWS_ITEMS.map((i) => i.id);

function parseIds(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

interface EarnGuideState {
  loaded: boolean;
  seenIds: string[];
  promptedIds: string[];
  load: () => Promise<void>;
  markSeen: () => void;
  markPrompted: () => void;
}

export const useEarnGuideStore = create<EarnGuideState>((set, get) => ({
  loaded: false,
  seenIds: [],
  promptedIds: [],
  load: async () => {
    if (get().loaded) return;
    try {
      const [seenRaw, promptedRaw, legacySeen, legacyPrompted] = await Promise.all([
        AsyncStorage.getItem(SEEN_KEY), AsyncStorage.getItem(PROMPTED_KEY),
        AsyncStorage.getItem(LEGACY_SEEN_KEY), AsyncStorage.getItem(LEGACY_PROMPTED_KEY),
      ]);
      const seenIds = parseIds(seenRaw) ?? LEGACY_MAP[legacySeen || ''] ?? [];
      const promptedIds = parseIds(promptedRaw) ?? LEGACY_MAP[legacyPrompted || ''] ?? [];
      set({ loaded: true, seenIds, promptedIds: Array.from(new Set([...promptedIds, ...seenIds])) });
      if (__DEV__) console.info('[EarnNews] 로드', { seen: seenIds, prompted: promptedIds });
    } catch (err: any) {
      console.warn('[EarnNews] 저장값 로드 실패(새 소식 표시로 진행)', err?.message);
      set({ loaded: true });
    }
  },
  markSeen: () => {
    const ids = ALL_IDS();
    if (ids.every((id) => get().seenIds.includes(id))) return;
    set({ seenIds: ids, promptedIds: ids });
    AsyncStorage.setItem(SEEN_KEY, JSON.stringify(ids)).catch(() => {});
    AsyncStorage.setItem(PROMPTED_KEY, JSON.stringify(ids)).catch(() => {});
    console.info('[EarnNews] 확인함', { ids });
  },
  markPrompted: () => {
    const ids = ALL_IDS();
    set({ promptedIds: ids });
    AsyncStorage.setItem(PROMPTED_KEY, JSON.stringify(ids)).catch(() => {});
  },
}));

/** 아직 확인하지 않은 새 소식 id 목록(로드 전엔 빈 목록 — 배지 깜빡임 방지) */
export function unseenEarnNewsIds(s: Pick<EarnGuideState, 'loaded' | 'seenIds'>): string[] {
  if (!s.loaded) return [];
  return ALL_IDS().filter((id) => !s.seenIds.includes(id));
}

/** 안 본 개수 — 상단 ⭐ 숫자 배지 */
export const selectEarnNewsCount = (s: EarnGuideState) => unseenEarnNewsIds(s).length;

/** 로그인 1회 안내 대상(안 봤고 아직 안내도 안 한 항목) */
export function unpromptedEarnNews(s: Pick<EarnGuideState, 'loaded' | 'seenIds' | 'promptedIds'>): EarnNewsItem[] {
  if (!s.loaded) return [];
  return EARN_NEWS_ITEMS.filter((i) => !s.seenIds.includes(i.id) && !s.promptedIds.includes(i.id));
}
