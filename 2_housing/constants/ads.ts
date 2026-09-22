/**
 * v3.208: AdMob 보상형 광고 설정 — 디렉터 휴식(쿨다운) 「광고 보고 30분 단축」 (PLAN v3.208 F5).
 *
 * - 광고 "단위" ID 는 순수 JS 상수(네이티브 무관) — EXPO_PUBLIC_* 는 빌드 시 인라인된다.
 * - 실값(ca-app-pub-xxxx/xxxx) 하드코딩 금지: eas.json env 또는 .env 로만 주입.
 * - 미설정 시 hooks/useRewardedSkipAd.ts 가 TestIds.REWARDED 로 폴백(단일 규칙:
 *   "키 미제공=샘플 테스트 광고, 제공=자체 단위" — __DEV__/프로필 분기 없음).
 *   단, 샘플 유닛은 SSV 콜백이 우리 서버로 오지 않아 적립 E2E 불가(UI 배선 확인용).
 * - 이 파일은 react-native-google-mobile-ads 를 import 하지 않는다(web/Expo Go 안전).
 */

/** 보상형 광고 단위 ID(Android) — 미설정('')이면 TestIds.REWARDED 폴백 */
export const ADMOB_REWARDED_AD_UNIT_ANDROID: string = (
  process.env.EXPO_PUBLIC_ADMOB_REWARDED_ANDROID ?? ''
).trim();

/**
 * 테스트 기기 ID 목록(콤마 구분) — 내부 테스트 중 실광고 노출(무효 트래픽) 방지.
 * MobileAds().setRequestConfiguration({ testDeviceIdentifiers }) 에 1회 주입(App.tsx).
 */
export const ADMOB_TEST_DEVICE_IDS: string[] = (
  process.env.EXPO_PUBLIC_ADMOB_TEST_DEVICE_IDS ?? ''
)
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean);
