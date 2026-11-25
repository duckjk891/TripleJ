// v3.442 [Winter] 상단바 아래 조명 장식 — 가는 줄에 달린 작은 불빛들이 세 묶음으로 천천히 번갈아 밝아진다(대표 11-25).
// 줄·전구는 그림 1장, 빛은 묶음별 그림 3장의 투명도만 움직여(네이티브 드라이버) 가볍다. 터치 통과·화면이 가려지면 멈춤.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import Svg, { Circle, Defs, Ellipse, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { isXmasSeason } from '../../utils/winter';

const NATIVE = Platform.OS !== 'web';
export const LIGHTS_H = 34;
const TOP = 1;
const SAG = 10;
// 따뜻한 금빛을 바탕으로 앱 보라·분홍, 얼음빛을 섞는다
const COLORS = ['#ffd27a', '#e58bff', '#ffd27a', '#8fd0ff'];
const GROUPS = 3;

interface Bulb { x: number; y: number; color: number; group: number; rot: number }

function layout(w: number): { wire: string; bulbs: Bulb[] } {
  const n = Math.max(2, Math.round(w / 125));
  const seg = w / n;
  let wire = `M0 ${TOP}`;
  const bulbs: Bulb[] = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    const x0 = i * seg;
    wire += `Q${x0 + seg / 2} ${TOP + SAG * 2} ${x0 + seg} ${TOP}`;
    const per = 5;
    for (let j = 0; j < per; j++) {
      const t = (j + 0.5) / per;
      bulbs.push({
        x: x0 + t * seg,
        y: TOP + SAG * 4 * t * (1 - t),
        color: k % COLORS.length,
        group: (k * 2 + i) % GROUPS,
        rot: (0.5 - t) * 34,
      });
      k++;
    }
  }
  return { wire, bulbs };
}

export default function StringLights() {
  if (!isXmasSeason()) return null;
  return <Inner />;
}

function Inner() {
  const focused = useIsFocused();
  const [w, setW] = useState(0);
  const [calm, setCalm] = useState(false);
  const glow = useRef(Array.from({ length: GROUPS }, () => new Animated.Value(0))).current;
  const { wire, bulbs } = useMemo(() => layout(w || 1), [w]);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().catch(() => false).then((v) => { if (alive) setCalm(!!v); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!focused || calm) return undefined;
    const loops = glow.map((v, i) => {
      v.setValue(0);
      const half = 1300 + i * 260; // 묶음마다 빠르기가 달라 기계적으로 깜빡이지 않는다
      return Animated.loop(Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: half, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE }),
        Animated.timing(v, { toValue: 0, duration: half, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE }),
      ]));
    });
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [focused, calm, glow]);

  return (
    <View style={styles.wrap} pointerEvents="none" onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))}>
      {w > 0 ? (
        <>
          <Svg width={w} height={LIGHTS_H} style={StyleSheet.absoluteFill}>
            <Path d={wire} stroke="#3d2f6b" strokeWidth={1.2} fill="none" />
            {bulbs.map((b, i) => (
              <Rect key={i} x={b.x - 1.5} y={b.y - 0.5} width={3} height={3.2} rx={0.8} fill="#57468f" transform={`rotate(${b.rot} ${b.x} ${b.y})`} />
            ))}
            {bulbs.map((b, i) => (
              <Ellipse key={`b${i}`} cx={b.x} cy={b.y + 6} rx={2.7} ry={3.9} fill={COLORS[b.color]} fillOpacity={0.6} transform={`rotate(${b.rot} ${b.x} ${b.y})`} />
            ))}
          </Svg>
          {glow.map((v, g) => (
            <Animated.View key={g} style={[StyleSheet.absoluteFill, { opacity: calm ? 0.85 : v.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }) }]}>
              <Svg width={w} height={LIGHTS_H}>
                <Defs>
                  {COLORS.map((c, i) => (
                    <RadialGradient key={i} id={`sl${g}_${i}`} cx="50%" cy="50%" r="50%">
                      <Stop offset="0" stopColor={c} stopOpacity={0.75} />
                      <Stop offset="0.45" stopColor={c} stopOpacity={0.26} />
                      <Stop offset="1" stopColor={c} stopOpacity={0} />
                    </RadialGradient>
                  ))}
                </Defs>
                {bulbs.filter((b) => b.group === g).map((b, i) => (
                  <Circle key={i} cx={b.x} cy={b.y + 6} r={12} fill={`url(#sl${g}_${b.color})`} />
                ))}
                {bulbs.filter((b) => b.group === g).map((b, i) => (
                  <Ellipse key={`e${i}`} cx={b.x} cy={b.y + 6} rx={2.7} ry={3.9} fill={COLORS[b.color]} transform={`rotate(${b.rot} ${b.x} ${b.y})`} />
                ))}
                {bulbs.filter((b) => b.group === g).map((b, i) => (
                  <Ellipse key={`w${i}`} cx={b.x - 0.5} cy={b.y + 5.2} rx={1.1} ry={1.8} fill="#fffdf4" fillOpacity={0.95} transform={`rotate(${b.rot} ${b.x} ${b.y})`} />
                ))}
              </Svg>
            </Animated.View>
          ))}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, height: LIGHTS_H, zIndex: 2 },
});
