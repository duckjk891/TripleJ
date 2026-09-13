// [Splash] v3.173(대표) — 2막 브랜드 인트로:
//   1막: "MY / AI / IDOL" 세 줄이 위에서부터 순차 등장 → 함께 사라짐
//   2막: 응원봉 심볼(배경 없는 흰 심볼, 소형) + MAIDOL 로고 등장
import { useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Image,
  Animated,
  Easing,
} from 'react-native';
import { AppText } from '../components/ui';
import { LinearGradient } from 'expo-linear-gradient';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { colors } from '../theme/colors';

type RootStackParamList = {
  Splash: undefined;
  MainTabs: undefined;
};

type Props = NativeStackScreenProps<RootStackParamList, 'Splash'>;

const SYMBOL = require('../assets/branding/maidol_symbol.png');

export default function SplashScreen({ navigation }: Props) {
  // 1막 — MY / AI / IDOL 순차 등장 (각 줄 opacity + 아래로 살짝 내려오는 translateY)
  const lineAnims = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  // 1막 전체 페이드아웃
  const act1Opacity = useRef(new Animated.Value(1)).current;
  // 2막 — 심볼+MAIDOL 등장
  const act2Opacity = useRef(new Animated.Value(0)).current;
  const act2Scale = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    Animated.sequence([
      // 1막: 세 줄 순차 등장 (위→아래)
      Animated.stagger(320, lineAnims.map((v) =>
        Animated.timing(v, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true })
      )),
      Animated.delay(520),
      // 1막 퇴장
      Animated.timing(act1Opacity, { toValue: 0, duration: 340, useNativeDriver: true }),
      // 2막: MAIDOL 등장
      Animated.parallel([
        Animated.timing(act2Opacity, { toValue: 1, duration: 480, useNativeDriver: true }),
        Animated.spring(act2Scale, { toValue: 1, friction: 7, tension: 60, useNativeDriver: true }),
      ]),
    ]).start();

    const timer = setTimeout(() => {
      navigation.replace('MainTabs');
    }, 4000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const WORDS = ['MY', 'AI', 'IDOL'];

  return (
    <LinearGradient
      colors={[colors.bg.deepest, colors.bg.surface1, colors.gradient.twilight[0], colors.bg.surface2]}
      locations={[0, 0.35, 0.7, 1]}
      style={styles.container}
    >
      {/* 1막 — MY / AI / IDOL (겹침 배치: 두 막이 같은 자리) */}
      <Animated.View style={[styles.act, { opacity: act1Opacity }]} pointerEvents="none">
        {WORDS.map((wd, i) => (
          <Animated.View
            key={wd}
            style={{
              opacity: lineAnims[i],
              transform: [{
                translateY: lineAnims[i].interpolate({ inputRange: [0, 1], outputRange: [-18, 0] }),
              }],
            }}
          >
            <AppText style={[styles.word, wd === 'AI' && styles.wordAi]}>{wd}</AppText>
          </Animated.View>
        ))}
      </Animated.View>

      {/* 2막 — 응원봉 심볼(배경 없음·소형) + MAIDOL */}
      <Animated.View style={[styles.act, { opacity: act2Opacity, transform: [{ scale: act2Scale }] }]}>
        <Image source={SYMBOL} style={styles.symbol} />
        <View style={styles.logoRow}>
          <AppText style={styles.title}>M</AppText>
          <AppText style={[styles.title, styles.titleAi]}>AI</AppText>
          <AppText style={styles.title}>DOL</AppText>
        </View>
        <AppText style={styles.subtitle}>당신의 1인 기획사</AppText>
      </Animated.View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // 두 막을 같은 중앙 위치에 겹침
  act: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 1막 워드 타이포
  word: {
    fontSize: 56,
    fontWeight: '900',
    color: colors.text.primary,
    letterSpacing: 6,
    lineHeight: 74,
  },
  wordAi: { color: colors.accent.primary },
  // 2막 — 심볼은 배경 없는 흰 응원봉, 기존보다 작게
  symbol: { width: 64, height: 66, marginBottom: 20, resizeMode: 'contain' },
  logoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  title: {
    fontSize: 52,
    lineHeight: 60,
    fontWeight: '900',
    color: colors.text.primary,
    letterSpacing: 3,
  },
  titleAi: { color: colors.accent.primary },
  subtitle: {
    fontSize: 13,
    color: colors.text.secondary,
    letterSpacing: 2,
  },
});
