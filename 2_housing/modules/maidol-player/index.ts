// v3.392 [NativePlayer] 안드로이드 음악 재생 엔진(로컬 Expo 모듈) JS 쪽.
// 네이티브 모듈이 없는 빌드(이전 APK·개발 클라이언트·iOS·웹)에서는 MaidolPlayer = null → 기존 expo-audio 심 경로.
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

export type NativeTrackItem = {
  /** "<트랙 id>#<순번>" */
  key: string;
  url: string;
  title: string;
  artist: string;
  artwork?: string | null;
};

export type NativePlayerState = {
  key: string;
  nextKey: string;
  index: number;
  count: number;
  positionMs: number;
  durationMs: number;
  isPlaying: boolean;
  playWhenReady: boolean;
  state: 'idle' | 'buffering' | 'ready' | 'ended';
  repeatOne: boolean;
};

export type NativePlayerEvents = {
  onTrackChange: (e: { key: string; reason: 'auto' | 'repeat' | 'seek' | 'playlist' }) => void;
  onState: (e: NativePlayerState) => void;
  onEnded: (e: { key: string }) => void;
  onError: (e: { key: string; code: string; message: string; http: number; willRetry: boolean }) => void;
  onNeedNext: (e: { from: string }) => void;
};

type NativeModuleShape = {
  isServiceAlive(): boolean;
  playNow(item: NativeTrackItem, upcoming: NativeTrackItem[], repeatOne: boolean): Promise<NativePlayerState>;
  setUpcoming(upcoming: NativeTrackItem[]): Promise<NativePlayerState>;
  play(): Promise<NativePlayerState>;
  pause(): Promise<NativePlayerState>;
  seekTo(positionMs: number): Promise<NativePlayerState>;
  setRepeatOne(repeatOne: boolean): Promise<void>;
  getState(): Promise<NativePlayerState>;
  stop(): Promise<void>;
  addListener<K extends keyof NativePlayerEvents>(event: K, listener: NativePlayerEvents[K]): { remove: () => void };
};

export const MaidolPlayer: NativeModuleShape | null =
  Platform.OS === 'android' ? requireOptionalNativeModule<NativeModuleShape>('MaidolPlayer') : null;
