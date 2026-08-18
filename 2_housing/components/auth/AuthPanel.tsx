// [AuthPanel] 로그인/회원가입 패널 — MAIDOL LoginPage/RegisterPage 이식.
// 로그인: 이메일·비밀번호 + 소셜(구글/카카오/네이버) + 회원가입 이동.
// 가입: [연령 게이트(생년월일·내외국인·성별)] → [본 폼(이메일·닉네임·기획사명·호칭·비밀번호+확인·추천코드·약관동의)]
//       만 14세 미만은 보호자 동의 준비 중 안내(blocked) — 백엔드 guardian_consent_enabled=false 기준.
// 현행 백엔드는 gender·consents가 필수라 이 패널이 없으면 가입이 항상 400으로 실패한다(v3.43에서 해소).
import { useMemo, useState } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { useAuthStore } from '../../stores/authStore';
import { CONSENT_VERSION, SIGNUP_CONSENT_KEYS, REQUIRED_CONSENT_KEYS } from '../../constants/consentTexts';
import ConsentList, { ConsentState } from './ConsentList';
import SocialLoginButtons from './SocialLoginButtons';
import { AppText, Button } from '../ui';
import { colors } from '../../theme/colors';
import { spacing, radius } from '../../theme/spacing';

type Mode = 'login' | 'gate' | 'form' | 'blocked';

// 기획사명 자동 접미 — MAIDOL과 동일(끝이 '엔터테인먼트'가 아니면 붙인다)
const normalizeCompany = (v: string) => {
  const t = v.trim();
  if (!t) return '';
  return t.endsWith('엔터테인먼트') ? t : `${t} 엔터테인먼트`;
};

const REFERRAL_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/;

export default function AuthPanel({ onSuccess }: { onSuccess?: () => void }) {
  const { isLoading, error, login, register, clearError } = useAuthStore();
  const [mode, setMode] = useState<Mode>('login');
  const [localError, setLocalError] = useState('');

  // 공통 필드
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // 게이트(생년월일·내외국인·성별)
  const [birthY, setBirthY] = useState('');
  const [birthM, setBirthM] = useState('');
  const [birthD, setBirthD] = useState('');
  const [nationality, setNationality] = useState<'domestic' | 'foreign' | null>(null);
  const [gender, setGender] = useState<'male' | 'female' | 'other' | null>(null);

  // 가입 본 폼
  const [nickname, setNickname] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [displayTitle, setDisplayTitle] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [consents, setConsents] = useState<ConsentState>({});

  const showError = localError || error;
  const resetError = () => { setLocalError(''); clearError(); };

  const pwHints = useMemo(() => ([
    { ok: password.length >= 8, label: '8자 이상' },
    { ok: /[a-zA-Z]/.test(password), label: '영문 포함' },
    { ok: /[0-9]/.test(password), label: '숫자 포함' },
  ]), [password]);

  const birthDate = () => {
    const y = parseInt(birthY, 10), m = parseInt(birthM, 10), d = parseInt(birthD, 10);
    if (!y || !m || !d || y < 1900 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };

  const koreanAge = (bd: string) => {
    const [y, m, d] = bd.split('-').map(Number);
    const now = new Date();
    let age = now.getFullYear() - y;
    if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age -= 1;
    return age;
  };

  const handleLogin = async () => {
    resetError();
    if (!email.trim() || !password) { setLocalError('이메일과 비밀번호를 입력해주세요.'); return; }
    if (__DEV__) console.info('[AuthPanel] login 시도', { emailLen: email.length });
    const ok = await login(email.trim(), password);
    if (ok) onSuccess?.();
  };

  const handleGateNext = () => {
    resetError();
    const bd = birthDate();
    if (!bd) { setLocalError('생년월일을 모두 선택해주세요.'); return; }
    if (!nationality) { setLocalError('내국인/외국인 여부를 선택해주세요.'); return; }
    if (!gender) { setLocalError('성별을 선택해주세요.'); return; }
    if (koreanAge(bd) < 14) {
      if (__DEV__) console.info('[AuthPanel] 만14세 미만 → blocked');
      setMode('blocked');
      return;
    }
    setMode('form');
  };

  const handleRegister = async () => {
    resetError();
    if (!email.trim() || !password || !nickname.trim()) { setLocalError('모든 필드를 입력해주세요.'); return; }
    if (!companyName.trim() || !displayTitle.trim()) { setLocalError('모든 필드를 입력해주세요.'); return; }
    if (password !== passwordConfirm) { setLocalError('비밀번호가 일치하지 않습니다.'); return; }
    if (!(password.length >= 8 && /[a-zA-Z]/.test(password) && /[0-9]/.test(password))) {
      setLocalError('비밀번호는 8자 이상이며 영문과 숫자를 모두 포함해야 합니다.'); return;
    }
    if (!REQUIRED_CONSENT_KEYS.every((k) => consents[k])) {
      setLocalError('필수 동의 항목에 모두 동의해야 가입할 수 있습니다.'); return;
    }
    const ref = referralCode.trim().toUpperCase();
    if (ref && !REFERRAL_RE.test(ref)) {
      setLocalError('추천코드는 4자리 영문 대문자/숫자입니다. 다시 확인해주세요.'); return;
    }
    const bd = birthDate();
    const consentsBody: Record<string, any> = { version: CONSENT_VERSION };
    SIGNUP_CONSENT_KEYS.forEach((k) => { consentsBody[k] = !!consents[k]; });
    if (__DEV__) console.info('[AuthPanel] register 시도', { emailLen: email.length, hasRef: !!ref });
    const ok = await register(
      email.trim(), password, nickname.trim(),
      normalizeCompany(companyName), displayTitle.trim(),
      {
        birth_date: bd,
        nationality,
        gender,
        consents: consentsBody,
        ...(ref ? { referral_code: ref } : {}),
      },
    );
    if (ok) onSuccess?.();
  };

  const Label = ({ children }: { children: string }) => (
    <AppText variant="footnote" tone="secondary" style={styles.label}>{children}</AppText>
  );

  const Radio = ({ selected, label, onPress }: { selected: boolean; label: string; onPress: () => void }) => (
    <TouchableOpacity style={[styles.radio, selected && styles.radioActive]} onPress={onPress} accessibilityLabel={label}>
      <AppText variant="footnote" tone={selected ? 'accent' : 'secondary'}>{label}</AppText>
    </TouchableOpacity>
  );

  // ── 로그인 ──
  if (mode === 'login') {
    return (
      <View>
        <AppText variant="title2" style={styles.title}>로그인</AppText>
        {showError ? <AppText variant="footnote" style={styles.error}>{showError}</AppText> : null}
        <Label>이메일</Label>
        <TextInput style={styles.input} placeholder="이메일을 입력하세요" placeholderTextColor={colors.text.muted}
          value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        <Label>비밀번호</Label>
        <TextInput style={styles.input} placeholder="비밀번호를 입력하세요" placeholderTextColor={colors.text.muted}
          value={password} onChangeText={setPassword} secureTextEntry />
        <Button label={isLoading ? '로그인 중...' : '로그인'} fullWidth disabled={isLoading} onPress={handleLogin} />
        <SocialLoginButtons logPrefix="AuthPanel:login" />
        <View style={styles.footer}>
          <AppText variant="footnote" tone="secondary">아직 계정이 없으신가요? </AppText>
          <TouchableOpacity onPress={() => { resetError(); setMode('gate'); }}>
            <AppText variant="footnote" tone="accent">회원가입</AppText>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── 가입: 만14세 미만 차단 ──
  if (mode === 'blocked') {
    return (
      <View>
        <AppText variant="title2" style={styles.title}>회원가입</AppText>
        <AppText variant="bodyStrong" style={{ marginBottom: spacing.sm }}>만 14세 미만 가입은 보호자 동의 절차 준비 중입니다.</AppText>
        <AppText variant="footnote" tone="secondary" style={{ lineHeight: 20, marginBottom: spacing.xl }}>
          만 14세 미만은 법정대리인(보호자)의 동의가 있어야 가입할 수 있습니다. 서비스 준비가 완료되면 보호자 동의 후 가입이 가능합니다.
        </AppText>
        <Button label="이전으로" variant="tonal" fullWidth onPress={() => { resetError(); setMode('gate'); }} />
      </View>
    );
  }

  // ── 가입: 연령 게이트 ──
  if (mode === 'gate') {
    return (
      <View>
        <AppText variant="title2" style={styles.title}>회원가입</AppText>
        <AppText variant="footnote" tone="secondary" style={{ marginBottom: spacing.lg }}>
          가입 전에 생년월일과 내/외국인 여부를 확인합니다.
        </AppText>
        {showError ? <AppText variant="footnote" style={styles.error}>{showError}</AppText> : null}

        <Label>생년월일 *</Label>
        <View style={styles.birthRow}>
          <TextInput style={[styles.input, styles.birthInput]} placeholder="연도(YYYY)" placeholderTextColor={colors.text.muted}
            value={birthY} onChangeText={(v) => setBirthY(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" />
          <TextInput style={[styles.input, styles.birthInput]} placeholder="월" placeholderTextColor={colors.text.muted}
            value={birthM} onChangeText={(v) => setBirthM(v.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" />
          <TextInput style={[styles.input, styles.birthInput]} placeholder="일" placeholderTextColor={colors.text.muted}
            value={birthD} onChangeText={(v) => setBirthD(v.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" />
        </View>

        <Label>내/외국인 *</Label>
        <View style={styles.radioRow}>
          <Radio selected={nationality === 'domestic'} label="내국인" onPress={() => setNationality('domestic')} />
          <Radio selected={nationality === 'foreign'} label="외국인" onPress={() => setNationality('foreign')} />
        </View>

        <Label>성별 *</Label>
        <View style={styles.radioRow}>
          <Radio selected={gender === 'male'} label="남성" onPress={() => setGender('male')} />
          <Radio selected={gender === 'female'} label="여성" onPress={() => setGender('female')} />
          <Radio selected={gender === 'other'} label="기타" onPress={() => setGender('other')} />
        </View>

        <Button label="다음" fullWidth onPress={handleGateNext} />
        <View style={styles.footer}>
          <AppText variant="footnote" tone="secondary">이미 계정이 있으신가요? </AppText>
          <TouchableOpacity onPress={() => { resetError(); setMode('login'); }}>
            <AppText variant="footnote" tone="accent">로그인</AppText>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── 가입: 본 폼 ──
  return (
    <View>
      <AppText variant="title2" style={styles.title}>회원가입</AppText>

      {/* 게이트 요약 + 수정 */}
      <View style={styles.gateSummary}>
        <AppText variant="caption" tone="secondary">
          생년월일 {birthDate()} · {nationality === 'domestic' ? '내국인' : '외국인'} · {gender === 'male' ? '남성' : gender === 'female' ? '여성' : '기타'}
        </AppText>
        <TouchableOpacity onPress={() => { resetError(); setMode('gate'); }}>
          <AppText variant="caption" tone="accent">수정</AppText>
        </TouchableOpacity>
      </View>

      {showError ? <AppText variant="footnote" style={styles.error}>{showError}</AppText> : null}

      <Label>이메일</Label>
      <TextInput style={styles.input} placeholder="이메일을 입력하세요" placeholderTextColor={colors.text.muted}
        value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
      <Label>닉네임</Label>
      <TextInput style={styles.input} placeholder="닉네임을 입력하세요" placeholderTextColor={colors.text.muted}
        value={nickname} onChangeText={setNickname} />
      <Label>기획사명</Label>
      <TextInput style={styles.input} placeholder="예: 이재규 엔터테인먼트" placeholderTextColor={colors.text.muted}
        maxLength={100} value={companyName} onChangeText={setCompanyName}
        onBlur={() => setCompanyName((v) => (v.trim() ? normalizeCompany(v) : v))} />
      <Label>호칭</Label>
      <TextInput style={styles.input} placeholder="예: 대표님" placeholderTextColor={colors.text.muted}
        maxLength={20} value={displayTitle} onChangeText={setDisplayTitle} />
      <Label>비밀번호</Label>
      <TextInput style={styles.input} placeholder="비밀번호 (8자 이상, 영문+숫자 포함)" placeholderTextColor={colors.text.muted}
        value={password} onChangeText={setPassword} secureTextEntry />
      {password ? (
        <View style={styles.hintRow}>
          {pwHints.map((h) => (
            <AppText key={h.label} variant="caption" tone={h.ok ? 'accent' : 'muted'}>
              {h.ok ? '✓' : '·'} {h.label}
            </AppText>
          ))}
        </View>
      ) : null}
      <Label>비밀번호 확인</Label>
      <TextInput style={styles.input} placeholder="비밀번호를 다시 입력하세요" placeholderTextColor={colors.text.muted}
        value={passwordConfirm} onChangeText={setPasswordConfirm} secureTextEntry />
      {passwordConfirm && password !== passwordConfirm ? (
        <AppText variant="caption" style={styles.error}>비밀번호가 일치하지 않습니다.</AppText>
      ) : null}

      <Label>추천코드 (선택)</Label>
      <TextInput style={styles.input} placeholder="친구에게 받은 4자리 코드" placeholderTextColor={colors.text.muted}
        maxLength={4} autoCapitalize="characters" value={referralCode}
        onChangeText={(v) => setReferralCode(v.toUpperCase())} />

      <AppText variant="bodyStrong" style={styles.section}>약관 동의</AppText>
      <ConsentList value={consents} onChange={setConsents} />

      <View style={{ marginTop: spacing.lg }}>
        <Button
          label={isLoading ? '가입 중...' : '회원가입'}
          fullWidth
          disabled={isLoading || !REQUIRED_CONSENT_KEYS.every((k) => consents[k])}
          onPress={handleRegister}
        />
      </View>

      <SocialLoginButtons logPrefix="AuthPanel:register" />
      <View style={styles.footer}>
        <AppText variant="footnote" tone="secondary">이미 계정이 있으신가요? </AppText>
        <TouchableOpacity onPress={() => { resetError(); setMode('login'); }}>
          <AppText variant="footnote" tone="accent">로그인</AppText>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { marginBottom: spacing.lg },
  label: { marginBottom: spacing.xs, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.bg.surface1, borderRadius: radius.md, padding: spacing.md,
    color: colors.text.primary, borderWidth: 1, borderColor: colors.border.subtle,
    marginBottom: spacing.sm,
  },
  error: { color: colors.status.error, marginBottom: spacing.sm },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: spacing.lg, marginBottom: spacing.md },
  birthRow: { flexDirection: 'row', gap: spacing.sm },
  birthInput: { flex: 1 },
  radioRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  radio: {
    paddingVertical: spacing.sm, paddingHorizontal: spacing.lg,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border.subtle,
  },
  radioActive: { borderColor: colors.accent.primary, backgroundColor: colors.bg.surface1 },
  hintRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.sm },
  gateSummary: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.bg.surface1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md,
  },
  section: { marginTop: spacing.lg, marginBottom: spacing.sm },
});
