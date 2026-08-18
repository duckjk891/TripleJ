// [Marquee] 넘치는 텍스트를 말줄임(...) 대신 좌우로 흘려보내는 컴포넌트.
// 컨테이너보다 텍스트가 길 때만 애니메이션(loop), 아니면 정적 표시(말줄임 없음).
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

export default function Marquee({ text, variant = 'bodyStrong', tone = 'primary', style, gap = 36, speed = 40 }: Props) {
  const [containerW, setContainerW] = useState(0);
  const [textW, setTextW] = useState(0);
  const x = useRef(new Animated.Value(0)).current;

  const overflow = textW > 0 && containerW > 0 && textW > containerW + 1;

  useEffect(() => {
    x.stopAnimation();
    x.setValue(0);
    if (!overflow) return;
    const distance = textW + gap;                 // 한 바퀴 이동 거리(텍스트+간격)
    const duration = (distance / speed) * 1000;
    const anim = Animated.loop(
      Animated.timing(x, {
        toValue: -distance,
        duration,
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== 'web',   // 웹은 네이티브 드라이버 미지원
      }),
    );
    anim.start();
    return () => anim.stop();
  }, [overflow, textW, gap, speed, x]);

  return (
    <View style={styles.container} onLayout={(e) => setContainerW(e.nativeEvent.layout.width)}>
      {overflow ? (
        // 복사본 폭을 '측정된 자연폭(textW)+여유'로 고정 + numberOfLines 미사용 → 말줄임(...) 없이 전체 텍스트가 흐름
        <Animated.View style={[styles.track, { transform: [{ translateX: x }] }]}>
          <AppText variant={variant} tone={tone} style={[style, styles.copy, { width: textW + 4 }]}>{text}</AppText>
          <View style={{ width: gap }} />
          <AppText variant={variant} tone={tone} style={[style, styles.copy, { width: textW + 4 }]}>{text}</AppText>
        </Animated.View>
      ) : (
        // 넘치지 않을 땐 정적. (측정 전이라도) 짧은 제목은 어차피 안 잘림.
        <AppText variant={variant} tone={tone} numberOfLines={1} style={style}>{text}</AppText>
      )}
      {/* 텍스트 자연 폭 측정용(투명, 레이아웃 영향 없음, 개행/클립 없음) */}
      <AppText
        variant={variant}
        style={[style, styles.measure]}
        onLayout={(e) => setTextW(e.nativeEvent.layout.width)}
      >
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'relative', overflow: 'hidden', flexShrink: 1, width: '100%' },
  track: { flexDirection: 'row', alignItems: 'center' },
  // 한 줄 유지(개행/말줄임 없음). whiteSpace는 웹 전용(RN은 무시).
  copy: { flexShrink: 0, ...(Platform.OS === 'web' ? ({ whiteSpace: 'nowrap' } as any) : {}) },
  // 자연 폭 측정: 절대배치 + 좌상단 + '한 줄 강제'(web nowrap)로 콘텐츠 자연폭 측정(개행 방지)
  measure: {
    position: 'absolute', opacity: 0, left: 0, top: 0, alignSelf: 'flex-start',
    ...(Platform.OS === 'web' ? ({ whiteSpace: 'nowrap' } as any) : {}),
  },
});
