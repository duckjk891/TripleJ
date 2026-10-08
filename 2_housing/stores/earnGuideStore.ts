// v3.304 [EarnNews] ⭐ 얻는 방법·미션 업데이트 알림 — "새로 바뀐 게 있다"를 일반 사용자도 알 수 있게(대표 10-08).
// EARN_GUIDE_VERSION 을 올리면(미션·적립 규칙 변경 시) 상단 ⭐ 배지에 NEW 점이 뜨고, 로그인 사용자에게
// 1회 안내 팝업을 띄운다. ⭐ 안내 팝업을 열면 '봤음'으로 기록(기기 저장 — 다른 기기는 각자 1회).
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const EARN_GUIDE_VERSION = '2026-10-08-club-album';
export const EARN_GUIDE_NEWS_TITLE = '새로운 ⭐ 얻는 방법';
export const EARN_GUIDE_NEWS =
  '새 미션이 생겼어요!\n• 주간 미션: 내 아티스트로 곡 3곡 발매 → ⭐15, 커버 이미지 3개 넣기 → ⭐5 (매주 월요일 0시 새로 시작)\n• 크루 앨범 참여: 크루장이 만든 테마 앨범에 새 곡을 내서 수록되면 → ⭐5 (앨범당 1회)';

const SEEN_KEY = 'maidol-earn-guide-seen';
const PROMPTED_KEY = 'maidol-earn-guide-prompted';

interface EarnGuideState {
  loaded: boolean;
  seenVersion: string | null;
  promptedVersion: string | null;
  load: () => Promise<void>;
  markSeen: () => void;
  markPrompted: () => void;
}

export const useEarnGuideStore = create<EarnGuideState>((set, get) => ({
  loaded: false,
  seenVersion: null,
  promptedVersion: null,
  load: async () => {
    if (get().loaded) return;
    try {
      const [seen, prompted] = await Promise.all([AsyncStorage.getItem(SEEN_KEY), AsyncStorage.getItem(PROMPTED_KEY)]);
      set({ loaded: true, seenVersion: seen, promptedVersion: prompted });
    } catch (err: any) {
      console.warn('[EarnNews] 저장값 로드 실패(새 소식 표시로 진행)', err?.message);
      set({ loaded: true });
    }
  },
  markSeen: () => {
    if (get().seenVersion === EARN_GUIDE_VERSION) return;
    set({ seenVersion: EARN_GUIDE_VERSION, promptedVersion: EARN_GUIDE_VERSION });
    AsyncStorage.setItem(SEEN_KEY, EARN_GUIDE_VERSION).catch(() => {});
    AsyncStorage.setItem(PROMPTED_KEY, EARN_GUIDE_VERSION).catch(() => {});
    if (__DEV__) console.info('[EarnNews] 확인함', { v: EARN_GUIDE_VERSION });
  },
  markPrompted: () => {
    set({ promptedVersion: EARN_GUIDE_VERSION });
    AsyncStorage.setItem(PROMPTED_KEY, EARN_GUIDE_VERSION).catch(() => {});
  },
}));

/** 아직 확인하지 않은 새 소식이 있는지 */
export const selectEarnGuideIsNew = (s: EarnGuideState) => s.loaded && s.seenVersion !== EARN_GUIDE_VERSION;
