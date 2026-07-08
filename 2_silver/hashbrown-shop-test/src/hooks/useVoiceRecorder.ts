import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 녹음 mimeType 선택:
 * - 안드로이드/PC 크롬 등: 'audio/webm;codecs=opus'
 * - iOS Safari: webm 미지원 → 'audio/mp4' (AAC)
 * - 둘 다 미지원: '' (브라우저 기본값에 위임)
 */
function pickRecordingMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
    return 'audio/webm;codecs=opus';
  }
  if (MediaRecorder.isTypeSupported('audio/mp4')) {
    return 'audio/mp4';
  }
  return '';
}

export interface UseVoiceRecorderResult {
  /** 현재 녹음 중인지 */
  isRecording: boolean;
  /** 사용자에게 보여줄 짧은 한국어 에러 메시지 (없으면 null) */
  error: string | null;
  /** 녹음 시작. 성공하면 true, 실패(권한 거부/미지원 등)하면 false + error 상태 설정 */
  start: () => Promise<boolean>;
  /** 녹음 종료. 녹음된 오디오 Blob 반환(녹음 중이 아니면 null). 마이크 트랙도 해제 */
  stop: () => Promise<Blob | null>;
}

/** MediaRecorder 래퍼 훅 — 마이크 녹음 시작/종료 및 Blob 반환 */
export function useVoiceRecorder(): UseVoiceRecorderResult {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const releaseStream = useCallback(() => {
    if (streamRef.current) {
      // 마이크 해제 (브라우저 탭의 녹음 표시등 끄기)
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  // 언마운트 시 녹음/마이크 정리
  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          // 이미 정지된 경우 무시
        }
      }
      recorderRef.current = null;
      releaseStream();
    };
  }, [releaseStream]);

  const start = useCallback(async (): Promise<boolean> => {
    setError(null);

    if (
      typeof MediaRecorder === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      console.error('[useVoiceRecorder] MediaRecorder/getUserMedia 미지원 브라우저');
      setError('이 브라우저는 음성 녹음을 지원하지 않습니다.');
      return false;
    }

    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      console.warn('[useVoiceRecorder] 이미 녹음 중인데 start()가 다시 호출됨');
      return true;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (cause) {
      const name = cause instanceof DOMException ? cause.name : '';
      console.error('[useVoiceRecorder] 마이크 접근 실패:', { name, cause });
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setError('마이크 사용 권한이 필요합니다. 브라우저 설정에서 허용해 주세요.');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setError('마이크를 찾을 수 없습니다.');
      } else {
        setError('마이크를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.');
      }
      return false;
    }

    const mimeType = pickRecordingMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch (cause) {
      console.error('[useVoiceRecorder] MediaRecorder 생성 실패:', { mimeType, cause });
      stream.getTracks().forEach((track) => track.stop());
      setError('음성 녹음을 시작할 수 없습니다.');
      return false;
    }

    chunksRef.current = [];
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };
    recorder.onerror = (event) => {
      console.error('[useVoiceRecorder] 녹음 중 오류:', event);
      setError('녹음 중 오류가 발생했습니다.');
    };

    streamRef.current = stream;
    recorderRef.current = recorder;
    recorder.start();
    setIsRecording(true);
    if (import.meta.env.DEV) {
      console.info('[useVoiceRecorder] 녹음 시작:', {
        requestedMimeType: mimeType || '(브라우저 기본)',
        actualMimeType: recorder.mimeType,
      });
    }
    return true;
  }, []);

  const stop = useCallback((): Promise<Blob | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      console.warn('[useVoiceRecorder] 녹음 중이 아닌데 stop()이 호출됨');
      setIsRecording(false);
      releaseStream();
      return Promise.resolve(null);
    }

    return new Promise<Blob | null>((resolve) => {
      recorder.onstop = () => {
        const type = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        recorderRef.current = null;
        releaseStream();
        setIsRecording(false);
        if (import.meta.env.DEV) {
          console.info('[useVoiceRecorder] 녹음 종료:', {
            size: blob.size,
            mimeType: blob.type,
          });
        }
        resolve(blob);
      };
      try {
        recorder.stop();
      } catch (cause) {
        console.error('[useVoiceRecorder] recorder.stop() 실패:', cause);
        recorderRef.current = null;
        releaseStream();
        setIsRecording(false);
        resolve(null);
      }
    });
  }, [releaseStream]);

  return { isRecording, error, start, stop };
}
