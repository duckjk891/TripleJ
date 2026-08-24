// [playback] 공용 재생 서비스 — v3.61
// MiniPlayer 안에 갇혀 있던 사운드 로드 로직을 승격: 피드 등 어느 화면에서든
// 플레이어 화면을 열지 않고 즉시 재생(큐 세팅 → 로드 → 미니플레이어 등장)할 수 있다.
import { Audio } from 'expo-av';
import { usePlayerStore } from '../stores/playerStore';
import { BACKEND_BASE_URL } from './api';
import { applyPlaybackAudioMode } from './audioMode';

/** 트랙 사운드 로드+재생. didJustFinish 시 셔플/반복 반영해 자동 다음곡. */
export async function loadAndPlayTrack(newTrack: any): Promise<void> {
  const store = usePlayerStore.getState();
  if (store.sound) {
    try { await store.sound.unloadAsync(); } catch {}
  }
  try {
    const audioUrl = `${BACKEND_BASE_URL}/api/tracks/stream-proxy/${newTrack.id}`;
    if (__DEV__) console.info('[playback] load', { id: newTrack.id });
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
              s.setIsPlaying(false);
            }
          }
        }
      }
    );
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
