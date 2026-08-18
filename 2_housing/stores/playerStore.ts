import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';

export type RepeatMode = 'off' | 'all' | 'one';

interface PlayerState {
  sound: Audio.Sound | null;
  track: any | null;
  isPlaying: boolean;
  position: number;
  duration: number;
  queue: any[];
  currentIndex: number;
  isPlayerScreenOpen: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  /** 현재 재생목록의 소유자 user.id. 비회원이 담은 큐는 null → 다음 접속(재시작) 시 폐기된다. */
  queueOwnerId: string | null;
  /** 비회원 담기 안내 팝업을 이미 확인했는지(세션 한정, 영속화 X) — 매번 뜨지 않게 함 */
  guestNoticeAck: boolean;
  setSound: (sound: Audio.Sound | null) => void;
  setTrack: (track: any | null) => void;
  setIsPlaying: (v: boolean) => void;
  setPosition: (v: number) => void;
  setDuration: (v: number) => void;
  setQueue: (tracks: any[]) => void;
  addToQueue: (track: any) => boolean;   // 재생목록(큐) 맨 뒤 추가. 이미 있으면 false
  removeFromQueue: (index: number) => void;
  reorderQueue: (from: number, to: number) => void; // 드래그 편집: from→to 이동(현재재생 인덱스 보정)
  /** 로그아웃 시 재생목록(큐)·재생상태를 초기화 */
  resetOnLogout: () => void;
  /** 로그인/가입 성공 시 호출 — 비회원으로 담아둔 재생목록을 그대로 그 계정의 것으로 승계(보존)한다. */
  claimQueue: (userId: string) => void;
  setGuestNoticeAck: (v: boolean) => void;
  setCurrentIndex: (i: number) => void;
  setPlayerScreenOpen: (v: boolean) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  playTrackAtIndex: (index: number) => void;
  /** 셔플/반복 고려해서 다음 인덱스 반환. 없으면 -1. */
  getNextIndex: () => number;
  /** 셔플 고려해서 이전 인덱스. 없으면 -1. */
  getPrevIndex: () => number;
  cleanup: () => void;
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      sound: null,
      track: null,
      isPlaying: false,
      position: 0,
      duration: 0,
      queue: [],
      currentIndex: -1,
      isPlayerScreenOpen: false,
      queueOwnerId: null,
      guestNoticeAck: false,
      shuffle: false,
      repeat: 'off' as RepeatMode,
      setSound: (sound) => set({ sound }),
      setTrack: (track) => set({ track }),
      setIsPlaying: (isPlaying) => set({ isPlaying }),
      setPosition: (position) => set({ position }),
      setDuration: (duration) => set({ duration }),
      setQueue: (queue) => set({ queue }),
      addToQueue: (track) => {
        if (!track?.id) return false;
        const { queue } = get();
        if (queue.some((t) => t?.id === track.id)) return false; // 중복 방지
        set({ queue: [...queue, track] });
        return true;
      },
      removeFromQueue: (index) => {
        const { queue, currentIndex } = get();
        if (index < 0 || index >= queue.length) return;
        const next = queue.filter((_, i) => i !== index);
        // 현재 재생 인덱스 보정
        let nextIndex = currentIndex;
        if (index < currentIndex) nextIndex = currentIndex - 1;
        else if (index === currentIndex) nextIndex = Math.min(currentIndex, next.length - 1);
        set({ queue: next, currentIndex: nextIndex });
      },
      reorderQueue: (from, to) => {
        const { queue, currentIndex } = get();
        if (from === to || from < 0 || to < 0 || from >= queue.length || to >= queue.length) return;
        const next = queue.slice();
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        // 현재 재생 인덱스가 이동에 따라 어디로 갔는지 추적
        let nextIndex = currentIndex;
        if (currentIndex === from) nextIndex = to;
        else if (from < currentIndex && to >= currentIndex) nextIndex = currentIndex - 1;
        else if (from > currentIndex && to <= currentIndex) nextIndex = currentIndex + 1;
        set({ queue: next, currentIndex: nextIndex });
      },
      resetOnLogout: async () => {
        const { sound } = get();
        if (sound) { try { await sound.unloadAsync(); } catch {} }
        if (__DEV__) console.info('[playerStore] resetOnLogout — 큐/재생상태 초기화');
        set({
          sound: null, track: null, isPlaying: false, position: 0, duration: 0,
          queue: [], currentIndex: -1, queueOwnerId: null, guestNoticeAck: false,
        });
      },
      claimQueue: (userId) => {
        // 비회원으로 담아둔 곡을 그대로 두고 소유자만 부여 → 로그인 후에도 재생목록 유지
        const { queue, queueOwnerId } = get();
        if (queueOwnerId === userId) return;
        if (__DEV__) console.info('[playerStore] claimQueue — 로그인 후 재생목록 승계', { kept: queue.length });
        set({ queueOwnerId: userId });
      },
      setGuestNoticeAck: (guestNoticeAck) => set({ guestNoticeAck }),
      setCurrentIndex: (currentIndex) => set({ currentIndex }),
      setPlayerScreenOpen: (isPlayerScreenOpen) => set({ isPlayerScreenOpen }),
      toggleShuffle: () => set((s) => ({ shuffle: !s.shuffle })),
      cycleRepeat: () => set((s) => ({
        repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off',
      })),
      playTrackAtIndex: (index: number) => {
        const { queue } = get();
        if (index >= 0 && index < queue.length) {
          set({ currentIndex: index, track: queue[index] });
        }
      },
      getNextIndex: () => {
        const { queue, currentIndex, shuffle, repeat } = get();
        if (queue.length === 0) return -1;
        if (repeat === 'one') return currentIndex; // 같은 곡 반복
        if (shuffle) {
          if (queue.length === 1) return repeat === 'all' ? 0 : -1;
          let next = Math.floor(Math.random() * queue.length);
          if (next === currentIndex) next = (next + 1) % queue.length;
          return next;
        }
        if (currentIndex < queue.length - 1) return currentIndex + 1;
        return repeat === 'all' ? 0 : -1; // 큐 끝 → all이면 처음으로
      },
      getPrevIndex: () => {
        const { queue, currentIndex, shuffle, repeat } = get();
        if (queue.length === 0) return -1;
        if (repeat === 'one') return currentIndex;
        if (shuffle) {
          if (queue.length === 1) return 0;
          let prev = Math.floor(Math.random() * queue.length);
          if (prev === currentIndex) prev = (prev + 1) % queue.length;
          return prev;
        }
        if (currentIndex > 0) return currentIndex - 1;
        return repeat === 'all' ? queue.length - 1 : -1;
      },
      cleanup: async () => {
        const { sound } = get();
        if (sound) {
          try { await sound.unloadAsync(); } catch {}
        }
        set({ sound: null, track: null, isPlaying: false, position: 0, duration: 0 });
      },
    }),
    {
      name: 'player-storage-v1',
      storage: createJSONStorage(() => AsyncStorage),
      // sound 객체(native module)와 휘발성 상태(isPlaying/position/duration/isPlayerScreenOpen)는 영속화 제외
      // 마지막 트랙 정보, 큐, 현재 인덱스만 영속화 → 재시작 시 마지막 들었던 곡으로 복귀 가능
      partialize: (state) => ({
        track: state.track,
        queue: state.queue,
        currentIndex: state.currentIndex,
        shuffle: state.shuffle,
        repeat: state.repeat,
        queueOwnerId: state.queueOwnerId,
      }),
      // 비회원(queueOwnerId=null)이 담은 재생목록은 다음 접속 시 폐기 — "로그인 안 하면 재생목록이 사라진다" 안내와 일치.
      // 로그인 상태에서 담은 재생목록(소유자 있음)은 그대로 복원.
      onRehydrateStorage: () => (state) => {
        if (state && !state.queueOwnerId && state.queue?.length) {
          if (__DEV__) console.info('[playerStore] 비회원 재생목록 폐기(재시작)', { discarded: state.queue.length });
          state.queue = [];
          state.currentIndex = -1;
          state.track = null;
        }
      },
    }
  )
);
