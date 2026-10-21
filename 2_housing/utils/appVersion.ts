// v3.324 [AppUpdate] 앱 버전 표시·업데이트 판정(대표 확정 2026-10-10: 필수·선택 2단계).
//  · APP_VERSION = app.json version(네이티브 스토어 버전과 같음), WEB_BUILD = 웹 배포 시각(deploy.sh 가
//    EXPO_PUBLIC_WEB_BUILD=YYYYMMDDHHmm KST 로 주입 — 로컬 개발·네이티브는 '').
//  · 판정(순수): 필수 = 네이티브 버전 < min 또는 웹 빌드 < web.min_build. 선택 = 네이티브 버전 < latest 또는 웹 새 번들 감지.
//  · v3.391 [OTA]: APP_BUILD = 설치된 네이티브 빌드 번호(안드로이드 versionCode·iOS CFBundleVersion — EAS 가 빌드마다 +1).
//    같은 버전(1.3.x)으로 빌드를 여러 번 내도 서버 android/ios.min_build·latest_build 로 구분해 안내한다.
//    OTA(EAS Update)로 받은 JS 는 OTA_LABEL(받은 업데이트 생성 시각 MMDDHHmm KST)로 표시해 어떤 업데이트인지 알 수 있게.
import Constants from 'expo-constants';
import { Platform } from 'react-native';

export const APP_VERSION: string = (Constants.expoConfig?.version as string) || '0.0.0';
export const WEB_BUILD: string = (process.env.EXPO_PUBLIC_WEB_BUILD as string) || '';

function readNative<T>(fn: () => T, fallback: T): T {
  if (Platform.OS === 'web') return fallback;
  try { return fn(); } catch { return fallback; }
}

/** 설치된 네이티브 빌드 번호(웹·확인 불가 = 0). expo-application 이 없는 옛 빌드에서도 안전하게 0 */
export const APP_BUILD: number = readNative(() => {
  const app = require('expo-application');
  return parseInt(String(app?.nativeBuildVersion ?? '0'), 10) || 0;
}, 0);

/** 실행 중인 OTA 업데이트 표시(내장 번들 = ''). 생성 시각 KST 'MMDDHHmm' */
export const OTA_LABEL: string = readNative(() => {
  const Updates = require('expo-updates');
  if (!Updates?.isEnabled || Updates.isEmbeddedLaunch || !Updates.createdAt) return '';
  return kstStamp(new Date(Updates.createdAt));
}, '');

/** Date → KST 'MMDDHHmm'(순수) */
export function kstStamp(d: Date): string {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(k.getUTCMonth() + 1)}${p(k.getUTCDate())}${p(k.getUTCHours())}${p(k.getUTCMinutes())}`;
}

/** 화면 표시용 — 'v1.3.1'(대표 10-10 "버전만 보이게": 웹 배포 시각은 표시하지 않고 업데이트 판정에만 사용).
 *  v3.391 앱: 빌드 번호·OTA 를 괄호로 덧붙인다 — 'v1.3.3 (16)' / 'v1.3.3 (16·10211530)'. 문의 때 정확한 판별용. */
export function versionLabel(appVersion: string = APP_VERSION, build: number = APP_BUILD, ota: string = OTA_LABEL): string {
  const extra = [build > 0 ? String(build) : '', ota].filter(Boolean).join('·');
  return extra ? `v${appVersion} (${extra})` : `v${appVersion}`;
}

/** '1.3.1' 비교(순수) — a<b 음수, 같으면 0, a>b 양수. 숫자 아닌 조각은 0 */
export function compareVersions(a: string, b: string): number {
  const pa = String(a || '0').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '0').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** min·latest = 버전 문자열, min_build·latest_build = 빌드 번호(v3.391 — 서버가 아직 안 보내면 버전만 비교) */
export interface NativeVersionConfig {
  min?: string; latest?: string; store_url?: string;
  min_build?: number | string; latest_build?: number | string;
}

export interface VersionConfig {
  web?: { min_build?: string };
  android?: NativeVersionConfig;
  ios?: NativeVersionConfig;
  message?: string;
}

export type UpdateLevel = 'none' | 'soft' | 'force';

/** 업데이트 판정(순수). webNewBundle = 웹에서 배포된 번들이 지금 실행 중인 번들과 다름 */
export function decideUpdate(input: {
  platform: string;
  appVersion: string;
  webBuild: string;
  config: VersionConfig | null;
  webNewBundle?: boolean;
  appBuild?: number;
}): UpdateLevel {
  const { platform, appVersion, webBuild, config } = input;
  if (platform === 'web') {
    const min = config?.web?.min_build || '0';
    if (/^\d{12}$/.test(webBuild) && /^\d{12}$/.test(min) && webBuild < min) return 'force';
    return input.webNewBundle ? 'soft' : 'none';
  }
  const p = platform === 'ios' ? config?.ios : config?.android;
  if (!p) return 'none';
  const build = input.appBuild || 0;
  const minBuild = parseInt(String(p.min_build ?? '0'), 10) || 0;
  const latestBuild = parseInt(String(p.latest_build ?? '0'), 10) || 0;
  if (p.min && compareVersions(appVersion, p.min) < 0) return 'force';
  if (build > 0 && minBuild > 0 && build < minBuild) return 'force';
  if (p.latest && compareVersions(appVersion, p.latest) < 0) return 'soft';
  if (build > 0 && latestBuild > 0 && build < latestBuild) return 'soft';
  return 'none';
}

/** 작업 중 화면 — 업데이트 팝업을 미뤘다가 이 화면을 벗어나면 띄운다(저장 안 된 작업 보호) */
export const UPDATE_BUSY_ROUTES = new Set([
  'Splash', 'LyricsInput', 'LyricsPromptReview', 'LyricsLoading', 'LyricsResult', 'ComposeLyricsPick',
  'MusicGeneration', 'MusicLoading', 'MusicResult', 'ComposerSelect', 'InstLoading',
  'CoverGeneration', 'AlbumCoverGeneration', 'VideoDirector', 'Dialogue',
  'ArtistInput', 'ArtistCody', 'ArtistLoading', 'ArtistResult', 'VoiceCloneWizard', 'FaceVerify',
  'FeedCompose', 'ShareCompose', 'TrackUpload', 'DmChat', 'ClubChat',
]);

/** /app HTML 에서 현재 배포된 웹 번들 이름(AppEntry-해시.js) 추출(순수) */
export function parseBundleName(html: string | null | undefined): string {
  const m = (html || '').match(/AppEntry-[a-f0-9]+\.js/);
  return m ? m[0] : '';
}
