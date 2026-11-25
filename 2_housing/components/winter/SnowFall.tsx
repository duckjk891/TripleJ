// v3.442 [Winter] 눈 내리는 배경 — 뒤(작고 느림)·가운데·앞(크고 빠름) 겹이 다른 빠르기로 내리고 좌우로 살짝 흔들린다.
// 애니메이션 값은 겹마다 2개뿐(네이티브 드라이버)이라 가볍다. 화면이 가려지면 멈춘다. 터치는 통과.
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { NavigationContext } from '@react-navigation/native';
import { isWinterSeason } from '../../utils/winter';

const NATIVE = Platform.OS !== 'web';

type Mode = 'splash' | 'app';
type LayerCfg = { count: number; size: [number, number]; opacity: [number, number]; ms: number; sway: number };
const LAYERS: Record<Mode, LayerCfg[]> = {
  splash: [
    { count: 20, size: [2, 3], opacity: [0.35, 0.6], ms: 15000, sway: 8 },
    { count: 14, size: [3, 5], opacity: [0.5, 0.8], ms: 10000, sway: 14 },
    { count: 8, size: [6, 8], opacity: [0.75, 0.95], ms: 7000, sway: 22 },
  ],
  app: [
    { count: 10, size: [2, 3], opacity: [0.28, 0.42], ms: 24000, sway: 8 },
    { count: 7, size: [3, 4], opacity: [0.36, 0.55], ms: 17000, sway: 14 },
  ],
};

/** 매번 같은 자리(고정 씨앗) — 렌더마다 눈송이가 튀지 않게 */
function rand(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** 큰 눈송이는 가장자리가 부드럽게 번지는 그림으로 */
const soft = (size: number) => size > 4.5;

function useFocusedSafe(): boolean {
  const nav = useContext(NavigationContext) as any;
  const [focused, setFocused] = useState<boolean>(() => (nav?.isFocused ? nav.isFocused() : true));
  useEffect(() => {
    if (!nav?.addListener) return undefined;
    setFocused(nav.isFocused());
    const a = nav.addListener('focus', () => setFocused(true));
    const b = nav.addListener('blur', () => setFocused(false));
    return () => {
      a();
      b();
    };
  }, [nav]);
  return focused;
}

export default function SnowFall({ mode = 'app' }: { mode?: Mode }) {
  if (!isWinterSeason()) return null;
  return <SnowFallInner mode={mode} />;
}

function SnowFallInner({ mode }: { mode: Mode }) {
  const focused = useFocusedSafe();
  const [h, setH] = useState(0);
  const [calm, setCalm] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().catch(() => false).then((v) => { if (alive) setCalm(!!v); });
    return () => { alive = false; };
  }, []);
  return (
    <View style={[StyleSheet.absoluteFill, styles.clip]} pointerEvents="none" onLayout={(e) => setH(Math.round(e.nativeEvent.layout.height))}>
      {h > 0 && !calm ? LAYERS[mode].map((l, i) => <Layer key={i} cfg={l} index={i} h={h} run={focused} />) : null}
    </View>
  );
}

function Layer({ cfg, index, h, run }: { cfg: LayerCfg; index: number; h: number; run: boolean }) {
  const fall = useRef(new Animated.Value(0)).current;
  const sway = useRef(new Animated.Value(0)).current;
  const span = h + 24;
  useEffect(() => {
    if (!run) return undefined;
    // 멈췄다 다시 시작할 때 중간 값에서 반복되면 한 바퀴마다 눈이 튄다 — 처음 값에서 시작
    fall.setValue(0);
    sway.setValue(0);
    const half = 2600 + index * 500;
    const a = Animated.loop(Animated.timing(fall, { toValue: 1, duration: cfg.ms, easing: Easing.linear, useNativeDriver: NATIVE }));
    const b = Animated.loop(Animated.sequence([
      Animated.timing(sway, { toValue: 1, duration: half, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE }),
      Animated.timing(sway, { toValue: 0, duration: half, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE }),
    ]));
    a.start();
    b.start();
    return () => {
      a.stop();
      b.stop();
    };
  }, [run, fall, sway, cfg.ms, index]);
  const flakes = useMemo(() => Array.from({ length: cfg.count }, (_, i) => {
    const s = index * 100 + i + 1;
    return {
      x: ((i + rand(s)) / cfg.count) * 100,
      y: rand(s + 37),
      size: cfg.size[0] + rand(s + 71) * (cfg.size[1] - cfg.size[0]),
      opacity: cfg.opacity[0] + rand(s + 53) * (cfg.opacity[1] - cfg.opacity[0]),
      dir: rand(s + 91) > 0.5 ? 1 : -1,
    };
  }), [cfg, index]);
  return (
    <>
      {flakes.map((f, i) => (
        <Animated.View
          key={i}
          style={[styles.flake, soft(f.size) && styles.clear, {
            left: `${f.x}%`, width: f.size, height: f.size, borderRadius: f.size, opacity: f.opacity,
            transform: [
              { translateY: Animated.modulo(Animated.add(Animated.multiply(fall, span), f.y * span), span) },
              { translateX: sway.interpolate({ inputRange: [0, 1], outputRange: [-cfg.sway * f.dir, cfg.sway * f.dir] }) },
            ],
          }]}
        >
          {soft(f.size) ? (
            <Svg width={f.size * 2.4} height={f.size * 2.4} style={{ position: 'absolute', left: -f.size * 0.7, top: -f.size * 0.7 }}>
              <Defs>
                <RadialGradient id={`flake${index}_${i}`} cx="50%" cy="50%" r="50%">
                  <Stop offset="0" stopColor="#ffffff" stopOpacity={1} />
                  <Stop offset="0.4" stopColor="#f3f5ff" stopOpacity={0.85} />
                  <Stop offset="1" stopColor="#dfe5ff" stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Circle cx={f.size * 1.2} cy={f.size * 1.2} r={f.size * 1.2} fill={`url(#flake${index}_${i})`} />
            </Svg>
          ) : null}
        </Animated.View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  flake: { position: 'absolute', top: -12, backgroundColor: '#f6f8ff' },
  clear: { backgroundColor: 'transparent' },
});
