// v76 — 브라우저 오디오 녹음 wrapper (MediaRecorder)
// VoiceCloneWizard 에서 사용. 별도 의존성 없음.

const PREFERRED_MIME = 'audio/webm;codecs=opus';

/**
 * 마이크 권한을 요청하고 MediaStream 을 반환합니다.
 * @returns {Promise<MediaStream>}
 */
export async function requestMic() {
  if (!navigator?.mediaDevices?.getUserMedia) {
    const err = new Error('이 브라우저는 마이크 녹음을 지원하지 않습니다.');
    err.code = 'UNSUPPORTED';
    throw err;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (import.meta.env.DEV) {
      console.info('[audioRecorder] requestMic ok', { tracks: stream.getAudioTracks().length });
    }
    return stream;
  } catch (err) {
    console.error('[audioRecorder] requestMic failed', { name: err?.name, message: err?.message });
    throw err;
  }
}

/**
 * 미디어 스트림을 정리합니다 (모든 트랙 stop).
 */
export function releaseStream(stream) {
  try {
    if (!stream) return;
    stream.getTracks().forEach((t) => {
      try { t.stop(); } catch {}
    });
  } catch {}
}

/**
 * 지원되는 MIME 을 자동 탐지합니다.
 */
function pickMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    PREFERRED_MIME,
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  for (const m of candidates) {
    try {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
    } catch {}
  }
  return '';
}

/**
 * AudioRecorder — MediaRecorder wrapper
 *  - start() 호출 후 stop() 시 단일 Blob 반환
 *  - getDurationMs() 로 경과 시간 확인
 */
export class AudioRecorder {
  constructor(stream) {
    if (!stream) throw new Error('AudioRecorder requires a MediaStream');
    this.stream = stream;
    this.mime = pickMime();
    const opts = this.mime ? { mimeType: this.mime } : undefined;
    this.recorder = new MediaRecorder(stream, opts);
    this._chunks = [];
    this._startedAt = 0;
    this._stoppedAt = 0;
    this.ondataavailable = null;

    this.recorder.addEventListener('dataavailable', (e) => {
      if (e?.data && e.data.size > 0) {
        this._chunks.push(e.data);
        if (typeof this.ondataavailable === 'function') {
          try { this.ondataavailable(e.data); } catch {}
        }
      }
    });
  }

  start() {
    this._chunks = [];
    this._startedAt = Date.now();
    this._stoppedAt = 0;
    try {
      this.recorder.start(250); // 250ms timeslice → 안정적 chunk
    } catch (err) {
      console.error('[audioRecorder] start failed', { message: err?.message });
      throw err;
    }
  }

  stop() {
    return new Promise((resolve, reject) => {
      if (!this.recorder) {
        reject(new Error('Recorder not initialized'));
        return;
      }
      const onStop = () => {
        try {
          this._stoppedAt = Date.now();
          const type = this.mime || 'audio/webm';
          const blob = new Blob(this._chunks, { type });
          if (import.meta.env.DEV) {
            console.info('[audioRecorder] stop ok', { bytes: blob.size, type, ms: this.getDurationMs() });
          }
          resolve(blob);
        } catch (err) {
          reject(err);
        }
      };
      this.recorder.addEventListener('stop', onStop, { once: true });
      try {
        if (this.recorder.state !== 'inactive') {
          this.recorder.stop();
        } else {
          // already stopped — resolve from chunks
          onStop();
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  getDurationMs() {
    if (!this._startedAt) return 0;
    const end = this._stoppedAt || Date.now();
    return Math.max(0, end - this._startedAt);
  }

  /** 추정 파일 확장자 (mime → ext) */
  getExtension() {
    const m = this.mime || '';
    if (m.includes('webm')) return 'webm';
    if (m.includes('ogg')) return 'ogg';
    if (m.includes('mp4')) return 'm4a';
    return 'webm';
  }
}

export default AudioRecorder;
