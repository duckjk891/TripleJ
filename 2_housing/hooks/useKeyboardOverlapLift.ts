// [useKeyboardOverlapLift] v3.207(⑤): 미사용(소비처 0) — react-native-keyboard-controller 전환으로 대체.
// 실패 인과: 실측 겹침 방식이어도 트리거가 RN Keyboard 이벤트라, SDK 54 edge-to-edge 강제+Fabric 조합
// 실기기에서 keyboardDidShow 미발화/좌표계 불일치 시 리프트가 0으로 남는다(새 APK 재현 확정).
// 신규 소비 금지 — keyboard-controller KeyboardAvoidingView/useKeyboardState를 사용할 것. 파일은 기록용 보존.
// ---- 이하 v3.205(①) 원문 ----
// [useKeyboardOverlapLift] v3.205(①): Android 한정 — 키보드와 대상 뷰의 "실측 겹침"만큼만 들어올리는 훅.
// useAndroidKeyboardLift(v3.201, Modal 전용 셈법: kbHeight - insets.bottom)와의 차별점:
// 전체 화면에서는 창 리사이즈(adjustResize) 동작 여부가 기기별로 갈린다 —
// Android 15(API 35)+는 edge-to-edge 강제로 창이 축소되지 않아 키보드가 하단 뷰를 가리고,
// API 34 이하는 창이 리사이즈되어 이미 가림이 없다. 고정 리프트를 더하면 구버전에서 이중 보정(간격).
// → keyboardDidShow의 endCoordinates.screenY(키보드 상단 절대좌표)와 대상 뷰 measureInWindow의
//   하단 좌표(y+height)를 비교해 실제 겹치는 픽셀만 리프트로 반환한다.
//   창이 이미 리사이즈된 기기는 측정 시점에 겹침 0 → 리프트 0(이중 보정 구조적 불가).
//   keyboardDidHide 시 무조건 0 리셋(잔존 간격 불가) — v3.201 관행 계승(리스너 등록/해제 쌍).
// 사용: const { lift, targetRef } = useKeyboardOverlapLift('[DmChat]');
//   <View ref={targetRef} style={{ marginBottom: 기본마진 + lift }}> — marginBottom에 적용
//   (paddingBottom 합산 금지 — v3.201 §1 교훈 동일). iOS는 항상 0 — 기존 KAV(padding) 경로가 담당.
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, type View } from 'react-native';

export function useKeyboardOverlapLift(logTag?: string) {
  const targetRef = useRef<View>(null);
  const [lift, setLift] = useState(0);
  // 이미 리프트가 적용된 상태에서 keyboardDidShow가 재발화(자판 높이 변경 등)하면
  // 측정된 하단 좌표가 리프트만큼 올라가 있다 — 원위치 기준 겹침 = 측정 겹침 + 현재 리프트.
  const liftRef = useRef(0);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      try {
        const kbTop = e.endCoordinates?.screenY;
        const node = targetRef.current;
        if (typeof kbTop !== 'number' || !node) return;
        node.measureInWindow((_x, y, _w, h) => {
          if (typeof y !== 'number' || typeof h !== 'number') return;
          const overlap = Math.max(0, Math.ceil(y + h + liftRef.current - kbTop));
          liftRef.current = overlap;
          if (__DEV__ && logTag) console.info(`${logTag} kb overlap lift`, { overlap });
          setLift(overlap);
        });
      } catch (err) {
        console.error('[useKeyboardOverlapLift] 겹침 측정 실패', err);
        liftRef.current = 0;
        setLift(0);
      }
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      liftRef.current = 0;
      setLift(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
      liftRef.current = 0;
      setLift(0);
    };
  }, [logTag]);

  return { lift, targetRef };
}
