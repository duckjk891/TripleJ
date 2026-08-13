// [ui/ScreenLayout] 화면 공통 껍데기 — 다크 배경 + 상단 황혼 그라데이션(은은). 안전영역 옵션.
import { ReactNode } from 'react';
import { View, StyleSheet, ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../../theme/colors';

export interface ScreenLayoutProps extends ViewProps {
  gradient?: boolean;
  safeTop?: boolean;
  children?: ReactNode;
}

export default function ScreenLayout({ gradient = true, safeTop = false, style, children, ...rest }: ScreenLayoutProps) {
  const Container: any = safeTop ? SafeAreaView : View;
  const containerProps = safeTop ? { edges: ['top'] as const } : {};
  return (
    <Container style={[styles.root, style]} {...containerProps} {...rest}>
      {gradient ? (
        <LinearGradient colors={[colors.bg.surface2, 'transparent']} style={styles.grad} pointerEvents="none" />
      ) : null}
      {children}
    </Container>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg.deepest },
  grad: { position: 'absolute', top: 0, left: 0, right: 0, height: 160 },
});
