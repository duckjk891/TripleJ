/**
 * v3.208: 디렉터 휴식(쿨다운) 보상형 광고 서비스 — react-native-google-mobile-ads 16.3.2.
 *
 * 호출부(utils/fatigueGate.ts showFatigueCooldownDialog)가 showAlert 기반의 임퍼러티브
 * 다이얼로그라 React 훅 대신 모듈 싱글턴 서비스로 제공한다(파일명은 PLAN 변경 매트릭스 준수).
 *
 * WaitTimerScreen(@deprecated) 보존 코드에서 "관행"만 승계: Platform.OS!=='web' + try-require
 * 게이트(metro.config.js 의 web 빈 모듈 치환과 한 쌍), pre-load 후 즉시 show, Expo Go 안전 강등.
 * 로직은 재작성 — 보존 코드의 3결함(PLAN F4)을 재현하지 않는다:
 *  1) serverSideVerificationOptions 설정: customData=user_id (서버 rewards.py SSV 콜백이
 *     custom_data 를 user_id 로 사용해 보상자를 식별) + userId 병기.
 *  2) 이벤트는 AdEventType/RewardedAdEventType 상수 구독('closed' 문자열 리터럴 금지).
 *  3) 스테일 클로저 타임아웃 없음 — 모듈 싱글턴 상태 + 리스너 unsubscribe 정리.
 *
 * Expo Go/web: 모듈 부재 시 isRewardedAdSupported()=false 로 전 API 안전 강등
 * (mock 보상 금지 — 서버 적립이 없어 UX 거짓말이 됨, PLAN F6).
 */
import { Platform } from 'react-native';
import { useAuthStore } from '../stores/authStore';
import { ADMOB_REWARDED_AD_UNIT_ANDROID, ADMOB_TEST_DEVICE_IDS } from '../constants/ads';

// try-require 게이트 — web 은 metro 에서 빈 모듈, Expo Go 는 require 실패
let admob: any = null;
if (Platform.OS !== 'web') {
  try {
    admob = require('react-native-google-mobile-ads');
  } catch {
    console.log('[AdReward] react-native-google-mobile-ads 미탑재(Expo Go) — 광고 배선 비활성');
  }
}

/** 이 플랫폼/런타임에서 보상형 광고를 지원하는가 (미지원이면 버튼 자체 미노출) */
export const isRewardedAdSupported = (): boolean => !!admob?.RewardedAd;

/** 광고 단위 ID — env 주입값 우선, 미설정 시 TestIds.REWARDED 폴백 (값 로그 금지) */
const resolveAdUnitId = (): string => ADMOB_REWARDED_AD_UNIT_ANDROID || admob?.TestIds?.REWARDED || '';

// ── 모듈 싱글턴 pre-load 상태 ────────────────────────────────────────────────
let preloadedAd: any = null;
let preloadedReady = false;
let preloadedForUserId: string | null = null;
let preloadUnsubs: Array<() => void> = [];

function detachPreloadListeners(): void {
  preloadUnsubs.forEach((un) => {
    try {
      un();
    } catch {}
  });
  preloadUnsubs = [];
}

function clearPreload(): void {
  detachPreloadListeners();
  preloadedAd = null;
  preloadedReady = false;
  preloadedForUserId = null;
}

/** 표시 가능한 광고가 준비되어 있는가 */
export const isRewardedSkipAdReady = (): boolean => !!preloadedAd && preloadedReady;

/**
 * 보상형 광고 pre-load — 다이얼로그 표시/앱 초기화 시 백그라운드 로드해 두면 클릭 시 즉시 show.
 * SSV 식별자(user_id)가 바뀌면(재로그인 등) 기존 pre-load 를 버리고 새로 만든다.
 */
export function preloadRewardedSkipAd(): void {
  if (!admob?.RewardedAd) return;
  const rawId = useAuthStore.getState().user?.id;
  const userId = rawId != null && String(rawId) ? String(rawId) : '';
  // v3.208 tester U-3③: user_id 없이는 SSV 식별 불가 = 적립 불능 시청 — 로드 자체를 막는다
  // (ready=false 유지 → 다이얼로그 버튼은 「광고 준비 중…」으로 자연 차단, 로그인 후 재시도 시 정상 로드).
  if (!userId) {
    clearPreload();
    return;
  }
  if (preloadedAd && preloadedForUserId === userId) return; // 로드 중 또는 준비 완료 — 재사용
  clearPreload();
  const adUnitId = resolveAdUnitId();
  if (!adUnitId) return;
  try {
    // SSV: 서버(rewards.py)는 콜백의 custom_data 를 user_id 로 사용해 보상자를 식별·적립한다.
    const requestOptions = userId
      ? { serverSideVerificationOptions: { userId, customData: userId } }
      : undefined;
    const ad = admob.RewardedAd.createForAdRequest(adUnitId, requestOptions);
    preloadedAd = ad;
    preloadedForUserId = userId;
    preloadUnsubs.push(
      ad.addAdEventListener(admob.RewardedAdEventType.LOADED, () => {
        if (preloadedAd === ad) preloadedReady = true;
        if (__DEV__) console.info('[AdReward] 보상형 광고 로드 완료');
      })
    );
    preloadUnsubs.push(
      ad.addAdEventListener(admob.AdEventType.ERROR, (err: any) => {
        console.error('[AdReward] 보상형 광고 로드 실패:', err);
        if (preloadedAd === ad) clearPreload();
      })
    );
    ad.load();
    if (__DEV__) console.info('[AdReward] 보상형 광고 pre-load 시작', { ssv: !!userId });
  } catch (err) {
    console.error('[AdReward] pre-load 실패:', err);
    clearPreload();
  }
}

export type RewardedAdWatchResult = 'earned' | 'dismissed';

/**
 * pre-load 된 보상형 광고를 표시하고 시청 결과를 돌려준다.
 * - 'earned': EARNED_REWARD 수신 후 닫힘(끝까지 시청) — 이후 SSV 콜백으로 서버 적립이 진행된다.
 * - 'dismissed': 보상 없이 닫힘(중도 이탈).
 * - reject: 미준비/표시 오류 — 호출부는 기존 경로(⭐/광고권)로 폴백한다.
 * 종료 시 리스너를 정리하고 다음 시청을 위해 pre-load 를 다시 킥한다.
 */
export function showRewardedSkipAd(): Promise<RewardedAdWatchResult> {
  return new Promise<RewardedAdWatchResult>((resolve, reject) => {
    if (!admob?.RewardedAd) {
      reject(new Error('rewarded_ad_unsupported'));
      return;
    }
    if (!preloadedAd || !preloadedReady) {
      preloadRewardedSkipAd();
      reject(new Error('rewarded_ad_not_ready'));
      return;
    }
    // pre-load 슬롯에서 꺼내 이중 show 를 방지 (다음 pre-load 는 종료 후 settle 에서 킥)
    const ad = preloadedAd;
    detachPreloadListeners();
    preloadedAd = null;
    preloadedReady = false;
    preloadedForUserId = null;

    let earned = false;
    let settled = false;
    const unsubs: Array<() => void> = [];
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      unsubs.forEach((un) => {
        try {
          un();
        } catch {}
      });
      preloadRewardedSkipAd(); // 다음 시청 대비 재로드
      fn();
    };
    try {
      unsubs.push(
        ad.addAdEventListener(admob.RewardedAdEventType.EARNED_REWARD, (reward: any) => {
          earned = true;
          if (__DEV__) {
            console.info(
              '[AdReward] EARNED_REWARD:',
              JSON.stringify({ type: reward?.type, amount: reward?.amount })
            );
          }
        })
      );
      unsubs.push(
        ad.addAdEventListener(admob.AdEventType.CLOSED, () => {
          if (__DEV__) console.info('[AdReward] 광고 닫힘 — earned:', earned);
          settle(() => resolve(earned ? 'earned' : 'dismissed'));
        })
      );
      unsubs.push(
        ad.addAdEventListener(admob.AdEventType.ERROR, (err: any) => {
          console.error('[AdReward] 광고 오류:', err);
          settle(() => reject(err instanceof Error ? err : new Error(String(err?.message ?? err))));
        })
      );
      ad.show();
    } catch (err) {
      console.error('[AdReward] show 실패:', err);
      settle(() => reject(err instanceof Error ? err : new Error(String(err))));
    }
  });
}

// ── 앱 시작 1회 초기화 (App.tsx) ─────────────────────────────────────────────
let mobileAdsInitialized = false;

/**
 * MobileAds 초기화 + 테스트 기기 등록(setRequestConfiguration) — 앱 루트에서 1회 호출.
 * 미지원 런타임(Expo Go/web)에서는 no-op. 실패해도 앱 흐름에 영향 없음(광고 버튼만 미동작).
 */
export async function initRewardedAds(): Promise<void> {
  if (!admob?.MobileAds || mobileAdsInitialized) return;
  mobileAdsInitialized = true;
  try {
    const mobileAds = admob.MobileAds();
    if (ADMOB_TEST_DEVICE_IDS.length > 0) {
      await mobileAds.setRequestConfiguration({ testDeviceIdentifiers: ADMOB_TEST_DEVICE_IDS });
    }
    await mobileAds.initialize();
    if (__DEV__) {
      console.info('[AdReward] MobileAds 초기화 완료', { testDevices: ADMOB_TEST_DEVICE_IDS.length });
    }
  } catch (err) {
    console.error('[AdReward] MobileAds 초기화 실패:', err);
  }
}
