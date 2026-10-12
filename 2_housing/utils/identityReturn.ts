// v3.349 [IdentityReturn] 웹 본인확인 = 같은 탭 이동 → 끝나면 서버가 앱 주소로 303 복귀
//   https://app.maidol.ai.kr/?identity=done&rid={rid}&status={verified|failed|duplicate|cancelled|…}
// 앱 모듈 로드 시 1회 캡처하고 주소창에서 identity·rid·status 를 지운다. 결과의 정본은 서버(GET /identity/result/{rid}) —
// 주소의 status 는 표시 힌트일 뿐이다. 가입 마무리 화면(SignupCompleteGate)이 꺼내서 이어 처리한다.
import { Platform } from 'react-native';

export const WEB_IDENTITY_RETURN_URL = 'https://app.maidol.ai.kr/?identity=done';

export interface IdentityReturn {
  rid: string;
  status: string;
}

let pending: IdentityReturn | null = null;
const RID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** location.search → 복귀 정보(순수). 본인확인 복귀가 아니면 null */
export function parseIdentityReturn(search: string): IdentityReturn | null {
  try {
    const q = new URLSearchParams(search);
    if (q.get('identity') !== 'done') return null;
    const rid = (q.get('rid') || '').trim();
    if (!RID_RE.test(rid)) return null;
    return { rid, status: (q.get('status') || '').slice(0, 20) };
  } catch {
    return null;
  }
}

/** 웹 URL 에서 identity·rid·status 제거한 경로(순수). 바꿀 게 없으면 null */
export function stripIdentityParams(href: string): string | null {
  try {
    const u = new URL(href);
    if (u.searchParams.get('identity') !== 'done') return null;
    for (const k of ['identity', 'rid', 'status']) u.searchParams.delete(k);
    return u.pathname + (u.searchParams.toString() ? `?${u.searchParams}` : '') + u.hash;
  } catch {
    return null;
  }
}

/** 웹 — 앱 모듈 로드 시 1회 */
export function captureWebIdentityReturn(): IdentityReturn | null {
  try {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
    const r = parseIdentityReturn(window.location.search);
    const next = stripIdentityParams(window.location.href);
    if (next !== null) window.history.replaceState(window.history.state, '', next);
    if (!r) return null;
    pending = r;
    console.info('[IdentityReturn] 본인확인 복귀', { rid: r.rid.slice(0, 8), status: r.status });
    return r;
  } catch (err: any) {
    console.error('[IdentityReturn] 캡처 실패', { message: err?.message });
    return null;
  }
}

/** 복귀 정보 꺼내기(1회) */
export function consumeIdentityReturn(): IdentityReturn | null {
  const r = pending;
  pending = null;
  return r;
}

/** 같은 탭 방식을 쓸 수 있는 웹 주소인지(서버 허용 접두 https://app.maidol.ai.kr/ — 미리보기 도메인은 종전 새 창) */
export function canUseSameTabReturn(origin: string | undefined | null): boolean {
  return origin === 'https://app.maidol.ai.kr';
}
