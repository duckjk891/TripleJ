// v3.333 [SignupComplete] 소셜 가입 마무리 — 구글·애플·카카오로 가입한 계정이 약관·개인정보·국외이전 동의와
// 나이 확인 없이 만들어지던 문제(스토어 제출 점검 #1)를 막는 화면. 서버 스위치 SOCIAL_ONBOARDING_ENABLED 를
// 켜기 전에는 서버가 required=false 를 주므로 아무것도 뜨지 않는다(현재 동작 그대로).
//  · 필수 동의 누락 → 동의 목록(가입과 같은 ConsentList) → POST /auth/me/consents
//  · 생년월일 없음 → 본인확인(PG, 서버 IDENTITY_VERIFY_PROVIDER 켜짐) 또는 생년월일 직접 입력(PG 전 — 이메일 가입과 같은 자기 신고)
//  · 만 14세 미만 → 보호자 동의 절차가 열릴 때까지 이용 불가 안내 + 로그아웃
// 로그인 상태가 바뀔 때(로그인 직후·앱 시작) 1회 조회. 닫기 버튼 없음(로그아웃만).
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../ui';
import ConsentList, { type ConsentState } from './ConsentList';
import { colors } from '../../theme/colors';
import { spacing, radius } from '../../theme/spacing';
import { useAuthStore } from '../../stores/authStore';
import { CONSENT_VERSION, SIGNUP_CONSENT_KEYS, REQUIRED_CONSENT_KEYS } from '../../constants/consentTexts';
import { recordConsents, getMe } from '../../services/authService';
import { getOnboardingStatus, type OnboardingStatus } from '../../services/identityService';
import { runIdentityVerification, pollResult } from '../../utils/identityFlow';
import { consumeIdentityReturn } from '../../utils/identityReturn';
import { showAlert } from '../../utils/appAlert';
import { friendlyErrorMessage } from '../../utils/friendlyError';

/** YYYY-MM-DD 또는 YYYYMMDD → Date(유효한 과거 날짜만) */
export function parseBirthInput(raw: string): string | null {
  const s = raw.trim();
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  if (y < 1900 || dt.getTime() > Date.now()) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** 만 나이(KST 기준 근사 — 서버가 정본 판정) */
export function ageFrom(isoDate: string, now = new Date()): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age -= 1;
  return age;
}

type Phase = 'form' | 'saving' | 'under14';

export default function SignupCompleteGate() {
  const insets = useSafeAreaInsets();
  const userId = useAuthStore((s) => (s.user?.id != null ? String(s.user.id) : ''));
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [consents, setConsents] = useState<ConsentState>({});
  const [birth, setBirth] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [phase, setPhase] = useState<Phase>('form');

  useEffect(() => {
    let alive = true;
    setStatus(null);
    setPhase('form');
    if (!userId) return;
    (async () => {
      const s = await getOnboardingStatus();
      if (!alive || !s) return;
      if (s.required) console.info('[SignupComplete] 가입 마무리 필요', { missing: s.missing_consents, birthMissing: s.birth_date_missing });
      setStatus(s);
    })();
    return () => { alive = false; };
  }, [userId]);

  // v3.349 웹 본인확인 같은 탭 복귀 — 서버 결과(정본)로 이어 처리. 로그인 복원 뒤 1회.
  useEffect(() => {
    if (!userId) return;
    const ret = consumeIdentityReturn();
    if (!ret) return;
    let alive = true;
    (async () => {
      const r = await pollResult(ret.rid, Date.now() + 15000);
      console.info('[SignupComplete] 웹 본인확인 복귀 결과', { rid: ret.rid.slice(0, 8), hint: ret.status, status: r.status, under14: r.under_14 });
      if (!alive) return;
      if (r.status === 'verified') {
        if (r.under_14) { setPhase('under14'); return; }
        try { useAuthStore.getState().setUser((await getMe()) as any); } catch { /* 표시용 갱신 실패 무시 */ }
        const s = await getOnboardingStatus();
        if (alive && s) setStatus(s);
        showAlert('본인확인', '본인확인이 완료됐어요.');
      } else if (r.status === 'cancelled' || ret.status === 'cancelled') {
        console.info('[SignupComplete] 본인확인 취소');
      } else if (r.status !== 'pending') {
        showAlert('본인확인', r.error || '본인확인을 마치지 못했어요. 다시 시도해 주세요.');
      } else {
        console.warn('[SignupComplete] 본인확인 결과 대기 중(복귀 후 15초)', { rid: ret.rid.slice(0, 8) });
      }
    })().catch((err: any) => console.error('[SignupComplete] 복귀 처리 실패', { message: err?.message }));
    return () => { alive = false; };
  }, [userId]);

  if (!userId) return null;
  if (phase === 'under14') {
    return (
      <Modal visible animationType="slide" onRequestClose={() => {}}>
        <View style={[styles.screen, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.center}>
            <AppText variant="title3" center>만 14세 미만은 지금 가입할 수 없어요</AppText>
            <AppText variant="footnote" tone="secondary" center style={{ marginTop: spacing.md }}>
              만 14세 미만은 보호자 동의를 받아야 MAIDOL 을 이용할 수 있어요.{'\n'}보호자 동의 절차가 열리면 다시 안내해 드릴게요.
            </AppText>
            <TouchableOpacity style={[styles.primary, { marginTop: spacing.xl }]} onPress={() => useAuthStore.getState().logout()}>
              <AppText style={styles.primaryText}>로그아웃</AppText>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }
  if (!status?.required) return null;

  const needConsents = status.missing_consents.length > 0;
  const needBirth = status.birth_date_missing;
  // v3.348: 어린이(보호자 동의) 계정은 '만 14세 이상 확인'을 보이지도·요구하지도·기록하지도 않는다
  const consentKeys = status.is_minor ? SIGNUP_CONSENT_KEYS.filter((k) => k !== 'age14') : SIGNUP_CONSENT_KEYS;
  const requiredKeys = status.is_minor ? REQUIRED_CONSENT_KEYS.filter((k) => k !== 'age14') : REQUIRED_CONSENT_KEYS;
  const consentsOk = !needConsents || requiredKeys.every((k) => consents[k]);

  const finish = async () => {
    const s = await getOnboardingStatus();
    try {
      const me = await getMe();
      useAuthStore.getState().setUser(me as any);
    } catch { /* 표시용 갱신 실패는 무시 */ }
    if (s && !s.required) {
      console.info('[SignupComplete] 가입 마무리 완료');
      setStatus(s);
    } else if (s) {
      setStatus(s);
      setPhase('form');
    }
  };

  const saveConsents = async () => {
    if (!needConsents) return;
    await recordConsents(consentKeys.map((k) => ({ key: k, agreed: !!consents[k] })), CONSENT_VERSION);
  };

  const submitWithBirth = async () => {
    if (!consentsOk) { showAlert('알림', '필수 항목에 모두 동의해 주세요.'); return; }
    let iso: string | null = null;
    if (needBirth) {
      iso = parseBirthInput(birth);
      if (!iso) { showAlert('알림', '생년월일을 YYYY-MM-DD 형식으로 입력해 주세요.'); return; }
    }
    setPhase('saving');
    try {
      await saveConsents();
      if (iso) {
        if (ageFrom(iso) < 14) {
          console.info('[SignupComplete] 만 14세 미만 — 이용 불가 안내');
          setPhase('under14');
          return;
        }
        const r = await useAuthStore.getState().updateProfile({ birth_date: iso } as any);
        if (!r.ok) throw new Error(useAuthStore.getState().error || '생년월일을 저장하지 못했어요.');
      }
      await finish();
    } catch (err: any) {
      console.error('[SignupComplete] 저장 실패', { status: err?.response?.status, message: err?.message });
      showAlert('알림', err?.response ? friendlyErrorMessage(err) : (err?.message || '저장하지 못했어요. 다시 시도해 주세요.'));
      setPhase('form');
    }
  };

  const submitWithIdentity = async () => {
    if (!consentsOk) { showAlert('알림', '필수 항목에 모두 동의해 주세요.'); return; }
    setVerifying(true);
    try {
      await saveConsents();
      const r = await runIdentityVerification('signup');
      console.info('[SignupComplete] 본인확인 결과', { status: r.status, under14: r.under_14 });
      if (r.status === 'verified') {
        if (r.under_14) { setPhase('under14'); return; }
        await finish();
      } else if (r.status !== 'pending') {
        showAlert('본인확인', r.error || '본인확인을 마치지 못했어요. 다시 시도해 주세요.');
      }
    } catch (err: any) {
      console.error('[SignupComplete] 본인확인 실패', { status: err?.response?.status });
      showAlert('본인확인', friendlyErrorMessage(err));
    } finally {
      setVerifying(false);
    }
  };

  const logout = () => {
    console.info('[SignupComplete] 로그아웃');
    useAuthStore.getState().logout();
  };

  return (
    <Modal visible animationType="slide" onRequestClose={() => {}}>
      <View style={[styles.screen, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.md }]}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }} keyboardShouldPersistTaps="handled">
            <AppText variant="title2">가입 마무리</AppText>
            <AppText variant="footnote" tone="secondary" style={{ marginTop: spacing.xs, marginBottom: spacing.lg }}>
              MAIDOL 을 계속 이용하려면 아래 내용을 확인해 주세요.
            </AppText>

            {needConsents && (
              <View style={styles.section}>
                <AppText variant="subtitle" style={{ marginBottom: spacing.sm }}>약관 동의</AppText>
                <ConsentList value={consents} onChange={setConsents} keys={consentKeys} />
              </View>
            )}

            {needBirth && status.identity.enabled && (
              <View style={styles.section}>
                <AppText variant="subtitle">나이 확인</AppText>
                <AppText variant="footnote" tone="secondary" style={{ marginVertical: spacing.sm }}>
                  휴대폰 본인확인으로 나이를 확인해요. 이름·생년월일·성별만 확인하고, 휴대폰 번호는 저장하지 않아요.
                </AppText>
                <TouchableOpacity style={[styles.primary, (!consentsOk || verifying) && styles.disabled]} onPress={submitWithIdentity} disabled={!consentsOk || verifying}>
                  {verifying ? <ActivityIndicator color="#fff" /> : <AppText style={styles.primaryText}>휴대폰 본인확인</AppText>}
                </TouchableOpacity>
              </View>
            )}

            {needBirth && !status.identity.enabled && (
              <View style={styles.section}>
                <AppText variant="subtitle">생년월일</AppText>
                <TextInput
                  style={styles.input}
                  value={birth}
                  onChangeText={setBirth}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.text.muted}
                  keyboardType="numbers-and-punctuation"
                  maxLength={10}
                />
              </View>
            )}

            {!(needBirth && status.identity.enabled) && (
              <TouchableOpacity
                style={[styles.primary, (!consentsOk || phase === 'saving') && styles.disabled]}
                onPress={submitWithBirth}
                disabled={!consentsOk || phase === 'saving'}
              >
                {phase === 'saving' ? <ActivityIndicator color="#fff" /> : <AppText style={styles.primaryText}>확인</AppText>}
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.secondary} onPress={logout}>
              <AppText variant="footnote" tone="muted">로그아웃</AppText>
            </TouchableOpacity>
          </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg.deepest },
  center: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xl },
  section: { marginBottom: spacing.xl },
  input: {
    marginTop: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    backgroundColor: colors.bg.surface1, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border.subtle,
    color: colors.text.primary, fontSize: 16,
  },
  primary: { backgroundColor: colors.accent.primary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center' },
  primaryText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.5 },
  secondary: { alignItems: 'center', paddingVertical: spacing.lg },
});
