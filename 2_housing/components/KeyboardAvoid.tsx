// v3.391 [KeyboardCtl] 입력 화면 공용 키보드 피하기 — DM·크루 채팅(v3.207⑤)과 같은 react-native-keyboard-controller 방식.
//  · 갤럭시(SDK 54 edge-to-edge 강제)에서는 창 크기가 줄지 않고 RN Keyboard 이벤트도 어긋나, RN KeyboardAvoidingView 의
//    behavior undefined/'height' 화면은 입력칸이 키보드에 가렸다. keyboard-controller 는 네이티브 IME 인셋을 직접 받는다.
//  · behavior='padding' 고정(iOS·Android 공통). 안드로이드는 이 뷰의 실제 화면 위치(네이티브 헤더 아래 등)를 재서
//    offset 을 자동으로 맞춘다(라이브러리 계산은 부모 기준 y 라 헤더 높이만큼 덜 올라가는 것 보정).
//  · iOS 는 화면마다 맞춰 둔 기존 offset(iosOffset)을 그대로 쓴다(종전과 같은 계산 — 아이폰 동작 유지).
import { useCallback, useRef, useState } from 'react';
import { Platform, type LayoutChangeEvent, type View, type ViewProps } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

type Props = ViewProps & {
  /** iOS keyboardVerticalOffset(종전 값) */
  iosOffset?: number;
  /** 안드로이드에서 자동 보정 위에 더할 값(기본 0) */
  androidExtra?: number;
  children?: React.ReactNode;
};

export default function KeyboardAvoid({ iosOffset = 0, androidExtra = 0, onLayout, children, ...rest }: Props) {
  const ref = useRef<View>(null);
  const [autoOffset, setAutoOffset] = useState(0);

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    onLayout?.(e);
    if (Platform.OS !== 'android') return;
    const layoutY = e.nativeEvent.layout.y;
    // 화면 기준 위치 - 부모 기준 위치 = 위에 있는 헤더 등 높이
    ref.current?.measureInWindow?.((_x, y) => {
      const next = Math.max(0, Math.round((y || 0) - layoutY));
      setAutoOffset((prev) => (prev === next ? prev : next));
    });
  }, [onLayout]);

  const offset = Platform.OS === 'ios' ? iosOffset : Platform.OS === 'android' ? autoOffset + androidExtra : 0;
  return (
    <KeyboardAvoidingView ref={ref as any} behavior="padding" keyboardVerticalOffset={offset} onLayout={handleLayout} {...rest}>
      {children}
    </KeyboardAvoidingView>
  );
}
