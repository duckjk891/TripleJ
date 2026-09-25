/**
 * v3.232 어린이 모드(1차) — 순수 판정·문구·child_restricted 오류 처리.
 *
 * 이 파일은 store 를 import 하지 않는다(services/api.ts 인터셉터가 import — authStore→api 순환 방지).
 * 화면·훅은 utils/kidsMode.ts(이 파일 재수출 + useIsChild 등 훅)를 import 한다.
 *
 * 판정 원칙(PLAN v3.232 플래그 설계): 앱은 생년월일을 계산하지 않는다.
 * 서버가 킬 스위치·나이를 모두 반영한 `kids_restricted === true` 일 때만 어린이.
 * 구서버·키 없음·false·age_group unknown/teen = 일반 모드(기존 동작 불변).
 */
import { showAlert } from './appAlert';

export type KidsPermissionKey = 'feed_write' | 'comment' | 'dm_friends';
export type KidsPermissions = Partial<Record<KidsPermissionKey, boolean>>;
export type AgeGroup = 'child' | 'teen' | 'adult' | 'unknown';

/** 판정에 쓰는 user 최소 형태(authStore AuthUser 의 부분집합) */
export interface KidsUserLike {
  id?: string | number | null;
  kids_restricted?: boolean | null;
  kids_permissions?: KidsPermissions | null;
  birth_date_locked?: boolean | null;
  age_group?: string | null;
}

/** 어린이 모드 사용자 노출 문구(이모지 ⭐ 외 금지, MAIDOL 표기) */
export const KIDS_TEXT = {
  restrictedTitle: '어린이 계정에서는 쓸 수 없어요',
  restrictedFallback: '어린이 계정을 안전하게 지키기 위해 이 기능은 쓸 수 없어요.',
  birthDateLocked: '생년월일은 가입 후 바꿀 수 없어요. 고객센터로 문의해주세요.',
  commentNeedsGuardian: '보호자가 허용하면 댓글을 쓸 수 있어요',
  feedWriteNeedsGuardian: '보호자가 허용하면 글을 쓸 수 있어요',
  dmOfficialOnly: '어린이 계정은 MAIDOL 공식 계정과만 메시지를 주고받을 수 있어요.',
  photoBlocked: '어린이 계정은 사진을 올릴 수 없어요.',
  voiceBlocked: '어린이 계정은 내 목소리 기능을 쓸 수 없어요.',
  safetyTitle: '온라인 안전 안내',
  safetyRowLabel: '온라인 안전 안내',
} as const;

/** 온라인 안전 안내 5항목(K4) — KidsSafetyNotice 와 설정 "다시 보기" 공용 */
export const KIDS_SAFETY_ITEMS: readonly string[] = [
  '이름·학교·전화번호·주소는 올리지 않아요.',
  '모르는 사람이 연락하면 대답하지 말고 거절해요.',
  '이상하거나 무서운 내용을 보면 신고해요.',
  '걱정되는 일이 생기면 보호자에게 바로 말해요.',
  '내 얼굴이나 사진은 올리지 않아요.',
];

// ── 사용자 판정(순수) ────────────────────────────────────────────────────────

/** 어린이 모드 여부 — 서버 kids_restricted === true 일 때만 true */
export function isKidsRestrictedUser(user: KidsUserLike | null | undefined): boolean {
  return !!user && user.kids_restricted === true;
}

/**
 * 보호자 허용 기능 사용 가능 여부. 어린이가 아니면 항상 true(제한 없음).
 * 어린이면 kids_permissions[key] === true 일 때만 true(1차 서버는 항상 false).
 */
export function kidsPermissionAllowed(user: KidsUserLike | null | undefined, key: KidsPermissionKey): boolean {
  if (!isKidsRestrictedUser(user)) return true;
  return user!.kids_permissions?.[key] === true;
}

/** 생년월일 잠금 여부 — 서버 birth_date_locked === true 일 때만(구서버 = false) */
export function isBirthDateLockedUser(user: KidsUserLike | null | undefined): boolean {
  return !!user && user.birth_date_locked === true;
}

// ── 모드 전환 로그(authStore 가 user 를 교체할 때 호출) ────────────────────
let lastLoggedMode: { uid: string; mode: 'child' | 'normal' } | null = null;

/**
 * `[KidsMode] mode=child|normal src=…` — 사용자·모드가 바뀔 때만 1회 기록.
 * 일반 사용자는 이전 기록이 없거나 일반이면 기록하지 않는다(성인 로그 소음 0),
 * 단 어린이 → 일반 전환은 기록한다.
 */
export function noteKidsMode(user: KidsUserLike | null | undefined, src: string): void {
  try {
    if (!user?.id) {
      // 로그아웃: 어린이였다면 일반 전환을 1회 기록(다음 계정에 어린이 상태가 남지 않음을 로그로 확인)
      if (lastLoggedMode?.mode === 'child') console.info(`[KidsMode] mode=normal src=${src}`);
      lastLoggedMode = null;
      return;
    }
    const uid = String(user.id);
    const mode: 'child' | 'normal' = isKidsRestrictedUser(user) ? 'child' : 'normal';
    const prev = lastLoggedMode;
    lastLoggedMode = { uid, mode };
    if (prev && prev.uid === uid && prev.mode === mode) return;
    if (mode === 'normal' && (!prev || prev.mode === 'normal')) return;
    console.info(`[KidsMode] mode=${mode} src=${src}`, { age_group: user.age_group ?? null });
  } catch (err) {
    console.error('[KidsMode] noteKidsMode 실패', { err });
  }
}

/** 테스트 전용: 전환 로그 상태 초기화 */
export function __resetKidsModeLogForTest(): void {
  lastLoggedMode = null;
}

// ── child_restricted 오류(K2) ─────────────────────────────────────────────

export interface ChildRestrictedInfo {
  feature: string | null;
  /** 사람이 읽는 안내 문구(서버 error, 코드형 문자열이면 기본 문구) */
  message: string;
}

const CODE_LIKE = /^[a-z0-9_.:-]+$/;

function pickHumanText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || CODE_LIKE.test(t)) return null;
  return t;
}

/**
 * axios 오류 또는 응답 data 에서 child_restricted 를 판별한다.
 * 서버 형태: `{error, code:'child_restricted', feature}` 또는 FastAPI `{detail:{error, code, feature}}`.
 * 해당 없으면 null.
 */
export function getChildRestricted(errOrData: any): ChildRestrictedInfo | null {
  try {
    if (!errOrData || typeof errOrData !== 'object') return null;
    const data = errOrData.isAxiosError || errOrData.response ? errOrData.response?.data : errOrData;
    if (!data || typeof data !== 'object') return null;
    const candidates = [data, data.detail].filter((d) => d && typeof d === 'object');
    for (const d of candidates) {
      if (d.code === 'child_restricted') {
        return {
          feature: typeof d.feature === 'string' ? d.feature : null,
          message: pickHumanText(d.error) || pickHumanText(d.message) || KIDS_TEXT.restrictedFallback,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** 화면 catch 에서 "인터셉터가 이미 안내했으니 자체 팝업 생략" 판별용 */
export function isChildRestrictedError(err: any): boolean {
  return getChildRestricted(err) !== null;
}

const NOTIFY_DEDUP_MS = 3000;
let lastNotifiedAt = -Infinity;

/**
 * child_restricted 안내 팝업(앱 내 다이얼로그) — 3초 내 중복 억제.
 * @returns 이번 호출로 팝업을 띄웠는가
 */
export function notifyChildRestricted(info: ChildRestrictedInfo, now: number = Date.now()): boolean {
  console.warn(`[KidsGate] 403 feature=${info.feature ?? 'unknown'}`);
  if (now - lastNotifiedAt < NOTIFY_DEDUP_MS) return false;
  lastNotifiedAt = now;
  try {
    showAlert(KIDS_TEXT.restrictedTitle, info.message);
  } catch (err) {
    console.error('[KidsGate] 안내 팝업 실패', { err });
  }
  return true;
}

/** 테스트 전용: 중복 억제 시계 초기화 */
export function __resetKidsNotifyForTest(): void {
  lastNotifiedAt = -Infinity;
}

/**
 * services/api.ts 응답 인터셉터용 — child_restricted 면 안내하고 true.
 * 그 외 오류는 아무것도 하지 않고 false(기존 경로 불변).
 */
export function handleChildRestrictedError(err: any): boolean {
  const info = getChildRestricted(err);
  if (!info) return false;
  notifyChildRestricted(info);
  return true;
}
