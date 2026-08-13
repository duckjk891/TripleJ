/**
 * AIDOL(PANN) 타이포그래피 토큰
 *
 * 목적: 화면마다 제각각인 fontSize/fontWeight 를 하나의 스케일로 통일.
 *       (실제 코드 사용 분포 기반: body 13·14·16, caption 11·12, title 20·24, display 48·64)
 * Figma Foundations 의 Typography 변수와 1:1 로 맞춘다. (예: text/body ↔ typography.style.body)
 *
 * 사용법:
 *   import { typography as T } from '../theme/typography';
 *   ...T.style.title            // { fontSize, fontWeight, lineHeight }
 *   fontSize: T.size.body, fontWeight: T.weight.semibold
 */

// 크기 스케일 (px) — 실제 사용값에 근거
export const size = {
  caption: 11,   // 보조 라벨/뱃지
  footnote: 12,  // 캡션/힌트
  body: 13,      // 본문 기본(최다 사용)
  bodyLg: 14,    // 본문 강조
  callout: 16,   // 눈에 띄는 본문/버튼
  subtitle: 18,  // 소제목
  title3: 20,    // 카드 타이틀
  title2: 24,    // 섹션 타이틀
  title1: 28,    // 화면 타이틀
  headline: 32,  // 큰 헤드라인
  display: 48,   // 히어로/스플래시
  hero: 64,      // 초대형(로고/스플래시)
} as const;

// 굵기 — RN 문자열 값
export const weight = {
  light: '300',
  regular: '400',
  medium: '500',
  semibold: '600', // 사용 빈도 높음
  bold: '700',     // 사용 빈도 최다
  heavy: '800',    // 강조 헤드라인
} as const;

// 줄간격 배수 (fontSize × ratio 로 lineHeight 계산)
export const leading = {
  tight: 1.2,   // 헤드라인
  normal: 1.35, // 본문
  relaxed: 1.5, // 긴 문단
} as const;

// 자간
export const tracking = {
  tight: -0.4,
  normal: 0,
  wide: 0.5,
} as const;

const compose = (fontSize: number, fontWeight: string, ratio: number) => ({
  fontSize,
  fontWeight: fontWeight as
    | '300' | '400' | '500' | '600' | '700' | '800',
  lineHeight: Math.round(fontSize * ratio),
});

// 시맨틱 텍스트 스타일 — 화면에서 이걸 우선 사용 (원시 size/weight 직접 지정 지양)
export const style = {
  hero: compose(size.hero, weight.heavy, leading.tight),
  display: compose(size.display, weight.bold, leading.tight),
  headline: compose(size.headline, weight.bold, leading.tight),
  title1: compose(size.title1, weight.bold, leading.tight),
  title2: compose(size.title2, weight.bold, leading.normal),
  title3: compose(size.title3, weight.semibold, leading.normal),
  subtitle: compose(size.subtitle, weight.semibold, leading.normal),
  callout: compose(size.callout, weight.semibold, leading.normal),
  body: compose(size.body, weight.regular, leading.normal),
  bodyStrong: compose(size.body, weight.semibold, leading.normal),
  bodyLg: compose(size.bodyLg, weight.regular, leading.relaxed),
  footnote: compose(size.footnote, weight.regular, leading.normal),
  caption: compose(size.caption, weight.medium, leading.normal),
} as const;

export const typography = { size, weight, leading, tracking, style };

// 편의 alias
export const T = typography;
export default typography;
