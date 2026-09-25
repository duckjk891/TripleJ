/**
 * v3.232 K4(B8) — 어린이 계정 온라인 안전 안내.
 *
 * - 어린이 첫 로그인 1회: App 루트에 <KidsSafetyNotice /> 를 마운트하면 로그인 사용자가
 *   어린이(kids_restricted === true)로 확정될 때 AsyncStorage `kids-safety-seen:{uid}` 를 보고 1회 표시.
 * - 설정 "온라인 안전 안내" 행에서 showKidsSafetyNotice() 로 다시 보기.
 * - 팝업은 앱 내 다이얼로그(showAlert) — 시스템 Alert 금지 규칙.
 * - 일반(성인·청소년·나이 모름·구서버) 사용자는 저장소 조회도 하지 않는다(무동작).
 */
import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from '../../stores/authStore';
import { showAlert } from '../../utils/appAlert';
import {
  KIDS_SAFETY_ITEMS,
  KIDS_TEXT,
  isKidsRestrictedUser,
  type KidsUserLike,
} from '../../utils/kidsRestricted';

export const KIDS_SAFETY_SEEN_PREFIX = 'kids-safety-seen:';

/** 안내 본문(5항목) */
export function buildKidsSafetyMessage(): string {
  const lines = KIDS_SAFETY_ITEMS.map((t, i) => `${i + 1}. ${t}`);
  return ['MAIDOL 을 안전하게 쓰기 위해 꼭 지켜주세요.', '', ...lines].join('\n');
}

/** 안전 안내 다이얼로그 표시(설정 "다시 보기"에서도 사용) */
export function showKidsSafetyNotice(): void {
  showAlert(KIDS_TEXT.safetyTitle, buildKidsSafetyMessage(), [{ text: '알겠어요' }]);
}

const inFlight = new Set<string>();
/** 이번 앱 실행에서 이미 안내한 uid — 저장소 읽기/쓰기가 실패해도 실행당 1회만(설정 "다시 보기"는 별개) */
const shownThisRun = new Set<string>();

/**
 * 어린이면 계정당 1회 안내. 반환: 'shown' | 'seen'(이미 봄) | 'skip'(어린이 아님·진행 중·오류)
 * 저장소 읽기·쓰기 실패 시에도 안내는 표시한다(안전 안내 누락보다 반복 노출이 낫다 — 실패는 로그만).
 */
export async function maybeShowKidsSafetyNoticeOnce(
  user: KidsUserLike | null | undefined
): Promise<'shown' | 'seen' | 'skip'> {
  if (!isKidsRestrictedUser(user) || user?.id == null) return 'skip';
  const uid = String(user.id);
  if (shownThisRun.has(uid)) return 'seen';
  if (inFlight.has(uid)) return 'skip';
  inFlight.add(uid);
  const key = `${KIDS_SAFETY_SEEN_PREFIX}${uid}`;
  try {
    let seen: string | null = null;
    try {
      seen = await AsyncStorage.getItem(key);
    } catch (err) {
      console.error('[KidsNotice] seen 읽기 실패', { err });
    }
    if (seen) return 'seen';
    // 비동기 조회 사이 로그아웃·계정 전환 시 표시하지 않음
    const now = useAuthStore.getState().user;
    if (!now || String(now.id) !== uid || !isKidsRestrictedUser(now)) return 'skip';
    showKidsSafetyNotice();
    shownThisRun.add(uid);
    console.info(`[KidsNotice] shown uid=${uid.slice(0, 8)}`);
    try {
      await AsyncStorage.setItem(key, String(Date.now()));
    } catch (err) {
      console.error('[KidsNotice] seen 기록 실패', { err });
    }
    return 'shown';
  } finally {
    inFlight.delete(uid);
  }
}

/** 테스트 전용: 실행 내 표시 기록 초기화(앱 재시작 모사) */
export function __resetKidsSafetyRunForTest(): void {
  shownThisRun.clear();
  inFlight.clear();
}

/** App 루트 마운트용 — 렌더 없음(어린이 로그인 확정 시 1회 안내만 트리거) */
export default function KidsSafetyNotice() {
  const uid = useAuthStore((s) => (s.user?.id != null ? String(s.user.id) : null));
  const isChild = useAuthStore((s) => isKidsRestrictedUser(s.user));
  useEffect(() => {
    if (!uid || !isChild) return;
    maybeShowKidsSafetyNoticeOnce(useAuthStore.getState().user).catch((err) =>
      console.error('[KidsNotice] 안내 처리 실패', { err })
    );
  }, [uid, isChild]);
  return null;
}
