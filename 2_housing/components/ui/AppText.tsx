// [ui/AppText] 타입 위계 통일 텍스트 — typography 토큰의 시맨틱 스타일만 사용.
// Material 3 / HIG: 명료한 타입 스케일. 원시 fontSize/fontWeight 직접 지정 지양.
import { Text, TextProps, StyleSheet } from 'react-native';
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

export default function AppText({ variant = 'body', tone = 'primary', center, style, ...rest }: AppTextProps) {
  return (
    <Text
      {...rest}
      style={[typography.style[variant], { color: toneColor[tone] }, center && styles.center, style]}
    />
  );
}

const styles = StyleSheet.create({ center: { textAlign: 'center' } });
