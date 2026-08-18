// [Marquee] 넘치는 텍스트를 말줄임(...) 대신 좌우로 흘려보내는 컴포넌트.
// 컨테이너보다 텍스트가 길 때만 애니메이션(loop), 아니면 정적 표시(말줄임 없음).
// 측정: 실제 표시 텍스트(flexShrink:0, web nowrap)를 그대로 onLayout → 네이티브·웹 모두 자연폭.
import { useEffect, useRef, useState } from 'react';
import { View, Animated, Easing, StyleSheet, Platform, TextProps } from 'react-native';
import AppText from './ui/AppText';

interface Props {
  text: string;
  variant?: any;      // AppText variant
  tone?: any;         // AppText tone
  style?: TextProps['style'];
  gap?: number;       // 반복 사이 간격
  speed?: number;     // px/sec
}

const NOWRAP = Platform.OS === 'web' ? ({ whiteSpace: 'nowrap' } as any) : {};

export default function Marquee({ text, variant = 'bodyStrong', tone = 'primary', style, gap = 36, speed = 40 }: Props) {
  const [containerW, setContainerW] = useState(0);
  const [textW, setTextW] = useState(0);
  const x = useRef(new Animated.Value(0)).current;

  const overflow = textW > 0 && containerW > 0 && textW > containerW + 1;

  useEffect(() => {
    x.stopAnimation();
    x.setValue(0);
    if (!overflow) return;
    const distance = textW + gap;
    const duration = (distance / speed) * 1000;
    const anim = Animated.loop(
      Animated.timing(x, {
        toValue: -distance,
        duration,
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== 'web', // 웹은 네이티브 드라이버 미지원
      }),
    );
    anim.start();
    return () => anim.stop();
  }, [overflow, textW, gap, speed, x]);

  return (
    <View style={styles.container} onLayout={(e) => setContainerW(e.nativeEvent.layout.width)}>
      <Animated.View style={[styles.track, overflow ? { transform: [{ translateX: x }] } : null]}>
        {/* 실제 표시 = 측정 대상. flexShrink:0(+web nowrap) → 한 줄 자연폭, 말줄임 없음 */}
        <AppText
          variant={variant}
          tone={tone}
          style={[style, styles.copy]}
          onLayout={(e) => setTextW(e.nativeEvent.layout.width)}
        >
          {text}
        </AppText>
        {overflow ? (
          <>
            <View style={{ width: gap }} />
            <AppText variant={variant} tone={tone} style={[style, styles.copy]}>{text}</AppText>
          </>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden', flexShrink: 1, width: '100%' },
  track: { flexDirection: 'row', alignItems: 'center' },
  // 한 줄 유지(개행/말줄임 없음). web은 whiteSpace:nowrap로 확실히.
  copy: { flexShrink: 0, ...NOWRAP },
});
