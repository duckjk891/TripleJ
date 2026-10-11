// v3.331 [SocialAgeGate] iOS 13세 미만 소셜(피드·커뮤니티·곡 댓글) 차단 — Apple 연령 등급 설문
// "Social Media Disabled for Users Under 13" 요건(2026-09 필수 설문): 소셜 기능을 켜기 전에 최소한
// Declared Age Range API 로 나이대를 확인하고, 13세 미만에게는 소셜 기능을 주지 않는다.
//  · iOS 앱 전용 — Android·웹은 기존 어린이 모드(가입 생년월일 + 보호자 허용) 그대로(Google 가족 정책 심사본).
//  · 판정: ① 계정이 어린이(서버 kids_restricted) → 차단  ② Apple 나이대가 13세 미만 → 차단(계정이 성인이어도 — 기기 사용자 기준)
//    ③ 나이대 공유 거절·iOS 26 미만·로그인 안 된 Apple 계정 → 계정 나이로만 판단(①).
//  · 확인 시점: 소셜 화면에 처음 들어갈 때 1회(시스템 공유 창은 그때 한 번 — 결과는 OS 가 캐시, 앱은 실행 중 메모리 보관).
import { Platform } from 'react-native';
import { create } from 'zustand';
import { isChildNow, useIsChild } from './kidsMode';

export type DeclaredAgeStatus = 'unknown' | 'checking' | 'under13' | 'over13' | 'unavailable';

interface DeclaredAgeState {
  status: DeclaredAgeStatus;
  set: (status: DeclaredAgeStatus) => void;
}

const useDeclaredAgeStore = create<DeclaredAgeState>((set) => ({
  status: 'unknown',
  set: (status) => set({ status }),
}));

const SOCIAL_MIN_AGE = 13;

/** Apple 응답(lowerBound/upperBound) → 판정(순수) */
export function classifyAgeRange(r: { lowerBound?: number | null; upperBound?: number | null } | null | undefined): DeclaredAgeStatus {
  if (!r) return 'unavailable';
  if (typeof r.upperBound === 'number' && r.upperBound < SOCIAL_MIN_AGE) return 'under13';
  if (typeof r.lowerBound === 'number' && r.lowerBound >= SOCIAL_MIN_AGE) return 'over13';
  return 'unavailable';
}

/** 차단 여부(순수) — iOS 에서만, 어린이 계정 또는 Apple 나이대 13세 미만 */
export function socialBlocked(os: string, isChildAccount: boolean, status: DeclaredAgeStatus): boolean {
  if (os !== 'ios') return false;
  return isChildAccount || status === 'under13';
}

let inflight: Promise<DeclaredAgeStatus> | null = null;

/** iOS 에서 Apple 나이대를 1회 확인(실행 중 재호출 없음). 다른 플랫폼은 즉시 'unavailable' */
export function ensureDeclaredAgeChecked(): Promise<DeclaredAgeStatus> {
  const st = useDeclaredAgeStore.getState();
  if (Platform.OS !== 'ios') return Promise.resolve('unavailable');
  if (st.status !== 'unknown' && st.status !== 'checking') return Promise.resolve(st.status);
  if (inflight) return inflight;
  st.set('checking');
  inflight = (async () => {
    let result: DeclaredAgeStatus = 'unavailable';
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const AgeRange = require('expo-age-range');
      console.info('[SocialAgeGate] Declared Age Range 요청', { threshold: SOCIAL_MIN_AGE });
      const r = await AgeRange.requestAgeRangeAsync({ threshold1: SOCIAL_MIN_AGE });
      result = classifyAgeRange(r);
      console.info('[SocialAgeGate] Declared Age Range 응답', {
        result, lower: r?.lowerBound ?? null, upper: r?.upperBound ?? null, declaration: r?.ageRangeDeclaration ?? null,
      });
    } catch (err: any) {
      // ERR_AGE_RANGE_USER_DECLINED(공유 거절)·NOT_AVAILABLE(Apple 계정 미로그인) 등 → 계정 나이로만 판단
      console.warn('[SocialAgeGate] Declared Age Range 사용 불가 — 계정 나이로 판단', { code: err?.code, message: err?.message });
      result = 'unavailable';
    }
    useDeclaredAgeStore.getState().set(result);
    inflight = null;
    return result;
  })();
  return inflight;
}

/** 렌더용 — { blocked, checking } (iOS 외에는 항상 false) */
export function useSocialAgeGate(): { blocked: boolean; checking: boolean } {
  const isChild = useIsChild();
  const status = useDeclaredAgeStore((s) => s.status);
  if (Platform.OS !== 'ios') return { blocked: false, checking: false };
  if (isChild) return { blocked: true, checking: false };
  return { blocked: status === 'under13', checking: status === 'unknown' || status === 'checking' };
}

/** 핸들러용 동기 조회 */
export function isSocialBlockedNow(): boolean {
  return socialBlocked(Platform.OS, isChildNow(), useDeclaredAgeStore.getState().status);
}

export const SOCIAL_BLOCKED_TEXT = {
  title: '13세 미만은 이용할 수 없어요',
  body: '피드·커뮤니티·댓글은 만 13세 이상만 이용할 수 있어요.\n노래 만들기와 듣기는 그대로 즐길 수 있어요.',
};
