// [NativeAudioShim] v1.3.1 — expo-av Sound 호환 심(expo-audio 기반, 네이티브 전용).
//
// 배경(대표 확정 2026-09-29): 백그라운드 연속재생·잠금화면 컨트롤은 expo-av 로는 불가
// (playback.ts v3.205 주석 "근본 해결은 차기 expo-audio/RNTP 이관"). SDK 54 expo-audio 가
// 백그라운드 재생(shouldPlayInBackground)·잠금화면/미디어 알림(setActiveForLockScreen)을
// 지원하므로, 재생 엔진(playback.ts·PlayerScreen)이 쓰는 expo-av Sound 표면만 이 심으로
// 치환한다. 엔진·스토어·프리로드 스왑 로직은 무변경(시그니처 동일).
//
// 표면(실사용 전수: playAsync/pauseAsync/unloadAsync/setPositionAsync/getStatusAsync/
// setOnPlaybackStatusUpdate + createAsync 상태 콜백 필드 isLoaded/positionMillis/
// durationMillis/isPlaying/didJustFinish/shouldPlay/error).
//
// 한계(정직 기재): Android 는 MediaSession 기반이라 장시간 백그라운드에서 OS 가 프로세스를
// 회수할 수 있다(전용 포그라운드 서비스는 RNTP 영역 — 실기기 검증 후 미흡 시 2차 이관).
// iOS 는 UIBackgroundModes audio + shouldPlayInBackground 로 표준 경로.
import { Platform } from 'react-native';
import {
  createAudioPlayer,
  type AudioPlayer,
  type AudioStatus,
  type AudioMetadata,
} from 'expo-audio';
import { trackCoverUri } from '../utils/coverUri';

export interface AvLikeStatus {
  isLoaded: boolean;
  positionMillis: number;
  durationMillis?: number;
  isPlaying: boolean;
  didJustFinish: boolean;
  shouldPlay: boolean;
  isBuffering?: boolean;
  error?: string;
}

/** expo-audio AudioStatus → expo-av 콜백 셰이프 (초→ms). 순수 함수 — 하니스 검증 대상 */
export function toAvStatus(st: {
  isLoaded: boolean;
  currentTime: number;
  duration: number;
  playing: boolean;
  didJustFinish: boolean;
  isBuffering?: boolean;
}): AvLikeStatus {
  return {
    isLoaded: !!st.isLoaded,
    positionMillis: Math.max(0, Math.round((st.currentTime || 0) * 1000)),
    durationMillis: st.duration > 0 ? Math.round(st.duration * 1000) : undefined,
    isPlaying: !!st.playing,
    didJustFinish: !!st.didJustFinish,
    shouldPlay: !!st.playing,
    isBuffering: !!st.isBuffering,
  };
}

/** 잠금화면 메타 소유자 — 마지막으로 play 된 심(동시 1개 전제: 엔진이 단일 재생 보장) */
let activeShim: NativeShimSound | null = null;

// v3.392 [NativePlayer] 단일 재생 안전장치(아이폰·옛 안드로이드 경로): 살아 있는 심 전부를 기억해
// ① 하나가 재생을 시작하면 나머지는 멈추고 ② 미니플레이어 닫기 때 전부 정리한다.
// 원인(대표 10-21 실측 '다음 누르면 겹침·닫아도 계속 재생'): 재생 화면·미니가 각자 사운드를 만들어
// 연타·전환 경합 때 store 가 모르는 사운드가 남았다(그 소리는 닫기로도 안 꺼짐).
const liveShims = new Set<NativeShimSound>();

/** 살아 있는 심 전부 정지·해제(미니플레이어 닫기) — 반환: 정리한 개수 */
export function stopAllNativeShims(reason: string): number {
  const all = Array.from(liveShims);
  all.forEach((sh) => { sh.unloadAsync().catch(() => {}); });
  if (all.length) console.warn('[NativePlayer] 심 전부 정리', { reason, count: all.length });
  return all.length;
}
let lockScreenTrack: { title?: string; artist?: string; artUrl?: string | null } | null = null;

function applyLockScreen(shim: NativeShimSound | null): void {
  if (!shim || !lockScreenTrack) return;
  try {
    const meta: AudioMetadata = {
      title: lockScreenTrack.title || 'MAIDOL',
      artist: lockScreenTrack.artist || 'MAIDOL',
      ...(lockScreenTrack.artUrl ? { artworkUrl: lockScreenTrack.artUrl } : {}),
    };
    shim.player.setActiveForLockScreen(true, meta, { showSeekBackward: false, showSeekForward: false });
    if (__DEV__) console.info('[NativeAudio] 잠금화면 메타 적용', { title: meta.title });
  } catch (err: any) {
    console.warn('[NativeAudio] 잠금화면 적용 실패(무해)', { message: err?.message });
  }
}

/** playback.ts 트랙 구독이 호출 — 현재 곡 잠금화면 메타 동기화(웹 mediaSession 동형) */
export function syncNativeLockScreen(track: any): void {
  if (Platform.OS === 'web' || !track) return;
  lockScreenTrack = {
    title: track.title || 'MAIDOL',
    artist: track.artist_name || track.uploader_nickname || 'MAIDOL',
    artUrl: trackCoverUri(track),
  };
  applyLockScreen(activeShim);
}

export class NativeShimSound {
  player: AudioPlayer;
  private cb: ((status: AvLikeStatus) => void) | null = null;
  private sub: { remove: () => void } | null = null;
  private removed = false;
  private lastStatus: AvLikeStatus = {
    isLoaded: false, positionMillis: 0, isPlaying: false,
    didJustFinish: false, shouldPlay: false,
  };

  private constructor(player: AudioPlayer) {
    this.player = player;
    liveShims.add(this);
    this.sub = player.addListener('playbackStatusUpdate', (st: AudioStatus) => {
      const av = toAvStatus(st as any);
      this.lastStatus = av;
      try {
        this.cb?.(av);
      } catch (err: any) {
        console.error('[NativeAudio] 상태 콜백 오류', { message: err?.message });
      }
    });
  }

  /** expo-av Audio.Sound.createAsync 호환 팩토리 */
  static async createAsync(
    source: { uri: string } | number,
    initialStatus?: { shouldPlay?: boolean; positionMillis?: number },
    onStatus?: ((status: AvLikeStatus) => void) | null,
  ): Promise<{ sound: NativeShimSound }> {
    const player = createAudioPlayer(source as any, { updateInterval: 500 });
    const shim = new NativeShimSound(player);
    if (onStatus) shim.cb = onStatus;
    if (initialStatus?.positionMillis) {
      try { await player.seekTo(initialStatus.positionMillis / 1000); } catch {}
    }
    if (initialStatus?.shouldPlay) {
      shim.play();
    }
    if (__DEV__) {
      console.info('[NativeAudio] createAsync', {
        src: typeof source === 'number' ? 'asset' : String((source as any)?.uri || '').slice(-32),
        shouldPlay: !!initialStatus?.shouldPlay,
      });
    }
    return { sound: shim };
  }

  private play(): void {
    // v3.392: 다른 심이 소리를 내고 있으면 멈춘다(겹침 방지 — 프리로드 스왑·연타 경합 공통)
    liveShims.forEach((o) => {
      if (o === this) return;
      try {
        if (o.player.playing) {
          o.player.pause();
          console.warn('[NativePlayer] 단일 재생 — 겹친 소리 정지');
        }
      } catch {}
    });
    this.player.play();
    activeShim = this;
    applyLockScreen(this);
  }

  setOnPlaybackStatusUpdate(cb: ((status: AvLikeStatus) => void) | null): void {
    this.cb = cb;
  }

  async playAsync(): Promise<void> { this.play(); }
  async pauseAsync(): Promise<void> { try { this.player.pause(); } catch {} }
  async setPositionAsync(positionMillis: number): Promise<void> {
    try { await this.player.seekTo(Math.max(0, positionMillis) / 1000); } catch {}
  }
  async getStatusAsync(): Promise<AvLikeStatus> {
    try {
      const p = this.player;
      return toAvStatus({
        isLoaded: p.isLoaded, currentTime: p.currentTime, duration: p.duration,
        playing: p.playing, didJustFinish: false, isBuffering: p.isBuffering,
      } as any);
    } catch {
      return this.lastStatus;
    }
  }
  async unloadAsync(): Promise<void> {
    if (this.removed) return;
    this.removed = true;
    liveShims.delete(this);
    // v3.392: remove 전에 먼저 멈춘다(잠금화면 컨트롤이 붙은 플레이어가 remove 후에도 소리 내던 경우 방어)
    try { this.player.pause(); } catch {}
    try { this.sub?.remove(); } catch {}
    this.sub = null;
    this.cb = null;
    if (activeShim === this) {
      try { this.player.clearLockScreenControls(); } catch {}
      activeShim = null;
    }
    try { this.player.remove(); } catch (err: any) {
      console.warn('[NativeAudio] remove 실패(무해)', { message: err?.message });
    }
  }
  /** 프리로드(shouldPlay:false) 사운드 스왑 재생 경로가 stopAsync 를 부를 가능성 방어 */
  async stopAsync(): Promise<void> { try { this.player.pause(); await this.player.seekTo(0); } catch {} }
}
