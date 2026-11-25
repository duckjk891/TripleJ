// [Splash] 2비트 브랜드 인트로:
//   1막: "MY / AI / IDOL" 세 줄 순차 등장
//   2막: 1막 퇴장 → MAIDOL 로고만 딱(하단 태그라인 없음) → 홈
//   v3.433(대표 11-23): 서비스 가치 말풍선 6개 제거 + 전체 5초 → 약 2.5초.
//   홈 이동은 고정 시간이 아니라 로고 등장이 끝난 뒤(느린 기기에서 로고가 잘리지 않게), 최대 4초.
//   사운드: 대표 지시(2026-09-29)로 보류 — assets/sounds/brand_sting.wav 자산은 보존,
//   재생 배선은 나중에.
import { useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Animated,
  Easing,
} from 'react-native';
import { AppText } from '../components/ui';
import { versionLabel } from '../utils/appVersion';
import { LinearGradient } from 'expo-linear-gradient';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { colors } from '../theme/colors';
import SnowFall from '../components/winter/SnowFall'; // v3.442 [Winter]
import SnowGround from '../components/winter/SnowGround';
import WinterLogo from '../components/winter/WinterLogo';
import { isWinterSeason } from '../utils/winter';

type RootStackParamList = {
  Splash: undefined;
  MainTabs: undefined;
};

type Props = NativeStackScreenProps<RootStackParamList, 'Splash'>;

export default function SplashScreen({ navigation }: Props) {
  // 1막 — MY / AI / IDOL 순차 등장
  const lineAnims = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  // 1막 전체 페이드아웃
  const act1Opacity = useRef(new Animated.Value(1)).current;
  // 2막 — MAIDOL 등장
  const act2Opacity = useRef(new Animated.Value(0)).current;
  const act2Scale = useRef(new Animated.Value(0.88)).current;

  useEffect(() => {
    let left = false;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    const goHome = () => {
      if (left) return;
      left = true;
      navigation.replace('MainTabs');
    };
    const intro = Animated.sequence([
      // 1막: 세 줄 순차 등장 (위→아래)
      Animated.stagger(170, lineAnims.map((v) =>
        Animated.timing(v, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true })
      )),
      Animated.delay(350),
      // 1막 퇴장
      Animated.timing(act1Opacity, { toValue: 0, duration: 250, useNativeDriver: true }),
      // 2막: MAIDOL 단독 임팩트
      Animated.parallel([
        Animated.timing(act2Opacity, { toValue: 1, duration: 420, useNativeDriver: true }),
        Animated.spring(act2Scale, { toValue: 1, friction: 6, tension: 70, useNativeDriver: true }),
      ]),
    ]);
    intro.start(({ finished }) => {
      if (finished && !left) holdTimer = setTimeout(goHome, 500);
    });

    // 안전장치 — 애니메이션이 밀리거나 끝나지 않아도 홈으로
    const maxTimer = setTimeout(goHome, 4000);
    return () => {
      left = true;
      clearTimeout(maxTimer);
      if (holdTimer) clearTimeout(holdTimer);
      intro.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const WORDS = ['MY', 'AI', 'IDOL'];
  const winter = isWinterSeason(); // v3.442 [Winter]: 눈·눈 언덕·눈 쌓인 로고(기간이 지나면 원래대로)

  return (
    <LinearGradient
      colors={[colors.bg.deepest, colors.bg.surface1, colors.gradient.twilight[0], colors.bg.surface2]}
      locations={[0, 0.35, 0.7, 1]}
      style={styles.container}
    >
      {winter ? <SnowGround /> : null}
      <SnowFall mode="splash" />

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

      {/* 2막 — MAIDOL 로고 단독 (v3.265: 하단 태그라인 제거 — 로고 임팩트 + 스팅) */}
      <Animated.View style={[styles.act, { opacity: act2Opacity, transform: [{ scale: act2Scale }] }]}>
        {winter ? <WinterLogo height={38} /> : (
          <View style={styles.logoRow}>
            <AppText style={styles.title}>M</AppText>
            <AppText style={[styles.title, styles.titleAi]}>AI</AppText>
            <AppText style={styles.title}>DOL</AppText>
          </View>
        )}
      </Animated.View>

      {/* v3.324 (대표 10-10): 하단 아주 작은 글씨로 앱 버전(웹은 배포 시각까지) */}
      <AppText style={[styles.versionText, winter && styles.versionWinter]} pointerEvents="none">{versionLabel()}</AppText>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  versionWinter: { color: 'rgba(45,25,90,0.75)' },
  versionText: { position: 'absolute', bottom: 28, alignSelf: 'center', fontSize: 10, color: 'rgba(255,255,255,0.45)', letterSpacing: 0.3 },
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
    fontSize: 40, // v3.193: 56→40 축소(타이포 과대 완화)
    fontWeight: '900',
    color: colors.text.primary,
    letterSpacing: 6,
    lineHeight: 54, // v3.193: 74→54 (비례)
  },
  wordAi: { color: colors.accent.primary },
  logoRow: { flexDirection: 'row', alignItems: 'center' },
  title: {
    fontSize: 44, // v3.265: 36→44 — 태그라인 제거 후 로고 단독 임팩트 강화
    lineHeight: 54,
    fontWeight: '900',
    color: colors.text.primary,
    letterSpacing: 4,
  },
  titleAi: { color: colors.accent.primary },
});
