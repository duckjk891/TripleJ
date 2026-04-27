import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';

interface PlayerState {
  sound: Audio.Sound | null;
  track: any | null;
  isPlaying: boolean;
  position: number;
  duration: number;
  queue: any[];
  currentIndex: number;
  isPlayerScreenOpen: boolean;
  setSound: (sound: Audio.Sound | null) => void;
  setTrack: (track: any | null) => void;
  setIsPlaying: (v: boolean) => void;
  setPosition: (v: number) => void;
  setDuration: (v: number) => void;
  setQueue: (tracks: any[]) => void;
  setCurrentIndex: (i: number) => void;
  setPlayerScreenOpen: (v: boolean) => void;
  playTrackAtIndex: (index: number) => void;
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
      setSound: (sound) => set({ sound }),
      setTrack: (track) => set({ track }),
      setIsPlaying: (isPlaying) => set({ isPlaying }),
      setPosition: (position) => set({ position }),
      setDuration: (duration) => set({ duration }),
      setQueue: (queue) => set({ queue }),
      setCurrentIndex: (currentIndex) => set({ currentIndex }),
      setPlayerScreenOpen: (isPlayerScreenOpen) => set({ isPlayerScreenOpen }),
      playTrackAtIndex: (index: number) => {
        const { queue } = get();
        if (index >= 0 && index < queue.length) {
          set({ currentIndex: index, track: queue[index] });
        }
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
      }),
    }
  )
);
