// v3.326 [EnterToSend] PC 웹 채팅 입력: Enter = 전송, Shift+Enter = 줄바꿈(오리쟁이 10-06 신고). 모바일(웹·앱)은 Enter = 줄바꿈 유지
// (휴대폰 메신저 관행 — 보내기 버튼으로 전송). 한글 조합 중 Enter(IME, keyCode 229)는 전송하지 않는다.
import { Platform } from 'react-native';

export function isDesktopWeb(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  try {
    const fine = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;
    const touch = 'ontouchstart' in window || (navigator as any)?.maxTouchPoints > 0;
    return fine && !touch;
  } catch {
    return false;
  }
}

/** TextInput onKeyPress 핸들러 생성 — 전송 조건이면 기본 동작(줄바꿈) 막고 onSend 실행 */
export function enterToSendHandler(onSend: () => void) {
  return (e: any) => {
    const ne = e?.nativeEvent || {};
    if (ne.key !== 'Enter' || ne.shiftKey || ne.isComposing || ne.keyCode === 229) return;
    if (!isDesktopWeb()) return;
    e.preventDefault?.();
    onSend();
  };
}
