// [audioMode] 재생 오디오 정책 공통 헬퍼 — v3.57
// ① 재생 시작 시 타 앱(유튜브 등) 오디오를 중단시키고(DoNotMix) 우리 소리가 올라오게 한다.
// ② 무음 스위치(iOS)에서도 재생, 백그라운드 재생 유지.
// ③ 웹에서는 Media Session API로 브라우저/OS 미디어 컨트롤(제목·아티스트·커버·재생버튼)을 노출.
//    네이티브 상단바(잠금화면) 미디어 알림은 expo-av 미지원 — react-native-track-player + EAS 빌드 필요(별도 과제).
import { Platform } from 'react-native';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';

/** 재생 직전에 호출 — 타 앱 소리를 끊고 우리 재생이 전면에 서는 오디오 모드 */
export async function applyPlaybackAudioMode(): Promise<void> {
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      // 타 플랫폼 오디오와 섞지 않음 — 우리가 재생을 시작하면 상대는 pause/포커스 상실
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      shouldDuckAndroid: false,
    });
  } catch (err: any) {
    console.error('[audioMode] setAudioModeAsync 실패', { message: err?.message });
  }
}

export interface MediaSessionMeta {
  title: string;
  artist?: string;
  artworkUrl?: string | null;
}

export interface MediaSessionHandlers {
  play?: () => void;
  pause?: () => void;
  next?: () => void;
  prev?: () => void;
}

/** 웹 전용 — 브라우저/OS 미디어 알림에 곡 정보 표시(안드로이드 크롬은 상단바 알림으로 뜸) */
export function updateMediaSession(meta: MediaSessionMeta, handlers?: MediaSessionHandlers): void {
  if (Platform.OS !== 'web') return;
  try {
    const ms: any = (navigator as any)?.mediaSession;
    if (!ms) return;
    ms.metadata = new (window as any).MediaMetadata({
      title: meta.title,
      artist: meta.artist || 'AIDOL',
      artwork: meta.artworkUrl ? [{ src: meta.artworkUrl, sizes: '512x512', type: 'image/png' }] : [],
    });
    if (handlers) {
      const map: [string, (() => void) | undefined][] = [
        ['play', handlers.play], ['pause', handlers.pause],
        ['nexttrack', handlers.next], ['previoustrack', handlers.prev],
      ];
      for (const [action, fn] of map) {
        try { ms.setActionHandler(action, fn ?? null); } catch {}
      }
    }
    if (__DEV__) console.info('[audioMode] mediaSession 갱신', { title: meta.title });
  } catch (err: any) {
    console.error('[audioMode] mediaSession 실패', { message: err?.message });
  }
}
