// [AuthPanel] 로그인/회원가입 패널 — MAIDOL LoginPage/RegisterPage 이식.
// 로그인: 이메일·비밀번호 + 소셜(구글/카카오/네이버) + 회원가입 이동.
// 가입: [연령 게이트(생년월일·내외국인·성별)] → [본 폼(이메일·닉네임·기획사명·호칭·비밀번호+확인·추천코드·약관동의)]
// v3.101(A-19) 만 14세 미만 분기 — GET /auth/signup-config 실측으로 결정:
//   플래그 ON  → 본 폼에 보호자(법정대리인) 정보 섹션 추가, 제출 = POST /auth/guardian-consent/request
//               → pending 화면(동의 요청 발송 안내 + 상태 확인). 승인 전 로그인은 서버가 403으로 차단.
//   플래그 OFF → 기존 blocked(준비 중) 안내 유지 — 법적 방어(가입 차단).
// 현행 백엔드는 gender·consents가 필수라 이 패널이 없으면 가입이 항상 400으로 실패한다(v3.43에서 해소).
import { useMemo, useState } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { useAuthStore } from '../../stores/authStore';
import {
  getSignupConfig, requestGuardianConsent, getGuardianConsentStatus, guardianTokenFromUrl,
} from '../../services/authService';
import { showAlert } from '../../utils/appAlert';
import { CONSENT_VERSION, SIGNUP_CONSENT_KEYS, REQUIRED_CONSENT_KEYS } from '../../constants/consentTexts';
import ConsentList, { ConsentState } from './ConsentList';
import SocialLoginButtons from './SocialLoginButtons';
import { AppText, Button } from '../ui';
import { colors } from '../../theme/colors';
import { spacing, radius } from '../../theme/spacing';

type Mode = 'login' | 'gate' | 'form' | 'blocked' | 'pending';

// 보호자 휴대폰 — 숫자만 10~11자리(서버는 8~20자 허용이나 국내 휴대폰 기준으로 좁힘)
const GUARDIAN_PHONE_RE = /^[0-9]{10,11}$/;

// 기획사명 자동 접미 — MAIDOL과 동일(끝이 '엔터테인먼트'가 아니면 붙인다)
const normalizeCompany = (v: string) => {
  const t = v.trim();
  if (!t) return '';
  return t.endsWith('엔터테인먼트') ? t : `${t} 엔터테인먼트`;
};

const REFERRAL_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/;

interface AuthPanelProps {
  onSuccess?: () => void;
  /** 헤더 타이틀 연동용 — 로그인/가입 화면 전환 통지 */
  onModeChange?: (mode: 'login' | 'register') => void;
}

export default function AuthPanel({ onSuccess, onModeChange }: AuthPanelProps) {
  const { isLoading, error, login, register, clearError } = useAuthStore();
  const [mode, setModeRaw] = useState<Mode>('login');
  const setMode = (m: Mode) => {
    setModeRaw(m);
    onModeChange?.(m === 'login' ? 'login' : 'register');
  };
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

  // v3.101 보호자 동의 플로우(만 14세 미만 + 서버 플래그 ON)
  const [isMinor, setIsMinor] = useState(false);
  const [gateBusy, setGateBusy] = useState(false);
  const [guardianName, setGuardianName] = useState('');
  const [guardianPhone, setGuardianPhone] = useState('');
  const [guardianLoading, setGuardianLoading] = useState(false);
  const [statusChecking, setStatusChecking] = useState(false);
  // 요청 접수 응답 — consent_url은 알림 어댑터가 mock(테스트 모드)일 때만 존재
  const [pendingInfo, setPendingInfo] = useState<{ message: string; consentUrl: string | null } | null>(null);

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

  const handleGateNext = async () => {
    resetError();
    const bd = birthDate();
    if (!bd) { setLocalError('생년월일을 모두 선택해주세요.'); return; }
    if (!nationality) { setLocalError('내국인/외국인 여부를 선택해주세요.'); return; }
    if (!gender) { setLocalError('성별을 선택해주세요.'); return; }
    if (koreanAge(bd) < 14) {
      // v3.101 — 서버 플래그(GET /auth/signup-config)로 보호자 동의 플로우 여부 결정
      setGateBusy(true);
      let enabled = false;
      try {
        enabled = (await getSignupConfig()).guardian_consent_enabled;
      } catch {
        // 설정 조회 실패 시 안전 기본값: 차단 안내(강행 금지)
        enabled = false;
      }
      setGateBusy(false);
      if (__DEV__) console.info('[AuthPanel] 만14세 미만 분기', { guardianConsentEnabled: enabled });
      setIsMinor(true);
      setMode(enabled ? 'form' : 'blocked');
      return;
    }
    setIsMinor(false);
    setMode('form');
  };

  // v3.101 — 만 14세 미만: register 대신 보호자 동의 요청(서버가 pending 계정 생성)
  const handleGuardianRequest = async () => {
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
    const gName = guardianName.trim();
    const gPhone = guardianPhone.replace(/[^0-9]/g, '');
    if (!gName) { setLocalError('보호자 이름을 입력해주세요.'); return; }
    if (!GUARDIAN_PHONE_RE.test(gPhone)) { setLocalError('보호자 휴대폰 번호를 정확히 입력해주세요.'); return; }
    const bd = birthDate();
    if (!bd) { setLocalError('생년월일을 다시 확인해주세요.'); setMode('gate'); return; }
    const consentsBody: Record<string, any> = { version: CONSENT_VERSION };
    SIGNUP_CONSENT_KEYS.forEach((k) => { consentsBody[k] = !!consents[k]; });
    if (__DEV__) console.info('[AuthPanel] guardian request 시도', { emailLen: email.length, nameLen: gName.length });
    setGuardianLoading(true);
    try {
      const res = await requestGuardianConsent({
        email: email.trim(),
        password,
        nickname: nickname.trim(),
        birth_date: bd,
        nationality,
        gender,
        company_name: normalizeCompany(companyName),
        display_title: displayTitle.trim(),
        guardian_name: gName,
        guardian_phone: gPhone,
        consents: consentsBody,
      });
      setPendingInfo({
        message: res?.message || '보호자 동의 요청이 접수되었습니다. 보호자 동의 완료 후 계정이 활성화됩니다.',
        consentUrl: res?.consent_url || null,
      });
      setMode('pending');
    } catch (err: any) {
      if (err?.response?.status === 503) {
        // 서버 플래그 OFF — 준비 중 안내로 전환
        setMode('blocked');
      } else {
        setLocalError(
          err?.response?.data?.error || err?.response?.data?.detail || '보호자 동의 요청에 실패했습니다.'
        );
      }
    } finally {
      setGuardianLoading(false);
    }
  };

  // v3.101 — pending 화면 [동의 상태 확인] (mock 모드: consent_url의 토큰으로 조회)
  const handleCheckGuardianStatus = async () => {
    const token = guardianTokenFromUrl(pendingInfo?.consentUrl);
    if (!token) return;
    setStatusChecking(true);
    try {
      const { status } = await getGuardianConsentStatus(token);
      if (status === 'agreed') {
        showAlert('보호자 동의 완료', '계정이 활성화되었습니다. 이제 로그인할 수 있습니다.', [
          { text: '로그인하기', onPress: () => { resetError(); setMode('login'); } },
        ]);
      } else if (status === 'rejected') {
        showAlert('동의가 거부되었습니다', '보호자가 동의를 거부하여 계정이 활성화되지 않았습니다.');
      } else if (status === 'expired') {
        showAlert('동의 링크 만료', '동의 링크가 만료되었거나 유효하지 않습니다. 가입을 처음부터 다시 진행해주세요.');
      } else {
        showAlert('아직 대기 중이에요', '보호자가 아직 동의를 완료하지 않았습니다. 동의 완료 후 로그인할 수 있습니다.');
      }
    } catch {
      showAlert('상태 확인 실패', '동의 상태를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setStatusChecking(false);
    }
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

  // ── 가입: 보호자 동의 대기(만14세 미만 + 플래그 ON, 요청 접수 후) ──
  if (mode === 'pending') {
    const statusToken = guardianTokenFromUrl(pendingInfo?.consentUrl);
    return (
      <View>
        <AppText variant="bodyStrong" style={{ marginBottom: spacing.sm }}>보호자에게 동의 요청을 보냈어요</AppText>
        <AppText variant="footnote" tone="secondary" style={{ lineHeight: 20, marginBottom: spacing.md }}>
          {pendingInfo?.message || '보호자 동의 요청이 접수되었습니다. 보호자 동의 완료 후 계정이 활성화됩니다.'}
        </AppText>
        <AppText variant="footnote" tone="secondary" style={{ lineHeight: 20, marginBottom: spacing.md }}>
          보호자가 동의 링크에서 동의를 완료하면 로그인할 수 있습니다. 동의 링크는 요청 시점부터 72시간 동안 유효합니다.
        </AppText>
        {pendingInfo?.consentUrl ? (
          <View style={styles.consentUrlBox}>
            <AppText variant="caption" tone="secondary" style={{ marginBottom: spacing.xs }}>
              테스트 모드 — 아래 링크에서 보호자 동의를 진행할 수 있습니다.
            </AppText>
            <AppText variant="caption" tone="accent" selectable>{pendingInfo.consentUrl}</AppText>
          </View>
        ) : null}
        {statusToken ? (
          <View style={{ marginBottom: spacing.sm }}>
            <Button
              label={statusChecking ? '확인 중...' : '동의 상태 확인'}
              fullWidth
              disabled={statusChecking}
              onPress={handleCheckGuardianStatus}
            />
          </View>
        ) : null}
        <Button label="로그인 화면으로" variant="tonal" fullWidth onPress={() => { resetError(); setMode('login'); }} />
      </View>
    );
  }

  // ── 가입: 만14세 미만 차단(서버 플래그 OFF) ──
  if (mode === 'blocked') {
    return (
      <View>
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

        <Button label={gateBusy ? '확인 중...' : '다음'} fullWidth disabled={gateBusy} onPress={handleGateNext} />
        <View style={styles.footer}>
          <AppText variant="footnote" tone="secondary">이미 계정이 있으신가요? </AppText>
          <TouchableOpacity onPress={() => { resetError(); setMode('login'); }}>
            <AppText variant="footnote" tone="accent">로그인</AppText>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── 가입: 본 폼 (만14세 미만이면 보호자 정보 섹션 추가, 제출 = 보호자 동의 요청) ──
  return (
    <View>

      {isMinor ? (
        <AppText variant="footnote" tone="secondary" style={{ lineHeight: 20, marginBottom: spacing.md }}>
          만 14세 미만은 보호자(법정대리인) 동의 후 가입이 완료됩니다. 입력한 보호자 연락처로 동의 요청을 보내드려요.
        </AppText>
      ) : null}

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

      {/* 추천코드 — 보호자 동의 경로(GuardianConsentRequest)에는 referral_code가 없어 미성년 가입에서는 숨김 */}
      {!isMinor ? (
        <>
          <Label>추천코드 (선택)</Label>
          <TextInput style={styles.input} placeholder="친구에게 받은 4자리 코드" placeholderTextColor={colors.text.muted}
            maxLength={4} autoCapitalize="characters" value={referralCode}
            onChangeText={(v) => setReferralCode(v.toUpperCase())} />
        </>
      ) : null}

      {isMinor ? (
        <>
          <AppText variant="bodyStrong" style={styles.section}>보호자(법정대리인) 정보</AppText>
          <Label>보호자 이름</Label>
          <TextInput style={styles.input} placeholder="보호자 이름을 입력하세요" placeholderTextColor={colors.text.muted}
            maxLength={60} value={guardianName} onChangeText={setGuardianName} />
          <Label>보호자 휴대폰 번호</Label>
          <TextInput style={styles.input} placeholder="숫자만 입력 (예: 01012345678)" placeholderTextColor={colors.text.muted}
            maxLength={11} keyboardType="number-pad" value={guardianPhone}
            onChangeText={(v) => setGuardianPhone(v.replace(/\D/g, '').slice(0, 11))} />
        </>
      ) : null}

      <AppText variant="bodyStrong" style={styles.section}>약관 동의</AppText>
      <ConsentList value={consents} onChange={setConsents} />

      <View style={{ marginTop: spacing.lg }}>
        <Button
          label={
            isMinor
              ? (guardianLoading ? '요청 중...' : '보호자 동의 요청')
              : (isLoading ? '가입 중...' : '회원가입')
          }
          fullWidth
          disabled={(isMinor ? guardianLoading : isLoading) || !REQUIRED_CONSENT_KEYS.every((k) => consents[k])}
          onPress={isMinor ? handleGuardianRequest : handleRegister}
        />
      </View>

      {/* 만14세 미만은 소셜 가입으로 보호자 동의 절차를 우회할 수 없도록 소셜 버튼 숨김 */}
      {!isMinor ? <SocialLoginButtons logPrefix="AuthPanel:register" /> : null}
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
  // minWidth:0 필수 — 웹 input은 고유 최소폭(size 속성)이 있어 flex 축소가 막혀 '일' 칸이 화면 밖으로 밀린다
  birthInput: { flex: 1, minWidth: 0 },
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
  consentUrlBox: {
    backgroundColor: colors.bg.surface1, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border.subtle, marginBottom: spacing.lg,
  },
});
