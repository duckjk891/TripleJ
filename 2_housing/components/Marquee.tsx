// [Marquee] 넘치는 텍스트를 말줄임(...) 대신 좌우로 흘려보내는 컴포넌트.
// 컨테이너보다 텍스트가 길 때만 애니메이션(loop), 아니면 정적 표시(말줄임 없음).
// 측정: 실제 표시 텍스트를 그대로 onLayout → 자연폭.
// v3.192: 네이티브에서 Text가 부모 폭 제약으로 개행되던 버그 수정 — 트랙을 수평 ScrollView
// (scrollEnabled=false)로 감싸 폭 제약 없는 컨텍스트에서 자연폭 측정·렌더(RN marquee 정석).
// 개행되면 측정폭≈컨테이너폭이 되어 overflow 판정도 항상 false였음. numberOfLines=1 이중 안전장치.
import { useEffect, useRef, useState } from 'react';
import { View, Animated, Easing, StyleSheet, Platform, TextProps, ScrollView } from 'react-native';
import AppText from './ui/AppText';

interface Props {
  text: string;
  variant?: any;      // AppText variant
  tone?: any;         // AppText tone
  style?: TextProps['style'];
  gap?: number;       // 반복 사이 간격
  speed?: number;     // px/sec
  /** v3.159: 넘치지 않을 땐 가운데 정렬(플레이어 제목처럼 center 레이아웃용). 기본 false(좌측 — 차트 행 관행) */
  center?: boolean;
}

const NOWRAP = Platform.OS === 'web' ? ({ whiteSpace: 'nowrap' } as any) : {};

export default function Marquee({ text, variant = 'bodyStrong', tone = 'primary', style, gap = 36, speed = 40, center = false }: Props) {
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
      {/* 수평 ScrollView = 측정 트랙: 자식에게 무제한 폭 제공 → 네이티브에서도 개행 없이 자연폭 측정 */}
      <ScrollView
        horizontal
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <Animated.View style={[styles.track, center && !overflow ? { justifyContent: 'center' } : null, overflow ? { transform: [{ translateX: x }] } : null]}>
          {/* 실제 표시 = 측정 대상. numberOfLines=1(+web nowrap) → 한 줄 자연폭, 말줄임 없음 */}
          <AppText
            variant={variant}
            tone={tone}
            numberOfLines={1}
            style={[style, styles.copy]}
            onLayout={(e) => setTextW(e.nativeEvent.layout.width)}
          >
            {text}
          </AppText>
          {overflow ? (
            <>
              <View style={{ width: gap }} />
              <AppText variant={variant} tone={tone} numberOfLines={1} style={[style, styles.copy]}>{text}</AppText>
            </>
          ) : null}
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden', flexShrink: 1, width: '100%' },
  // flexGrow:1 → 텍스트가 짧으면 트랙이 컨테이너 폭까지 늘어나 center 정렬 유지(v3.159 무회귀)
  scrollContent: { flexGrow: 1 },
  track: { flexDirection: 'row', alignItems: 'center', flexGrow: 1 },
  // 한 줄 유지(개행/말줄임 없음). web은 whiteSpace:nowrap로 확실히.
  copy: { flexShrink: 0, ...NOWRAP },
});
