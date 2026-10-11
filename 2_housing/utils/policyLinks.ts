// v3.332 [PolicyLinks] 이용약관·개인정보 처리방침 = 게시된 웹 문서(정본)를 앱 안 브라우저로 연다.
// 앱 안 축약문(constants/consentTexts — 가입 동의 문구)은 동의서 원문으로만 쓰고, '전문'은 항상 이 페이지.
import { Platform, Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { colors } from '../theme/colors';

export const POLICY_URLS = {
  terms: 'https://lotusai.co.kr/terms',
  privacy: 'https://lotusai.co.kr/privacy',
} as const;

export type PolicyKey = keyof typeof POLICY_URLS;

export async function openPolicyPage(key: PolicyKey): Promise<void> {
  const url = POLICY_URLS[key];
  console.info('[PolicyLinks] 정책 문서 열기', { key });
  try {
    if (Platform.OS === 'web') {
      window.open(url, '_blank', 'noopener');
      return;
    }
    await WebBrowser.openBrowserAsync(url, {
      toolbarColor: colors.bg.deepest,
      controlsColor: colors.accent.primary,
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
    });
  } catch (err: any) {
    console.error('[PolicyLinks] 인앱 브라우저 열기 실패 — 외부 브라우저 폴백', { key, message: err?.message });
    Linking.openURL(url).catch(() => {});
  }
}
