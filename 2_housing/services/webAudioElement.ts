// [WebAudio] 웹 전용 단일 HTMLAudioElement 재사용 계층 — v3.217 ①(a)
// expo-av 웹 구현은 곡마다 detached `new Audio()`를 새로 만든다(ExponentAV.web.js:159) —
// iOS 사파리 백그라운드에서 "새 Audio 생성 + XHR 후 play()"는 autoplay 정책에 차단될 수
// 있어, 단일 element를 재사용하고 `ended` 핸들러 안에서 동기 src 교체로 이어재생한다.
// 네이티브는 이 모듈을 전혀 타지 않는다(services/playback.ts createTrackSound 분기 — 무변경).
import { Platform } from 'react-native';

type StatusCallback = ((status: any) => void) | null;
/** 상태 콜백 소유자 — 'playback'=playback.ts makeStatusCallback(스테일 클로저 교체 대상),
 *  'external'=PlayerScreen 등 자체 콜백(스토어 라이브 트랙 참조 — 교체 금지) */
export type WebStatusCbOwner = 'playback' | 'external';

let el: HTMLAudioElement | null = null;
/** 현재 유효 소유 세대 — 구 래퍼의 unload/play가 새 재생을 건드리지 못하게 한다 */
let gen = 0;
let statusCb: StatusCallback = null;
let statusCbOwner: WebStatusCbOwner = 'playback';
/** ended 시 동기 이어재생 훅(playback.ts가 등록) — true 반환 = 처리됨(didJustFinish 미전파) */
let endedHandler: (() => boolean) | null = null;

export function setWebEndedHandler(fn: () => boolean): void {
  endedHandler = fn;
}

export function getWebStatusCbOwner(): WebStatusCbOwner {
  return statusCbOwner;
}

export function setWebStatusCb(cb: StatusCallback, owner: WebStatusCbOwner): void {
  statusCb = cb;
  statusCbOwner = owner;
}

/** expo-av 상태 객체 호환 서브셋 — 기존 onPlaybackStatusUpdate 콜백들이 그대로 소비한다 */
function buildStatus(a: HTMLAudioElement, extra?: Record<string, any>) {
  const durationSec = Number.isFinite(a.duration) ? a.duration : 0;
  return {
    isLoaded: true,
    uri: a.src,
    isPlaying: !a.paused && !a.ended,
    shouldPlay: !a.paused,
    positionMillis: Math.max(0, Math.round((a.currentTime || 0) * 1000)),
    durationMillis: Math.max(0, Math.round(durationSec * 1000)),
    isBuffering: a.readyState < 3,
    didJustFinish: false,
    ...extra,
  };
}

function dispatch(extra?: Record<string, any>): void {
  if (!el || !statusCb) return;
  try {
    statusCb(buildStatus(el, extra));
  } catch (err: any) {
    console.error('[WebAudio] status 콜백 오류', { message: err?.message });
  }
}

function ensureElement(): HTMLAudioElement {
  if (el) return el;
  const audio = document.createElement('audio');
  audio.preload = 'auto';
  audio.setAttribute('playsinline', 'true');
  audio.addEventListener('timeupdate', () => dispatch());
  audio.addEventListener('durationchange', () => dispatch());
  audio.addEventListener('play', () => dispatch());
  audio.addEventListener('pause', () => {
    // ended 직전의 pause는 ended 리스너가 didJustFinish로 처리 — 여기서 중복 전파 금지
    if (!audio.ended) dispatch();
  });
  audio.addEventListener('ended', () => {
    let handled = false;
    try {
      handled = endedHandler ? endedHandler() : false;
    } catch (err: any) {
      console.warn('[WebAudio] ended 핸들러 오류 — didJustFinish 폴백', { message: err?.message });
    }
    if (!handled) dispatch({ didJustFinish: true, isPlaying: false, shouldPlay: false });
  });
  audio.addEventListener('error', () => {
    if (!audio.src) return; // unload로 src를 비운 직후의 무해 이벤트
    const code = (audio.error as any)?.code;
    console.warn('[WebAudio] media error', { code });
    if (statusCb) {
      try {
        statusCb({ isLoaded: false, error: `MediaError code=${code ?? 'unknown'}` });
      } catch {}
    }
  });
  el = audio;
  return audio;
}

/** ended 핸들러 내부 전용 — 동기 src 교체 + play() (autoplay 정책상 비동기 개입 금지) */
export function webSwapSrcAndPlay(url: string): boolean {
  if (!el) return false;
  try {
    if (el.src === url) {
      el.currentTime = 0; // repeat 'one' 등 동일 소스 — 리로드 없이 처음부터
    } else {
      el.src = url;
    }
    const p = el.play();
    if (p && typeof (p as any).catch === 'function') {
      (p as any).catch((err: any) =>
        console.warn('[WebAudio] swap play 거부', { message: err?.message })
      );
    }
    return true;
  } catch (err: any) {
    console.warn('[WebAudio] swap 실패', { message: err?.message });
    return false;
  }
}

/** expo-av Audio.Sound 호환 서브셋 — 단일 element 위 얇은 프록시(세대 가드).
 *  구 래퍼(전 곡)의 unloadAsync가 현재 재생을 죽이지 않도록 current 검사로 무해화한다. */
export class WebTrackSound {
  private myGen: number;
  constructor(myGen: number) {
    this.myGen = myGen;
  }
  private get current(): boolean {
    return this.myGen === gen;
  }

  async playAsync(): Promise<any> {
    if (!this.current || !el) return { isLoaded: false };
    try {
      await el.play();
    } catch (err: any) {
      // autoplay 정책 거부 등 — throw 대신 상태 전파(호출부 UI가 일시정지로 정합화)
      console.warn('[WebAudio] play 거부', { message: err?.message });
      dispatch();
    }
    return buildStatus(el);
  }

  async pauseAsync(): Promise<any> {
    if (!this.current || !el) return { isLoaded: false };
    el.pause();
    return buildStatus(el);
  }

  async stopAsync(): Promise<any> {
    return this.pauseAsync();
  }

  async setPositionAsync(positionMillis: number): Promise<any> {
    if (!this.current || !el) return { isLoaded: false };
    try {
      el.currentTime = Math.max(0, positionMillis) / 1000;
    } catch (err: any) {
      console.warn('[WebAudio] seek 실패', { message: err?.message });
    }
    return buildStatus(el);
  }

  async getStatusAsync(): Promise<any> {
    if (!this.current || !el) return { isLoaded: false };
    return buildStatus(el);
  }

  setOnPlaybackStatusUpdate(cb: ((status: any) => void) | null): void {
    if (!this.current) return;
    // 래퍼 경유 재부착 = PlayerScreen 등 외부 화면 콜백(스토어 라이브 트랙 참조)
    setWebStatusCb(cb, 'external');
  }

  async unloadAsync(): Promise<any> {
    if (!this.current || !el) return { isLoaded: false };
    gen++; // 이 래퍼 포함 전 래퍼 무효화 — 다음 로드가 새 세대를 연다
    try {
      el.pause();
    } catch {}
    try {
      el.removeAttribute('src');
      el.load();
    } catch {}
    statusCb = null;
    return { isLoaded: false };
  }
}

/** 단일 element 로드 — 곡 전환마다 new Audio() 생성 금지(src 교체 재사용) */
export function createWebTrackSound(
  uri: string,
  cb: (status: any) => void,
  owner: WebStatusCbOwner,
  shouldPlay: boolean
): WebTrackSound {
  if (Platform.OS !== 'web') {
    throw new Error('[WebAudio] createWebTrackSound는 웹 전용');
  }
  const audio = ensureElement();
  gen++;
  setWebStatusCb(cb ?? null, owner);
  audio.src = uri;
  if (shouldPlay) {
    const p = audio.play();
    if (p && typeof (p as any).catch === 'function') {
      (p as any).catch((err: any) => {
        console.warn('[WebAudio] 초기 play 거부(autoplay 정책 가능)', { message: err?.message });
        dispatch();
      });
    }
  }
  if (__DEV__) console.info('[WebAudio] load', { gen, owner, shouldPlay });
  return new WebTrackSound(gen);
}
