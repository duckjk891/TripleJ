// [Marquee] 넘치는 텍스트를 말줄임(...) 대신 좌우로 흘려보내는 컴포넌트.
// 컨테이너보다 텍스트가 길 때만 애니메이션(loop), 아니면 정적 표시.
import { useEffect, useRef, useState } from 'react';
import { View, Animated, Easing, StyleSheet, TextProps } from 'react-native';
import AppText from './ui/AppText';

interface Props {
  text: string;
  variant?: any;      // AppText variant
  tone?: any;         // AppText tone
  style?: TextProps['style'];
  gap?: number;       // 반복 사이 간격
  speed?: number;     // px/sec
}

export default function Marquee({ text, variant = 'bodyStrong', tone = 'primary', style, gap = 32, speed = 40 }: Props) {
  const [containerW, setContainerW] = useState(0);
  const [textW, setTextW] = useState(0);
  const x = useRef(new Animated.Value(0)).current;

  const overflow = textW > 0 && containerW > 0 && textW > containerW;

  useEffect(() => {
    x.stopAnimation();
    x.setValue(0);
    if (!overflow) return;
    const distance = textW + gap;                 // 한 바퀴 이동 거리(텍스트+간격)
    const duration = (distance / speed) * 1000;
    const anim = Animated.loop(
      Animated.timing(x, { toValue: -distance, duration, easing: Easing.linear, useNativeDriver: true }),
    );
    anim.start();
    return () => anim.stop();
  }, [overflow, textW, containerW, gap, speed, x]);

  return (
    <View style={styles.container} onLayout={(e) => setContainerW(e.nativeEvent.layout.width)}>
      {overflow ? (
        <Animated.View style={[styles.track, { transform: [{ translateX: x }] }]}>
          <AppText variant={variant} tone={tone} numberOfLines={1} style={style}>{text}</AppText>
          <View style={{ width: gap }} />
          <AppText variant={variant} tone={tone} numberOfLines={1} style={style}>{text}</AppText>
        </Animated.View>
      ) : (
        <AppText variant={variant} tone={tone} numberOfLines={1} style={style}>{text}</AppText>
      )}
      {/* 텍스트 실제 폭 측정용(투명, 레이아웃에서 제외) */}
      <AppText
        variant={variant}
        numberOfLines={1}
        style={[style, styles.measure]}
        onLayout={(e) => setTextW(e.nativeEvent.layout.width)}
      >
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden', flexShrink: 1 },
  track: { flexDirection: 'row' },
  measure: { position: 'absolute', opacity: 0, left: 0, top: 0 },
});
