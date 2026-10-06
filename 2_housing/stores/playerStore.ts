import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';

export type RepeatMode = 'off' | 'all' | 'one';

// ── v3.253 [CrewRecog] 큐 귀속 메타 — "이 큐는 어느 크루 플리에서 시작됐나" ──
// 수명: 크루 플리를 큐 교체(setQueue+source)로 재생 시작하면 그 큐 세션 동안 유지.
//  · 같은 플리 소속 곡으로 넘어가면(자동/수동) 유지 — track_ids 스냅샷이 소속 판정 기준.
//  · 소스 플리 밖 곡이 재생 세션을 시작하면 해제 — services/playRecord.ts 가 단일 지점에서 수행.
//  · 큐를 소스 없이 교체(개인 플리·앨범·playTrackNow replace)하면 즉시 해제(setQueue 기본값 null).
// 영속: 비영속(아래 partialize 화이트리스트라 자동 제외) — 작업 큐(queue/track) 자체가 비영속이라
//  앱 재시작·계정 보관함(savedQueues) 복원 큐에는 귀속이 없다(v3.36 큐 정책과 정합, 복원 재생=무귀속).
export interface QueueSource {
  type: 'club_playlist';
  playlist_id: string;
  club_id: string;
  /** 큐 교체 시점 플리 곡 id 스냅샷 — 이후 append(관련곡·직접 담기)된 곡은 소속 아님 */
  track_ids: string[];
}

/** setQueue 두 번째 인자 — track_ids 는 스토어가 tracks 에서 파생한다 */
export type QueueSourceInput = Omit<QueueSource, 'track_ids'>;

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
  /** v3.271 — 최근 재생 trackId(최신순, 40캡) — 추천 exclude 원천 */
  recentlyPlayedIds: string[];
  noteRecentlyPlayed: (trackId: string) => void;
  /** v3.271 — 자동 진행 전용: Inst 곡 스킵 */
  getNextAutoIndex: () => number;
  /** v3.275: 수동 '다음'(플레이어·미니플레이어·잠금화면) 전용 — Inst 건너뛰기 + 한 곡 반복이어도 다음 곡으로 전진 */
  getNextManualIndex: () => number;
  repeat: RepeatMode;
  /** 현재 재생목록의 소유자 user.id. 비회원이 담은 큐는 null → 앱을 새로 켜면 사라진다. */
  queueOwnerId: string | null;
  /** v3.253 [CrewRecog]: 현재 큐의 귀속 메타(크루 플리 큐 교체 시에만 non-null, 비영속) */
  queueSource: QueueSource | null;
  /** 계정별 재생목록 보관함(영속) — 로그인하면 그 계정이 쓰던 재생목록을 여기서 복원한다. */
  savedQueues: Record<string, { queue: any[]; currentIndex: number; track: any | null }>;
  /** 비회원 담기 안내 팝업을 이미 확인했는지(영속) — 한 번 '계속 담기'를 고르면 다시 뜨지 않는다 */
  guestNoticeAck: boolean;
  /** v3.82: 미니플레이어 UI 숨김(렌더만 제어 — 오디오 재생은 유지). ArtistResult 등 화면별 focus/blur로 토글. 비영속. */
  miniHidden: boolean;
  /** v3.198: 이번 앱 세션에서 실제 재생을 시작한 적이 있는지(비영속, partialize 화이트리스트라 자동 제외).
   *  setSound(truthy)에서 true — 재생 시작점이 여러 곳(playback.ts·PlayerScreen 등)에 분산돼 있어 setter 한 곳에서 건다.
   *  resetOnLogout·restoreQueueFor(복원)·cleanup에서 false. MiniPlayer가 "로그인 복원 큐(track만 있고 재생한 적 없음)"를
   *  숨기면서도, 세션 중 sound가 null이 된 경우(v3.197 BT 전환 실패 복구 경로)는 유지하기 위한 플래그. */
  sessionActive: boolean;
  setMiniHidden: (v: boolean) => void;
  setSound: (sound: Audio.Sound | null) => void;
  setTrack: (track: any | null) => void;
  setIsPlaying: (v: boolean) => void;
  setPosition: (v: number) => void;
  setDuration: (v: number) => void;
  /** v3.253: source 지정 = 크루 플리 큐 교체(귀속 시작). 미지정(기존 호출부 전부)은 귀속 해제. */
  setQueue: (tracks: any[], source?: QueueSourceInput | null) => void;
  /** v3.253 [CrewRecog]: 귀속 해제 전용 — playRecord 가 소스 밖 곡 재생 세션 시작 시 호출 */
  setQueueSource: (source: QueueSource | null) => void;
  addToQueue: (track: any) => boolean;   // 재생목록(큐) 맨 뒤 추가. 이미 있으면 false
  /** v3.267 [추천 이어듣기]: afterIndex 바로 뒤에 곡들 삽입(큐 내 중복 제거·현재 인덱스 불변).
   *  차트 곡 탭 시 관련곡 5곡을 선택곡 뒤에 심어 "다음 곡 = 추천"을 만든다. 반환: 실제 삽입 수 */
  insertIntoQueueAfter: (afterIndex: number, tracks: any[]) => number;
  /** v3.286 [RelatedVariety]: 곡을 현재 곡 바로 뒤로(이미 큐에 있으면 그 자리에서 옮김). 반환: 새 인덱스(-1=불가) */
  placeNextAfterCurrent: (track: any) => number;
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
  /** v3.229 N4: 아티스트 개명 직후 — 재생 큐·계정 보관함(savedQueues)·현재 곡 중 character_id가 일치하는
   *  항목의 artist_name을 새 이름으로 일괄 치환(빈 이름이면 기획사명 → 'AI' 폴백, 서버 직렬화 규칙과 동일).
   *  character_id가 없는 항목은 대상 아님(다음 서버 조회 때 갱신). 반환: 치환된 항목 수(큐·보관함·현재곡 합계) */
  renameArtistInQueue: (characterId: string, name: string) => number;
  /** v3.248 B1(A-5): 트랙 필드 패치 일괄 전파 — 재생 큐·현재 곡·계정 보관함(savedQueues)의 같은 id 항목에
   *  patch를 병합한다(renameArtistInQueue 패턴). 커버 교체 PUT 성공 직후 등 "서버가 바뀐 걸 아는 지점"에서
   *  호출해 미니플레이어·플레이어·영속 큐가 옛 스냅샷을 계속 그리는 문제를 막는다.
   *  값이 전부 동일하면 참조 유지(no-op). 반환: 패치된 항목 수(큐·보관함·현재곡 합계). */
  patchTrackEverywhere: (trackId: string | number, patch: Record<string, any>) => number;
}

/** v3.248 B2(A-6): 미니플레이어 "실노출" 판정 단일화.
 *  MiniPlayer 실제 렌더 조건(track 존재 + (sound 있음 || 이번 세션 재생 이력) + 플레이어 화면 아님)에
 *  App.tsx MiniPlayerWrapper의 miniHidden(작업실 화면 숨김)까지 합산한 값.
 *  AppScreenLayout·작곡/디렉터 화면의 하단 패딩이 전부 이 판정을 공유한다
 *  (기존 AppScreenLayout은 !!track만 봐서 "로그인 복원 큐(미니 미노출)"에도 패딩이 생기는 불일치가 있었다). */
export const selectMiniPlayerVisible = (s: PlayerState): boolean =>
  !!s.track && (!!s.sound || s.sessionActive) && !s.isPlayerScreenOpen && !s.miniHidden;

/** v3.248 B2: 화면 훅 — 미니플레이어가 실제로 떠 있는지(하단 패딩 필요 여부) */
export const useMiniPlayerVisible = (): boolean => usePlayerStore(selectMiniPlayerVisible);

/** v3.248 B2: 미니플레이어 높이(px) — AppScreenLayout·각 화면 하단 패딩 공용 상수 */
export const MINI_PLAYER_HEIGHT = 70;

// v3.229 N4: 큐 항목의 아티스트 식별 — 곡 문서의 character_id(발매 시 선택 아티스트) 우선,
// 없으면 곡 스냅샷(user_character_snapshot.character_id). 둘 다 없으면 대상 아님.
function trackCharacterId(t: any): string {
  if (!t) return '';
  const cid = t.character_id ?? t.user_character_snapshot?.character_id;
  return cid != null ? String(cid) : '';
}

function renameTrackArtist(t: any, cid: string, name: string): any {
  if (!t || trackCharacterId(t) !== cid) return t;
  const nextName = name || t.uploader_nickname || t.agency_name || 'AI';
  const snap = t.user_character_snapshot;
  const snapNeeds = !!snap && typeof snap === 'object' && snap.name !== name;
  if (t.artist_name === nextName && !snapNeeds) return t;
  return {
    ...t,
    artist_name: nextName,
    ...(snapNeeds ? { user_character_snapshot: { ...snap, name } } : {}),
  };
}

/** v3.275: 연주곡(Inst) 판정 공용 — 제목 서픽스 "(Inst.)" (서버 related 제외 규칙 _INST_TITLE_RE 와 동일) */
export const isInstTrack = (t: any): boolean => /\(Inst\.\)\s*$/.test(String(t?.title || ''));

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
      queueSource: null, // v3.253 [CrewRecog]
      savedQueues: {},
      guestNoticeAck: false,
      miniHidden: false,
      sessionActive: false,
      shuffle: false,
      recentlyPlayedIds: [] as string[],
      repeat: 'off' as RepeatMode,
      // v3.198: sound가 truthy면 이번 세션에 재생을 시작한 것 — sessionActive를 setter 한 곳에서 일괄 마킹.
      // (null 세팅은 전환/정리 중일 수 있으므로 플래그를 내리지 않는다 — v3.197 재생버튼 1탭 복구 경로 보존)
      setSound: (sound) => set(sound ? { sound, sessionActive: true } : { sound }),
      setTrack: (track) => set({ track }),
      setIsPlaying: (isPlaying) => set({ isPlaying }),
      setPosition: (position) => set({ position }),
      setDuration: (duration) => set({ duration }),
      // v3.253 [CrewRecog]: 큐 교체 = 귀속 재설정 지점 — source 있으면 곡 id 스냅샷과 함께 설정,
      // 없으면(기존 호출부: 개인 플리·앨범·playTrackNow replace) 이전 귀속 해제.
      setQueue: (queue, source) => {
        const queueSource: QueueSource | null = source
          ? { ...source, track_ids: queue.map((t: any) => String(t?.id ?? t?.track_id ?? '')).filter(Boolean) }
          : null;
        if (__DEV__ && source) console.info('[CrewRecog] 큐 귀속 설정', { playlistId: source.playlist_id, clubId: source.club_id, tracks: queueSource?.track_ids.length ?? 0 });
        set({ queue, queueSource });
        saveOwnerQueue();
      },
      setQueueSource: (queueSource) => set({ queueSource }),
      addToQueue: (track) => {
        if (!track?.id) return false;
        const { queue } = get();
        // v3.223 O-1: id 타입 혼재(number/string) 이중 추가 방지 — String 정규화 비교
        if (queue.some((t) => String(t?.id) === String(track.id))) return false; // 중복 방지
        set({ queue: [...queue, track] });
        saveOwnerQueue();
        return true;
      },
      placeNextAfterCurrent: (track) => {
        if (!track?.id) return -1;
        const { queue, currentIndex } = get();
        const id = String(track.id);
        const q = queue.slice();
        let cur = currentIndex;
        const old = q.findIndex((t) => String(t?.id) === id);
        if (old >= 0) {
          if (old === cur) return -1; // 현재 곡 자체 — 옮길 수 없음
          const [existing] = q.splice(old, 1);
          if (old < cur) cur -= 1;
          track = existing || track;
        }
        const at = Math.min(cur + 1, q.length);
        q.splice(at, 0, track);
        set({ queue: q, currentIndex: cur });
        saveOwnerQueue();
        return at;
      },
      insertIntoQueueAfter: (afterIndex, tracks) => {
        const { queue, currentIndex } = get();
        const have = new Set(queue.map((t) => String(t?.id)));
        const fresh = (tracks || []).filter((t) => t?.id && !have.has(String(t.id)));
        if (!fresh.length) return 0;
        const at = Math.max(-1, Math.min(afterIndex, queue.length - 1));
        const next = [...queue.slice(0, at + 1), ...fresh, ...queue.slice(at + 1)];
        // 삽입 지점이 현재 재생 앞이면 인덱스 보정(뒤 삽입은 불변)
        const nextIndex = at < currentIndex ? currentIndex + fresh.length : currentIndex;
        set({ queue: next, currentIndex: nextIndex });
        saveOwnerQueue();
        return fresh.length;
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
          queueSource: null, // v3.253: 큐가 사라지므로 귀속도 해제
          sessionActive: false, // v3.198: 다음 로그인의 복원 큐가 미니로 뜨지 않도록 리셋
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
            queueSource: null, // v3.253: 복원 큐는 무귀속(보관함에 귀속 미저장 — 상단 주석 정책)
            isPlaying: false, position: 0, duration: 0,
            sessionActive: false, // v3.198: 복원 큐는 재생 전까지 미니플레이어 미노출
          });
          return true;
        }
        // 보관된 목록이 없으면 비회원으로 담아둔 목록을 승계(버릴 이유가 없음)
        if (__DEV__) console.info('[playerStore] restoreQueueFor — 보관 목록 없음 → 현재 목록 승계', { kept: get().queue.length });
        set({ queueOwnerId: userId });
        // v3.223 ②(A3 방어): 현재 큐가 비어 있으면 저장 스킵 — persist 하이드레이션 전(savedQueues={})
        // 경합 등에서 빈 큐가 보관함을 파괴적으로 덮어쓰는 것을 금지(승계할 게 있을 때만 저장).
        if (get().queue.length > 0) saveOwnerQueue();
        else if (__DEV__) console.info('[playerStore] restoreQueueFor — 빈 큐 저장 스킵(보관함 보호)');
        return false;
      },
      setGuestNoticeAck: (guestNoticeAck) => set({ guestNoticeAck }),
      setMiniHidden: (miniHidden) => set({ miniHidden }),
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
          saveOwnerQueue(); // v3.223 ②: 현재곡·인덱스 스냅샷 최신화 — 재시작 복원 시 현재 곡 정확
        }
      },
      // v3.271 [InstSkip]: "(Inst.)" 곡은 자동 진행(곡 종료·프리로드·오류 스킵)에서 건너뛴다
      // (대표 확정 — 직접 탭 재생·수동 다음 버튼은 그대로). 전곡 Inst면 getNextIndex 결과 유지.
      getNextAutoIndex: () => {
        const { queue, repeat, currentIndex } = get();
        const isInst = isInstTrack;
        let idx = get().getNextIndex();
        if (idx < 0) return idx;
        if (repeat === 'one') return idx;
        // v3.275: 큐 전체가 Inst(연주곡만 모은 목록)면 건너뛰지 않는다 — 사용자가 의도한 목록
        if (queue.length > 0 && queue.every(isInst)) return idx;
        const tried = new Set<number>();
        while (idx >= 0 && !tried.has(idx) && isInst(queue[idx])) {
          tried.add(idx);
          // 순차 규칙으로 계속 전진(셔플이어도 Inst 재추첨 무한루프 방지 — 다음 자리 탐색)
          const n = idx < queue.length - 1 ? idx + 1 : (repeat === 'all' ? 0 : -1);
          if (n === currentIndex && repeat !== 'all') return -1;
          idx = n;
        }
        if (idx >= 0 && isInst(queue[idx])) return -1; // 전부 Inst — 자동 진행 종료(관련곡 경로로)
        return idx;
      },
      // v3.275 [InstSkip-Manual](대표 2026-10-04): 수동 '다음'도 Inst 를 건너뛴다. 종전엔 수동 경로 3곳이
      // getNextIndex 를 써서 큐에 Inst 가 연달아 있으면 "계속 Inst만" 재생됐다(10-03·10-04 실측 3연속).
      // 규칙: 직접 탭한 Inst 는 재생(다른 경로) · 큐 전체가 Inst 면 건너뛰지 않음 · 한 곡 반복이어도 다음 곡으로.
      // 반환 -1 = 건너뛸 곳 없음(큐 끝/남은 곡 전부 Inst) → 호출부가 관련곡 이어듣기로.
      getNextManualIndex: () => {
        const { queue, currentIndex, shuffle, repeat } = get();
        if (queue.length === 0) return -1;
        const step = (i: number) => (i < queue.length - 1 ? i + 1 : (repeat === 'off' ? -1 : 0));
        let idx: number;
        if (shuffle && queue.length > 1) {
          idx = Math.floor(Math.random() * queue.length);
          if (idx === currentIndex) idx = (idx + 1) % queue.length;
        } else {
          idx = step(currentIndex);
        }
        if (idx < 0) return -1;
        if (queue.every(isInstTrack)) return idx;
        const tried = new Set<number>();
        while (idx >= 0 && !tried.has(idx) && isInstTrack(queue[idx])) {
          tried.add(idx);
          idx = step(idx);
          if (idx === currentIndex) return -1; // 한 바퀴 — 나머지 전부 Inst
        }
        if (idx >= 0 && (isInstTrack(queue[idx]) || tried.has(idx))) return -1;
        return idx;
      },
      // v3.271 [RelatedVariety]: 최근 재생 이력(최대 40곡) — 관련곡 추천 exclude 원천(영속)
      noteRecentlyPlayed: (trackId: string) => {
        if (!trackId) return;
        const prev = get().recentlyPlayedIds || [];
        if (prev[0] === trackId) return;
        const next = [trackId, ...prev.filter((x: string) => x !== trackId)].slice(0, 40);
        set({ recentlyPlayedIds: next });
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
        // v3.198: sessionActive도 리셋 — track이 null이라 미니는 어차피 숨지만 일관성 유지(무해)
        set({ sound: null, track: null, isPlaying: false, position: 0, duration: 0, sessionActive: false });
      },
      renameArtistInQueue: (characterId, name) => {
        const cid = String(characterId || '').trim();
        if (!cid) return 0;
        const newName = (name || '').trim();
        const { queue, track, savedQueues } = get();
        let nQueue = 0;
        let nSaved = 0;
        let nTrack = 0;
        const nextQueue = queue.map((t) => {
          const r = renameTrackArtist(t, cid, newName);
          if (r !== t) nQueue++;
          return r;
        });
        const nextTrack = renameTrackArtist(track, cid, newName);
        if (nextTrack !== track) nTrack = 1;
        const nextSaved: PlayerState['savedQueues'] = {};
        for (const [owner, entry] of Object.entries(savedQueues || {})) {
          if (!entry) { nextSaved[owner] = entry; continue; }
          let changed = false;
          const q = (entry.queue || []).map((t) => {
            const r = renameTrackArtist(t, cid, newName);
            if (r !== t) { nSaved++; changed = true; }
            return r;
          });
          const et = renameTrackArtist(entry.track, cid, newName);
          if (et !== entry.track) { nSaved++; changed = true; }
          nextSaved[owner] = changed ? { ...entry, queue: q, track: et } : entry;
        }
        const total = nQueue + nSaved + nTrack;
        console.info('[ArtistRename] queue rename', { n: total, queue: nQueue, saved: nSaved, current: nTrack, nameLen: newName.length });
        if (total === 0) return 0;
        // 현재 작업 큐·현재곡·보관함을 한 번에 반영(재생 상태·인덱스는 불변 — 곡 id 기준 비교라 재로드 없음)
        set({ queue: nextQueue, track: nextTrack, savedQueues: nextSaved });
        return total;
      },
      // v3.248 B1(A-5): renameArtistInQueue와 같은 3면 순회 — id 일치 항목에 patch 병합.
      // savedQueues를 직접 패치하므로 영속(partialize: savedQueues)에도 다음 저장 시 그대로 실린다.
      patchTrackEverywhere: (trackId, patch) => {
        const id = String(trackId ?? '').trim();
        if (!id || !patch || Object.keys(patch).length === 0) return 0;
        const apply = (t: any): any => {
          if (!t || String(t.id) !== id) return t;
          const changed = Object.keys(patch).some((k) => t[k] !== patch[k]);
          return changed ? { ...t, ...patch } : t;
        };
        const { queue, track, savedQueues } = get();
        let nQueue = 0;
        let nSaved = 0;
        let nTrack = 0;
        const nextQueue = queue.map((t) => {
          const r = apply(t);
          if (r !== t) nQueue++;
          return r;
        });
        const nextTrack = apply(track);
        if (nextTrack !== track) nTrack = 1;
        const nextSaved: PlayerState['savedQueues'] = {};
        for (const [owner, entry] of Object.entries(savedQueues || {})) {
          if (!entry) { nextSaved[owner] = entry; continue; }
          let changed = false;
          const q = (entry.queue || []).map((t) => {
            const r = apply(t);
            if (r !== t) { nSaved++; changed = true; }
            return r;
          });
          const et = apply(entry.track);
          if (et !== entry.track) { nSaved++; changed = true; }
          nextSaved[owner] = changed ? { ...entry, queue: q, track: et } : entry;
        }
        const total = nQueue + nSaved + nTrack;
        if (total === 0) return 0;
        console.info('[TrackPatch] patchTrackEverywhere', {
          id, keys: Object.keys(patch), n: total, queue: nQueue, saved: nSaved, current: nTrack,
        });
        // 재생 상태·인덱스 불변(id 기준 병합) — 커버 등 표시 필드만 바뀌므로 재로드 없음
        set({ queue: nextQueue, track: nextTrack, savedQueues: nextSaved });
        return total;
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
        recentlyPlayedIds: state.recentlyPlayedIds,
        repeat: state.repeat,
        guestNoticeAck: state.guestNoticeAck, // 한 번 확인했으면 앱을 다시 켜도 팝업 재노출 X
      }),
    }
  )
);
