// [LoginModalHost] v3.276 — 전역 로그인 모달(App.tsx 에 1개). utils/loginModal.openLoginModal() 로 어디서든 즉시 연다.
// 대표 결정(2026-10-04): "로그인하고 시작하기" 버튼 → 설정 화면 이동 2단계를 없애고 로그인 창을 바로 띄운다.
// 간편가입(구글·카카오) 우선 배치 + "3초면 간편가입 완료" 카피. 본인인증은 가입 시 요구하지 않고 필요한 기능(DM 등)에서만.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, View, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AuthPanel from './AuthPanel';
import { useLyricsStore } from '../../stores/lyricsStore';
import { whenBootAuthSettled } from '../../utils/bootAuth';
import { AppText } from '../ui';
import { setLoginModalOpener, LoginModalOptions } from '../../utils/loginModal';
// v3.277 [GuestCompose]: 로그인 확정 시 대기 중인 게스트 작곡 체험 곡을 1회 자동 claim(웹 소셜 리로드 포함)
import { runGuestClaimIfPending } from '../../utils/guestTrial';
import { useAuthStore } from '../../stores/authStore';
import { colors } from '../../theme/colors';
import { spacing, radius } from '../../theme/spacing';

// v3.279 [LyricsOwner] 1회 정리 — 이 버전 이전에 로그아웃한 기기에는 이전 계정의 작사 대화가 남아 있다.
// 부팅 시 비로그인이면 한 번만 비운다(이후엔 로그아웃 시점에 계정 보관함으로 옮기므로 재발 없음).
const LYRICS_OWNER_MIGRATED_KEY = 'maidol_lyrics_owner_migrated_v1';
async function migrateLegacyGuestLyricsOnce(): Promise<void> {
  try {
    if (await AsyncStorage.getItem(LYRICS_OWNER_MIGRATED_KEY)) return;
    await whenBootAuthSettled();
    if (!useAuthStore.getState().user) {
      useLyricsStore.getState().reset();
      console.info('[LyricsOwner] 레거시 잔존 작사 작업본 1회 정리(비로그인)');
    }
    await AsyncStorage.setItem(LYRICS_OWNER_MIGRATED_KEY, '1');
  } catch (err: any) {
    console.warn('[LyricsOwner] 1회 정리 실패', { message: err?.message });
  }
}

export default function LoginModalHost() {
  useEffect(() => { void migrateLegacyGuestLyricsOnce(); }, []);
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

  // v3.277 [GuestCompose]: user 확정(이메일·소셜 콜백·세션 복원) 시 대기 중 게스트 곡 자동 claim — 이 호스트는 항상 마운트
  const userId = user?.id ? String(user.id) : null;
  useEffect(() => {
    if (!userId) return;
    void runGuestClaimIfPending('auth_user');
  }, [userId]);

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
