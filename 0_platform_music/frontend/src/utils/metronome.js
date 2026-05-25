/**
 * Metronome (v44)
 *
 * Schedules short oscillator clicks at provided beat / downbeat times,
 * synchronized with an external "currentTime" feed (e.g. WaveSurfer).
 *
 * Usage:
 *   const m = new Metronome();
 *   m.setBeats(beats, downbeats);
 *   m.setVolume(0.3);
 *   m.start();
 *   // on every audio time tick:
 *   m.tick(currentTime);
 *   m.stop(); // when paused / unmount
 */

const LOOKAHEAD_SEC = 0.1;          // schedule clicks 100ms ahead
const CLICK_DURATION_SEC = 0.05;    // 50ms click
const REGULAR_FREQ = 1200;          // Hz
const DOWNBEAT_FREQ = 800;          // Hz (lower → emphasized)

export class Metronome {
  constructor() {
    this._ctx = null;
    this._gain = null;
    this._beats = [];
    this._downbeatSet = new Set();
    this._scheduled = new Set();    // beat times already scheduled
    this._lastTickTime = -1;
    this._volume = 0.3;
    this._running = false;
  }

  _ensureCtx() {
    if (this._ctx) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this._ctx = new Ctx();
      this._gain = this._ctx.createGain();
      this._gain.gain.value = this._volume;
      this._gain.connect(this._ctx.destination);
    } catch (e) {
      // AudioContext blocked — silently no-op
      this._ctx = null;
    }
  }

  setBeats(beats, downbeats) {
    this._beats = Array.isArray(beats) ? beats.slice().sort((a, b) => a - b) : [];
    this._downbeatSet = new Set(
      Array.isArray(downbeats) ? downbeats.map((t) => Number(t.toFixed(3))) : []
    );
    this._scheduled.clear();
  }

  setVolume(v) {
    const clipped = Math.max(0, Math.min(1, Number(v) || 0));
    this._volume = clipped;
    if (this._gain) this._gain.gain.value = clipped;
  }

  start() {
    this._ensureCtx();
    if (this._ctx && this._ctx.state === 'suspended') {
      this._ctx.resume().catch(() => {});
    }
    this._scheduled.clear();
    this._lastTickTime = -1;
    this._running = true;
  }

  stop() {
    this._running = false;
    this._scheduled.clear();
    this._lastTickTime = -1;
  }

  /**
   * Called frequently (e.g. on audioprocess) with the current playback time.
   * Schedules any clicks within [currentTime, currentTime + LOOKAHEAD_SEC]
   * that haven't already been scheduled.
   */
  tick(currentTime) {
    if (!this._running || !this._ctx) return;
    const t = Number(currentTime);
    if (!Number.isFinite(t)) return;

    // If user scrubbed backwards, clear scheduling memory ahead
    if (this._lastTickTime >= 0 && t + 0.1 < this._lastTickTime) {
      this._scheduled.clear();
    }
    this._lastTickTime = t;

    const horizon = t + LOOKAHEAD_SEC;

    // Linear scan; beats list is small (~hundreds). Could binary-search later.
    for (const beatTime of this._beats) {
      if (beatTime < t - 0.01) continue;     // already past
      if (beatTime > horizon) break;         // future, beyond lookahead

      const key = beatTime.toFixed(3);
      if (this._scheduled.has(key)) continue;
      this._scheduled.add(key);

      const offsetSec = beatTime - t;
      this._scheduleClick(this._ctx.currentTime + Math.max(0, offsetSec), beatTime);
    }
  }

  _scheduleClick(audioCtxTime, beatTime) {
    if (!this._ctx) return;
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
      // ignore scheduling errors (context closed, etc.)
    }
  }

  destroy() {
    this.stop();
    if (this._ctx) {
      try { this._ctx.close(); } catch {}
      this._ctx = null;
      this._gain = null;
    }
  }
}

export default Metronome;
