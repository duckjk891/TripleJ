// [CarolHero] v3.440 캐롤 이벤트 머리 그림 — 불빛으로 된 크리스마스트리가 반짝이고, 눈이 내리고, 남은 시간이 흐른다(대표 11-24).
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, Ellipse, LinearGradient as SvgGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { AppText } from './ui';
import { CURRENCY_ICON } from '../constants/currency';
import { LIGHT_GROUPS, TREE_H, TREE_TIERS, TREE_W, garlandPaths, remainUntil, treeLights, two } from '../utils/carolTree';

const NATIVE = Platform.OS !== 'web';
const HERO_H = 458;
const PAD = 50; // 나무 둘레 빛 여백
const LINES = garlandPaths();
// 눈송이 [가로 %, 시작 높이 비율, 크기, 진하기]
const SNOW: [number, number, number, number][] = [
  [4, 0.1, 3, 0.5], [11, 0.62, 2, 0.35], [19, 0.35, 3, 0.4], [27, 0.85, 2, 0.35], [35, 0.15, 2, 0.4], [44, 0.5, 2, 0.3],
  [56, 0.72, 2, 0.35], [63, 0.05, 3, 0.4], [71, 0.44, 2, 0.45], [79, 0.92, 2, 0.4], [87, 0.28, 3, 0.45], [95, 0.6, 2, 0.4],
];

interface Props {
  title: string;
  subtitle: string;
  /** 남은 시간의 기준 시각과 이름 */
  until: string;
  untilName: string;
  onOver?: () => void;
}

export default function CarolHero({ title, subtitle, until, untilName, onOver }: Props) {
  const lights = useMemo(() => treeLights(), []);
  const groups = useRef(Array.from({ length: LIGHT_GROUPS }, () => new Animated.Value(0))).current;
  const snow = useRef(new Animated.Value(0)).current;
  const star = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let alive = true;
    const loops: Animated.CompositeAnimation[] = [];
    AccessibilityInfo.isReduceMotionEnabled().catch(() => false).then((calm) => {
      if (!alive || calm) return;
      groups.forEach((v, i) => {
        const half = 520 + i * 90; // 묶음마다 시작과 빠르기가 달라 불규칙하게 반짝인다
        v.setValue(i % 2);
        loops.push(Animated.loop(Animated.sequence(i % 2 ? [
          Animated.timing(v, { toValue: 0, duration: half, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE }),
          Animated.timing(v, { toValue: 1, duration: half, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE }),
        ] : [
          Animated.timing(v, { toValue: 1, duration: half, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE }),
          Animated.timing(v, { toValue: 0, duration: half, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE }),
        ])));
      });
      loops.push(Animated.loop(Animated.timing(snow, { toValue: 1, duration: 14000, easing: Easing.linear, useNativeDriver: NATIVE })));
      loops.push(Animated.loop(Animated.sequence([
        Animated.timing(star, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE }),
        Animated.timing(star, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE }),
      ])));
      loops.forEach((l) => l.start());
    });
    return () => { alive = false; loops.forEach((l) => l.stop()); };
  }, [groups, snow, star]);

  return (
    <View style={styles.hero}>
      <LinearGradient colors={['#1d1147', '#2b1458', '#0d0a24']} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
      {SNOW.map(([x, y, s, o], i) => (
        <Animated.View
          key={i}
          style={[styles.snow, {
            left: `${x}%`, width: s, height: s, borderRadius: s, opacity: o,
            transform: [{ translateY: Animated.modulo(Animated.add(Animated.multiply(snow, HERO_H), y * HERO_H), HERO_H) }],
          }]}
        />
      ))}

      <AppText variant="title2" style={styles.title} numberOfLines={1}>{title}</AppText>
      <AppText variant="footnote" style={styles.subtitle} numberOfLines={2}>{subtitle}</AppText>

      <View style={styles.tree} accessibilityLabel="반짝이는 크리스마스트리">
        <Svg width={TREE_W + PAD * 2} height={TREE_H + PAD * 2} viewBox={`${-PAD} ${-PAD} ${TREE_W + PAD * 2} ${TREE_H + PAD * 2}`} style={styles.glow}>
          <Defs>
            <RadialGradient id="carolGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#a855f7" stopOpacity={0.5} />
              <Stop offset="1" stopColor="#a855f7" stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id="carolFloor" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#f0a6ff" stopOpacity={0.45} />
              <Stop offset="1" stopColor="#f0a6ff" stopOpacity={0} />
            </RadialGradient>
            <SvgGradient id="carolTier" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#3fbf93" />
              <Stop offset="0.55" stopColor="#14705f" />
              <Stop offset="1" stopColor="#0b3f48" />
            </SvgGradient>
          </Defs>
          <Ellipse cx={TREE_W / 2} cy={TREE_H / 2} rx={168} ry={158} fill="url(#carolGlow)" />
          <Ellipse cx={TREE_W / 2} cy={236} rx={132} ry={16} fill="url(#carolFloor)" />
          <Rect x={109} y={208} width={22} height={30} rx={5} fill="#5b3a4a" />
          {TREE_TIERS.map((d) => <Path key={d} d={d} fill="url(#carolTier)" stroke="#0a2f38" strokeOpacity={0.5} strokeWidth={1.5} />)}
          {LINES.map((d) => <Path key={d} d={d} fill="none" stroke="#ffe7b0" strokeOpacity={0.35} strokeWidth={1} />)}
        </Svg>
        {lights.map((l, i) => {
          const halo = l.size * 2.1;
          const g = groups[l.group];
          return (
            <Animated.View
              key={i}
              style={[styles.light, {
                left: l.x - halo / 2, top: l.y - halo / 2, width: halo, height: halo,
                opacity: g.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] }),
                transform: [{ scale: g.interpolate({ inputRange: [0, 1], outputRange: [1.12, 0.78] }) }],
              }]}
            >
              <View style={[StyleSheet.absoluteFill, { borderRadius: halo, backgroundColor: l.color, opacity: 0.22 }]} />
              <View style={{ width: l.size, height: l.size, borderRadius: l.size, backgroundColor: l.color }} />
              {l.big ? <View style={styles.shine} /> : null}
            </Animated.View>
          );
        })}
        <Animated.View style={[styles.star, { transform: [{ scale: star.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) }] }]}>
          <AppText style={styles.starText} allowFontScaling={false}>{CURRENCY_ICON}</AppText>
        </Animated.View>
      </View>

      <Countdown until={until} name={untilName} onOver={onOver} />
    </View>
  );
}

/** 1초마다 다시 그리는 부분만 따로 — 트리는 다시 그리지 않는다 */
function Countdown({ until, name, onOver }: { until: string; name: string; onOver?: () => void }) {
  const [now, setNow] = useState(Date.now());
  const overRef = useRef(onOver);
  overRef.current = onOver;
  const r = remainUntil(until, now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  useEffect(() => { if (r.over) overRef.current?.(); }, [r.over]);

  const cells: [string, string][] = [[String(r.days), '일'], [two(r.hours), '시간'], [two(r.minutes), '분'], [two(r.seconds), '초']];
  return (
    <View style={styles.count} accessibilityLabel={`${name}까지 ${r.days}일 ${r.hours}시간 ${r.minutes}분 남았어요`}>
      <AppText variant="caption" style={styles.countName}>{r.over ? `${name}됐어요` : `${name}까지 남은 시간`}</AppText>
      <View style={styles.cells}>
        {cells.map(([v, u]) => (
          <View key={u} style={styles.cell}>
            <AppText style={styles.cellNum} allowFontScaling={false}>{v}</AppText>
            <AppText style={styles.cellUnit} allowFontScaling={false}>{u}</AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    height: HERO_H, borderRadius: 28, overflow: 'hidden', backgroundColor: '#0d0a24', alignItems: 'center', paddingTop: 22,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  snow: { position: 'absolute', top: 0, backgroundColor: '#ffffff' },
  title: { textAlign: 'center' },
  subtitle: { color: '#d8c8ff', textAlign: 'center', marginTop: 4, paddingHorizontal: 24 },
  tree: { width: TREE_W, height: TREE_H, marginTop: 14 },
  glow: { position: 'absolute', left: -PAD, top: -PAD },
  light: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  shine: { position: 'absolute', width: 2.5, height: 2.5, borderRadius: 2, backgroundColor: '#ffffff', marginTop: -3, marginLeft: -3 },
  star: { position: 'absolute', left: TREE_W / 2 - 22, top: 0, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  starText: { fontSize: 32, lineHeight: 42 },
  count: { alignItems: 'center', marginTop: 20, width: '100%', paddingHorizontal: 22 },
  countName: { color: '#d8b4fe', letterSpacing: 1 },
  cells: { flexDirection: 'row', gap: 8, marginTop: 8, width: '100%', maxWidth: 360 },
  cell: {
    flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)',
  },
  cellNum: { fontSize: 24, lineHeight: 30, fontWeight: '700', color: '#ffffff', fontVariant: ['tabular-nums'] },
  cellUnit: { fontSize: 11, lineHeight: 15, color: '#c4b5fd' },
});
