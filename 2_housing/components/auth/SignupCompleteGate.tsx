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
import { getMyGuardianConsent, requestMyGuardianConsent, type MyGuardianConsent } from '../../services/guardianConsentService';
import { shareOrCopy } from '../../utils/clubJoin';
import QrCode from './QrCode';
import { openAccountMerge } from '../../utils/accountMerge';
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

// v3.350: guardian = 만 14세 미만(본인확인으로 확인) → 보호자 동의 대기(링크·QR 공유, 동의되면 자동 해제)
type Phase = 'form' | 'saving' | 'under14' | 'guardian';
const GUARDIAN_POLL_MS = 8000;

export default function SignupCompleteGate() {
  const insets = useSafeAreaInsets();
  const userId = useAuthStore((s) => (s.user?.id != null ? String(s.user.id) : ''));
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [consents, setConsents] = useState<ConsentState>({});
  const [birth, setBirth] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [phase, setPhase] = useState<Phase>('form');
  const [guardian, setGuardian] = useState<MyGuardianConsent | null>(null);
  const [guardianBusy, setGuardianBusy] = useState(false);

  /** v3.350 만 14세 미만 확인 → 보호자 동의 링크 만들기(대기 중이면 그 링크) → 대기 화면. 실패 시 종전 안내(로그아웃) */
  const enterGuardian = async (src: string) => {
    try {
      const g = await requestMyGuardianConsent();
      console.info('[SignupComplete] 보호자 동의 대기 진입', { src, status: g.status, required: g.required });
      setGuardian(g);
      setPhase(g.required ? 'guardian' : 'form');
    } catch (err: any) {
      console.error('[SignupComplete] 보호자 동의 링크 요청 실패', { src, status: err?.response?.status });
      setPhase('under14');
    }
  };

  useEffect(() => {
    let alive = true;
    setStatus(null);
    setPhase('form');
    setGuardian(null);
    if (!userId) return;
    (async () => {
      const s = await getOnboardingStatus();
      if (!alive || !s) return;
      if (s.required) console.info('[SignupComplete] 가입 마무리 필요', { missing: s.missing_consents, birthMissing: s.birth_date_missing });
      setStatus(s);
      // v3.350 만 14세 미만인데 보호자 동의가 없으면(본인확인 뒤 앱을 닫았다 다시 연 경우 포함) 대기 화면
      if (s.is_minor) {
        const g = await getMyGuardianConsent();
        if (!alive || !g) return;
        if (g.required) {
          console.info('[SignupComplete] 보호자 동의 필요(재진입)', { status: g.status });
          setGuardian(g);
          setPhase('guardian');
        }
      }
    })();
    return () => { alive = false; };
  }, [userId]);

  // v3.350 보호자 동의 대기 중 — 주기적으로 확인해 동의되면 자동 해제
  useEffect(() => {
    if (phase !== 'guardian' || !userId) return;
    let alive = true;
    const t = setInterval(async () => {
      const g = await getMyGuardianConsent();
      if (!alive || !g) return;
      setGuardian(g);
      if (!g.required) {
        console.info('[SignupComplete] 보호자 동의 완료 — 해제');
        setPhase('form');
        try { useAuthStore.getState().setUser((await getMe()) as any); } catch { /* 표시용 갱신 실패 무시 */ }
        const s = await getOnboardingStatus();
        if (alive && s) setStatus(s);
        showAlert('보호자 동의 완료', '보호자 동의가 끝났어요. 이제 MAIDOL 을 이용할 수 있어요!');
      }
    }, GUARDIAN_POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [phase, userId]);

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
      if (r.status === 'merge_candidate' || r.merge_candidate) {
        // v3.352 같은 분 명의의 다른 계정 → 통합 화면(합치면 남긴 계정 세션으로 바뀌고 userId 효과가 다시 판정)
        const o = await openAccountMerge(ret.rid);
        if (o === 'declined') showAlert('알림', '계정을 합치지 않았어요. 본인 명의 휴대폰으로 다시 인증하거나 고객센터(maidol_official@lotusai.co.kr)로 문의해 주세요.');
        const s = await getOnboardingStatus();
        if (alive && s) setStatus(s);
        return;
      }
      if (r.status === 'verified') {
        if (r.under_14) { await enterGuardian('web_return'); return; }
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
  if (phase === 'guardian' && guardian) {
    const url = guardian.consent_url;
    const stale = guardian.status === 'rejected' || guardian.status === 'expired' || !url;
    const remake = async () => {
      setGuardianBusy(true);
      try { await enterGuardian('remake'); } finally { setGuardianBusy(false); }
    };
    const share = async () => {
      if (!url) return;
      const r = await shareOrCopy(`MAIDOL 가입에 보호자 동의가 필요해요. 아래 링크를 열어 휴대폰 본인확인 후 동의해 주세요.\n${url}`, url);
      console.info('[SignupComplete] 보호자 링크 공유', { result: r });
      if (r === 'copied') showAlert('알림', '링크를 복사했어요. 보호자에게 보내 주세요.');
    };
    const checkNow = async () => {
      setGuardianBusy(true);
      try {
        const g = await getMyGuardianConsent();
        if (g) setGuardian(g);
        if (g && !g.required) {
          setPhase('form');
          try { useAuthStore.getState().setUser((await getMe()) as any); } catch { /* 무시 */ }
          const s = await getOnboardingStatus();
          if (s) setStatus(s);
          showAlert('보호자 동의 완료', '보호자 동의가 끝났어요. 이제 MAIDOL 을 이용할 수 있어요!');
        } else if (g) {
          showAlert('알림', g.status === 'rejected' ? '보호자가 동의하지 않았어요. 다시 요청하려면 새 링크를 만들어 주세요.' : '아직 보호자 동의 전이에요.');
        }
      } finally {
        setGuardianBusy(false);
      }
    };
    return (
      <Modal visible animationType="slide" onRequestClose={() => {}}>
        <ScrollView style={styles.screen} contentContainerStyle={{ paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xl, paddingHorizontal: spacing.lg }}>
          <AppText variant="title2">보호자 동의가 필요해요</AppText>
          <AppText variant="footnote" tone="secondary" style={{ marginTop: spacing.sm }}>
            만 14세 미만은 보호자(부모님 등)의 동의가 있어야 MAIDOL 을 이용할 수 있어요.{'\n'}
            보호자에게 아래 링크를 보내거나 QR 코드를 보여 주세요. 보호자가 휴대폰 본인확인 후 동의하면 바로 이용할 수 있어요.
          </AppText>
          {stale ? (
            <View style={[styles.section, { marginTop: spacing.xl }]}>
              <AppText variant="callout">
                {guardian.status === 'rejected' ? '보호자가 동의하지 않았어요.' : '동의 링크가 만료됐어요.'}
              </AppText>
              <TouchableOpacity style={[styles.primary, { marginTop: spacing.md }, guardianBusy && styles.disabled]} onPress={remake} disabled={guardianBusy}>
                {guardianBusy ? <ActivityIndicator color="#fff" /> : <AppText style={styles.primaryText}>새 동의 링크 만들기</AppText>}
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ marginTop: spacing.xl, alignItems: 'center' }}>
              <View style={styles.qrBox}><QrCode value={url as string} size={184} /></View>
              <AppText variant="caption" tone="muted" center style={{ marginTop: spacing.sm }}>
                {guardian.expires_at ? `링크는 ${new Date(guardian.expires_at).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}까지 쓸 수 있어요` : ''}
              </AppText>
              <TouchableOpacity style={[styles.primary, { marginTop: spacing.lg, alignSelf: 'stretch' }]} onPress={share}>
                <AppText style={styles.primaryText}>보호자에게 링크 보내기</AppText>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.outline, { marginTop: spacing.sm, alignSelf: 'stretch' }, guardianBusy && styles.disabled]} onPress={checkNow} disabled={guardianBusy}>
                {guardianBusy ? <ActivityIndicator color={colors.accent.primary} /> : <AppText tone="accent" style={{ fontWeight: '700' }}>보호자 동의 확인하기</AppText>}
              </TouchableOpacity>
            </View>
          )}
          <TouchableOpacity style={styles.secondary} onPress={() => useAuthStore.getState().logout()}>
            <AppText variant="footnote" tone="muted">로그아웃</AppText>
          </TouchableOpacity>
        </ScrollView>
      </Modal>
    );
  }
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
      if ((r.status === 'merge_candidate' || r.merge_candidate) && r.rid) {
        const o = await openAccountMerge(r.rid);
        if (o === 'declined') showAlert('알림', '계정을 합치지 않았어요. 본인 명의 휴대폰으로 다시 인증하거나 고객센터(maidol_official@lotusai.co.kr)로 문의해 주세요.');
        await finish();
        return;
      }
      if (r.status === 'verified') {
        if (r.under_14) { await enterGuardian('native'); return; }
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
                <AppText variant="subtitle">{status.identity_required ? '휴대폰 본인확인' : '나이 확인'}</AppText>
                <AppText variant="footnote" tone="secondary" style={{ marginVertical: spacing.sm }}>
                  {status.identity_required
                    ? 'MAIDOL 은 한 분당 한 계정으로 운영돼요. 가입하신 방법(이메일·소셜)과 관계없이 휴대폰 본인확인을 한 번 해 주세요. 이름·생년월일·성별만 확인하고, 휴대폰 번호는 저장하지 않아요.'
                    : '휴대폰 본인확인으로 나이를 확인해요. 이름·생년월일·성별만 확인하고, 휴대폰 번호는 저장하지 않아요.'}
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
  outline: { borderRadius: radius.md, paddingVertical: 13, alignItems: 'center', borderWidth: 1, borderColor: colors.accent.primary },
  qrBox: { padding: spacing.sm, backgroundColor: '#FFFFFF', borderRadius: radius.md },
});
