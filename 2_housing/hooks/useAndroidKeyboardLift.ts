// [useAndroidKeyboardLift] v3.207(⑤): 미사용(소비처 0) — react-native-keyboard-controller 전환으로 대체.
// 실패 인과: RN Keyboard 이벤트(keyboardDidShow) 의존 → SDK 54 edge-to-edge 강제+Fabric 조합
// 실기기에서 미발화/endCoordinates 좌표계 불일치로 리프트 0 잔존(사용자 실기기+새 APK 재현 확정).
// 신규 소비 금지 — keyboard-controller KeyboardAvoidingView/useKeyboardState를 사용할 것. 파일은 기록용 보존.
// ---- 이하 v3.201(A) 원문 ----
// [useAndroidKeyboardLift] v3.201(A): Android 한정 "키보드 위로 들어올리기" 공용 훅.
// PlaylistPickerSheet v3.198의 수동 kbPad 로직을 그대로 추출 — Modal(별도 window)에서
// Android KAV padding이 키보드 닫힘 후 잔존 간격을 남기는 문제(v3.196→198) 때문에
// KAV 재도입 대신 keyboardDidShow/Hide로 직접 계산한다(재퇴행 금지).
// - show: max(0, 키보드 높이 - insets.bottom) — 시트/모달 자체 하단 인셋 패딩과의 이중 계상 방지
// - hide: 무조건 0 리셋 → 잔존 간격이 구조적으로 불가
// - visible 게이트: 닫힌 모달이 리스너를 들고 있지 않게 + 닫힐 때 0 리셋
// - v3.197 U-7 교훈: 리스너는 반드시 등록/해제 쌍 (visible false·언마운트 시 remove)
// 사용처: 시트/모달 컨테이너의 marginBottom에 반환값을 적용(paddingBottom 합산 금지 —
// maxHeight 클램프가 있으면 콘텐츠만 커지고 입력행은 키보드 뒤에 남는다. v3.201 §1 근본 원인).
// iOS는 항상 0 반환 — 기존 KAV(padding) 경로가 담당.
import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function useAndroidKeyboardLift(visible: boolean): number {
  const insets = useSafeAreaInsets();
  const [kbPad, setKbPad] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'android' || !visible) { setKbPad(0); return; }
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      setKbPad(Math.max(0, e.endCoordinates.height - insets.bottom));
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKbPad(0));
    return () => { showSub.remove(); hideSub.remove(); setKbPad(0); };
  }, [visible, insets.bottom]);

  return kbPad;
}
