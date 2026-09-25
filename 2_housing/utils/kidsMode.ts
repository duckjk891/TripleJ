/**
 * v3.232 어린이 모드(1차) — 화면·훅 공용 진입점(K1 계약).
 *
 *   useIsChild(): boolean                         — 렌더용(어린이면 true). `{!isChild && 기존 요소}` 로 감싸 쓴다.
 *   isChildNow(): boolean                         — 이벤트 핸들러·서비스용 store 동기 조회.
 *   useKidsPermission(key): boolean               — 보호자 허용 기능 "사용 가능" 여부. 어린이가 아니면 항상 true.
 *   kidsPermissionNow(key): boolean               — 위의 동기 조회판.
 *   useBirthDateLocked() / isBirthDateLockedNow() — 서버 birth_date_locked(구서버 = false).
 *   isChildRestrictedError(err)                   — 서버 403 child_restricted 여부(인터셉터가 이미 안내 → 화면 자체 팝업 생략 판단용).
 *   KIDS_TEXT · KIDS_SAFETY_ITEMS                  — 공용 문구.
 *
 * 판정은 서버 `kids_restricted === true` 한 가지(앱은 나이를 계산하지 않음).
 * 구서버·킬 스위치 OFF·나이 모름 = false → 기존 동작 그대로.
 */
import { useAuthStore } from '../stores/authStore';
import {
  isBirthDateLockedUser,
  isKidsRestrictedUser,
  kidsPermissionAllowed,
  type KidsPermissionKey,
} from './kidsRestricted';

export * from './kidsRestricted';

/** 어린이 모드면 true (렌더용 훅) */
export function useIsChild(): boolean {
  return useAuthStore((s) => isKidsRestrictedUser(s.user));
}

/** 어린이 모드면 true (store 동기 조회 — 핸들러·서비스용) */
export function isChildNow(): boolean {
  try {
    return isKidsRestrictedUser(useAuthStore.getState().user);
  } catch (err) {
    console.error('[KidsMode] isChildNow 조회 실패', { err });
    return false;
  }
}

/** 보호자 허용 기능 사용 가능 여부(어린이가 아니면 항상 true, 1차 어린이는 항상 false) */
export function useKidsPermission(key: KidsPermissionKey): boolean {
  return useAuthStore((s) => kidsPermissionAllowed(s.user, key));
}

/** useKidsPermission 의 동기 조회판 */
export function kidsPermissionNow(key: KidsPermissionKey): boolean {
  try {
    return kidsPermissionAllowed(useAuthStore.getState().user, key);
  } catch (err) {
    console.error('[KidsMode] kidsPermissionNow 조회 실패', { err });
    return true;
  }
}

/** 생년월일 잠금(서버 birth_date_locked === true) */
export function useBirthDateLocked(): boolean {
  return useAuthStore((s) => isBirthDateLockedUser(s.user));
}

export function isBirthDateLockedNow(): boolean {
  try {
    return isBirthDateLockedUser(useAuthStore.getState().user);
  } catch (err) {
    console.error('[KidsMode] isBirthDateLockedNow 조회 실패', { err });
    return false;
  }
}
