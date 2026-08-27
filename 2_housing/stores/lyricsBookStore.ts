import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// [lyricsBookStore] 가사 보관함 — 작사 결과를 로컬에 영속 저장(persist).
// lyricsStore 는 메모리 단일 슬롯(곡 저장 시 reset)이라, 마음에 든 가사를
// 잃지 않도록 별도 보관함에 담아두고 나중에 "이 가사로 작곡하기"로 재사용한다.

export interface LyricsBookEntry {
  id: string;
  title: string;
  lyrics: string;
  genre?: string;
  mood?: string;
  createdAt: number;
}

const MAX_ENTRIES = 50;

interface LyricsBookState {
  entries: LyricsBookEntry[];
  add: (entry: LyricsBookEntry) => void;
  remove: (id: string) => void;
}

export const makeLyricsBookId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const useLyricsBookStore = create<LyricsBookState>()(
  persist(
    (set) => ({
      entries: [],
      // 최신이 앞으로, cap 50 — 초과 시 가장 오래된 항목부터 제거
      add: (entry) =>
        set((state) => ({
          entries: [entry, ...state.entries].slice(0, MAX_ENTRIES),
        })),
      remove: (id) =>
        set((state) => ({
          entries: state.entries.filter((e) => e.id !== id),
        })),
    }),
    {
      name: 'aidol-lyrics-book',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
