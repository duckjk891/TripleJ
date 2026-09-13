import { useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Image,
  Animated,
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

export default function SplashScreen({ navigation }: Props) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 1200,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();

    const timer = setTimeout(() => {
      // 기획사명/호칭은 회원가입 시 저장되므로 Onboarding 단계 불필요
      navigation.replace('MainTabs');
    }, 2500);

    return () => clearTimeout(timer);
  }, []);

  return (
    <LinearGradient
      colors={[colors.bg.deepest, colors.bg.surface1, colors.gradient.twilight[0], colors.bg.surface2]}
      locations={[0, 0.35, 0.7, 1]}
      style={styles.container}
    >
      <Animated.View
        style={[
          styles.content,
          {
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        {/* v3.171(대표): MAIDOL = MY AI IDOL — 심볼 로고(대표 제공 시안, 스플래시 색감 보정) + 텍스트 로고 */}
        <Image source={require('../assets/branding/maidol_logo.png')} style={styles.logoMark} />
        <View style={styles.logoRow}>
          <AppText style={styles.title}>M</AppText>
          <AppText style={[styles.title, styles.titleAi]}>AI</AppText>
          <AppText style={styles.title}>DOL</AppText>
        </View>
        <AppText style={styles.tagline}>MY AI IDOL</AppText>
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
  content: {
    alignItems: 'center',
  },
  // v3.171: MAIDOL 로고 — 흰색 M/DOL + 액센트 박스 AI (MY AI IDOL 의미 강조)
  logoMark: { width: 132, height: 140, marginBottom: 22 },
  logoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  title: {
    fontSize: 52,
    fontWeight: '900',
    color: colors.text.primary,
    letterSpacing: 3,
  },
  titleAi: { color: colors.accent.primary },
  tagline: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 6,
    color: colors.accent.primary,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    color: colors.text.secondary,
    letterSpacing: 2,
  },
});
