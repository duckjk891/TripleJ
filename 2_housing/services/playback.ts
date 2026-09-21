// [playback] 공용 재생 서비스 — v3.61
// MiniPlayer 안에 갇혀 있던 사운드 로드 로직을 승격: 피드 등 어느 화면에서든
// 플레이어 화면을 열지 않고 즉시 재생(큐 세팅 → 로드 → 미니플레이어 등장)할 수 있다.
// v3.197: 다음 곡 프리로드 + 전환/재생버튼 견고화 — BT/화면꺼짐(차량) 상태에서
//   곡 종료 시점의 "unload → 네트워크 재로드" 의존을 제거하고, 실패 시 죽은 참조를
//   정리해 재생버튼 1탭 복구가 가능하게 한다.
//   [BTDebug] 로그는 원격 계측용 — remoteLogger가 프로덕션에서 warn/error만 후킹하므로
//   반드시 console.warn 레벨 고정(민감정보 금지 — trackId·상태만).
import { AppState, Platform } from 'react-native';
import { Audio } from 'expo-av';
import { usePlayerStore } from '../stores/playerStore';
import api, { BACKEND_BASE_URL } from './api';
import { applyPlaybackAudioMode } from './audioMode';

// v3.70: 로드 세대 토큰 — 로딩 도중 사용자가 플레이어를 닫거나 다른 곡으로 전환하면
// 늦게 완료된 createAsync 결과(유령 사운드)를 즉시 폐기한다.
let loadGen = 0;

/** 진행 중인 로드를 무효화(닫기·정지 시 호출) — 이후 완료되는 로드는 재생되지 않고 폐기됨 */
export function invalidatePlayback(): void {
  loadGen++;
  discardPreloaded('invalidate'); // v3.197: 미니 닫기 등 — 핀된 프리로드도 함께 폐기
  if (__DEV__) console.info('[playback] invalidate', { gen: loadGen });
}

// v3.91: 관련곡 자동 이어듣기 중복 조회 가드 (MAIDOL PlayerContext fetchingRelatedRef 관행)
let fetchingRelated = false;

// v3.192: duration 괴리 경고 1회 가드(트랙당) — Xing 헤더 없는 VBR MP3 진단용
let durationWarnedTrackId: string | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// v3.197: 다음 곡 프리로드 공용 모듈
// 종료 20초 전(또는 85% 지점)에 다음 곡을 shouldPlay:false로 미리 로드해 두고,
// didJustFinish에서 사운드 스왑으로 즉시 이어재생(네트워크 폴백은 기존 경로 유지).
// shuffle은 getNextIndex() 호출마다 랜덤이므로 프리로드 시점에 인덱스를 핀(pinnedIdx)하고
// didJustFinish에서는 재호출하지 않는다. 수동 스킵·큐 편집·셔플/반복 토글·미니 닫기 시
// 폐기: loadGen 세대 + 핀 시점 스냅샷(fromIndex/shuffle/repeat/트랙 id 매치) 검증으로 처리.
// 웹은 PlayerScreen presigned 경로(진짜 seek) 유지를 위해 네이티브 한정.
// ─────────────────────────────────────────────────────────────────────────────
const PRELOAD_LEAD_MS = 20_000;
const PRELOAD_RATIO = 0.85;
// v3.202(A-lite, U-2 보강): 조기 트리거 실패 시 재시도 창 — 종료 60초 전부터.
// 백오프 가드가 시간 창 게이트 뒤에 있어, 창이 20초면 eager 실패 후 재시도가
// 종곡 20초 전까지 지연된다(그 시점엔 이미 Doze 가능성이 높음). 창을 합집합으로 넓혀
// 화면이 아직 살아 있을 확률이 높은 구간에서 재시도 기회를 확보한다.
const PRELOAD_EARLY_LEAD_MS = 60_000;
// v3.202(A-lite): 실패 백오프 — 곡당 최대 3회·10초 간격.
// 기존에는 실패 시 상태 콜백(~500ms)마다 무제한 재시도(초당 ~8회 폭주 — 원격 실측).
// Doze로 네트워크가 죽은 상태에서 재시도 폭주는 성공 가능성 없이 배터리/로그만 태운다.
const PRELOAD_RETRY_MAX = 3;
const PRELOAD_RETRY_INTERVAL_MS = 10_000;
/** 현재 곡 기준 프리로드 실패 이력 — forTrackId가 바뀌면 자연 무효(가드 미매치) */
let preloadFail: { forTrackId: string; count: number; lastAt: number } | null = null;

interface NextPreload {
  /** 프리로드를 건 시점의 "현재 재생 곡" id — 곡당 1회 트리거 가드 */
  forTrackId: string;
  /** 프리로드된 다음 곡 id */
  trackId: string;
  sound: Audio.Sound;
  /** 핀된 다음 인덱스 — didJustFinish에서 getNextIndex() 재호출 금지(셔플 재추첨 방지) */
  pinnedIdx: number;
  /** 핀 시점 스냅샷 — 수동 스킵/큐 편집/셔플·반복 토글 감지용 */
  fromIndex: number;
  shuffle: boolean;
  repeat: string;
  gen: number;
}
let nextPreload: NextPreload | null = null;
let preloadInFlight = false;

/** 핀된 프리로드 폐기(unload 포함) — invalidate·수동 스킵·새 로드 시 호출 */
export function discardPreloaded(reason?: string): void {
  const p = nextPreload;
  if (!p) return;
  nextPreload = null;
  try { p.sound.unloadAsync().catch(() => {}); } catch {}
  if (__DEV__) console.info('[playback] preload 폐기', { reason, trackId: p.trackId });
}

/**
 * 종료 임박 시 다음 곡 프리로드 트리거 — 양쪽 상태 콜백(playback.ts·PlayerScreen)에서 호출.
 * durationMillis는 v3.192 effectiveDuration(보정값)을 넘길 것.
 * v3.202(A-lite): opts.eager=true — 현재 곡 로드 성공 직후 조기 트리거(시간 게이트 무시).
 * Doze 진입 전(화면 켜짐·네트워크 생존 구간)에 프리로드를 끝내 두는 것이 목적.
 * 기존 20s/85% 트리거는 유지(조기 트리거 실패 시 2차 기회) — 이중 트리거.
 */
export function maybePreloadNext(
  currentTrack: any,
  positionMillis: number,
  durationMillis: number,
  opts?: { eager?: boolean },
): void {
  if (Platform.OS === 'web') return; // 웹은 presigned 경로 유지 — 네이티브 한정
  if (!currentTrack?.id) return;
  if (!opts?.eager) {
    if (!durationMillis || durationMillis <= 0) return;
    const remaining = durationMillis - positionMillis;
    const leadMs = Math.max(PRELOAD_LEAD_MS, PRELOAD_EARLY_LEAD_MS); // 창 합집합(20s ∪ 60s)
    if (remaining > leadMs && positionMillis / durationMillis < PRELOAD_RATIO) return;
  }
  if (preloadInFlight) return;
  if (nextPreload && nextPreload.forTrackId === String(currentTrack.id)) return; // 곡당 1회 가드
  // v3.202(A-lite): 실패 백오프 — 같은 곡에서 3회 실패했으면 중단, 10초 안 지났으면 대기
  const curId = String(currentTrack.id);
  if (preloadFail && preloadFail.forTrackId === curId) {
    if (preloadFail.count >= PRELOAD_RETRY_MAX) return;
    if (Date.now() - preloadFail.lastAt < PRELOAD_RETRY_INTERVAL_MS) return;
  }
  const s = usePlayerStore.getState();
  const pinnedIdx = s.getNextIndex(); // 지금 핀 — didJustFinish에서 재호출 금지
  const next = pinnedIdx >= 0 ? s.queue[pinnedIdx] : null;
  if (!next?.id) return; // 큐 소진 — related 프리페치는 v3.197 보류(계획서 판정)
  discardPreloaded('re-pin'); // 이전 곡 기준의 잔존 프리로드 정리
  preloadInFlight = true;
  const gen = loadGen;
  const pin = { fromIndex: s.currentIndex, shuffle: s.shuffle, repeat: s.repeat as string };
  (async () => {
    try {
      console.warn('[BTDebug] preload start', { trackId: next.id, pinnedIdx, eager: !!opts?.eager });
      const { sound } = await Audio.Sound.createAsync(
        { uri: `${BACKEND_BASE_URL}/api/tracks/stream-proxy/${next.id}` },
        { shouldPlay: false },
      );
      if (gen !== loadGen) {
        // 프리로드 도중 닫힘/전환 — 폐기 (실패 아님 — 백오프 카운트 비대상)
        try { await sound.unloadAsync(); } catch {}
        console.warn('[BTDebug] preload stale discard', { trackId: next.id });
        return;
      }
      nextPreload = { forTrackId: curId, trackId: String(next.id), sound, pinnedIdx, gen, ...pin };
      preloadFail = null; // v3.202(A-lite): 성공 — 실패 이력 리셋
      console.warn('[BTDebug] preload ready', { trackId: next.id, pinnedIdx });
    } catch (err: any) {
      // v3.202(A-lite): 실패 기록 — 곡당 3회·10s 간격 백오프의 근거(폭주 제거)
      preloadFail = {
        forTrackId: curId,
        count: preloadFail?.forTrackId === curId ? preloadFail.count + 1 : 1,
        lastAt: Date.now(),
      };
      console.warn('[BTDebug] preload fail', { trackId: next?.id, message: err?.message, retry: preloadFail.count, max: PRELOAD_RETRY_MAX });
    } finally {
      preloadInFlight = false;
    }
  })();
}

/**
 * didJustFinish에서 호출 — 핀이 여전히 유효하면(세대·인덱스·셔플/반복·트랙 id 매치)
 * 프리로드된 sound를 반환(호출자가 콜백 부착 + playAsync). 무효/부재면 null → 네트워크 폴백.
 */
export function consumePreloaded(): { index: number; track: any; sound: Audio.Sound } | null {
  const p = nextPreload;
  if (!p) return null;
  nextPreload = null;
  const s = usePlayerStore.getState();
  const track = s.queue[p.pinnedIdx];
  const valid =
    p.gen === loadGen &&
    s.currentIndex === p.fromIndex &&
    s.shuffle === p.shuffle &&
    s.repeat === p.repeat &&
    !!track?.id && String(track.id) === p.trackId;
  if (!valid) {
    try { p.sound.unloadAsync().catch(() => {}); } catch {}
    console.warn('[BTDebug] preload invalid discard', { trackId: p.trackId, pinnedIdx: p.pinnedIdx });
    return null;
  }
  return { index: p.pinnedIdx, track, sound: p.sound };
}

/**
 * v3.91: 관련곡 자동 이어듣기 — 큐 마지막 곡이 끝나면(getNextIndex()<0, 수동 큐 우선)
 * GET /tracks/{id}/related?exclude=...&limit=1 로 1곡을 받아 큐 뒤에 붙이고 이어 재생.
 * (MAIDOL PlayerContext.jsx onEnded 관행 — 설정 토글 없이 기본 동작, YouTube Music 스타일)
 * 무한 반복 방지: 이미 큐에 있는 트랙 id 전부를 exclude로 전달(이어들은 곡도 큐에 누적되므로
 * 재생 이력 제외 세트 역할). related 응답: { tracks: [...], source: "vector"|"genre"|"popular"|"mixed" } — 무인증.
 */
// loadFn 주입: PlayerScreen처럼 자체 사운드/콜백을 관리하는 호출자는 자기 로더로 재생을 잇는다
// (미주입 시 기본 loadAndPlayTrack — 미니/인라인 재생 경로)
export async function autoContinueWithRelated(
  loadFn?: (track: any) => Promise<void>
): Promise<void> {
  const s = usePlayerStore.getState();
  const endedTrack = s.queue[s.currentIndex] || s.track;
  if (!endedTrack?.id || fetchingRelated) {
    s.setIsPlaying(false);
    return;
  }
  fetchingRelated = true;
  const excludeIds = s.queue.map((t: any) => t?.id).filter(Boolean);
  console.info('[playerStore] 관련곡 이어듣기 조회', { track_id: endedTrack.id, exclude_count: excludeIds.length });
  try {
    const res = await api.get(`/tracks/${endedTrack.id}/related`, {
      params: {
        limit: 1,
        ...(excludeIds.length > 0 ? { exclude: excludeIds.join(',') } : {}),
      },
    });
    const tracks = res.data?.tracks || [];
    if (tracks.length === 0) {
      console.warn('[playerStore] 관련곡 없음 — 재생 종료');
      usePlayerStore.getState().setIsPlaying(false);
      return;
    }
    const t = tracks[0];
    // 백엔드 _serialize_track이 artist_name/cover_image 별칭까지 실어주지만 원본 필드도 방어적으로 수용
    const nextTrack = {
      ...t,
      id: t.id,
      title: t.title,
      artist_name: t.artist_name || t.uploader_nickname || 'AI',
      cover_image: t.cover_image || t.cover_image_url,
    };
    const store = usePlayerStore.getState();
    store.addToQueue(nextTrack);
    const idx = usePlayerStore.getState().queue.findIndex((x: any) => x?.id === nextTrack.id);
    if (idx < 0) {
      // addToQueue가 중복으로 거부한 예외 상황 — 이어듣기 중단
      usePlayerStore.getState().setIsPlaying(false);
      return;
    }
    console.info('[playerStore] 관련곡 이어재생', { id: nextTrack.id, queue_size: usePlayerStore.getState().queue.length, source: res.data?.source });
    usePlayerStore.getState().playTrackAtIndex(idx);
    await (loadFn ? loadFn(nextTrack) : loadAndPlayTrack(nextTrack));
  } catch (err: any) {
    // v3.197: [BTDebug] 계측 — 백그라운드 related 왕복 실패(H1 취약 지점) 확진용
    console.warn('[BTDebug] related fail', { trackId: endedTrack.id, status: err?.response?.status, message: err?.message, appState: AppState.currentState });
    usePlayerStore.getState().setIsPlaying(false);
  } finally {
    fetchingRelated = false;
  }
}

/**
 * v3.197: 상태 콜백 팩토리 — createAsync 인라인 콜백을 승격해 프리로드 스왑 사운드에도
 * 동일 콜백(v3.192 effectiveDuration 보정 포함)을 부착할 수 있게 한다.
 */
function makeStatusCallback(newTrack: any): (status: any) => void {
  return (status: any) => {
    if (status.isLoaded) {
      const s = usePlayerStore.getState();
      s.setIsPlaying(status.isPlaying);
      s.setPosition(status.positionMillis || 0);
      // v3.192: duration 방어 보정 — Xing 헤더 없는 VBR MP3는 엔진이 duration을 짧게 오판.
      // 실측 우선: 엔진값·현재 위치·API duration_sec 중 최대값(진행바 조기 고정 방지).
      const apiDurationMs = (newTrack?.duration_sec ?? 0) * 1000;
      const engineDurationMs = status.durationMillis || 0;
      const effectiveDuration = Math.max(engineDurationMs, status.positionMillis || 0, apiDurationMs);
      if (__DEV__ && effectiveDuration - engineDurationMs >= 5000 && newTrack?.id && durationWarnedTrackId !== newTrack.id) {
        durationWarnedTrackId = newTrack.id;
        console.warn('[playback] duration mismatch', {
          trackId: newTrack.id,
          apiSec: newTrack?.duration_sec ?? 0,
          engineMs: engineDurationMs,
          positionMs: status.positionMillis || 0,
        });
      }
      s.setDuration(effectiveDuration);
      // v3.197: 종료 임박 — 다음 곡 프리로드(셔플 인덱스 핀 포함)
      maybePreloadNext(newTrack, status.positionMillis || 0, effectiveDuration);
      if (status.didJustFinish) {
        // v3.197: 프리로드 스왑 우선 — 종료 시점 네트워크 의존 제거. 미스면 기존 경로 폴백.
        const pre = consumePreloaded();
        if (pre) {
          console.warn('[BTDebug] didJustFinish', { src: 'playback', trackId: newTrack?.id, nextIdx: pre.index, appState: AppState.currentState, preloadHit: true });
          s.playTrackAtIndex(pre.index);
          playPreloadedSound(pre);
        } else {
          const nextIdx = s.getNextIndex();
          console.warn('[BTDebug] didJustFinish', { src: 'playback', trackId: newTrack?.id, nextIdx, appState: AppState.currentState, preloadHit: false });
          if (nextIdx >= 0 && s.queue[nextIdx]) {
            s.playTrackAtIndex(nextIdx);
            loadAndPlayTrack(s.queue[nextIdx]);
          } else {
            // v3.91: 큐 소진(반복 off) — 관련곡을 받아 자동 이어듣기(수동 큐 우선)
            autoContinueWithRelated();
          }
        }
      }
    } else if (status.error) {
      // v3.197: 미디어 에러 — 무음 방치 제거(UI를 일시정지로 정합화) + 원격 계측.
      // 자동 재재생은 하지 않음 — 견고화된 재생버튼 1탭이 복구 경로.
      console.warn('[BTDebug] sound error', { src: 'playback', trackId: newTrack?.id, error: String(status.error) });
      usePlayerStore.getState().setIsPlaying(false);
    }
  };
}

/** v3.197: didJustFinish 프리로드 스왑 재생(네트워크 無). 실패 시 기존 네트워크 로드 폴백. */
async function playPreloadedSound(pre: { index: number; track: any; sound: Audio.Sound }): Promise<void> {
  const gen = ++loadGen; // 스왑도 하나의 "로드" — 유령 재생 방지 세대 갱신
  const store = usePlayerStore.getState();
  const oldSound = store.sound;
  try {
    await applyPlaybackAudioMode(); // 인터럽션 후 포커스 재획득 대비(계획서 (a) 부분 적용)
    pre.sound.setOnPlaybackStatusUpdate(makeStatusCallback(pre.track)); // v3.192 duration 보정 경로 동일
    await pre.sound.playAsync();
    if (gen !== loadGen) {
      // 스왑 도중 닫힘/전환 — 유령 재생 방지
      try { await pre.sound.unloadAsync(); } catch {}
      return;
    }
    store.setSound(pre.sound);
    store.setIsPlaying(true);
    console.warn('[BTDebug] preload swap ok', { src: 'playback', trackId: pre.track?.id });
    if (oldSound && oldSound !== pre.sound) {
      try { await oldSound.unloadAsync(); } catch {}
    }
    // v3.202(A-lite): 스왑 성공 = 새 현재 곡 확정 — 다음 곡 프리로드 조기 트리거(이중 트리거 1차).
    // 백그라운드 연쇄 전환(차량) 중 Doze 창이 열리기 전에 다음 곡까지 확보한다.
    maybePreloadNext(pre.track, 0, 0, { eager: true });
  } catch (err: any) {
    console.warn('[BTDebug] preload swap fail → network fallback', { src: 'playback', trackId: pre.track?.id, message: err?.message });
    try { await pre.sound.unloadAsync(); } catch {}
    await loadAndPlayTrack(pre.track);
  }
}

/** 트랙 사운드 로드+재생. didJustFinish 시 셔플/반복 반영해 자동 다음곡. */
export async function loadAndPlayTrack(newTrack: any): Promise<void> {
  const gen = ++loadGen; // 이 로드의 세대 — 도중에 invalidate/새 로드가 오면 스스로 폐기
  discardPreloaded('new-load'); // v3.197: 수동 스킵/새 재생 — 이전 곡 기준 핀 프리로드 폐기
  const store = usePlayerStore.getState();
  if (store.sound) {
    const old = store.sound;
    store.setSound(null); // v3.197: unload된 죽은 참조가 store에 남는 창 제거
    try { await old.unloadAsync(); } catch {}
  }
  try {
    const audioUrl = `${BACKEND_BASE_URL}/api/tracks/stream-proxy/${newTrack.id}`;
    if (__DEV__) console.info('[playback] load', { id: newTrack.id, gen });
    await applyPlaybackAudioMode(); // 타 앱 오디오 중단·백그라운드 재생
    const { sound: newSound } = await Audio.Sound.createAsync(
      { uri: audioUrl },
      { shouldPlay: true },
      makeStatusCallback(newTrack)
    );
    if (gen !== loadGen) {
      // 로딩 도중 닫힘/전환됨 — 유령 재생 방지: 방금 만든 사운드를 폐기
      if (__DEV__) console.info('[playback] 늦은 로드 폐기', { id: newTrack.id, gen, current: loadGen });
      try { await newSound.unloadAsync(); } catch {}
      return;
    }
    usePlayerStore.getState().setSound(newSound);
    usePlayerStore.getState().setIsPlaying(true);
    // v3.202(A-lite): 현재 곡 로드 성공 직후 다음 곡 프리로드 조기 트리거(이중 트리거 1차).
    // 기존 20s/85% 창은 Android Doze(네트워크 차단) 진입보다 늦는 실측 — 화면/네트워크가
    // 살아있는 지금 확보한다. 실패 시 백오프(곡당 3회·10s)가 폭주를 막는다.
    maybePreloadNext(newTrack, 0, 0, { eager: true });
  } catch (err: any) {
    // v3.197: 실패 시 참조/상태 정리 — 죽은 객체 방치 금지(재생버튼 1탭 복구가 받아준다)
    usePlayerStore.getState().setSound(null);
    usePlayerStore.getState().setIsPlaying(false);
    console.warn('[BTDebug] load fail', { src: 'playback', trackId: newTrack?.id, message: err?.message, appState: AppState.currentState });
  }
}

/** 화면 이동 없이 즉시 재생 — 큐를 세팅하고 해당 곡부터 재생(미니플레이어 등장). */
export async function playTrackNow(track: any, queue?: any[]): Promise<void> {
  const store = usePlayerStore.getState();
  const q = queue && queue.length ? queue : [track];
  store.setQueue(q);
  const idx = Math.max(0, q.findIndex((t: any) => t.id === track.id));
  store.playTrackAtIndex(idx);
  if (__DEV__) console.info('[playback] playTrackNow', { id: track.id, queue: q.length });
  await loadAndPlayTrack(q[idx] || track);
}

// ─────────────────────────────────────────────────────────────────────────────
// v3.197(T4): AppState 'active' 복귀 리컨사일 — 백그라운드에서 사운드가 죽었는데
// UI가 "재생중"으로 남는 불일치를 정리한다. 자동 재재생은 하지 않는다(운전 중 돌발
// 재생 방지 — 계획서 명시). 복구는 사용자의 재생버튼 1탭(견고화 토글)이 받아준다.
// ─────────────────────────────────────────────────────────────────────────────
let reconcilerInited = false;
let reconcilerSubscription: { remove: () => void } | null = null;
export function initPlaybackReconciler(): void {
  if (reconcilerInited) return;
  reconcilerInited = true;
  reconcilerSubscription = AppState.addEventListener('change', async (state) => {
    if (state !== 'active') return;
    const s = usePlayerStore.getState();
    if (!s.sound || !s.isPlaying) return;
    try {
      const st: any = await s.sound.getStatusAsync();
      if (!st?.isLoaded) {
        console.warn('[BTDebug] reconcile dead sound → paused UI', {
          trackId: s.track?.id, error: st?.error ? String(st.error) : undefined,
        });
        s.setIsPlaying(false);
        s.setSound(null); // 죽은 참조 정리 — 재생버튼이 재로드 경로를 타게 한다
      } else if (!st.isPlaying) {
        // 로드는 살아있는데 시스템(포커스 상실 등)이 멈춘 경우 — UI만 일시정지 정합화
        console.warn('[BTDebug] reconcile paused sound → paused UI', { trackId: s.track?.id });
        s.setIsPlaying(false);
      }
    } catch (err: any) {
      console.warn('[BTDebug] reconcile getStatus fail → paused UI', { trackId: s.track?.id, message: err?.message });
      const cur = usePlayerStore.getState();
      cur.setIsPlaying(false);
      cur.setSound(null);
    }
  });
}

/** v3.197: 리컨사일 리스너 해제 — 등록/해제 쌍 보장(dev fast-refresh 리스너 누적 방지) */
export function teardownPlaybackReconciler(): void {
  try { reconcilerSubscription?.remove(); } catch {}
  reconcilerSubscription = null;
  reconcilerInited = false; // 재진입 가드 리셋 — 다음 init에서 재등록 가능
}
