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
// v3.272 → v3.275 [BGWeb-Net]: 미디어 에러 복구 — 네트워크 단절 내성 재시도.
// 재진단(10-04, 배포 후 로그): 끊김의 실체는 "곡 경계의 순간 단절"(백그라운드 네트워크 차단·Wi-Fi↔LTE
// 핸드오버)로 다음 곡 로드가 MediaError code 4 가 되는 것. v3.272 복구 3종은 이 경우 전부 불발이었다:
//  (a) 자동 스왑이 이미 proxy 라 `src !== recover` 가드에 걸려 복구 0회 실행(실측 code4 5건 전부)
//  (b) 에러 콜백이 isPlaying=false 로 만들어 복귀(visibility) 재로드 분기 진입 불가
//  (c) 건너뛰기 판정이 네트워크 실패 시 그대로 정지 / 200 이면 멀쩡한 곡을 건너뜀
// 조치: 같은 곡을 캐시버스터 붙여 백오프 재시도(즉시→2→5→10→20→30s…, 최대 10분) + online 이벤트 즉시
// 재시도. 재시도 중에는 에러를 `retrying:true` 로만 전파(일시정지·건너뛰기 금지 — 4xx 확정만 예외).
// 복구 URL 공급자(playback.ts 등록): 현재 스토어 트랙의 결정적 proxy URL(없으면 null).
let errorRecoveryUrlProvider: (() => string | null) | null = null;
const ERROR_RETRY_DELAYS_MS = [0, 2000, 5000, 10000, 20000, 30000]; // 이후 30s 반복
const ERROR_RETRY_MAX_MS = 10 * 60 * 1000;
interface ErrorRetryState { baseUrl: string; expectSrc: string; attempts: number; startedAt: number; timer: any; resumeAt: number }
let errorRetry: ErrorRetryState | null = null;
/** 재생 의도 — 로드/스왑/play 로 true, 사용자 일시정지·해제로 false. 복귀 복구가 store.isPlaying 대신 참조 */
let playIntent = false;

const stripRetryBuster = (u: string) => u.replace(/([?&])r=\d+(&|$)/, (_m, a, b) => (b ? a : '')).replace(/[?&]$/, '');

function cancelErrorRetry(reason: string): void {
  if (!errorRetry) return;
  clearTimeout(errorRetry.timer);
  if (errorRetry.attempts > 0) console.warn('[WebAudio] 재시도 취소', { reason, attempts: errorRetry.attempts });
  errorRetry = null;
}

/** 외부(건너뛰기 확정 등)에서 재시도 중단 */
export function webCancelErrorRetry(reason: string): void {
  cancelErrorRetry(reason);
}

export function webIsErrorRetrying(): boolean {
  return !!errorRetry;
}

function fireErrorRetry(why: string): void {
  const st = errorRetry;
  if (!st || !el) return;
  clearTimeout(st.timer);
  // 그 사이 다른 로드/해제가 src 를 바꿨으면 이 재시도는 무효
  if (el.src !== st.expectSrc) {
    cancelErrorRetry('src-changed');
    return;
  }
  const url = st.baseUrl + (st.baseUrl.includes('?') ? '&' : '?') + 'r=' + Date.now();
  console.warn('[WebAudio] 재시도', { why, attempt: st.attempts, online: typeof navigator !== 'undefined' ? navigator.onLine : null });
  try {
    el.src = url;
    st.expectSrc = el.src;
    if (st.resumeAt > 0) {
      const at = st.resumeAt;
      const target = el;
      const onMeta = () => {
        target.removeEventListener('loadedmetadata', onMeta);
        try { if (target.src === st.expectSrc) target.currentTime = at; } catch {}
      };
      target.addEventListener('loadedmetadata', onMeta);
    }
    const p = el.play();
    if (p && typeof (p as any).catch === 'function') {
      (p as any).catch((e: any) => {
        // NotSupportedError(로드 실패)는 error 이벤트가 다음 재시도를 잡는다 — 그 외만 기록
        if (e?.name !== 'NotSupportedError' && e?.name !== 'AbortError') {
          console.warn('[WebAudio] 재시도 play 거부', { name: e?.name, message: e?.message });
        }
      });
    }
  } catch (e: any) {
    console.warn('[WebAudio] 재시도 실행 실패', { message: e?.message });
  }
}

/** 재시도 대기 중이면 즉시 실행(online 복귀·탭 복귀·재생버튼) — 실행했으면 true */
export function webRetryNow(why: string): boolean {
  if (!errorRetry) return false;
  fireErrorRetry(why);
  return true;
}

function handleMediaError(audio: HTMLAudioElement): void {
  const code = (audio.error as any)?.code;
  const vis = typeof document !== 'undefined' ? document.visibilityState : null;
  const online = typeof navigator !== 'undefined' ? navigator.onLine : null;
  console.warn('[WebAudio] media error', {
    code, msg: String((audio.error as any)?.message || '').slice(0, 80), vis, online,
    srcKind: audio.src.includes('/stream-proxy/') ? 'proxy' : 'presigned',
  });
  const errText = `MediaError code=${code ?? 'unknown'}`;
  let target: string | null = null;
  try { target = errorRecoveryUrlProvider ? errorRecoveryUrlProvider() : null; } catch { target = null; }
  if (!target) target = stripRetryBuster(audio.src);
  const now = Date.now();
  if (!errorRetry || errorRetry.baseUrl !== target) {
    if (errorRetry) clearTimeout(errorRetry.timer);
    // 곡 중간 단절(code 2 등)이면 끊긴 위치 기억 — 재시도 성공 시 처음이 아니라 그 자리에서 이어 재생
    const pos = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    errorRetry = { baseUrl: target, expectSrc: audio.src, attempts: 0, startedAt: now, timer: null, resumeAt: pos > 1 ? pos : 0 };
  } else {
    errorRetry.expectSrc = audio.src;
  }
  const st = errorRetry;
  if (!playIntent || now - st.startedAt > ERROR_RETRY_MAX_MS) {
    // 재생 의도 없음(사용자 정지) 또는 10분 소진 — 최종 에러 전파(기존 정지·건너뛰기 경로)
    console.warn('[WebAudio] 재시도 종료 — 최종 에러 전파', { attempts: st.attempts, intent: playIntent });
    cancelErrorRetry('give-up');
    if (statusCb) { try { statusCb({ isLoaded: false, error: errText }); } catch {} }
    return;
  }
  st.attempts++;
  const delay = ERROR_RETRY_DELAYS_MS[Math.min(st.attempts - 1, ERROR_RETRY_DELAYS_MS.length - 1)];
  st.timer = setTimeout(() => fireErrorRetry('timer'), delay);
  // 즉시 재시도까지 실패한 시점(2회째)에 1회만 통지 — 삭제곡(4xx) 판정·건너뛰기는 앱 쪽이 수행,
  // 네트워크 문제면 앱은 아무것도 하지 않고 이 재시도 루프가 계속 돈다.
  if (st.attempts === 2 && statusCb) {
    try { statusCb({ isLoaded: false, error: errText, retrying: true }); } catch {}
  }
}

export function setWebErrorRecoveryProvider(fn: (() => string | null) | null): void {
  errorRecoveryUrlProvider = fn;
}

// ── v3.235 B6: 자동재생 차단 상태 — 링크 진입(사용자 활성화 없음) 초기 play() 가 NotAllowedError 로
// 거부되면 true. 구독자(PlayerScreen)가 '탭해서 듣기' 오버레이를 띄우고, 탭 핸들러 안에서
// resumeWebPlaybackFromGesture() 로 **동기** el.play() 를 호출한다(iOS 제스처 요건 — await/setTimeout 금지).
// 'play' 이벤트(어떤 경로든 재생 시작)·새 로드·unload 시 false 로 해제.
let autoplayBlocked = false;
const autoplayListeners = new Set<(blocked: boolean) => void>();

function setAutoplayBlocked(v: boolean): void {
  if (autoplayBlocked === v) return;
  autoplayBlocked = v;
  for (const fn of Array.from(autoplayListeners)) {
    try {
      fn(v);
    } catch (err: any) {
      console.error('[WebAudio] autoplay 구독 콜백 오류', { message: err?.message });
    }
  }
}

/** 초기 play() 거부가 자동재생 정책(사용자 활성화 없음) 때문인지 — 순수 */
export function isAutoplayPolicyError(err: any): boolean {
  return String(err?.name || '') === 'NotAllowedError';
}

export function isWebAutoplayBlocked(): boolean {
  return autoplayBlocked;
}

/** 구독 — 해제 함수 반환(useEffect cleanup 용) */
export function subscribeWebAutoplayBlocked(fn: (blocked: boolean) => void): () => void {
  autoplayListeners.add(fn);
  return () => {
    autoplayListeners.delete(fn);
  };
}

/**
 * 사용자 탭 핸들러 안에서 호출 — 단일 element 에 동기 play()(v3.217 단일 element 유지, 새 element 생성 0).
 * 반환 = play() 호출 여부(element 없음·src 없음이면 false). 거부되면 차단 상태 유지(오버레이 잔존).
 */
export function resumeWebPlaybackFromGesture(): boolean {
  if (Platform.OS !== 'web' || !el || !el.getAttribute('src')) return false;
  try {
    const p = el.play(); // ← 동기 호출(제스처 안). 이 앞에 await 를 두지 말 것
    if (p && typeof (p as any).then === 'function') {
      (p as any).then(
        () => setAutoplayBlocked(false),
        (err: any) => {
          console.warn('[WebAudio] 제스처 play 거부', { name: err?.name, message: err?.message });
          dispatch();
        }
      );
    } else {
      setAutoplayBlocked(false);
    }
    return true;
  } catch (err: any) {
    console.warn('[WebAudio] 제스처 play 실패', { message: err?.message });
    return false;
  }
}

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
  audio.addEventListener('playing', () => {
    // v3.275: 실제 재생 시작 = 재시도 성공 종료
    if (errorRetry) {
      console.warn('[WebAudio] 재시도 성공 — 재생 재개', { attempts: errorRetry.attempts, tookMs: Date.now() - errorRetry.startedAt });
      clearTimeout(errorRetry.timer);
      errorRetry = null;
    }
  });
  audio.addEventListener('play', () => {
    setAutoplayBlocked(false); // v3.235 B6: 어떤 경로로든 재생 시작 = 차단 해제(오버레이 닫힘)
    dispatch();
  });
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
    handleMediaError(audio);
  });
  // v3.275: 네트워크 복귀 즉시 재시도(백오프 대기 단축) + 수명주기 계측
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      if (errorRetry) fireErrorRetry('online');
    });
  }
  el = audio;
  return audio;
}

/** ended 핸들러 내부 전용 — 동기 src 교체 + play() (autoplay 정책상 비동기 개입 금지) */
export function webSwapSrcAndPlay(url: string): boolean {
  if (!el) return false;
  cancelErrorRetry('swap');
  playIntent = true;
  try {
    if (el.src === url) {
      el.currentTime = 0; // repeat 'one' 등 동일 소스 — 리로드 없이 처음부터
    } else {
      el.src = url;
    }
    const p = el.play();
    if (p && typeof (p as any).catch === 'function') {
      (p as any).catch((err: any) => {
        console.warn('[WebAudio] swap play 거부', { name: err?.name, message: err?.message });
        // v3.271 [BGWeb]: AbortError = load/교체 경합 — 의도는 재생이므로 짧게 1회 재시도
        if (err?.name === 'AbortError' && el) {
          setTimeout(() => {
            el?.play().catch((e2: any) =>
              console.warn('[WebAudio] swap 재시도 실패', { name: e2?.name, message: e2?.message }));
          }, 120);
        }
      });
    }
    return true;
  } catch (err: any) {
    console.warn('[WebAudio] swap 실패', { message: err?.message });
    return false;
  }
}

/**
 * v3.271 [BGWeb] — 탭 복귀 시 멈춘 재생 복구(대표 지적 "웹 백그라운드 끊김").
 * iOS 사파리는 백그라운드에서 페이지 JS를 통째로 얼린다(원격 로그 실측: 멈춤 시점에
 * 에러 라인조차 없음). 완전 해결은 네이티브(v1.3.1) 영역이고, 웹에서 가능한 복구는
 * "깨어난 순간"뿐이다: ① 곡이 얼림 중 끝나 있으면(ended) 체인 핸들러를 수동 트리거해
 * 다음 곡으로, ② 의도는 재생인데 paused 로 깨어났으면 같은 element 에 play() 재시도
 * (과거 제스처로 활성화된 element — iOS 가 대체로 허용. 거부 시 상태만 전파).
 * 반환: 'advanced' | 'resumed' | 'denied' | 'noop'.
 */
export function webResumeIfStalled(wantPlaying: boolean): 'advanced' | 'resumed' | 'denied' | 'noop' {
  if (!el || !el.src) return 'noop';
  if (el.ended) {
    let handled = false;
    try {
      handled = endedHandler ? endedHandler() : false;
    } catch (err: any) {
      console.warn('[WebAudio] 복귀 ended 핸들러 오류', { message: err?.message });
    }
    console.warn('[WebAudio] 복귀 — 얼림 중 곡 종료 감지', { handled });
    if (handled) return 'advanced';
    dispatch({ didJustFinish: true, isPlaying: false, shouldPlay: false });
    return 'advanced';
  }
  // v3.275: 재시도 대기 중이면 즉시 실행(백그라운드 타이머 지연 보정)
  if (errorRetry) {
    fireErrorRetry('visible');
    return 'resumed';
  }
  // v3.275: store.isPlaying 은 에러 콜백이 false 로 만들 수 있어(구 (b) 결함) 재생 의도 플래그를 함께 본다
  const want = wantPlaying || playIntent;
  if (el.error && want) {
    // 에러 상태로 깨어남(재시도 소진 등) → 새 재시도 사이클 시작
    console.warn('[WebAudio] 복귀 — 에러 상태 재시도 재개');
    handleMediaError(el);
    return 'resumed';
  }
  if (want && el.paused) {
    const p = el.play();
    if (p && typeof (p as any).catch === 'function') {
      (p as any).catch((err: any) => {
        console.warn('[WebAudio] 복귀 재개 거부', { name: err?.name, message: err?.message });
        dispatch(); // UI 를 실제 상태(일시정지)로 정합화
      });
    }
    console.warn('[WebAudio] 복귀 — 재생 재개 시도');
    return 'resumed';
  }
  return 'noop';
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
    playIntent = true;
    // v3.275: 에러 상태에서의 재생버튼 = 즉시 재시도(대기 중이면 당기고, 소진됐으면 새 사이클)
    if (errorRetry) { fireErrorRetry('play-button'); return buildStatus(el); }
    if (el.error && el.src) { handleMediaError(el); return buildStatus(el); }
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
    playIntent = false; // 사용자 일시정지 — 재시도 루프가 뒤늦게 재생을 되살리지 않게
    cancelErrorRetry('pause');
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
    playIntent = false;
    cancelErrorRetry('unload');
    setAutoplayBlocked(false); // v3.235 B6: 곡 해제 — 이전 곡 차단 표시 잔존 방지
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
  const loadGen = gen;
  setWebStatusCb(cb ?? null, owner);
  setAutoplayBlocked(false); // v3.235 B6: 새 로드 — 판정 초기화
  cancelErrorRetry('new-load'); // v3.275: 이전 곡 재시도 무효
  playIntent = !!shouldPlay;
  audio.src = uri;
  if (shouldPlay) {
    const p = audio.play();
    if (p && typeof (p as any).catch === 'function') {
      (p as any).catch((err: any) => {
        console.warn('[WebAudio] 초기 play 거부(autoplay 정책 가능)', { name: err?.name, message: err?.message });
        // v3.235 B6: 자동재생 정책 거부만 차단 상태로(곡 전환으로 인한 AbortError 등 제외·구세대 무시)
        if (loadGen === gen && isAutoplayPolicyError(err)) setAutoplayBlocked(true);
        dispatch();
      });
    }
  }
  if (__DEV__) console.info('[WebAudio] load', { gen, owner, shouldPlay });
  return new WebTrackSound(gen);
}
