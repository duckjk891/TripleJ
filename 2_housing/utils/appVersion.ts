// v3.324 [AppUpdate] 앱 버전 표시·업데이트 판정(대표 확정 2026-10-10: 필수·선택 2단계).
//  · APP_VERSION = app.json version(네이티브 스토어 버전과 같음), WEB_BUILD = 웹 배포 시각(deploy.sh 가
//    EXPO_PUBLIC_WEB_BUILD=YYYYMMDDHHmm KST 로 주입 — 로컬 개발·네이티브는 '').
//  · 판정(순수): 필수 = 네이티브 버전 < min 또는 웹 빌드 < web.min_build. 선택 = 네이티브 버전 < latest 또는 웹 새 번들 감지.
import Constants from 'expo-constants';
import { Platform } from 'react-native';

export const APP_VERSION: string = (Constants.expoConfig?.version as string) || '0.0.0';
export const WEB_BUILD: string = (process.env.EXPO_PUBLIC_WEB_BUILD as string) || '';

/** 화면 표시용 — 'v1.3.1' / 웹은 'v1.3.1 · 웹 10.10 17:40' */
export function versionLabel(platform: string = Platform.OS, webBuild: string = WEB_BUILD, appVersion: string = APP_VERSION): string {
  const base = `v${appVersion}`;
  if (platform !== 'web' || !/^\d{12}$/.test(webBuild)) return base;
  return `${base} · 웹 ${webBuild.slice(4, 6)}.${webBuild.slice(6, 8)} ${webBuild.slice(8, 10)}:${webBuild.slice(10, 12)}`;
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

export interface VersionConfig {
  web?: { min_build?: string };
  android?: { min?: string; latest?: string; store_url?: string };
  ios?: { min?: string; latest?: string; store_url?: string };
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
}): UpdateLevel {
  const { platform, appVersion, webBuild, config } = input;
  if (platform === 'web') {
    const min = config?.web?.min_build || '0';
    if (/^\d{12}$/.test(webBuild) && /^\d{12}$/.test(min) && webBuild < min) return 'force';
    return input.webNewBundle ? 'soft' : 'none';
  }
  const p = platform === 'ios' ? config?.ios : config?.android;
  if (!p) return 'none';
  if (p.min && compareVersions(appVersion, p.min) < 0) return 'force';
  if (p.latest && compareVersions(appVersion, p.latest) < 0) return 'soft';
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
