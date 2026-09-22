// [TutorialOverlay] v3.204 ⑥ — 화면별 첫 방문 튜토리얼(카드형 스텝 안내).
// - 스포트라이트/요소 측정 없음: 반투명 딤 + 하단 카드로 기능을 짧게 안내한다(과설계 금지).
// - 마운트 시 AsyncStorage `maidol_tutorial_seen_v1:<screenKey>` 미열람이면 자동 1회 노출.
//   읽기 실패 시엔 노출하지 않는다(오탐 노출보다 안전). 닫힘(건너뛰기·시작하기 포함) 시 플래그 기록.
// - ref.show()로 명령형 재노출 지원(작업실 ⓘ 등) — 재노출은 seen 여부와 무관하게 항상 뜬다.
// - Modal은 화면 루트의 safe-area 패딩을 상속하지 않으므로(v3.201~202 교훈) 인셋을 직접 보강한다.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Modal, StyleSheet, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { AppText, Button } from './ui';

export interface TutorialStep {
  title: string;
  desc: string;
}

export interface TutorialOverlayHandle {
  /** seen 여부와 무관하게 1스텝부터 재노출 (예: 작업실 ⓘ) */
  show: () => void;
}

interface TutorialOverlayProps {
  /** 스토리지 키 구분자 — 화면당 고유해야 한다 */
  screenKey: string;
  steps: TutorialStep[];
}

const SEEN_KEY_PREFIX = 'maidol_tutorial_seen_v1:';

const TutorialOverlay = forwardRef<TutorialOverlayHandle, TutorialOverlayProps>(
  ({ screenKey, steps }, ref) => {
    const insets = useSafeAreaInsets();
    const [visible, setVisible] = useState(false);
    const [step, setStep] = useState(0);
    // 닫힘 로그에 현재 스텝을 담기 위한 미러 (setState 클로저 지연 회피)
    const stepRef = useRef(0);

    const show = useCallback(() => {
      stepRef.current = 0;
      setStep(0);
      setVisible(true);
      console.info('[Tutorial] shown', { screenKey });
    }, [screenKey]);

    useImperativeHandle(ref, () => ({ show }), [show]);

    // 마운트 시 1회: 미열람이면 자동 노출 (프로젝트 관행대로 스토리지 접근은 전부 try/catch 성격의 .catch)
    useEffect(() => {
      let cancelled = false;
      AsyncStorage.getItem(SEEN_KEY_PREFIX + screenKey)
        .then((seen) => {
          if (!cancelled && !seen) show();
        })
        .catch(() => {
          // 읽기 실패 → 미노출 (이미 본 사용자에게 다시 띄우는 오탐보다 안전)
          console.warn('[Tutorial] storage read failed', { screenKey });
        });
      return () => {
        cancelled = true;
      };
    }, [screenKey, show]);

    const close = useCallback(
      (reason: 'done' | 'skip') => {
        setVisible(false);
        console.info(reason === 'done' ? '[Tutorial] done' : '[Tutorial] skip', {
          screenKey,
          step: stepRef.current,
        });
        AsyncStorage.setItem(SEEN_KEY_PREFIX + screenKey, '1').catch(() => {
          console.warn('[Tutorial] storage write failed', { screenKey });
        });
      },
      [screenKey]
    );

    if (!steps.length) return null;

    const isLast = step >= steps.length - 1;
    const current = steps[Math.min(step, steps.length - 1)];

    const handleNext = () => {
      if (isLast) {
        close('done');
        return;
      }
      const next = step + 1;
      stepRef.current = next;
      setStep(next);
    };

    return (
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => close('skip')} // Android 백버튼 = 건너뛰기와 동일
      >
        <View style={styles.dim}>
          <View style={[styles.card, { paddingBottom: spacing.lg + insets.bottom }]}>
            <AppText variant="title3" style={styles.title}>
              {current.title}
            </AppText>
            <AppText tone="secondary" style={styles.desc}>
              {current.desc}
            </AppText>
            <View style={styles.dots}>
              {steps.map((_, i) => (
                <View key={i} style={[styles.dot, i === step && styles.dotActive]} />
              ))}
            </View>
            <View style={styles.footer}>
              <TouchableOpacity
                onPress={() => close('skip')}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityLabel="튜토리얼 건너뛰기"
              >
                <AppText variant="bodyStrong" tone="muted">
                  건너뛰기
                </AppText>
              </TouchableOpacity>
              <View style={styles.nextBtn}>
                <Button label={isLast ? '시작하기' : '다음'} fullWidth onPress={handleNext} />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    );
  }
);

TutorialOverlay.displayName = 'TutorialOverlay';
export default TutorialOverlay;

const styles = StyleSheet.create({
  dim: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: colors.bg.surface1,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border.accent,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
  },
  title: {
    marginBottom: spacing.sm,
  },
  desc: {
    marginBottom: spacing.lg,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginBottom: spacing.lg,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.bg.surface3,
  },
  dotActive: {
    backgroundColor: colors.accent.primary,
    width: 18,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  nextBtn: {
    flex: 1,
    maxWidth: 180,
  },
});
