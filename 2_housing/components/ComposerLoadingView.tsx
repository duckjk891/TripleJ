// [InstLoading] v3.222 ②: 작곡 진행 UI 공용 컴포넌트 — MusicLoadingScreen 프레젠테이션부
// (초상 펄스 + 진행 메시지 + 5스텝 인디케이터 + %바 + 노트, 기존 :349-412 + styles)를
// props(steps, messageIndex, progress?, portrait, noteText)로 추출한 것.
// 스텝 전진(4s 타이머)·% 점프·폴링 로직은 소유 화면(MusicLoading/InstLoading)이 담당하고,
// 이 컴포넌트는 표시만 한다(추출 전과 시각 동일 — 회귀 0 목표).
import { useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Image,
  Animated,
  Easing,
  ActivityIndicator,
  ImageSourcePropType,
} from 'react-native';
import { AppText } from './ui';
import { colors } from '../theme/colors';

export interface ComposerLoadingStep {
  label: string;
  message: string;
}

interface Props {
  steps: ComposerLoadingStep[];
  messageIndex: number;
  /** 서버 progress %(0-100). 0 이하면 %바 미표시(MusicLoading 기존 동작 동일). */
  progress?: number;
  portrait: ImageSourcePropType;
  noteText: string;
}

export default function ComposerLoadingView({
  steps,
  messageIndex,
  progress = 0,
  portrait,
  noteText,
}: Props) {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Pulse animation (MusicLoadingScreen 기존 :72-92 동일)
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  const safeIndex = Math.max(0, Math.min(messageIndex, steps.length - 1));

  return (
    <View style={styles.content}>
      <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
        <View style={styles.portraitContainer}>
          <Image source={portrait} style={styles.portraitImage} />
        </View>
      </Animated.View>

      <AppText style={styles.loadingText}>{steps[safeIndex].message}</AppText>

      <ActivityIndicator size="large" color={colors.accent.primary} style={styles.spinner} />

      {/* 스텝 인디케이터 */}
      <View style={styles.stepRow}>
        {steps.map((s, i) => {
          const state = i < safeIndex ? 'done' : i === safeIndex ? 'active' : 'pending';
          return (
            <View key={s.label} style={styles.stepItem}>
              <View
                style={[
                  styles.stepDot,
                  state === 'active' && styles.stepDotActive,
                  state === 'done' && styles.stepDotDone,
                ]}
              >
                <AppText style={styles.stepDotText}>
                  {state === 'done' ? '✓' : i + 1}
                </AppText>
              </View>
              <AppText
                style={[
                  styles.stepLabel,
                  state === 'active' && styles.stepLabelActive,
                  state === 'done' && styles.stepLabelDone,
                ]}
                numberOfLines={1}
              >
                {s.label}
              </AppText>
            </View>
          );
        })}
      </View>

      {progress > 0 && (
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>
          <AppText style={styles.progressText}>{Math.round(progress)}%</AppText>
        </View>
      )}

      <View style={styles.noteContainer}>
        <AppText style={styles.noteText}>{noteText}</AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  portraitContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: colors.accent.primary,
    marginBottom: 32,
  },
  portraitImage: {
    width: 120,
    height: 360,
    resizeMode: 'cover',
    position: 'absolute',
    top: 0,
    left: 0,
  },
  loadingText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text.primary,
    marginBottom: 24,
    textAlign: 'center',
  },
  spinner: {
    marginBottom: 20,
  },
  stepRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  stepItem: {
    alignItems: 'center',
    flex: 1,
  },
  stepDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.bg.surface1,
    borderWidth: 1.5,
    borderColor: colors.border.subtle,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  stepDotActive: {
    backgroundColor: colors.accent.primary,
    borderColor: colors.accent.primary,
  },
  stepDotDone: {
    backgroundColor: colors.bg.surface2,
    borderColor: colors.accent.primary,
  },
  stepDotText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.text.primary,
  },
  stepLabel: {
    fontSize: 10,
    color: colors.text.muted,
    textAlign: 'center',
  },
  stepLabelActive: {
    color: colors.accent.primary,
    fontWeight: '700',
  },
  stepLabelDone: {
    color: colors.text.secondary,
  },
  progressContainer: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
    gap: 12,
  },
  progressBar: {
    flex: 1,
    height: 8,
    backgroundColor: colors.bg.surface1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.accent.primary,
    borderRadius: 4,
  },
  progressText: {
    color: colors.text.secondary,
    fontSize: 14,
    fontWeight: '600',
    minWidth: 40,
    textAlign: 'right',
  },
  noteContainer: {
    backgroundColor: colors.bg.surface1,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  noteText: {
    fontSize: 13,
    color: colors.text.secondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
