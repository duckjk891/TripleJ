// [loginModal] v3.276 — 로그인 모달 전역 열기. 호스트(components/auth/LoginModalHost, App.tsx 에 1개)가
// 마운트 시 opener 를 등록한다. "로그인하고 시작하기 → 설정 화면 이동" 2단계를 없애고 어디서든 즉시 모달.
export interface LoginModalOptions {
  /** 원격 로그·분석용 진입 사유(예: 'map_guest', 'guest_trial_used', 'feed') */
  reason?: string;
  /** 로그인/가입 성공 직후 1회 실행(원래 하려던 동작 이어가기) */
  afterLogin?: () => void;
}
type Opener = (opts?: LoginModalOptions) => void;
let opener: Opener | null = null;

export function setLoginModalOpener(fn: Opener | null): void {
  opener = fn;
}

export function openLoginModal(opts?: LoginModalOptions): void {
  if (opener) opener(opts);
  else console.warn('[LoginModal] opener not mounted', { reason: opts?.reason });
}
