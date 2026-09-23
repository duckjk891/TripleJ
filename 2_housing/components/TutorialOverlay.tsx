// [TutorialOverlay] v3.204 ⑥ 카드형 → v3.207 ① 코치마크(스포트라이트+화살표) → v3.213 재설계.
// - 스텝에 anchorKey가 있고 해당 anchor가 registry(utils/tutorialAnchors)에 등록돼 있으면:
//   4분할 딤으로 대상 rect만 밝게 뚫고(스포트라이트) Feather 화살표 + 근접 카드로 지시한다.
//   카드 위치는 anchor 상/하 자동(placement로 강제 가능).
// - v3.213 비주얼: 구멍 테두리(2px 실선) → 보라 틴트 반투명 박스(@16% + 헤어라인 글로우 톤).
//   딤도 순흑 대신 colors.bg.deepest(#0d0820) 틴트로 브랜드 톤 정렬.
// - anchor 미등록/측정 실패/화면 밖 rect → 기존 전체 딤 + 하단 카드로 graceful fallback
//   (리스트 로딩 전 노출 타이밍 대비). 늦은 등록은 registry 구독으로 반영.
// - v3.213 노출 정책 분기(tutorialGate.TUTORIAL_REVIEW_MODE 단일 스위치):
//   · 리뷰 모드(true): 게이트·seen 무시, useIsFocused 포커스 획득마다 재노출(검수용).
//   · false: v3.211 정책 — 'fresh'(완전 최초 설치) 판정 + seen 미열람이면 화면별 1회.
// - v3.213 enabled prop: 화면별 노출 게이트(로그인 상태 등) — false면 어떤 모드에서도 미노출.
// - v3.213 onStepChange prop: 스텝 전환 콜백(노출 시 0부터) — 화면 밖 anchor 자동 스크롤용(MapScreen).
// - ref.show()는 명령형 재노출용으로 존치(작업실 ⓘ는 v3.207 ⑫로 제거 — 재보기 소멸은 의도).
// - Modal은 화면 루트의 safe-area 패딩을 상속하지 않으므로(v3.201~202 교훈) 인셋을 직접 보강한다.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Modal, StyleSheet, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
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
import {
  TUTORIAL_REVIEW_MODE,
  TUTORIAL_SEEN_KEY_PREFIX,
  initTutorialGate,
} from '../utils/tutorialGate';

export interface TutorialStep {
  title: string;
  desc: string;
  /** v3.207 ①: 스포트라이트 대상 anchor 키 — 미등록/측정 실패 시 카드형 fallback */
  anchorKey?: TutorialAnchorKey;
  /** 카드 배치 강제 — 생략 시 anchor 위치 기준 자동(화면 상반부 anchor → 카드 below) */
  placement?: 'above' | 'below';
  /**
   * v3.214 ①: 하이라이트 형태 — 'rect'(기본, radius 12 현행) | 'pill'(radius = min(w,h)/2).
   * 작업실 디렉터 스텝이 pill(isNext 원형 펄스와 동일 시각 언어), 그 외 rect 유지.
   */
  shape?: 'rect' | 'pill';
}

export interface TutorialOverlayHandle {
  /** seen 여부와 무관하게 1스텝부터 재노출 */
  show: () => void;
}

interface TutorialOverlayProps {
  /** 스토리지 키 구분자 — 화면당 고유해야 한다 */
  screenKey: string;
  steps: TutorialStep[];
  /**
   * v3.213: 화면별 노출 게이트(로그인 상태 등). false면 자동·명령형 노출 모두 차단하고
   * 노출 중이던 오버레이도 닫는다. 리뷰 모드에서도 유효(상태별 검수 가능). 기본 true.
   */
  enabled?: boolean;
  /** v3.213: 스텝 전환 콜백(노출 시 0부터) — 화면 밖 anchor 자동 스크롤용(MapScreen) */
  onStepChange?: (index: number) => void;
}

const SEEN_KEY_PREFIX = TUTORIAL_SEEN_KEY_PREFIX; // 'maidol_tutorial_seen_v1:' — tutorialGate와 단일 출처
const HOLE_PAD = 8; // 스포트라이트 구멍 여유
const ARROW_SIZE = 28;
const ARROW_GAP = 4; // 구멍 ↔ 화살표 간격
const CARD_GAP = 8; // 화살표 ↔ 카드 간격
// v3.213: 순흑 0.6 → colors.bg.deepest(#0d0820) 틴트 딤 — 브랜드 톤 정렬
const DIM_COLOR = 'rgba(13, 8, 32, 0.68)';
// v3.214 ①: 딤 코너 마스크 두께 — 4분할 사각 딤은 구멍 라운딩 밖 모서리가 밝게 남으므로
// 구멍보다 큰 View 에 두꺼운 DIM_COLOR border(+borderRadius r+B)를 둘러 모서리 잔존을 덮는다.
const CORNER_MASK_B = 40;

const TutorialOverlay = forwardRef<TutorialOverlayHandle, TutorialOverlayProps>(
  ({ screenKey, steps, enabled = true, onStepChange }, ref) => {
    const insets = useSafeAreaInsets();
    const { width: winW, height: winH } = useWindowDimensions();
    const isFocused = useIsFocused();
    const [visible, setVisible] = useState(false);
    const [step, setStep] = useState(0);
    // 닫힘 로그에 현재 스텝을 담기 위한 미러 (setState 클로저 지연 회피)
    const stepRef = useRef(0);
    // 현재 스텝 anchor의 창 좌표 — 등록/해제 구독으로 갱신 (null = fallback 카드형)
    const [anchorRect, setAnchorRect] = useState<AnchorRect | null>(null);
    // onStepChange는 ref로 미러 — 콜백 identity 변화로 스텝 이펙트가 중복 발화하지 않게
    const onStepChangeRef = useRef(onStepChange);
    onStepChangeRef.current = onStepChange;

    const show = useCallback(() => {
      if (!enabled) {
        if (__DEV__) console.info('[Tutorial] enabled=false — 노출 차단', { screenKey });
        return;
      }
      stepRef.current = 0;
      setStep(0);
      setVisible(true);
      if (__DEV__) console.info('[Tutorial] shown', { screenKey });
    }, [screenKey, enabled]);

    useImperativeHandle(ref, () => ({ show }), [show]);

    // v3.213: 게이트 해제(로그아웃 등) 시 노출 중이던 오버레이도 닫는다
    useEffect(() => {
      if (!enabled) setVisible(false);
    }, [enabled]);

    // v3.213 리뷰 모드: 게이트·seen 무시 — 화면 포커스 획득마다 재노출(검수용).
    // 블러 시 닫기 — Modal은 앱 전역이라 다른 탭 위에 잔존하는 것을 방지.
    useEffect(() => {
      if (!TUTORIAL_REVIEW_MODE) return;
      if (isFocused && enabled) show();
      else setVisible(false);
    }, [isFocused, enabled, show]);

    // first-run 모드(리뷰 모드 off): firstRun 'fresh'(완전 최초 설치) + 미열람이면 자동 노출.
    // enabled가 뒤늦게 true가 되는 화면(가입 후 최초 사용)을 위해 enabled 전환 시 재평가 —
    // 닫으면 seen이 기록되므로 화면·상태별 1회 정책은 유지된다.
    // (스토리지 접근은 프로젝트 관행대로 실패 시 미노출 — 오탐 노출보다 안전)
    useEffect(() => {
      if (TUTORIAL_REVIEW_MODE) return; // 리뷰 모드는 위 포커스 이펙트가 전담
      if (!enabled) return;
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
    }, [screenKey, show, enabled]);

    // v3.213: 스텝 전환 통지 — 노출 시 0부터. MapScreen이 대상 디렉터로 자동 스크롤 후 재측정
    useEffect(() => {
      if (visible) onStepChangeRef.current?.(step);
    }, [visible, step]);

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
        if (__DEV__)
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
      // v3.214 ①: 스텝별 하이라이트 형태 — pill = min(w,h)/2 (140×164 anchor 기준 좌우 반원)
      const holeRadius = current.shape === 'pill' ? Math.min(hole.w, hole.h) / 2 : radius.lg;
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
          {/* v3.214 ①: 딤 코너 마스크 — 구멍 라운딩(rect 12 / pill 반원) 밖에 4분할 딤이 못 덮은
              밝은 모서리 잔존을 두꺼운 DIM_COLOR border 로 가린다. shape 무관 항상 렌더. */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: hole.x - CORNER_MASK_B,
              top: hole.y - CORNER_MASK_B,
              width: hole.w + CORNER_MASK_B * 2,
              height: hole.h + CORNER_MASK_B * 2,
              borderWidth: CORNER_MASK_B,
              borderColor: DIM_COLOR,
              borderRadius: holeRadius + CORNER_MASK_B,
              backgroundColor: 'transparent',
            }}
          />
          {/* v3.213: 구멍 위 보라 틴트 반투명 하이라이트 박스 (테두리 최소화 — 헤어라인 글로우 톤) */}
          <View
            pointerEvents="none"
            style={[
              styles.highlightBox,
              { left: hole.x, top: hole.y, width: hole.w, height: hole.h, borderRadius: holeRadius },
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
  // v3.213: 테두리 박스(2px 실선) → 세련된 반투명 하이라이트 박스.
  // MapScreen isNext 펄스(rgba(168,85,247,0.28)+글로우)와 동일 계열 — 앱 내 시각 언어 통일.
  highlightBox: {
    position: 'absolute',
    backgroundColor: 'rgba(168, 85, 247, 0.16)', // colors.accent.primary(#a855f7) @16% 보라 틴트
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(192, 132, 252, 0.45)', // colors.accent.primaryGlow(#c084fc) @45% 헤어라인
    // 소프트 글로우 — iOS/웹 전용 enhancement. Android elevation은 글로우 표현 불가 →
    // 틴트+헤어라인만으로 성립하는 디자인(간소화, elevation 미지정).
    shadowColor: colors.accent.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 16,
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
