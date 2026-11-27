// v3.451 [CreationPreview] 작곡 화면 키·BPM 미리 듣기(오리쟁이 11-25 신고 6b06aa34·대표 11-27).
//
// 앱에 넣어 둔 짧은 소리(assets/sounds/preview, scripts/gen_preview_sounds.py 로 직접 합성 — 외부 전송·생성비 없음)를
// 따로 도는 작은 플레이어 하나로 튼다. 재생목록·재생수와 무관.
//  · 듣던 곡이 있으면 미리 듣기 동안 일시정지 → 끝나거나 멈추면 그 자리부터 이어 재생(diaryPreview 와 같은 방식).
//  · 새로 누르면 앞 소리는 바로 멈추고 새 소리.
// 네이티브 = expo-audio createAudioPlayer, 웹 = <audio> 한 개(손으로 누를 때만 트니 자동 재생 제한 없음).
import { Platform } from 'react-native';
import { Asset } from 'expo-asset';
import { create } from 'zustand';
import { usePlayerStore } from '../stores/playerStore';
import { previewBpm, previewKeyId } from '../utils/creationPreviewLogic';

// Metro 는 정적 require 만 묶는다 — 파일 목록 그대로 나열
const KEY_CLIPS: Record<string, number> = {
  C_major: require('../assets/sounds/preview/key_C_major.mp3'),
  C_minor: require('../assets/sounds/preview/key_C_minor.mp3'),
  D_major: require('../assets/sounds/preview/key_D_major.mp3'),
  D_minor: require('../assets/sounds/preview/key_D_minor.mp3'),
  E_major: require('../assets/sounds/preview/key_E_major.mp3'),
  E_minor: require('../assets/sounds/preview/key_E_minor.mp3'),
  F_major: require('../assets/sounds/preview/key_F_major.mp3'),
  F_minor: require('../assets/sounds/preview/key_F_minor.mp3'),
  G_major: require('../assets/sounds/preview/key_G_major.mp3'),
  G_minor: require('../assets/sounds/preview/key_G_minor.mp3'),
  A_major: require('../assets/sounds/preview/key_A_major.mp3'),
  A_minor: require('../assets/sounds/preview/key_A_minor.mp3'),
  B_major: require('../assets/sounds/preview/key_B_major.mp3'),
  B_minor: require('../assets/sounds/preview/key_B_minor.mp3'),
};
const BPM_CLIPS: Record<number, number> = {
  60: require('../assets/sounds/preview/bpm_60.mp3'),
  65: require('../assets/sounds/preview/bpm_65.mp3'),
  70: require('../assets/sounds/preview/bpm_70.mp3'),
  75: require('../assets/sounds/preview/bpm_75.mp3'),
  80: require('../assets/sounds/preview/bpm_80.mp3'),
  85: require('../assets/sounds/preview/bpm_85.mp3'),
  90: require('../assets/sounds/preview/bpm_90.mp3'),
  95: require('../assets/sounds/preview/bpm_95.mp3'),
  100: require('../assets/sounds/preview/bpm_100.mp3'),
  105: require('../assets/sounds/preview/bpm_105.mp3'),
  110: require('../assets/sounds/preview/bpm_110.mp3'),
  115: require('../assets/sounds/preview/bpm_115.mp3'),
  120: require('../assets/sounds/preview/bpm_120.mp3'),
  125: require('../assets/sounds/preview/bpm_125.mp3'),
  130: require('../assets/sounds/preview/bpm_130.mp3'),
  135: require('../assets/sounds/preview/bpm_135.mp3'),
  140: require('../assets/sounds/preview/bpm_140.mp3'),
  145: require('../assets/sounds/preview/bpm_145.mp3'),
  150: require('../assets/sounds/preview/bpm_150.mp3'),
  155: require('../assets/sounds/preview/bpm_155.mp3'),
  160: require('../assets/sounds/preview/bpm_160.mp3'),
  165: require('../assets/sounds/preview/bpm_165.mp3'),
  170: require('../assets/sounds/preview/bpm_170.mp3'),
  175: require('../assets/sounds/preview/bpm_175.mp3'),
  180: require('../assets/sounds/preview/bpm_180.mp3'),
  185: require('../assets/sounds/preview/bpm_185.mp3'),
  190: require('../assets/sounds/preview/bpm_190.mp3'),
  195: require('../assets/sounds/preview/bpm_195.mp3'),
  200: require('../assets/sounds/preview/bpm_200.mp3'),
};

export function keyClipModule(key: string): number | null {
  const id = previewKeyId(key);
  return id ? KEY_CLIPS[id] ?? null : null;
}
export function bpmClipModule(bpm: number): number | null {
  const b = previewBpm(bpm);
  return b !== null ? BPM_CLIPS[b] ?? null : null;
}

interface PreviewUi {
  /** 지금 소리 나는 미리 듣기('key:C major' / 'bpm:120') */
  playing: string | null;
}
export const useCreationPreviewStore = create<PreviewUi>(() => ({ playing: null }));

let gen = 0;
let resumeMainPending = false;
let nativePlayer: any = null;
let nativeSub: any = null;
let webEl: any = null;

function pauseMain() {
  const ps = usePlayerStore.getState();
  if (!ps.isPlaying || !ps.sound) return;
  resumeMainPending = true;
  ps.setIsPlaying(false);
  Promise.resolve(ps.sound.pauseAsync()).catch((err: any) => console.warn('[CreationPreview] 듣던 곡 일시정지 실패', { message: err?.message }));
}
function resumeMain() {
  if (!resumeMainPending) return;
  resumeMainPending = false;
  const ps = usePlayerStore.getState();
  if (!ps.sound || ps.isPlaying) return;
  ps.setIsPlaying(true);
  Promise.resolve(ps.sound.playAsync()).catch((err: any) => {
    console.warn('[CreationPreview] 듣던 곡 이어 재생 실패', { message: err?.message });
    usePlayerStore.getState().setIsPlaying(false);
  });
}

function releaseEngine() {
  if (Platform.OS === 'web') {
    const el = webEl;
    if (el) {
      el.onended = null;
      try { el.pause(); } catch {}
    }
    return;
  }
  const p = nativePlayer;
  nativePlayer = null;
  try { nativeSub?.remove(); } catch {}
  nativeSub = null;
  if (!p) return;
  try { p.pause(); } catch {}
  try { p.volume = 0; } catch {} // 아이폰: 소리까지 끈 뒤 해제(remove 만 하면 소리가 남음 — nativeAudioShim 교훈)
  try { p.remove(); } catch {}
}

function finished(myGen: number) {
  if (myGen !== gen) return;
  releaseEngine();
  useCreationPreviewStore.setState({ playing: null });
  resumeMain();
}

async function play(tag: string, mod: number | null) {
  if (mod == null) {
    console.warn('[CreationPreview] 미리 듣기 소리 없음', { tag });
    return;
  }
  const myGen = ++gen;
  releaseEngine();
  pauseMain();
  useCreationPreviewStore.setState({ playing: tag });
  console.info('[CreationPreview] 미리 듣기', { tag });
  try {
    if (Platform.OS === 'web') {
      if (!webEl && typeof window !== 'undefined') webEl = new (window as any).Audio();
      const el = webEl;
      if (!el) return;
      el.src = Asset.fromModule(mod).uri;
      el.currentTime = 0;
      el.onended = () => finished(myGen);
      await el.play();
    } else {
      const { createAudioPlayer } = require('expo-audio');
      const p = createAudioPlayer(mod, { updateInterval: 250 });
      nativePlayer = p;
      nativeSub = p.addListener('playbackStatusUpdate', (st: any) => {
        if (nativePlayer === p && st?.didJustFinish) finished(myGen);
      });
      if (myGen !== gen) return;
      p.play();
    }
  } catch (err: any) {
    console.warn('[CreationPreview] 미리 듣기 실패', { tag, name: err?.name, message: err?.message });
    finished(myGen);
  }
}

export const creationPreview = {
  playKey(key: string) { return play(`key:${key}`, keyClipModule(key)); },
  playBpm(bpm: number) {
    const b = previewBpm(bpm);
    return play(`bpm:${b}`, b !== null ? BPM_CLIPS[b] ?? null : null);
  },
  /** 멈춤(다음 단계로 넘어감·화면을 떠남·다시 누름) — 듣던 곡은 이어 재생 */
  stop() {
    if (!useCreationPreviewStore.getState().playing) return;
    gen++;
    releaseEngine();
    useCreationPreviewStore.setState({ playing: null });
    resumeMain();
  },
};
