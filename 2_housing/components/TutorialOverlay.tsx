// [TutorialOverlay] v3.204 ⑥ 카드형 → v3.207 ① 코치마크(스포트라이트+화살표) 확장.
// - 스텝에 anchorKey가 있고 해당 anchor가 registry(utils/tutorialAnchors)에 등록돼 있으면:
//   4분할 딤으로 대상 rect만 밝게 뚫고(스포트라이트) Feather 화살표 + 근접 카드로 지시한다.
//   카드 위치는 anchor 상/하 자동(placement로 강제 가능).
// - anchor 미등록/측정 실패/화면 밖 rect → 기존 전체 딤 + 하단 카드로 graceful fallback
//   (리스트 로딩 전 노출 타이밍 대비). 늦은 등록은 registry 구독으로 반영.
// - v3.207 ⑪: 자동 노출은 tutorialGate 'fresh'(완전 최초 설치) 판정일 때만 — 기존 유저는
//   getAllKeys 마이그레이션으로 차단. 판별 미확정 시 미노출(보수 기본값 계승).
// - 노출 조건: AsyncStorage `maidol_tutorial_seen_v1:<screenKey>` 미열람이면 화면별 1회.
// - ref.show()는 명령형 재노출용으로 존치(작업실 ⓘ는 v3.207 ⑫로 제거 — 재보기 소멸은 의도).
// - Modal은 화면 루트의 safe-area 패딩을 상속하지 않으므로(v3.201~202 교훈) 인셋을 직접 보강한다.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Modal, StyleSheet, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { AppText, Button } from './ui';
import {
  AnchorRect,
  TutorialAnchorKey,
  getAnchor,
  subscribeAnchor,
} from '../utils/tutorialAnchors';
import { TUTORIAL_SEEN_KEY_PREFIX, initTutorialGate } from '../utils/tutorialGate';

export interface TutorialStep {
  title: string;
  desc: string;
  /** v3.207 ①: 스포트라이트 대상 anchor 키 — 미등록/측정 실패 시 카드형 fallback */
  anchorKey?: TutorialAnchorKey;
  /** 카드 배치 강제 — 생략 시 anchor 위치 기준 자동(화면 상반부 anchor → 카드 below) */
  placement?: 'above' | 'below';
}

export interface TutorialOverlayHandle {
  /** seen 여부와 무관하게 1스텝부터 재노출 */
  show: () => void;
}

interface TutorialOverlayProps {
  /** 스토리지 키 구분자 — 화면당 고유해야 한다 */
  screenKey: string;
  steps: TutorialStep[];
}

const SEEN_KEY_PREFIX = TUTORIAL_SEEN_KEY_PREFIX; // 'maidol_tutorial_seen_v1:' — tutorialGate와 단일 출처
const HOLE_PAD = 8; // 스포트라이트 구멍 여유
const ARROW_SIZE = 28;
const ARROW_GAP = 4; // 구멍 ↔ 화살표 간격
const CARD_GAP = 8; // 화살표 ↔ 카드 간격
const DIM_COLOR = 'rgba(0, 0, 0, 0.6)';

const TutorialOverlay = forwardRef<TutorialOverlayHandle, TutorialOverlayProps>(
  ({ screenKey, steps }, ref) => {
    const insets = useSafeAreaInsets();
    const { width: winW, height: winH } = useWindowDimensions();
    const [visible, setVisible] = useState(false);
    const [step, setStep] = useState(0);
    // 닫힘 로그에 현재 스텝을 담기 위한 미러 (setState 클로저 지연 회피)
    const stepRef = useRef(0);
    // 현재 스텝 anchor의 창 좌표 — 등록/해제 구독으로 갱신 (null = fallback 카드형)
    const [anchorRect, setAnchorRect] = useState<AnchorRect | null>(null);

    const show = useCallback(() => {
      stepRef.current = 0;
      setStep(0);
      setVisible(true);
      console.info('[Tutorial] shown', { screenKey });
    }, [screenKey]);

    useImperativeHandle(ref, () => ({ show }), [show]);

    // 마운트 시 1회: firstRun 'fresh'(완전 최초 설치) + 미열람이면 자동 노출.
    // (스토리지 접근은 프로젝트 관행대로 실패 시 미노출 — 오탐 노출보다 안전)
    useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          const firstRun = await initTutorialGate(); // 멱등 — App.tsx 부팅 호출과 promise 공유
          if (firstRun !== 'fresh') {
            if (__DEV__)
              console.info('[Tutorial] 자동 노출 게이트 차단', { screenKey, firstRun });
            return; // 기존 유저('existing') 또는 미확정(null) → 자동 노출 금지
          }
          const seen = await AsyncStorage.getItem(SEEN_KEY_PREFIX + screenKey);
          if (!cancelled && !seen) show();
        } catch (err: any) {
          // 읽기 실패 → 미노출 (이미 본 사용자에게 다시 띄우는 오탐보다 안전)
          console.error('[Tutorial] storage read failed', { screenKey, message: err?.message });
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [screenKey, show]);

    // 현재 스텝의 anchor 좌표 구독 — 리스트 로딩 후 늦게 등록돼도 스포트라이트로 승격
    const currentAnchorKey = steps[Math.min(step, Math.max(steps.length - 1, 0))]?.anchorKey;
    useEffect(() => {
      if (!visible || !currentAnchorKey) {
        setAnchorRect(null);
        return;
      }
      setAnchorRect(getAnchor(currentAnchorKey));
      return subscribeAnchor(currentAnchorKey, () => {
        setAnchorRect(getAnchor(currentAnchorKey));
      });
    }, [visible, currentAnchorKey]);

    const close = useCallback(
      (reason: 'done' | 'skip') => {
        setVisible(false);
        console.info(reason === 'done' ? '[Tutorial] done' : '[Tutorial] skip', {
          screenKey,
          step: stepRef.current,
        });
        AsyncStorage.setItem(SEEN_KEY_PREFIX + screenKey, '1').catch(() => {
          console.error('[Tutorial] storage write failed', { screenKey });
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

    // anchor 유효성: 0-rect·화면 밖(스크롤 아웃/회전 잔상)은 스포트라이트 부적격 → fallback
    const validAnchor =
      anchorRect &&
      anchorRect.width > 0 &&
      anchorRect.height > 0 &&
      anchorRect.x >= 0 &&
      anchorRect.y >= 0 &&
      anchorRect.x + anchorRect.width <= winW &&
      anchorRect.y + anchorRect.height <= winH
        ? anchorRect
        : null;

    // 공용 카드 본문 (스포트라이트/폴백 공유)
    const cardBody = (
      <>
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
      </>
    );

    let content;
    if (validAnchor) {
      // ── 스포트라이트 모드: 4분할 딤 + 구멍 테두리 + 화살표 + 근접 카드 ──
      const hole = {
        x: Math.max(0, validAnchor.x - HOLE_PAD),
        y: Math.max(0, validAnchor.y - HOLE_PAD),
        w: Math.min(winW, validAnchor.x + validAnchor.width + HOLE_PAD) -
          Math.max(0, validAnchor.x - HOLE_PAD),
        h: Math.min(winH, validAnchor.y + validAnchor.height + HOLE_PAD) -
          Math.max(0, validAnchor.y - HOLE_PAD),
      };
      const holeCenterX = hole.x + hole.w / 2;
      const placement: 'above' | 'below' =
        current.placement ?? (hole.y + hole.h / 2 < winH / 2 ? 'below' : 'above');
      const arrowLeft = Math.min(
        Math.max(holeCenterX - ARROW_SIZE / 2, spacing.lg),
        winW - spacing.lg - ARROW_SIZE
      );
      content = (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {/* 4분할 딤 — 가운데 구멍(anchor rect)만 원화면이 그대로 보인다 */}
          <View style={[styles.dimPart, { top: 0, left: 0, right: 0, height: hole.y }]} />
          <View style={[styles.dimPart, { top: hole.y, height: hole.h, left: 0, width: hole.x }]} />
          <View
            style={[styles.dimPart, { top: hole.y, height: hole.h, left: hole.x + hole.w, right: 0 }]}
          />
          <View style={[styles.dimPart, { top: hole.y + hole.h, left: 0, right: 0, bottom: 0 }]} />
          {/* 구멍 테두리 하이라이트 */}
          <View
            pointerEvents="none"
            style={[
              styles.holeBorder,
              { left: hole.x, top: hole.y, width: hole.w, height: hole.h },
            ]}
          />
          {/* 대상 지시 화살표 — 카드가 아래면 위(대상) 방향, 위면 아래 방향 */}
          <Feather
            name={placement === 'below' ? 'arrow-up' : 'arrow-down'}
            size={ARROW_SIZE}
            color={colors.accent.primary}
            style={
              placement === 'below'
                ? { position: 'absolute', left: arrowLeft, top: hole.y + hole.h + ARROW_GAP }
                : {
                    position: 'absolute',
                    left: arrowLeft,
                    top: hole.y - ARROW_GAP - ARROW_SIZE,
                  }
            }
          />
          {/* 근접 카드 — anchor 상/하 */}
          <View
            style={[
              styles.card,
              styles.cardFloating,
              placement === 'below'
                ? { top: Math.min(hole.y + hole.h + ARROW_GAP + ARROW_SIZE + CARD_GAP, winH - 220) }
                : { bottom: Math.max(winH - hole.y + ARROW_GAP + ARROW_SIZE + CARD_GAP, insets.bottom + spacing.lg) },
            ]}
          >
            {cardBody}
          </View>
        </View>
      );
    } else {
      // ── fallback: 기존 전체 딤 + 하단 카드 (anchor 미등록/측정 실패/화면 밖) ──
      content = (
        <View style={styles.dim}>
          <View style={[styles.card, styles.cardBottom, { paddingBottom: spacing.lg + insets.bottom }]}>
            {cardBody}
          </View>
        </View>
      );
    }

    return (
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => close('skip')} // Android 백버튼 = 건너뛰기와 동일
      >
        {content}
      </Modal>
    );
  }
);

TutorialOverlay.displayName = 'TutorialOverlay';
export default TutorialOverlay;

const styles = StyleSheet.create({
  dim: {
    flex: 1,
    backgroundColor: DIM_COLOR,
    justifyContent: 'flex-end',
  },
  dimPart: {
    position: 'absolute',
    backgroundColor: DIM_COLOR,
  },
  holeBorder: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: colors.accent.primary,
    borderRadius: radius.md,
  },
  card: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.accent,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
  },
  // 하단 시트형(폴백) — 상단 모서리만 라운드
  cardBottom: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  // 스포트라이트 근접 카드 — 좌우 여백 + 전체 라운드
  cardFloating: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    borderRadius: radius.xl,
    paddingBottom: spacing.lg,
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
