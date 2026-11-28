// v3.452 [AuthBrowser] 안드로이드 로그인·본인확인 창 열기 옵션.
//  문제(11-28): 기본 브라우저가 삼성 인터넷인 폰에서 카카오 로그인·본인확인 창이 열리자마자 1초 안에 앱으로 돌아옴
//   → 서버 콜백 0건. expo-web-browser 는 안드로이드에서 '앱이 다시 앞으로 오면 = 창 닫힘'으로 보는데,
//   기본값(createTask, 최근 기록 제외·기록 없음)으로 연 삼성 인터넷 창이 곧바로 사라져 앱이 앞으로 온다.
//   크롬이 기본인 폰은 그동안 정상(11-24·25 서버 기록).
//  대응: 크롬이 기본이면 지금 그대로. 아니면 설치된 크롬으로 연다. 크롬이 없으면 앱과 같은 작업으로 연다(createTask:false).
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

const CHROME = 'com.android.chrome';

export type AuthBrowserPick = { options: WebBrowser.AuthSessionOpenOptions; mode: 'default' | 'chrome' | 'same_task'; preferred: string | null };

export function pickAuthBrowser(info: { browserPackages?: string[]; preferredBrowserPackage?: string | null; defaultBrowserPackage?: string | null } | null): AuthBrowserPick {
  const preferred = info?.preferredBrowserPackage || info?.defaultBrowserPackage || null;
  if (preferred === CHROME) return { options: {}, mode: 'default', preferred };
  if (info?.browserPackages?.includes(CHROME)) return { options: { browserPackage: CHROME }, mode: 'chrome', preferred };
  return { options: { createTask: false }, mode: 'same_task', preferred };
}

export async function authBrowserOptions(tag: string): Promise<AuthBrowserPick> {
  if (Platform.OS !== 'android') return { options: {}, mode: 'default', preferred: null };
  let info = null;
  try {
    info = await WebBrowser.getCustomTabsSupportingBrowsersAsync();
  } catch {
    info = null;
  }
  const pick = pickAuthBrowser(info);
  // 서버 frontend.log 로 남겨 실제 폰에서 어떤 길로 열렸는지 확인한다(개인정보 없음).
  console.warn('[AuthBrowser] 창 열기', { tag, mode: pick.mode, preferred: pick.preferred });
  return pick;
}

/** 열고 나서 금방 돌아왔는지 기록 — 같은 문제가 다시 생기면 frontend.log 에서 바로 보인다. */
export function logAuthBrowserClosed(tag: string, pick: AuthBrowserPick, type: string, startedAt: number) {
  if (Platform.OS !== 'android') return;
  const ms = Date.now() - startedAt;
  if (type !== 'success') console.warn('[AuthBrowser] 창 닫힘', { tag, mode: pick.mode, preferred: pick.preferred, type, ms });
}
