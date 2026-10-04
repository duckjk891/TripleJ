// [LoginModalHost] v3.276 — 전역 로그인 모달(App.tsx 에 1개). utils/loginModal.openLoginModal() 로 어디서든 즉시 연다.
// 대표 결정(2026-10-04): "로그인하고 시작하기" 버튼 → 설정 화면 이동 2단계를 없애고 로그인 창을 바로 띄운다.
// 간편가입(구글·카카오) 우선 배치 + "3초면 간편가입 완료" 카피. 본인인증은 가입 시 요구하지 않고 필요한 기능(DM 등)에서만.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, View, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AuthPanel from './AuthPanel';
import { AppText } from '../ui';
import { setLoginModalOpener, LoginModalOptions } from '../../utils/loginModal';
import { useAuthStore } from '../../stores/authStore';
import { colors } from '../../theme/colors';
import { spacing, radius } from '../../theme/spacing';

export default function LoginModalHost() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const afterLoginRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setLoginModalOpener((opts?: LoginModalOptions) => {
      // 이미 로그인 상태면 모달 없이 후속 동작만
      if (useAuthStore.getState().user) {
        opts?.afterLogin?.();
        return;
      }
      console.info('[LoginModal] open', { reason: opts?.reason || '-' });
      afterLoginRef.current = opts?.afterLogin || null;
      setMode('login');
      setVisible(true);
    });
    return () => setLoginModalOpener(null);
  }, []);

  const close = useCallback(() => {
    setVisible(false);
    afterLoginRef.current = null;
  }, []);

  const handleSuccess = useCallback(() => {
    console.info('[LoginModal] success');
    const next = afterLoginRef.current;
    afterLoginRef.current = null;
    setVisible(false);
    // 모달 닫힘 애니메이션 뒤 후속 동작(네비게이션 충돌 방지)
    if (next) setTimeout(() => { try { next(); } catch (e: any) { console.error('[LoginModal] afterLogin failed', { message: e?.message }); } }, 250);
  }, []);

  // 외부 경로(소셜 콜백·다른 화면)로 로그인이 완료되면 자동 닫힘
  useEffect(() => {
    if (user && visible) handleSuccess();
  }, [user, visible, handleSuccess]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" pointerEvents="box-none">
        <View style={styles.overlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={close} accessibilityLabel="로그인 창 닫기" />
          <View style={[styles.sheet, { paddingBottom: Math.max(24, insets.bottom + 16) }]}>
            <View style={styles.headerRow}>
              <View style={{ flex: 1 }}>
                <AppText style={styles.title}>
                  {mode === 'login' ? '3초면 간편가입 완료' : mode === 'forgot' ? '비밀번호 재설정' : '회원가입'}
                </AppText>
                {mode === 'login' ? (
                  <AppText variant="footnote" tone="secondary" style={{ marginTop: 4 }}>
                    구글·카카오로 바로 시작해요. 본인인증은 필요한 순간에만 요청해요.
                  </AppText>
                ) : null}
              </View>
              <TouchableOpacity onPress={close} accessibilityLabel="닫기" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Feather name="x" size={22} color={colors.text.secondary} />
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {visible ? (
                <AuthPanel socialFirst onSuccess={handleSuccess} onModeChange={setMode} />
              ) : null}
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: colors.bg.surface1,
    borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg, paddingTop: spacing.lg,
    maxHeight: '90%',
  },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.md },
  title: { fontSize: 20, fontWeight: 'bold', color: colors.text.primary },
});
