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
  setSound: (sound: Audio.Sound | null) => void;
  setTrack: (track: any | null) => void;
  setIsPlaying: (v: boolean) => void;
  setPosition: (v: number) => void;
  setDuration: (v: number) => void;
  setQueue: (tracks: any[]) => void;
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
      shuffle: false,
      repeat: 'off' as RepeatMode,
      setSound: (sound) => set({ sound }),
      setTrack: (track) => set({ track }),
      setIsPlaying: (isPlaying) => set({ isPlaying }),
      setPosition: (position) => set({ position }),
      setDuration: (duration) => set({ duration }),
      setQueue: (queue) => set({ queue }),
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
      }),
    }
  )
);
