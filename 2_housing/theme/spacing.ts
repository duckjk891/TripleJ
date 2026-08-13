/**
 * AIDOL(PANN) 간격 · 반경 토큰
 *
 * 목적: 화면마다 흩어진 padding/margin/borderRadius 를 4px 그리드 스케일로 통일.
 *       (실제 사용 최다: 여백 4·8·12·16·20·24, 반경 8·10·12·16·20)
 * Figma Foundations 의 Spacing/Radius 변수와 1:1 로 맞춘다.
 *
 * 사용법:
 *   import { spacing as S, radius as R } from '../theme/spacing';
 *   padding: S.lg, marginBottom: S.md, borderRadius: R.lg
 *   ※ 6·10·14 같은 그리드 밖 값은 지양하고 가까운 스케일로 정렬.
 */

// 간격 스케일 (4px 그리드) — t-shirt 네이밍
export const spacing = {
  none: 0,
  xxs: 2,    // 미세(아이콘-텍스트 붙임)
  xs: 4,
  sm: 8,     // 최다 사용
  md: 12,    // 최다 사용
  lg: 16,    // 최다 사용(기본 화면 패딩)
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
  giant: 48,
} as const;

// 모서리 반경
export const radius = {
  none: 0,
  sm: 6,
  md: 10,
  lg: 12,   // 최다 사용(카드)
  xl: 16,   // 최다 사용(큰 카드/모달)
  xxl: 20,
  pill: 999, // 완전 둥근(버튼/칩/아바타)
} as const;

// 화면 공통 레이아웃 상수
export const layout = {
  screenPadding: spacing.lg,   // 화면 좌우 기본 패딩(16)
  sectionGap: spacing.xxl,     // 섹션 간 간격(24)
  cardGap: spacing.md,         // 카드 사이 간격(12)
  minTouchTarget: 44,          // 접근성 최소 터치 타깃
} as const;

export const S = spacing;
export const R = radius;
export default spacing;
