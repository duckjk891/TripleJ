// v3.281 [63] 결과 화면(A/B 비교) "다른 곡이 재생 중" 표시 수정 — 순수 판정 모듈(RN 의존 없음, Node 하니스 대상).
// 제보(10-04, iOS 웹): A/B 후보를 듣는 동안 잠금화면 Now Playing 이 직전 전역 곡("13층", 1:50/2:23 재생 중)을 표시.
// 원인: 결과 화면의 A/B 는 expo-av 자체 Audio(웹은 분리된 new Audio) — 전역 플레이어(webAudioElement 단일 element)를
// 멈추지도, navigator.mediaSession 메타를 바꾸지도 않았다(메타는 playback.ts 의 store.track 구독만 갱신).

export interface AbNowPlayingInput {
  /** 작사 결과 제목(lyricsStore.generatedTitle) */
  title?: string | null;
  genre?: string | null;
  mood?: string | null;
  variantIndex: number;
  /** 1 = 단일 플레이어(발매 후·클립 1개), 2+ = A/B 비교 */
  variantCount: number;
  labels: readonly string[];
}

export interface AbNowPlayingMeta {
  title: string;
  artist: string;
}

/** 잠금화면/알림에 띄울 A/B 후보 메타 — 화면 상단 제목과 같은 셈법 + 비교 중이면 버전 라벨 */
export function abNowPlayingMeta(i: AbNowPlayingInput): AbNowPlayingMeta {
  const t = (i.title || '').trim();
  const gm = [i.genre, i.mood].filter((x) => !!(x && String(x).trim())).join(' - ');
  const base = t || gm || '새 곡';
  if (i.variantCount > 1) {
    const idx = Math.max(0, Math.floor(i.variantIndex || 0));
    const label = i.labels[idx] || `버전 ${idx + 1}`;
    return { title: `${base} (${label})`, artist: 'MAIDOL · 버전 비교 중' };
  }
  return { title: base, artist: 'MAIDOL · 새 곡 미리듣기' };
}

export interface GlobalPlaybackSnapshot {
  hasSound: boolean;
  /** store.isPlaying */
  storeIsPlaying: boolean;
  /** sound.getStatusAsync().isPlaying (조회 실패 시 null) */
  statusIsPlaying: boolean | null;
}

/** 결과 화면 진입·A/B 재생 시 전역 재생을 멈춰야 하는지 — store 또는 실제 status 어느 쪽이든 재생 중이면 */
export function shouldPauseGlobal(g: GlobalPlaybackSnapshot): boolean {
  if (!g.hasSound) return false;
  return g.storeIsPlaying || g.statusIsPlaying === true;
}

export type MediaSessionRestorePlan =
  | { kind: 'track'; playing: boolean }
  | { kind: 'clear' };

/** 결과 화면 이탈 시 잠금화면 메타 복귀 계획 — 전역 곡이 있으면 그 곡(재생 상태 그대로), 없으면 비움 */
export function mediaSessionRestorePlan(g: { hasTrack: boolean; isPlaying: boolean }): MediaSessionRestorePlan {
  return g.hasTrack ? { kind: 'track', playing: !!g.isPlaying } : { kind: 'clear' };
}
