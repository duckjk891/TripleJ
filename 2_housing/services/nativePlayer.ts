// [NativePlayer] v3.392 — 안드로이드 네이티브 큐 재생 엔진(modules/maidol-player) JS 층.
//
// 배경(대표 갤럭시 실측 10-21): ① '다음'을 누르면 곡이 겹침 ② 차에서 다음 곡으로 안 넘어감 ③ 미니플레이어를
// 꺼도 노래가 계속 나옴 ④ 산발적으로 다음 곡으로 안 넘어가고 끊김. 원인은 expo-audio 심 구조 —
// 곡마다 플레이어를 새로 만들고(재생 화면·미니 각자 로더 → 서로 모르는 소리가 남음), 잠금화면/차에 다음·이전
// 명령이 없으며, 곡 끝 → 다음 곡 전환을 JS 가 해서 화면이 꺼지면 끊겼다.
//
// 이 층의 역할: 네이티브 플레이어(서비스 1개·플레이어 1개)를 expo-av Sound 모양(engineSound)으로 감싸
// 기존 호출부(미니플레이어·피드·크루 미리듣기 등 store.sound.playAsync/pauseAsync…)가 그대로 동작하게 하고,
// 곡 정보 ↔ 네이티브 항목(key) 변환, 이벤트 구독을 맡는다. 재생 정책(다음 곡 고르기·추천·재생 기록)은
// services/playback.ts 의 [NativePlayer] 구역이 정한다.
//
// 아이폰·웹은 이 엔진을 쓰지 않는다(NATIVE_QUEUE_ENGINE=false) — 기존 경로 그대로.
import { MaidolPlayer, type NativePlayerState, type NativeTrackItem } from '../modules/maidol-player';
import { streamProxyUrl } from './api';
import { trackCoverUri } from '../utils/coverUri';

/** 안드로이드 + 새 빌드(모듈 포함)에서만 true. 옛 APK·개발 클라이언트는 false → 기존 expo-audio 심 */
export const NATIVE_QUEUE_ENGINE = !!MaidolPlayer;

// ── key: "<트랙 id>#<순번>" ─────────────────────────────────────────────────
// 순번은 시각 기반으로 시작 — JS 가 다시 뜬 뒤(앱 재실행) 살아 있던 네이티브 목록의 key 와 겹치지 않고,
// 순번 크기로 '앞으로/뒤로' 이동을 가린다(차·잠금화면 '이전' 판정).
let keySeq = Date.now() % 1_000_000_000;
const keyTracks = new Map<string, any>();

export function trackIdOfKey(key: string | null | undefined): string {
  if (!key) return '';
  const i = key.indexOf('#');
  return i >= 0 ? key.slice(0, i) : key;
}

export function seqOfKey(key: string | null | undefined): number {
  if (!key) return -1;
  const i = key.indexOf('#');
  const n = i >= 0 ? Number(key.slice(i + 1)) : NaN;
  return Number.isFinite(n) ? n : -1;
}

/** 네이티브가 스스로 이전 항목으로 갔는지(차·잠금화면 '이전') — 순번이 작아졌으면 뒤로 */
export function isBackwardKey(prevKey: string | null | undefined, nextKey: string | null | undefined): boolean {
  const a = seqOfKey(prevKey);
  const b = seqOfKey(nextKey);
  return a >= 0 && b >= 0 && b < a;
}

/** 화면에 '재생 중'으로 보일지 — 버퍼링 중에도 재생 의도가 있으면 재생 중(버튼 깜빡임 방지) */
export function engineShowsPlaying(st: Pick<NativePlayerState, 'isPlaying' | 'playWhenReady' | 'state'> | null): boolean {
  if (!st) return false;
  if (st.isPlaying) return true;
  return !!st.playWhenReady && (st.state === 'buffering' || st.state === 'ready');
}

/** 엔진 상태 → expo-av 상태 콜백 셰이프(재생 화면 콜백·getStatusAsync 호환). 곡 전환은 네이티브가 하므로 didJustFinish 는 항상 false */
export function engineToAvStatus(st: NativePlayerState | null, durationOverrideMs?: number) {
  const loaded = !!st && st.count > 0 && st.state !== 'idle';
  const playing = engineShowsPlaying(st);
  return {
    isLoaded: loaded,
    positionMillis: Math.max(0, Math.round(st?.positionMs || 0)),
    durationMillis: durationOverrideMs || (st && st.durationMs > 0 ? Math.round(st.durationMs) : undefined),
    isPlaying: playing,
    didJustFinish: false,
    shouldPlay: playing,
    isBuffering: st?.state === 'buffering',
  };
}

export function keyTrack(key: string | null | undefined): any | null {
  return key ? keyTracks.get(key) ?? null : null;
}

function buildItem(track: any): NativeTrackItem {
  const key = `${String(track.id)}#${++keySeq}`;
  keyTracks.set(key, track);
  if (keyTracks.size > 300) {
    // 오래된 key 정리(목록에는 최대 20+2곡만 남는다)
    const drop = keyTracks.size - 200;
    let i = 0;
    for (const k of keyTracks.keys()) {
      if (i++ >= drop) break;
      keyTracks.delete(k);
    }
  }
  return {
    key,
    url: streamProxyUrl(track), // v3.345 미발매곡만 ?token=
    title: track?.title || 'MAIDOL',
    artist: track?.artist_name || track?.uploader_nickname || 'MAIDOL',
    artwork: trackCoverUri(track, 640), // 잠금화면·차 화면 아트(640px 썸네일)
  };
}

// ── 엔진 상태(마지막으로 받은 값) ───────────────────────────────────────────
let lastState: NativePlayerState | null = null;
export function engineLastState(): NativePlayerState | null {
  return lastState;
}
function noteState(st: NativePlayerState | null | undefined): void {
  if (st && typeof st === 'object') lastState = st;
}

// 재생 화면(PlayerScreen)이 붙이는 상태 콜백 — expo-av setOnPlaybackStatusUpdate 호환(하나만)
let externalCb: ((status: any) => void) | null = null;
export function engineExternalCallback(): ((status: any) => void) | null {
  return externalCb;
}

export async function enginePlayNow(track: any, upcoming: any[], repeatOne: boolean): Promise<NativePlayerState | null> {
  if (!MaidolPlayer) return null;
  const item = buildItem(track);
  const ups = upcoming.filter((t) => t?.id).map(buildItem);
  console.warn('[NativePlayer] playNow', { trackId: track?.id, upcoming: ups.map((u) => trackIdOfKey(u.key)), repeatOne });
  const st = await MaidolPlayer.playNow(item, ups, repeatOne);
  noteState(st);
  return st;
}

export async function engineSetUpcoming(upcoming: any[]): Promise<NativePlayerState | null> {
  if (!MaidolPlayer) return null;
  const ups = upcoming.filter((t) => t?.id).map(buildItem);
  const st = await MaidolPlayer.setUpcoming(ups);
  noteState(st);
  return st;
}

export async function engineSetRepeatOne(on: boolean): Promise<void> {
  if (!MaidolPlayer) return;
  await MaidolPlayer.setRepeatOne(on);
  if (lastState) lastState = { ...lastState, repeatOne: on };
}

export async function engineGetState(): Promise<NativePlayerState | null> {
  if (!MaidolPlayer) return null;
  const st = await MaidolPlayer.getState();
  noteState(st);
  return st;
}

/** 재생 정지 + 목록 비움 + 서비스 정리(미니플레이어 닫기·로그아웃) */
export async function engineStop(reason: string): Promise<void> {
  if (!MaidolPlayer) return;
  externalCb = null;
  lastState = null;
  console.warn('[NativePlayer] stop', { reason });
  try {
    await MaidolPlayer.stop();
  } catch (err: any) {
    console.warn('[NativePlayer] stop 실패(무해)', { message: err?.message });
  }
}

export function engineServiceAlive(): boolean {
  try {
    return !!MaidolPlayer?.isServiceAlive();
  } catch {
    return false;
  }
}

/**
 * store.sound 에 들어가는 Sound 모양 객체 — 네이티브 플레이어가 하나뿐이라 객체도 하나.
 * unloadAsync = 정지·정리(미니플레이어 닫기 → playerStore.cleanup 이 부른다).
 */
export const engineSound = {
  __nativeEngine: true,
  async playAsync(): Promise<void> {
    noteState(await MaidolPlayer?.play());
  },
  async pauseAsync(): Promise<void> {
    noteState(await MaidolPlayer?.pause());
  },
  async setPositionAsync(positionMillis: number): Promise<void> {
    noteState(await MaidolPlayer?.seekTo(Math.max(0, positionMillis || 0)));
  },
  async getStatusAsync(): Promise<any> {
    try {
      return engineToAvStatus(await engineGetState());
    } catch {
      return engineToAvStatus(null);
    }
  },
  async stopAsync(): Promise<void> {
    await MaidolPlayer?.pause();
    noteState(await MaidolPlayer?.seekTo(0));
  },
  async unloadAsync(): Promise<void> {
    await engineStop('unload');
  },
  setOnPlaybackStatusUpdate(cb: ((status: any) => void) | null): void {
    externalCb = cb;
  },
};

export function isEngineSound(sound: any): boolean {
  return !!sound && sound === engineSound;
}

export type EngineHandlers = {
  onTrackChange: (key: string, reason: string, prevKey: string | null) => void;
  onState: (st: NativePlayerState) => void;
  onEnded: (key: string) => void;
  onError: (e: { key: string; code: string; message: string; http: number; willRetry: boolean }) => void;
  onNeedNext: (from: string) => void;
};

let subs: { remove: () => void }[] = [];
let lastKey: string | null = null;

/** 이벤트 구독(앱 기동 시 1회) — 다시 부르면 이전 구독을 지우고 새로 건다 */
export function initNativeEngine(h: EngineHandlers): void {
  if (!MaidolPlayer) return;
  subs.forEach((s) => { try { s.remove(); } catch {} });
  subs = [
    MaidolPlayer.addListener('onTrackChange', (e) => {
      const prev = lastKey;
      lastKey = e.key || null;
      if (lastState) lastState = { ...lastState, key: e.key };
      try { h.onTrackChange(e.key, e.reason, prev); } catch (err: any) {
        console.warn('[NativePlayer] onTrackChange 처리 오류', { message: err?.message });
      }
    }),
    MaidolPlayer.addListener('onState', (st) => {
      noteState(st);
      try { h.onState(st); } catch (err: any) {
        console.warn('[NativePlayer] onState 처리 오류', { message: err?.message });
      }
    }),
    MaidolPlayer.addListener('onEnded', (e) => {
      try { h.onEnded(e.key); } catch (err: any) {
        console.warn('[NativePlayer] onEnded 처리 오류', { message: err?.message });
      }
    }),
    MaidolPlayer.addListener('onError', (e) => {
      try { h.onError(e); } catch (err: any) {
        console.warn('[NativePlayer] onError 처리 오류', { message: err?.message });
      }
    }),
    MaidolPlayer.addListener('onNeedNext', (e) => {
      try { h.onNeedNext(e.from); } catch (err: any) {
        console.warn('[NativePlayer] onNeedNext 처리 오류', { message: err?.message });
      }
    }),
  ];
  console.warn('[NativePlayer] engine ready');
}
