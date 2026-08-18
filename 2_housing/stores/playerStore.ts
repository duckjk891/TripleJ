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
  /** 현재 재생목록의 소유자 user.id. 비회원이 담은 큐는 null → 앱을 새로 켜면 사라진다. */
  queueOwnerId: string | null;
  /** 계정별 재생목록 보관함(영속) — 로그인하면 그 계정이 쓰던 재생목록을 여기서 복원한다. */
  savedQueues: Record<string, { queue: any[]; currentIndex: number; track: any | null }>;
  /** 비회원 담기 안내 팝업을 이미 확인했는지(영속) — 한 번 '계속 담기'를 고르면 다시 뜨지 않는다 */
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
  /** 로그아웃 시 현재 재생목록을 그 계정 보관함에 저장한 뒤 큐·재생상태를 초기화 */
  resetOnLogout: () => void;
  /** 회원가입 성공 시 — 가입 직전까지 비회원으로 담아둔 재생목록을 그대로 새 계정의 것으로 승계한다. */
  claimQueue: (userId: string) => void;
  /** 로그인 성공 시 — 그 계정이 쓰던 재생목록을 보관함에서 복원한다.
   *  보관된 목록이 없으면(첫 로그인 등) 비회원으로 담아둔 목록을 그대로 승계한다. 반환: 복원했으면 true */
  restoreQueueFor: (userId: string) => boolean;
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
    (set, get) => {
    // 로그인 상태(소유자 있음)에서 재생목록이 바뀔 때마다 그 계정 보관함에 저장.
    // 비회원(소유자 null)은 저장하지 않음 → 앱을 새로 켜면 사라진다(안내 문구와 일치).
    const saveOwnerQueue = () => {
      const { queueOwnerId, queue, currentIndex, track, savedQueues } = get();
      if (!queueOwnerId) return;
      set({ savedQueues: { ...savedQueues, [queueOwnerId]: { queue, currentIndex, track } } });
    };
    return ({
      sound: null,
      track: null,
      isPlaying: false,
      position: 0,
      duration: 0,
      queue: [],
      currentIndex: -1,
      isPlayerScreenOpen: false,
      queueOwnerId: null,
      savedQueues: {},
      guestNoticeAck: false,
      shuffle: false,
      repeat: 'off' as RepeatMode,
      setSound: (sound) => set({ sound }),
      setTrack: (track) => set({ track }),
      setIsPlaying: (isPlaying) => set({ isPlaying }),
      setPosition: (position) => set({ position }),
      setDuration: (duration) => set({ duration }),
      setQueue: (queue) => { set({ queue }); saveOwnerQueue(); },
      addToQueue: (track) => {
        if (!track?.id) return false;
        const { queue } = get();
        if (queue.some((t) => t?.id === track.id)) return false; // 중복 방지
        set({ queue: [...queue, track] });
        saveOwnerQueue();
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
        saveOwnerQueue();
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
        saveOwnerQueue();
      },
      resetOnLogout: async () => {
        const { sound } = get();
        if (sound) { try { await sound.unloadAsync(); } catch {} }
        saveOwnerQueue(); // 로그아웃 전 현재 목록을 그 계정 보관함에 저장 → 다음 로그인 때 복원
        if (__DEV__) console.info('[playerStore] resetOnLogout — 큐/재생상태 초기화');
        set({
          sound: null, track: null, isPlaying: false, position: 0, duration: 0,
          // guestNoticeAck은 유지 — 한 번 확인한 안내를 로그아웃했다고 다시 띄우지 않는다
          queue: [], currentIndex: -1, queueOwnerId: null,
        });
      },
      claimQueue: (userId) => {
        // 회원가입: 가입 직전까지 비회원으로 담은 목록을 그대로 새 계정의 것으로 승계
        const { queue, queueOwnerId } = get();
        if (queueOwnerId === userId) return;
        if (__DEV__) console.info('[playerStore] claimQueue — 가입 후 재생목록 승계', { kept: queue.length });
        set({ queueOwnerId: userId });
        saveOwnerQueue();
      },
      restoreQueueFor: (userId) => {
        // 로그인: 그 계정이 쓰던 재생목록이 있으면 그것을 보여준다(비회원 목록은 대체됨).
        const saved = get().savedQueues?.[userId];
        if (saved && saved.queue?.length) {
          if (__DEV__) console.info('[playerStore] restoreQueueFor — 계정 재생목록 복원', { restored: saved.queue.length });
          set({
            queue: saved.queue,
            currentIndex: saved.currentIndex ?? -1,
            track: saved.track ?? null,
            queueOwnerId: userId,
            isPlaying: false, position: 0, duration: 0,
          });
          return true;
        }
        // 보관된 목록이 없으면 비회원으로 담아둔 목록을 승계(버릴 이유가 없음)
        if (__DEV__) console.info('[playerStore] restoreQueueFor — 보관 목록 없음 → 현재 목록 승계', { kept: get().queue.length });
        set({ queueOwnerId: userId });
        saveOwnerQueue();
        return false;
      },
      setGuestNoticeAck: (guestNoticeAck) => set({ guestNoticeAck }),
      setCurrentIndex: (currentIndex) => { set({ currentIndex }); saveOwnerQueue(); },
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
    });
    },
    {
      name: 'player-storage-v1',
      storage: createJSONStorage(() => AsyncStorage),
      // 영속화 대상은 '계정별 보관함(savedQueues)'과 재생 옵션뿐.
      // 작업 중인 큐(queue/currentIndex/track)와 소유자는 영속화하지 않는다:
      //  · 비회원 목록은 앱을 새로 켜면 사라져야 하고(안내 문구와 일치),
      //  · 앱 재시작 시 로그인 세션도 초기화되므로, 이전 사용자의 목록이 다음 사람에게 보이면 안 된다.
      // 로그인하면 restoreQueueFor(userId)가 보관함에서 그 계정 목록을 복원한다.
      partialize: (state) => ({
        savedQueues: state.savedQueues,
        shuffle: state.shuffle,
        repeat: state.repeat,
        guestNoticeAck: state.guestNoticeAck, // 한 번 확인했으면 앱을 다시 켜도 팝업 재노출 X
      }),
    }
  )
);
