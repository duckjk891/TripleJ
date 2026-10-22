// [ui/AppText] 타입 위계 통일 텍스트 — typography 토큰의 시맨틱 스타일만 사용.
// Material 3 / HIG: 명료한 타입 스케일. 원시 fontSize/fontWeight 직접 지정 지양.
import { Platform, Text, TextProps, StyleSheet } from 'react-native';
import { typography } from '../../theme/typography';
import { colors } from '../../theme/colors';

type Variant = keyof typeof typography.style;
type Tone = 'primary' | 'secondary' | 'muted' | 'accent' | 'inverse';

const toneColor: Record<Tone, string> = {
  primary: colors.text.primary,
  secondary: colors.text.secondary,
  muted: colors.text.muted,
  accent: colors.accent.primary,
  inverse: colors.text.inverse,
};

export interface AppTextProps extends TextProps {
  variant?: Variant;
  tone?: Tone;
  center?: boolean;
}

// v3.398 [iOS 글씨 잘림] 호출부가 fontSize 만 바꾸면 variant 의 lineHeight(body 18)가 그대로 남아, 아이폰은 줄 높이 밖으로
// 나간 글자 위아래를 잘라 그린다(대표 실기기 아이폰 6s, 10-22 — 아바타 이니셜·제목·화살표 등 145곳).
// iOS 에서만: 결과 lineHeight 가 글자 크기의 1.2배보다 작고 호출부가 lineHeight 를 직접 주지 않았으면 1.3배로 맞춘다.
const MIN_RATIO = 1.2;
const FIT_RATIO = 1.3;

function iosLineHeightFix(variant: Variant, style: TextProps['style']) {
  if (Platform.OS !== 'ios' || !style) return null;
  const flat = StyleSheet.flatten(style) as { fontSize?: number; lineHeight?: number } | undefined;
  const fontSize = flat?.fontSize;
  if (!fontSize || flat?.lineHeight != null) return null;
  const base = (typography.style[variant] as { lineHeight?: number }).lineHeight;
  if (base == null || base >= fontSize * MIN_RATIO) return null;
  return { lineHeight: Math.round(fontSize * FIT_RATIO) };
}

export default function AppText({ variant = 'body', tone = 'primary', center, style, ...rest }: AppTextProps) {
  return (
    <Text
      {...rest}
      style={[typography.style[variant], { color: toneColor[tone] }, center && styles.center, style, iosLineHeightFix(variant, style)]}
    />
  );
}

const styles = StyleSheet.create({ center: { textAlign: 'center' } });
