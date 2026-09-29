// [Splash] v3.265(대표) — 3비트 브랜드 인트로:
//   1막-a: "MY / AI / IDOL" 세 줄 순차 등장
//   1막-b: 서비스 가치 말풍선 6개가 속사포로 팝(대표: "와라라라랄라 속도감있게")
//   2막:   전부 퇴장 → MAIDOL 로고만 딱(하단 태그라인 제거)
//   사운드: 대표 지시(2026-09-29)로 보류 — assets/sounds/brand_sting.wav 자산은 보존,
//   재생 배선은 나중에. 말풍선 = 흰색 반투명·수평·꼬리 없음(모서리 각짐), 속도는
//   워드 빠르게·말풍선 천천히(가독) — 대표 확정 2026-09-29.
import { useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
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

// 말풍선 6개 — 위 3개·아래 3개, 좌우 교차 + 살짝 기울여 채팅 팝 느낌
const BUBBLES: {
  text: string;
  top: `${number}%`;
  side: 'left' | 'right';
}[] = [
  { text: '내 마음에 딱 맞는 곡', top: '13%', side: 'left' },
  { text: '이럴땐 이런 음악', top: '21%', side: 'right' },
  { text: '크루들과 함께 완성하는 플리', top: '29%', side: 'left' },
  { text: '나만의 아티스트 키우기', top: '64%', side: 'right' },
  { text: '당신만의 1인 기획사', top: '72%', side: 'left' },
  { text: '내 음악으로 수익창출까지', top: '80%', side: 'right' },
];

export default function SplashScreen({ navigation }: Props) {
  // 1막-a — MY / AI / IDOL 순차 등장
  const lineAnims = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  // 1막-b — 말풍선 속사포 팝
  const bubbleAnims = useRef(BUBBLES.map(() => new Animated.Value(0))).current;
  // 1막 전체 페이드아웃
  const act1Opacity = useRef(new Animated.Value(1)).current;
  // 2막 — MAIDOL 등장
  const act2Opacity = useRef(new Animated.Value(0)).current;
  const act2Scale = useRef(new Animated.Value(0.88)).current;

  useEffect(() => {
    Animated.sequence([
      // 1막-a: 세 줄 순차 등장 (위→아래)
      Animated.stagger(170, lineAnims.map((v) =>
        Animated.timing(v, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true })
      )),
      Animated.delay(120),
      // 1막-b: 말풍선 속사포 — 110ms 간격 스프링 팝
      Animated.stagger(200, bubbleAnims.map((v) =>
        Animated.spring(v, { toValue: 1, friction: 7, tension: 120, useNativeDriver: true })
      )),
      Animated.delay(950),
      // 1막 퇴장 (워드+말풍선 함께)
      Animated.timing(act1Opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
      // 2막: MAIDOL 단독 임팩트
      Animated.parallel([
        Animated.timing(act2Opacity, { toValue: 1, duration: 420, useNativeDriver: true }),
        Animated.spring(act2Scale, { toValue: 1, friction: 6, tension: 70, useNativeDriver: true }),
      ]),
    ]).start();

    const timer = setTimeout(() => {
      navigation.replace('MainTabs');
    }, 5000);
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
      {/* 1막 — MY / AI / IDOL + 말풍선 (겹침 배치: 두 막이 같은 자리) */}
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

        {/* 말풍선 속사포 — 스케일 팝(0.5→1) + 페이드, 좌우 교차·기울임 */}
        {BUBBLES.map((b, i) => (
          <Animated.View
            key={b.text}
            style={[
              styles.bubble,
              { top: b.top },
              b.side === 'left' ? styles.bubbleLeft : styles.bubbleRight,
              {
                opacity: bubbleAnims[i],
                transform: [
                  { scale: bubbleAnims[i].interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) },
                ],
              },
            ]}
          >
            <AppText style={styles.bubbleText}>{b.text}</AppText>
          </Animated.View>
        ))}
      </Animated.View>

      {/* 2막 — MAIDOL 로고 단독 (v3.265: 하단 태그라인 제거 — 로고 임팩트 + 스팅) */}
      <Animated.View style={[styles.act, { opacity: act2Opacity, transform: [{ scale: act2Scale }] }]}>
        <View style={styles.logoRow}>
          <AppText style={styles.title}>M</AppText>
          <AppText style={[styles.title, styles.titleAi]}>AI</AppText>
          <AppText style={styles.title}>DOL</AppText>
        </View>
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
    fontSize: 40, // v3.193: 56→40 축소(타이포 과대 완화)
    fontWeight: '900',
    color: colors.text.primary,
    letterSpacing: 6,
    lineHeight: 54, // v3.193: 74→54 (비례)
  },
  wordAi: { color: colors.accent.primary },
  // 말풍선 — 흰색 살짝 반투명·수평(대표 확정), 채팅 팝
  bubble: {
    position: 'absolute',
    maxWidth: 240,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.88)',
  },
  bubbleLeft: { left: 24, borderBottomLeftRadius: 4 },
  bubbleRight: { right: 24, borderBottomRightRadius: 4 },
  bubbleText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#241A3E', // 흰 풍선 위 다크 텍스트(브랜드 딥퍼플 계열)
    letterSpacing: 0.2,
  },
  // v3.265c: 별도 꼬리 뷰 제거 — 반투명 배경과 겹쳐 마름모가 비침(대표 지적).
  // 한쪽 모서리 각진 라운드(bubbleLeft/Right)만으로 말풍선 느낌을 낸다.
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
