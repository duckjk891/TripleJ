// v3.449 [DiaryAutoBGM] 낙서장 — 화면에 잡힌 낙서의 곡을 후렴부터 자동 미리듣기(오리쟁이 11-20 제안·대표 11-26).
//
// 메인 플레이어와 섞이지 않게 '따로 도는 작은 플레이어' 하나로만 튼다.
//  · 재생목록·이전 곡 기록·재생수(record-play — 메인 store 구독 단일 지점)에 남지 않는다.
//  · 차트 플레이어로 듣던 곡이 있으면 미리듣기 동안 일시정지 → 낙서장을 떠나거나 음소거하면 그 자리부터 이어 재생.
//  · 사용자가 곡을 눌러 메인으로 듣기 시작하면(낙서장 곡·미니플레이어·잠금화면) 미리듣기는 바로 멈추고 이번엔 음소거.
//  · 앱이 뒤로 가면 미리듣기만 멈춤(메인은 그대로), 돌아오면 다시.
// 네이티브 = expo-audio 플레이어(심 nativeAudioShim 의 단일 재생 목록에 넣지 않음 — 메인을 멈추는 건 여기서 직접),
// 웹 = 미리듣기 전용 <audio> 한 개(아이폰 사파리는 한 번 손으로 튼 element 만 이후 자동 재생 허용 → 재사용).
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import api, { BACKEND_BASE_URL, currentAuthToken } from './api';
import { usePlayerStore } from '../stores/playerStore';
import { initialMuted, previewEndSec, previewStartSec, shouldLoopBack, PreviewPref } from '../utils/diaryPreviewLogic';

const PREF_KEY = 'diary_preview_pref_v1';
const FOCUS_DEBOUNCE_MS = 350;

export interface PreviewTrack { id: string | number; title?: string; duration_sec?: number; is_public?: boolean }

interface PreviewState {
  /** 낙서장 소리 꺼짐(음소거) */
  muted: boolean;
  /** 지금 소리 내는 미리듣기(낙서 id·곡 id) */
  activeFeedId: string | null;
  activeTrackId: string | null;
  /** 웹 자동 재생이 막혀 한 번 눌러야 함 */
  blocked: boolean;
}
export const useDiaryPreviewStore = create<PreviewState>(() => ({ muted: true, activeFeedId: null, activeTrackId: null, blocked: false }));
const setUi = (p: Partial<PreviewState>) => useDiaryPreviewStore.setState(p);

// ── 내부 상태 ───────────────────────────────────────────────
let screenActive = false;
let appActive = true;
let pref: PreviewPref = null;
let prefLoaded: Promise<void> | null = null;
let focused: { feedId: string; track: PreviewTrack } | null = null;
let focusTimer: ReturnType<typeof setTimeout> | null = null;
let gen = 0; // 시작 경합 방지(빠른 스크롤)
let resumeMainPending = false; // 미리듣기 때문에 메인을 멈췄나
let selfPausingMain = false;
const chorusCache = new Map<string, number | null>();

const short = (id: unknown) => String(id ?? '').slice(-6);

function loadPref(): Promise<void> {
  if (!prefLoaded) {
    prefLoaded = AsyncStorage.getItem(PREF_KEY)
      .then((v) => { pref = v === 'on' || v === 'off' ? v : null; })
      .catch(() => { pref = null; });
  }
  return prefLoaded;
}
function savePref(v: 'on' | 'off') {
  pref = v;
  AsyncStorage.setItem(PREF_KEY, v).catch(() => {});
}

async function chorusStartOf(trackId: string): Promise<number | null> {
  if (chorusCache.has(trackId)) return chorusCache.get(trackId) ?? null;
  let v: number | null = null;
  try {
    const res = await api.get(`/tracks/${encodeURIComponent(trackId)}/share-video/clip-info`, { timeout: 8000 });
    const c = res.data?.chorus_start;
    v = typeof c === 'number' && Number.isFinite(c) && c >= 0 ? c : null;
  } catch (err: any) {
    // 비공개 곡은 404(공개 곡만 조회) → 곡 길이 30% 지점으로
    if (__DEV__) console.info('[DiaryAutoBGM] 후렴 정보 없음 → 30% 지점', { track: short(trackId), status: err?.response?.status ?? null });
  }
  chorusCache.set(trackId, v);
  return v;
}

function streamUrl(trackId: string): string {
  const token = currentAuthToken();
  const base = `${BACKEND_BASE_URL}/api/tracks/stream-proxy/${encodeURIComponent(trackId)}`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

// ── 메인 플레이어 일시정지·이어 재생 ─────────────────────────
function pauseMainForPreview() {
  const ps = usePlayerStore.getState();
  if (!ps.isPlaying || !ps.sound) return;
  resumeMainPending = true;
  selfPausingMain = true;
  ps.setIsPlaying(false);
  Promise.resolve(ps.sound.pauseAsync()).catch((err: any) => console.warn('[DiaryAutoBGM] 메인 일시정지 실패', { message: err?.message }))
    .finally(() => { selfPausingMain = false; });
  console.info('[DiaryAutoBGM] 듣던 곡 잠시 멈춤', { track: short(ps.track?.id) });
}
function resumeMainIfPaused() {
  if (!resumeMainPending) return;
  resumeMainPending = false;
  const ps = usePlayerStore.getState();
  if (!ps.sound || ps.isPlaying) return;
  // 동기로 먼저 '재생 중' 표시 — 이어서 열리는 낙서 상세(v3.414)가 '듣던 곡 없음'으로 착각해 곡을 갈아 끼우지 않게
  ps.setIsPlaying(true);
  Promise.resolve(ps.sound.playAsync()).catch((err: any) => {
    console.warn('[DiaryAutoBGM] 듣던 곡 이어 재생 실패', { message: err?.message });
    usePlayerStore.getState().setIsPlaying(false);
  });
  console.info('[DiaryAutoBGM] 듣던 곡 이어 재생', { track: short(ps.track?.id) });
}

// ── 플레이어(네이티브 / 웹) ─────────────────────────────────
interface Engine {
  start(url: string, start: number | null, durationHint: number | null, myGen: number): Promise<void>;
  stop(): void;
}

const nativeEngine = (): Engine => {
  let player: any = null;
  let sub: any = null;
  const release = () => {
    const p = player;
    player = null;
    try { sub?.remove(); } catch {}
    sub = null;
    if (!p) return;
    try { p.pause(); } catch {}
    try { p.volume = 0; } catch {} // 아이폰: 소리까지 끈 뒤 해제(remove 만 하면 소리가 남음 — nativeAudioShim 교훈)
    try { p.remove(); } catch {}
  };
  return {
    async start(url, start, durationHint, myGen) {
      release();
      const { createAudioPlayer } = require('expo-audio');
      const p = createAudioPlayer({ uri: url }, { updateInterval: 500 });
      player = p;
      let from = start;
      let seeking = false;
      sub = p.addListener('playbackStatusUpdate', (st: any) => {
        if (player !== p || !st?.isLoaded) return;
        const dur = st.duration > 0 ? st.duration : durationHint;
        if (from === null && dur) {
          from = previewStartSec(null, dur);
          if (from) { seeking = true; p.seekTo(from).catch(() => {}).finally(() => { seeking = false; }); }
          return;
        }
        if (seeking || from === null) return;
        if (st.didJustFinish || shouldLoopBack(st.currentTime || 0, from, dur)) {
          seeking = true;
          p.seekTo(from).catch(() => {}).finally(() => { seeking = false; if (player === p) p.play(); });
        }
      });
      if (from) { try { await p.seekTo(from); } catch {} }
      if (myGen !== gen || player !== p) return;
      p.play();
    },
    stop: release,
  };
};

// 웹: 1초 무음 wav — 손으로 누를 때 element 를 미리 '깨워' 두는 용도
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
let webEl: any = null;
const webAudio = (): any => {
  if (!webEl && typeof document !== 'undefined') {
    webEl = new (window as any).Audio();
    webEl.preload = 'auto';
    (webEl as any).playsInline = true;
  }
  return webEl;
};

const webEngine = (): Engine => {
  let onTime: any = null;
  let onMeta: any = null;
  const detach = () => {
    const el = webEl;
    if (!el) return;
    if (onTime) { el.removeEventListener('timeupdate', onTime); el.removeEventListener('ended', onTime); }
    if (onMeta) el.removeEventListener('loadedmetadata', onMeta);
    onTime = null; onMeta = null;
  };
  return {
    async start(url, start, durationHint, myGen) {
      const el = webAudio();
      if (!el) return;
      detach();
      let from = start;
      el.muted = false;
      el.loop = false;
      el.src = from ? `${url}#t=${from}` : url;
      onMeta = () => {
        const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : durationHint;
        if (from === null && dur) from = previewStartSec(null, dur);
        if (from && Math.abs((el.currentTime || 0) - from) > 1) { try { el.currentTime = from; } catch {} }
      };
      onTime = () => {
        if (from === null) return;
        const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : durationHint;
        if (el.ended || shouldLoopBack(el.currentTime || 0, from, dur)) {
          try { el.currentTime = from; } catch {}
          if (el.paused) el.play().catch(() => {});
        }
      };
      el.addEventListener('loadedmetadata', onMeta);
      el.addEventListener('timeupdate', onTime);
      el.addEventListener('ended', onTime);
      try {
        await el.play();
        if (myGen === gen) setUi({ blocked: false });
      } catch (err: any) {
        if (myGen !== gen) return;
        if (err?.name === 'NotAllowedError') {
          console.info('[DiaryAutoBGM] 웹 자동 재생 막힘 — 소리 버튼을 누르면 재생');
          setUi({ blocked: true, activeFeedId: null, activeTrackId: null });
          resumeMainIfPaused();
        } else if (err?.name !== 'AbortError') {
          console.warn('[DiaryAutoBGM] 웹 재생 실패', { name: err?.name, message: err?.message });
        }
      }
    },
    stop() {
      detach();
      const el = webEl;
      if (!el) return;
      try { el.pause(); } catch {}
      try { el.removeAttribute('src'); el.load(); } catch {}
    },
  };
};

const engine: Engine = Platform.OS === 'web' ? webEngine() : nativeEngine();

// ── 시작·정지 ───────────────────────────────────────────────
function stopPreview(opts: { resumeMain: boolean }) {
  gen++;
  const was = useDiaryPreviewStore.getState().activeTrackId;
  engine.stop();
  setUi({ activeFeedId: null, activeTrackId: null });
  if (was && __DEV__) console.info('[DiaryAutoBGM] 미리듣기 정지', { track: short(was), resumeMain: opts.resumeMain });
  if (opts.resumeMain) resumeMainIfPaused();
}

async function startPreview(feedId: string, track: PreviewTrack) {
  const trackId = String(track.id);
  const myGen = ++gen;
  setUi({ activeFeedId: feedId, activeTrackId: trackId });
  pauseMainForPreview();
  const chorus = await chorusStartOf(trackId);
  if (myGen !== gen) return;
  const dur = typeof track.duration_sec === 'number' && track.duration_sec > 0 ? track.duration_sec : null;
  const start = previewStartSec(chorus, dur);
  console.info('[DiaryAutoBGM] 미리듣기 시작', {
    feed: short(feedId), track: short(trackId), start, chorus: chorus !== null, end: start !== null ? previewEndSec(start, dur) : null,
  });
  try {
    await engine.start(streamUrl(trackId), start, dur, myGen);
  } catch (err: any) {
    console.warn('[DiaryAutoBGM] 미리듣기 실패', { track: short(trackId), message: err?.message });
    if (myGen === gen) setUi({ activeFeedId: null, activeTrackId: null });
  }
}

function canPlay(): boolean {
  const ui = useDiaryPreviewStore.getState();
  return screenActive && appActive && !ui.muted && !ui.blocked; // 웹 막힘이면 버튼을 누를 때까지 다시 시도하지 않음
}

function applyFocus() {
  const ui = useDiaryPreviewStore.getState();
  if (!canPlay() || !focused) {
    if (ui.activeTrackId) stopPreview({ resumeMain: false }); // 곡 없는 낙서로 넘어가면 조용히(메인은 떠날 때 이어 재생)
    return;
  }
  if (ui.activeFeedId === focused.feedId && ui.activeTrackId === String(focused.track.id)) return;
  void startPreview(focused.feedId, focused.track);
}

// ── 공개 API ────────────────────────────────────────────────
export const diaryPreview = {
  /** 낙서장 화면에 들어옴(포커스) */
  async enter() {
    screenActive = true;
    await loadPref();
    if (!screenActive) return;
    const ps = usePlayerStore.getState();
    const muted = initialMuted(pref, !!ps.isPlaying || resumeMainPending);
    setUi({ muted, blocked: false });
    console.info('[DiaryAutoBGM] 낙서장 진입', { muted, pref, mainPlaying: !!ps.isPlaying });
    applyFocus();
  },
  /** 낙서장을 떠남(다른 탭·상세 화면) — 미리듣기 정지 + 듣던 곡 이어 재생 */
  leave() {
    screenActive = false;
    if (focusTimer) { clearTimeout(focusTimer); focusTimer = null; }
    stopPreview({ resumeMain: true });
  },
  /** 화면에 잡힌 낙서(곡 없는 낙서·공지면 track=null) */
  setFocused(feedId: string | null, track: PreviewTrack | null) {
    const next = feedId && track?.id ? { feedId, track } : null;
    if (focused?.feedId === next?.feedId && String(focused?.track.id) === String(next?.track.id)) return;
    focused = next;
    if (focusTimer) clearTimeout(focusTimer);
    focusTimer = setTimeout(() => { focusTimer = null; applyFocus(); }, FOCUS_DEBOUNCE_MS);
  },
  /** 소리 켬/끔 버튼(손으로 누름) */
  toggleMute() {
    const { muted, blocked } = useDiaryPreviewStore.getState();
    if (muted || blocked) {
      if (Platform.OS === 'web') diaryPreview.unlockWeb();
      savePref('on');
      setUi({ muted: false, blocked: false });
      console.info('[DiaryAutoBGM] 소리 켬');
      gen++; // 웹 막힘 뒤 다시 누름 — 같은 곡이라도 새로 시작
      setUi({ activeFeedId: null, activeTrackId: null });
      applyFocus();
    } else {
      savePref('off');
      setUi({ muted: true });
      console.info('[DiaryAutoBGM] 음소거 — 듣던 곡 이어 재생');
      stopPreview({ resumeMain: true });
    }
  },
  /** 사용자가 곡을 눌러 메인으로 들으려 함 — 미리듣기 멈추고 이번엔 음소거(선택 기억은 그대로) */
  yieldToMain() {
    resumeMainPending = false;
    if (useDiaryPreviewStore.getState().activeTrackId) console.info('[DiaryAutoBGM] 메인 재생으로 넘김');
    setUi({ muted: true });
    stopPreview({ resumeMain: false });
  },
  /** 웹: 손으로 누른 순간 미리듣기 element 를 깨워 둔다(아이폰 사파리 자동 재생 허용) */
  unlockWeb() {
    if (Platform.OS !== 'web') return;
    const el = webAudio();
    if (!el || el.src) return;
    try {
      el.muted = true;
      el.src = SILENT_WAV;
      const p = el.play();
      if (p?.then) p.then(() => { if (el.src === SILENT_WAV) { el.pause(); el.removeAttribute('src'); el.muted = false; } }).catch(() => { el.muted = false; });
    } catch {}
  },
};

// 메인 플레이어가 (우리가 아닌 이유로) 재생을 시작하면 미리듣기는 비켜 준다 — 미니플레이어·잠금화면·다른 화면 재생
usePlayerStore.subscribe((s, prev) => {
  if (!s.isPlaying || prev.isPlaying || selfPausingMain) return;
  if (!useDiaryPreviewStore.getState().activeTrackId) return;
  console.info('[DiaryAutoBGM] 메인 재생 시작 감지 → 미리듣기 정지');
  resumeMainPending = false;
  setUi({ muted: true });
  stopPreview({ resumeMain: false });
});

// 앱이 뒤로 가면 미리듣기만 멈춤(메인 그대로·이어 재생 예약 유지), 돌아오면 다시
AppState.addEventListener('change', (st) => {
  const active = st === 'active';
  if (active === appActive) return;
  appActive = active;
  if (!active) {
    if (useDiaryPreviewStore.getState().activeTrackId) stopPreview({ resumeMain: false });
  } else if (screenActive) {
    applyFocus();
  }
});
