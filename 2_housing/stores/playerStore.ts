import { create } from 'zustand';
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

export const usePlayerStore = create<PlayerState>((set, get) => ({
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
}));
