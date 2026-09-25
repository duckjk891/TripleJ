// v3.230 A8 [IdentityBypass] 본인인증 요구 전면 우회(대표 지시: "본인인증은 추후 적용 — 본인인증 하라고
// 뜨는 경우가 있다면 모두 넘어가도록"). 순수 함수 모듈 — Node 하네스 검증 대상.
//  · 앱은 어디에서도 본인인증을 요구·유도하지 않는다(단계·팝업·차단·버튼 없음).
//  · 서버 S3: IDENTITY_VERIFY_REQUIRED=False(기본) → /face-verify/status 에 identity_required:false,
//    face_verify 의 is_verified 게이트 통과. AWS 얼굴 인증(동의·촬영·대조)·미성년 보호자 동의는 유지.
//  · 구서버(identity_required 키 없음)에서 is_verified=false 면 서버가 403 을 내므로, 본인인증 유도 대신
//    "얼굴 인증을 잠시 이용할 수 없어요" 일반 안내로 끝낸다.
//  · 서버가 돌려준 문장에 '본인인증'이 들어 있으면 그대로 노출하지 않고 일반 문구로 바꾼다.

export const FACE_UNAVAILABLE_TITLE = '얼굴 인증을 잠시 이용할 수 없어요';
export const FACE_UNAVAILABLE_MESSAGE =
  '지금은 얼굴 사진으로 아티스트를 만들 수 없어요. 잠시 후 다시 시도하거나, 사진 없이 가상 아티스트로 만들 수 있어요.';
export const DM_UNAVAILABLE_MESSAGE =
  '다른 회원과 메시지를 주고받는 기능은 아직 준비 중이에요. 문의는 공식 계정으로 보내주세요.';

const IDENTITY_TEXT_RE = /본인\s*인증/;

/** /face-verify/status → 얼굴 인증 진행 여부. 본인인증 단계는 없다(항상 건너뜀).
 *  'proceed' = 동의·보호자·촬영 흐름으로, 'unavailable' = 구서버·서버 요구로 진행 불가(일반 안내). */
export function faceIdentityRoute(st: { identity_required?: boolean | null; is_verified?: boolean | null } | null | undefined): 'proceed' | 'unavailable' {
  if (!st) return 'unavailable';
  if (st.identity_required === false) return 'proceed';
  if (st.is_verified) return 'proceed';
  return 'unavailable';
}

/** 서버 403 identity_verification_required(또는 '본인인증' 문장 403) 여부 */
export function isIdentityRequiredError(status: number | undefined, data: any): boolean {
  if (data?.error === 'identity_verification_required' || data?.code === 'identity_verification_required') return true;
  if (status !== 403) return false;
  const text = [data?.detail, data?.message, data?.error].filter((x) => typeof x === 'string').join(' ');
  return IDENTITY_TEXT_RE.test(text);
}

/** 서버 문장을 노출해도 되는지 — 비었거나 '본인인증' 유도 문장이면 fallback */
export function sanitizeServerText(text: unknown, fallback: string): string {
  if (typeof text !== 'string' || !text.trim()) return fallback;
  if (IDENTITY_TEXT_RE.test(text)) return fallback;
  return text.trim();
}
