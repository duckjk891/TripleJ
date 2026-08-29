/**
 * [Metronome] v3.97(A-9) — MAIDOL utils/metronome.js(v44) 이식.
 * WebAudio 오실레이터로 비트/다운비트 클릭을 합성 재생(별도 사운드 에셋 없음).
 * → AudioContext가 있는 웹에서만 동작. 네이티브(iOS/Android)에는 WebAudio가 없고
 *   클릭 에셋도 없어 구조상 불가 — isMetronomeSupported()로 노출 여부를 판단하고
 *   미지원 환경에서는 전체가 조용히 no-op 된다.
 *
 * 사용(BeatTrackView):
 *   const m = new Metronome();
 *   m.setBeats(beats, downbeats);  // 초 단위 배열
 *   m.setVolume(0.3);
 *   m.start();
 *   m.tick(currentTimeSec);        // 재생 위치 틱마다 호출 — 룩어헤드 내 클릭 예약
 *   m.stop(); m.destroy();
 */

// MAIDOL은 audioprocess(고빈도) 기준 0.1s 룩어헤드.
// AIDOL은 100ms 인터벌 틱이라 빈틈이 없도록 0.15s로 여유를 둔다.
const LOOKAHEAD_SEC = 0.15;
const CLICK_DURATION_SEC = 0.05;
const REGULAR_FREQ = 1200; // Hz
const DOWNBEAT_FREQ = 800; // Hz (낮은 음 → 강조)

type AnyAudioContext = AudioContext;

function getAudioContextCtor(): (new () => AnyAudioContext) | null {
  const g = globalThis as any;
  return g?.AudioContext || g?.webkitAudioContext || null;
}

export const isMetronomeSupported = (): boolean => !!getAudioContextCtor();

export class Metronome {
  private _ctx: AnyAudioContext | null = null;
  private _gain: GainNode | null = null;
  private _beats: number[] = [];
  private _downbeatSet: Set<number> = new Set();
  private _scheduled: Set<string> = new Set(); // 이미 예약한 비트 시각
  private _lastTickTime = -1;
  private _volume = 0.3;
  private _running = false;

  private _ensureCtx(): void {
    if (this._ctx) return;
    try {
      const Ctor = getAudioContextCtor();
      if (!Ctor) return; // 네이티브 등 미지원 — no-op
      this._ctx = new Ctor();
      this._gain = this._ctx.createGain();
      this._gain.gain.value = this._volume;
      this._gain.connect(this._ctx.destination);
    } catch {
      // AudioContext 차단 — 조용히 no-op
      this._ctx = null;
      this._gain = null;
    }
  }

  setBeats(beats: number[], downbeats: number[]): void {
    this._beats = Array.isArray(beats) ? beats.slice().sort((a, b) => a - b) : [];
    this._downbeatSet = new Set(
      Array.isArray(downbeats) ? downbeats.map((t) => Number(t.toFixed(3))) : []
    );
    this._scheduled.clear();
  }

  setVolume(v: number): void {
    const clipped = Math.max(0, Math.min(1, Number(v) || 0));
    this._volume = clipped;
    if (this._gain) this._gain.gain.value = clipped;
  }

  start(): void {
    this._ensureCtx();
    if (this._ctx && this._ctx.state === 'suspended') {
      this._ctx.resume().catch(() => {});
    }
    this._scheduled.clear();
    this._lastTickTime = -1;
    this._running = true;
  }

  stop(): void {
    this._running = false;
    this._scheduled.clear();
    this._lastTickTime = -1;
  }

  /** 재생 위치(초)를 자주 넘겨주면 룩어헤드 구간의 클릭을 예약한다. */
  tick(currentTime: number): void {
    if (!this._running || !this._ctx) return;
    const t = Number(currentTime);
    if (!Number.isFinite(t)) return;

    // 뒤로 스크럽하면 예약 기억을 초기화
    if (this._lastTickTime >= 0 && t + 0.1 < this._lastTickTime) {
      this._scheduled.clear();
    }
    this._lastTickTime = t;

    const horizon = t + LOOKAHEAD_SEC;

    // 선형 스캔 — 비트 배열은 수백 개 수준이라 충분히 저렴
    for (const beatTime of this._beats) {
      if (beatTime < t - 0.01) continue; // 이미 지난 비트
      if (beatTime > horizon) break;     // 룩어헤드 밖 미래

      const key = beatTime.toFixed(3);
      if (this._scheduled.has(key)) continue;
      this._scheduled.add(key);

      const offsetSec = beatTime - t;
      this._scheduleClick(this._ctx.currentTime + Math.max(0, offsetSec), beatTime);
    }
  }

  private _scheduleClick(audioCtxTime: number, beatTime: number): void {
    if (!this._ctx || !this._gain) return;
    try {
      const isDownbeat = this._downbeatSet.has(Number(beatTime.toFixed(3)));
      const osc = this._ctx.createOscillator();
      const env = this._ctx.createGain();

      osc.type = 'square';
      osc.frequency.value = isDownbeat ? DOWNBEAT_FREQ : REGULAR_FREQ;

      env.gain.setValueAtTime(0, audioCtxTime);
      env.gain.linearRampToValueAtTime(1, audioCtxTime + 0.005);
      env.gain.linearRampToValueAtTime(0, audioCtxTime + CLICK_DURATION_SEC);

      osc.connect(env);
      env.connect(this._gain);

      osc.start(audioCtxTime);
      osc.stop(audioCtxTime + CLICK_DURATION_SEC + 0.02);
    } catch {
      // 예약 실패(컨텍스트 종료 등) 무시
    }
  }

  destroy(): void {
    this.stop();
    if (this._ctx) {
      try { this._ctx.close().catch(() => {}); } catch {}
      this._ctx = null;
      this._gain = null;
    }
  }
}

export default Metronome;
