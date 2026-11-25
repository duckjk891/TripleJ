// [CarolReel] v3.438 스타룰렛 — 숫자가 입체 원통처럼 위에서 아래로 빠르게 굴러가다가, result 가 오면 가운데에서 딱 멈춘다.
// 줄무늬·굵은 테두리 없이 깊은 밤 배경 + 유리 칸 하나(대표 11-24 '세련되게'). 결과는 서버가 정한다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { AppText } from './ui';
import { CURRENCY_ICON } from '../constants/currency'; // 앱 공통 스타 이모지(대표 11-24 '우리 이모지로')
import { ROW_H, SPEED, reelOrder, stopAt, stopMs } from '../utils/carolStop';

const VISIBLE = 5; // 보이는 줄(가운데 = 3번째)
const COPIES = 3;
const ROLL_SEC = 120; // 한 번에 걸어 두는 굴림 시간(그 안에 스톱을 안 누르면 이어서 다시)
const NATIVE = Platform.OS !== 'web';
const STAGE_H = ROW_H * VISIBLE;
const MID = Math.floor(VISIBLE / 2);
export const REEL_BG = '#0d0a24';

const CHAMPAGNE = '#ffe7b0';
const numberColor = (v: number) => (v >= 100 ? CHAMPAGNE : v >= 50 ? '#f5c6ff' : '#ffffff');

// 눈송이 [가로 %, 시작 높이 비율, 크기, 진하기]
const SNOW: [number, number, number, number][] = [
  [6, 0.1, 3, 0.5], [15, 0.62, 2, 0.35], [24, 0.35, 2, 0.45], [33, 0.85, 3, 0.3], [44, 0.2, 2, 0.35],
  [57, 0.7, 2, 0.4], [66, 0.05, 3, 0.35], [76, 0.48, 2, 0.5], [86, 0.9, 2, 0.4], [94, 0.3, 3, 0.45],
];
const SPARKS = Array.from({ length: 14 }, (_, i) => (i * 2 * Math.PI) / 14);

interface Props {
  amounts: number[];
  running: boolean;
  /** 값이 들어오면 그 값이 가운데 오게 멈추고 onDone */
  result: number | null;
  onDone: () => void;
}

export default function CarolReel({ amounts, running, result, onDone }: Props) {
  const order = useMemo(() => reelOrder(amounts), [amounts.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = order.length;
  const pos = useRef(new Animated.Value(0)).current;
  const blur = useRef(new Animated.Value(0)).current; // 0 = 또렷, 1 = 빠르게 구르는 중(길게 늘어남)
  const win = useRef(new Animated.Value(0)).current;
  const burst = useRef(new Animated.Value(0)).current;
  const snow = useRef(new Animated.Value(0)).current;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const calm = useRef(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { calm.current = v; }).catch(() => {}).finally(() => {
      if (!alive || calm.current) return;
      Animated.loop(Animated.timing(snow, { toValue: 1, duration: 11000, easing: Easing.linear, useNativeDriver: NATIVE })).start();
    });
    return () => {
      alive = false;
      [pos, blur, win, burst, snow].forEach((v) => v.stopAnimation());
    };
  }, [pos, blur, win, burst, snow]);

  // 굴러가는 동안
  useEffect(() => {
    if (!running || result !== null || calm.current) return undefined;
    let alive = true;
    let from = 0;
    Animated.timing(blur, { toValue: 1, duration: 260, useNativeDriver: NATIVE }).start();
    const roll = () => {
      from += SPEED * ROLL_SEC;
      Animated.timing(pos, { toValue: from, duration: ROLL_SEC * 1000, easing: Easing.linear, useNativeDriver: NATIVE })
        .start(({ finished }) => { if (alive && finished) roll(); });
    };
    roll();
    return () => { alive = false; };
  }, [running, result, pos, blur]);

  // 결과가 온 뒤 — 지금 위치에서 이어서 느려지며 가운데에 딱 멈춤
  useEffect(() => {
    if (result === null) return undefined;
    let alive = true;
    const idx = order.indexOf(result);
    const finish = () => {
      if (!alive) return;
      setDone(true);
      doneRef.current();
      if (calm.current) { win.setValue(1); return; }
      Animated.parallel([
        Animated.spring(win, { toValue: 1, friction: 5, tension: 90, useNativeDriver: NATIVE }),
        Animated.timing(burst, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE }),
      ]).start();
    };
    pos.stopAnimation((cur) => {
      if (!alive) return;
      if (idx < 0) { finish(); return; }
      const to = stopAt(n, cur, idx);
      if (calm.current) { pos.setValue(to); finish(); return; }
      const ms = stopMs(to - cur);
      Animated.timing(blur, { toValue: 0, duration: ms * 0.75, easing: Easing.in(Easing.quad), useNativeDriver: NATIVE }).start();
      Animated.timing(pos, { toValue: to, duration: ms, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE })
        .start(({ finished }) => { if (finished) finish(); });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const cycle = n * ROW_H;
  const wrapped = useMemo(() => Animated.modulo(pos, Math.max(1, cycle)), [pos, cycle]);
  if (!n) return null;
  // 가운데 줄 = 2n 번째. 한 묶음(n줄) 내려가면 처음과 같은 그림이라 끊김 없이 돈다.
  const base = (MID - 2 * n) * ROW_H;
  const stretch = blur.interpolate({ inputRange: [0, 1], outputRange: [1, 1.55] });
  const soft = blur.interpolate({ inputRange: [0, 1], outputRange: [1, 0.62] });

  return (
    <View style={styles.stage} accessibilityLabel={done && result !== null ? `스타 ${result}개` : '스타룰렛'}>
      <LinearGradient colors={['#1d1147', '#2b1458', REEL_BG]} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />
      {SNOW.map(([x, y, s, o], i) => (
        <Animated.View
          key={i}
          style={[styles.snow, {
            left: `${x}%`, width: s, height: s, borderRadius: s, opacity: o,
            transform: [{ translateY: Animated.modulo(Animated.add(Animated.multiply(snow, STAGE_H), y * STAGE_H), STAGE_H) }],
          }]}
        />
      ))}

      {/* 가운데 유리 칸 — 멈추면 보랏빛으로 차오름 */}
      <View style={styles.glass}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: win }]}>
          <LinearGradient colors={['#7c3aed', '#c026d3', '#f0a6ff']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
      </View>

      <Animated.View style={{ transform: [{ translateY: Animated.add(wrapped, base) }] }}>
        {Array.from({ length: n * COPIES }, (_, k) => {
          const v = order[k % n];
          // 이 줄과 가운데 사이 거리 = wrapped + off
          const off = k * ROW_H + base - MID * ROW_H;
          const at = [-2, -1, 0, 1, 2].map((r) => r * ROW_H - off);
          const scale = wrapped.interpolate({ inputRange: at, outputRange: [0.46, 0.66, 1, 0.66, 0.46], extrapolate: 'clamp' });
          const opacity = wrapped.interpolate({ inputRange: at, outputRange: [0.06, 0.34, 1, 0.34, 0.06], extrapolate: 'clamp' });
          const rotateX = wrapped.interpolate({ inputRange: at, outputRange: ['62deg', '38deg', '0deg', '-38deg', '-62deg'], extrapolate: 'clamp' });
          const won = done && result === v && k === 2 * n - centerShift(n, order.indexOf(v));
          return (
            <Animated.View key={k} style={[styles.row, { opacity, transform: [{ perspective: 600 }, { rotateX }, { scale }] }]}>
              <Animated.View
                style={[styles.rowIn, {
                  opacity: soft,
                  transform: [{ scaleY: stretch }, ...(won ? [{ scale: win.interpolate({ inputRange: [0, 1], outputRange: [1, 1.16] }) }] : [])],
                }]}
              >
                <AppText style={styles.star} allowFontScaling={false}>{CURRENCY_ICON}</AppText>
                <AppText style={[styles.num, { color: won ? '#ffffff' : numberColor(v) }]} allowFontScaling={false}>{v}</AppText>
              </Animated.View>
            </Animated.View>
          );
        })}
      </Animated.View>

      <LinearGradient colors={['#1d1147', 'rgba(29,17,71,0)']} style={[styles.fade, { top: 0 }]} />
      <LinearGradient colors={['rgba(13,10,36,0)', REEL_BG]} style={[styles.fade, { bottom: 0 }]} />

      {done ? (
        <View style={styles.burst}>
          {SPARKS.map((a, i) => {
            const r = 92 + (i % 3) * 26;
            return (
              <Animated.View
                key={i}
                style={[styles.spark, {
                  opacity: burst.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 0] }),
                  transform: [
                    { translateX: burst.interpolate({ inputRange: [0, 1], outputRange: [Math.cos(a) * 96, Math.cos(a) * r * 1.35] }) },
                    { translateY: burst.interpolate({ inputRange: [0, 1], outputRange: [Math.sin(a) * 46, Math.sin(a) * r] }) },
                    { scale: burst.interpolate({ inputRange: [0, 1], outputRange: [1.3, 0.5] }) },
                    { rotate: burst.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${i % 2 ? 140 : -140}deg`] }) },
                  ],
                }]}
              >
                <AppText style={styles.sparkText} allowFontScaling={false}>{CURRENCY_ICON}</AppText>
              </Animated.View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/** 멈춘 뒤(위치 = 줄 높이의 배수) 값 idx 가 놓인 줄이 2n 에서 얼마나 위인지 */
function centerShift(n: number, idx: number): number {
  return (n - idx) % n;
}

const styles = StyleSheet.create({
  stage: { width: '100%', height: STAGE_H, overflow: 'hidden', backgroundColor: REEL_BG },
  snow: { position: 'absolute', top: 0, backgroundColor: '#ffffff' },
  row: { height: ROW_H, alignItems: 'center', justifyContent: 'center' },
  rowIn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  num: { fontSize: 50, lineHeight: 58, fontWeight: '700', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  glass: {
    position: 'absolute', left: 36, right: 36, top: ROW_H * MID - 8, height: ROW_H + 16, borderRadius: (ROW_H + 16) / 2, overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
  },
  fade: { position: 'absolute', left: 0, right: 0, height: ROW_H * 1.3, pointerEvents: 'none' },
  burst: { position: 'absolute', left: '50%', top: STAGE_H / 2, pointerEvents: 'none' },
  spark: { position: 'absolute', left: -12, top: -12, width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  sparkText: { fontSize: 17, lineHeight: 24 },
  star: { fontSize: 34, lineHeight: 46 },
});
