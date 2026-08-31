// [playback] 공용 재생 서비스 — v3.61
// MiniPlayer 안에 갇혀 있던 사운드 로드 로직을 승격: 피드 등 어느 화면에서든
// 플레이어 화면을 열지 않고 즉시 재생(큐 세팅 → 로드 → 미니플레이어 등장)할 수 있다.
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
  if (__DEV__) console.info('[playback] invalidate', { gen: loadGen });
}

// v3.91: 관련곡 자동 이어듣기 중복 조회 가드 (MAIDOL PlayerContext fetchingRelatedRef 관행)
let fetchingRelated = false;

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
    console.error('[playerStore] 관련곡 조회 실패', { status: err?.response?.status, message: err?.message });
    usePlayerStore.getState().setIsPlaying(false);
  } finally {
    fetchingRelated = false;
  }
}

/** 트랙 사운드 로드+재생. didJustFinish 시 셔플/반복 반영해 자동 다음곡. */
export async function loadAndPlayTrack(newTrack: any): Promise<void> {
  const gen = ++loadGen; // 이 로드의 세대 — 도중에 invalidate/새 로드가 오면 스스로 폐기
  const store = usePlayerStore.getState();
  if (store.sound) {
    try { await store.sound.unloadAsync(); } catch {}
  }
  try {
    const audioUrl = `${BACKEND_BASE_URL}/api/tracks/stream-proxy/${newTrack.id}`;
    if (__DEV__) console.info('[playback] load', { id: newTrack.id, gen });
    await applyPlaybackAudioMode(); // 타 앱 오디오 중단·백그라운드 재생
    const { sound: newSound } = await Audio.Sound.createAsync(
      { uri: audioUrl },
      { shouldPlay: true },
      (status: any) => {
        if (status.isLoaded) {
          const s = usePlayerStore.getState();
          s.setIsPlaying(status.isPlaying);
          s.setPosition(status.positionMillis || 0);
          s.setDuration(status.durationMillis || 0);
          if (status.didJustFinish) {
            const nextIdx = s.getNextIndex();
            if (nextIdx >= 0 && s.queue[nextIdx]) {
              s.playTrackAtIndex(nextIdx);
              loadAndPlayTrack(s.queue[nextIdx]);
            } else {
              // v3.91: 큐 소진(반복 off) — 관련곡을 받아 자동 이어듣기(수동 큐 우선)
              autoContinueWithRelated();
            }
          }
        }
      }
    );
    if (gen !== loadGen) {
      // 로딩 도중 닫힘/전환됨 — 유령 재생 방지: 방금 만든 사운드를 폐기
      if (__DEV__) console.info('[playback] 늦은 로드 폐기', { id: newTrack.id, gen, current: loadGen });
      try { await newSound.unloadAsync(); } catch {}
      return;
    }
    usePlayerStore.getState().setSound(newSound);
    usePlayerStore.getState().setIsPlaying(true);
  } catch (err: any) {
    console.error('[playback] 곡 로드 실패', { id: newTrack?.id, message: err?.message });
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
