// [AuthPanel] 로그인/회원가입 패널 — MAIDOL LoginPage/RegisterPage 이식.
// 로그인: 이메일·비밀번호 + 소셜(구글/카카오 — v3.194 네이버 제거) + 회원가입 이동.
// 가입: [연령 게이트(생년월일·내외국인·성별)] → [본 폼(이메일·닉네임·기획사명·호칭·비밀번호+확인·추천코드·약관동의)]
// v3.101(A-19) 만 14세 미만 분기 — GET /auth/signup-config 실측으로 결정:
//   플래그 ON  → 본 폼에 보호자(법정대리인) 정보 섹션 추가, 제출 = POST /auth/guardian-consent/request
//               → pending 화면(동의 요청 발송 안내 + 상태 확인). 승인 전 로그인은 서버가 403으로 차단.
//   플래그 OFF → 기존 blocked(준비 중) 안내 유지 — 법적 방어(가입 차단).
// 현행 백엔드는 gender·consents가 필수라 이 패널이 없으면 가입이 항상 400으로 실패한다(v3.43에서 해소).
import { useEffect, useMemo, useState } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/authStore';
import {
  getSignupConfig, requestGuardianConsent, getGuardianConsentStatus, guardianTokenFromUrl,
  requestPasswordReset, confirmPasswordReset,
} from '../../services/authService';
import { showAlert } from '../../utils/appAlert';
import { CONSENT_VERSION, SIGNUP_CONSENT_KEYS, REQUIRED_CONSENT_KEYS } from '../../constants/consentTexts';
import ConsentList, { ConsentState } from './ConsentList';
import SocialLoginButtons from './SocialLoginButtons';
import {
  capturePendingReferralFromUrl,
  loadPendingReferral,
  savePendingReferral,
} from '../../utils/pendingReferral';
import {
  NICKNAME_GUIDE,
  NICKNAME_MAX_LEN,
  checkSignupNickname,
  nicknameLength,
  normalizeNickname,
  pickServerErrorMessage,
} from '../../utils/nicknameRules';
import { AppText, Button } from '../ui';
import { colors } from '../../theme/colors';
import { spacing, radius } from '../../theme/spacing';

// v3.207(⑦): 'forgot'(이메일 입력→코드 발송 요청) | 'forgotSent'(코드+새 비밀번호 입력) 추가
type Mode = 'login' | 'gate' | 'form' | 'blocked' | 'pending' | 'forgot' | 'forgotSent';

// 보호자 휴대폰 — 숫자만 10~11자리(서버는 8~20자 허용이나 국내 휴대폰 기준으로 좁힘)
const GUARDIAN_PHONE_RE = /^[0-9]{10,11}$/;

// 기획사명 자동 접미 — MAIDOL과 동일(끝이 '엔터테인먼트'가 아니면 붙인다)
const normalizeCompany = (v: string) => {
  const t = v.trim();
  if (!t) return '';
  return t.endsWith('엔터테인먼트') ? t : `${t} 엔터테인먼트`;
};

// v3.216 ⑦: 커스텀 초대코드(예: SSUGSIS) 허용 — 서버 referral_service 해석 확장과 동일 규격(4~12자 A-Z/0-9).
// 자동 발급 코드는 여전히 4자 charset(0/O/1/I/L 제외)이나, 입력 검증은 확장 규격을 따른다.
const REFERRAL_RE = /^[A-Z0-9]{4,12}$/;

// v3.212: 웹 한정 — 초대 랜딩의 `?ref={code}` 쿼리를 가입 폼 추천코드로 프리필. 네이티브 동작 무변경.
// v3.230 A7-1 [ReferralPending]: 모듈 로드(앱 부팅) 시 1회 읽고 7일 보관(utils/pendingReferral) —
// 새로고침·재방문·소셜 이동 후에도 코드가 유지된다. 마운트 시 보관 코드로 다시 채운다.
const initialReferralCode = capturePendingReferralFromUrl();

interface AuthPanelProps {
  onSuccess?: () => void;
  /** 헤더 타이틀 연동용 — 로그인/가입/비밀번호 재설정 화면 전환 통지 (v3.207 ⑦: 'forgot' 추가) */
  onModeChange?: (mode: 'login' | 'register' | 'forgot') => void;
  /** v3.237 B: 첫 화면 — 'register' 면 가입 첫 단계(연령 게이트)로 바로 진입(공유 링크 CTA).
   *  미전달·'login' = 기존 동작 그대로(로그인 화면). 마운트 시 1회만 반영. */
  initialMode?: 'login' | 'register';
}

export default function AuthPanel({ onSuccess, onModeChange, initialMode }: AuthPanelProps) {
  const { isLoading, error, login, register, clearError } = useAuthStore();
  const [mode, setModeRaw] = useState<Mode>(() => (initialMode === 'register' ? 'gate' : 'login'));
  // v3.237 B: 가입 직행 진입이면 헤더 타이틀도 '회원가입'으로 맞춘다(부모 onModeChange 통지 1회)
  useEffect(() => {
    if (!initialMode) return;
    console.info(`[AuthPanel] initialMode=${initialMode}`);
    if (initialMode === 'register') onModeChange?.('register');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setMode = (m: Mode) => {
    setModeRaw(m);
    onModeChange?.(
      m === 'login' ? 'login' : m === 'forgot' || m === 'forgotSent' ? 'forgot' : 'register'
    );
  };
  const [localError, setLocalError] = useState('');

  // 공통 필드
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // v3.207(⑦) 비밀번호 재설정 — 코드·새 비밀번호는 로그인 password와 분리 보관
  const [resetCode, setResetCode] = useState('');
  const [resetPw, setResetPw] = useState('');
  const [resetPwConfirm, setResetPwConfirm] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

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
  const [referralCode, setReferralCode] = useState(initialReferralCode);
  // v3.230 A7-1: 로그인 모드 "추천코드가 있어요" 펼침 입력
  const [refInputOpen, setRefInputOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadPendingReferral().then((p) => {
      if (cancelled || !p) return;
      console.info('[ReferralPending] 보관 코드 복원', { len: p.code.length, source: p.source });
      setReferralCode((prev) => (prev ? prev : p.code));
    });
    return () => { cancelled = true; };
  }, []);
  const validReferral = REFERRAL_RE.test(referralCode.trim().toUpperCase()) ? referralCode.trim().toUpperCase() : '';
  // 로그인 모드 입력 — 형식이 맞으면 즉시 보관(소셜 이동 후에도 유지)
  const handleLoginReferralChange = (v: string) => {
    const up = v.toUpperCase().replace(/\s+/g, '');
    setReferralCode(up);
    if (REFERRAL_RE.test(up)) {
      savePendingReferral(up, 'input').then((ok) => console.info('[ReferralPending] 로그인 모드 입력 보관', { ok, len: up.length }));
    }
  };
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

  // ── v3.207(⑦) 비밀번호 재설정 ──
  // 서버 계약: request는 계정 존재 여부와 무관하게 항상 동일 응답(비노출) —
  // 소셜 전용 계정(password_hash NULL)은 메일로 "소셜 가입 계정" 안내가 가고, 앱은 정적 안내만 표시.
  const handleForgotRequest = async () => {
    resetError();
    const em = email.trim();
    if (!em) { setLocalError('가입하신 이메일을 입력해주세요.'); return; }
    if (__DEV__) console.info('[Auth] 비밀번호 재설정 코드 요청', { emailLen: em.length });
    setResetLoading(true);
    try {
      await requestPasswordReset(em);
      setResetCode('');
      setResetPw('');
      setResetPwConfirm('');
      setMode('forgotSent');
    } catch (err: any) {
      console.error('[Auth] 재설정 코드 요청 실패', { status: err?.response?.status, message: err?.message });
      setLocalError(
        err?.response?.data?.error || err?.response?.data?.detail
          || '재설정 코드 요청에 실패했습니다. 잠시 후 다시 시도해주세요.'
      );
    } finally {
      setResetLoading(false);
    }
  };

  const handleForgotConfirm = async () => {
    resetError();
    const code = resetCode.trim();
    if (!/^[0-9]{6}$/.test(code)) { setLocalError('메일로 받은 6자리 코드를 입력해주세요.'); return; }
    if (resetPw !== resetPwConfirm) { setLocalError('비밀번호가 일치하지 않습니다.'); return; }
    if (!(resetPw.length >= 8 && /[a-zA-Z]/.test(resetPw) && /[0-9]/.test(resetPw))) {
      setLocalError('비밀번호는 8자 이상이며 영문과 숫자를 모두 포함해야 합니다.'); return;
    }
    if (__DEV__) console.info('[Auth] 비밀번호 재설정 확정 시도', { codeLen: code.length, pwLen: resetPw.length });
    setResetLoading(true);
    try {
      await confirmPasswordReset(email.trim(), code, resetPw);
      setResetCode('');
      setResetPw('');
      setResetPwConfirm('');
      setPassword('');
      setMode('login');
      showAlert('비밀번호 변경 완료', '새 비밀번호로 다시 로그인해주세요.');
    } catch (err: any) {
      console.error('[Auth] 비밀번호 재설정 확정 실패', { status: err?.response?.status, message: err?.message });
      setLocalError(
        err?.response?.data?.error || err?.response?.data?.detail
          || '코드가 올바르지 않거나 만료되었습니다. 코드를 다시 요청해주세요.'
      );
    } finally {
      setResetLoading(false);
    }
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
    // v3.230c: 가입 닉네임도 변경과 같은 규칙(2~15자·사용 불가 문자·예약어) 사전 검사
    const nickCheck = checkSignupNickname(nickname);
    if (!nickCheck.ok) {
      console.info('[AuthPanel] 가입 닉네임 사전 검사 실패', { path: 'guardian', reason: nickCheck.reason, len: nicknameLength(normalizeNickname(nickname)) });
      setLocalError(nickCheck.message); return;
    }
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
        nickname: nickCheck.value,
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
        // v3.230c: 서버 400 문구 그대로(코드형 error 면 message) — 본인인증 유도 문장은 일반 문구로
        setLocalError(pickServerErrorMessage(err?.response?.data, '보호자 동의 요청에 실패했습니다.'));
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
    // v3.230c: 가입 닉네임 사전 검사(변경 모달과 같은 규칙)
    const nickCheck = checkSignupNickname(nickname);
    if (!nickCheck.ok) {
      console.info('[AuthPanel] 가입 닉네임 사전 검사 실패', { path: 'email', reason: nickCheck.reason, len: nicknameLength(normalizeNickname(nickname)) });
      setLocalError(nickCheck.message); return;
    }
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
      setLocalError('추천코드는 4~12자 영문 대문자/숫자입니다. 다시 확인해주세요.'); return;
    }
    const bd = birthDate();
    const consentsBody: Record<string, any> = { version: CONSENT_VERSION };
    SIGNUP_CONSENT_KEYS.forEach((k) => { consentsBody[k] = !!consents[k]; });
    if (__DEV__) console.info('[AuthPanel] register 시도', { emailLen: email.length, hasRef: !!ref });
    const ok = await register(
      email.trim(), password, nickCheck.value,
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

  // v3.230 A7-1: 추천코드 적용 안내 칩(로그인·가입 공통) — 코드는 원문 표시(본인이 받은 코드)
  const ReferralChip = ({ onEdit }: { onEdit?: () => void }) => (
    <View style={styles.refChip}>
      <Feather name="gift" size={14} color={colors.accent.primary} />
      <View style={{ flex: 1 }}>
        <AppText variant="caption" tone="accent">
          {`추천코드 ${validReferral} 적용돼요 — 구글·카카오로 가입해도 ⭐50을 받아요`}
        </AppText>
        <AppText variant="caption" tone="muted">새로 가입할 때만 적용돼요. 이미 가입한 계정에는 적용되지 않아요.</AppText>
      </View>
      {onEdit ? (
        <TouchableOpacity onPress={onEdit} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel="추천코드 변경">
          <AppText variant="caption" tone="secondary">변경</AppText>
        </TouchableOpacity>
      ) : null}
    </View>
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
        <SocialLoginButtons logPrefix="AuthPanel:login" referralCode={referralCode} />
        {/* v3.230 A7-1: 추천코드 — 보관 코드가 있으면 칩, 없으면 "추천코드가 있어요" 펼침 입력 */}
        {validReferral && !refInputOpen ? (
          <ReferralChip onEdit={() => setRefInputOpen(true)} />
        ) : refInputOpen ? (
          <View style={{ marginTop: spacing.md }}>
            <Label>추천코드</Label>
            <TextInput style={styles.input} placeholder="친구에게 받은 코드 (4~12자)" placeholderTextColor={colors.text.muted}
              maxLength={12} autoCapitalize="characters" value={referralCode}
              onChangeText={handleLoginReferralChange} />
            <AppText variant="caption" tone="muted">
              구글·카카오로 새로 가입할 때만 적용돼요. 이미 가입한 계정에는 적용되지 않아요.
            </AppText>
          </View>
        ) : (
          <TouchableOpacity style={styles.forgotLink} onPress={() => { console.info('[ReferralPending] 로그인 모드 입력 펼침'); setRefInputOpen(true); }}>
            <AppText variant="footnote" tone="secondary">추천코드가 있어요</AppText>
          </TouchableOpacity>
        )}
        {/* v3.207(⑦): 비밀번호 재설정 진입 링크 */}
        <TouchableOpacity style={styles.forgotLink} onPress={() => { resetError(); setMode('forgot'); }}>
          <AppText variant="footnote" tone="secondary">비밀번호를 잊으셨나요?</AppText>
        </TouchableOpacity>
        <View style={styles.footer}>
          <AppText variant="footnote" tone="secondary">아직 계정이 없으신가요? </AppText>
          <TouchableOpacity onPress={() => { resetError(); setMode('gate'); }}>
            <AppText variant="footnote" tone="accent">회원가입</AppText>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── v3.207(⑦) 비밀번호 재설정: 이메일 입력 → 코드 발송 요청 ──
  if (mode === 'forgot') {
    return (
      <View>
        <AppText variant="footnote" tone="secondary" style={{ lineHeight: 20, marginBottom: spacing.md }}>
          가입하신 이메일로 6자리 재설정 코드를 보내드려요.
        </AppText>
        {showError ? <AppText variant="footnote" style={styles.error}>{showError}</AppText> : null}
        <Label>이메일</Label>
        <TextInput style={styles.input} placeholder="가입하신 이메일을 입력하세요" placeholderTextColor={colors.text.muted}
          value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        {/* 아이디 찾기 갈음 안내(확정 스펙) — 아이디 = 이메일 */}
        <AppText variant="caption" tone="muted" style={{ marginBottom: spacing.sm }}>
          아이디는 가입하신 이메일입니다.
        </AppText>
        <AppText variant="caption" tone="muted" style={{ lineHeight: 18, marginBottom: spacing.md }}>
          소셜 로그인(구글·카카오)으로 가입한 계정은 비밀번호가 없어 재설정할 수 없어요. 소셜 로그인으로 이용해주세요.
        </AppText>
        <Button label={resetLoading ? '요청 중...' : '재설정 코드 받기'} fullWidth disabled={resetLoading} onPress={handleForgotRequest} />
        <View style={styles.footer}>
          <TouchableOpacity onPress={() => { resetError(); setMode('login'); }}>
            <AppText variant="footnote" tone="accent">로그인으로 돌아가기</AppText>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── v3.207(⑦) 비밀번호 재설정: 코드 + 새 비밀번호 입력 ──
  if (mode === 'forgotSent') {
    return (
      <View>
        <AppText variant="footnote" tone="secondary" style={{ lineHeight: 20, marginBottom: spacing.md }}>
          입력하신 이메일로 재설정 코드를 보냈어요. 메일이 오지 않으면 스팸함을 확인하거나 코드를 다시 요청해주세요. 코드는 15분 동안 유효합니다.
        </AppText>
        {showError ? <AppText variant="footnote" style={styles.error}>{showError}</AppText> : null}
        <Label>재설정 코드</Label>
        <TextInput style={styles.input} placeholder="메일로 받은 6자리 코드" placeholderTextColor={colors.text.muted}
          maxLength={6} keyboardType="number-pad" value={resetCode}
          onChangeText={(v) => setResetCode(v.replace(/\D/g, '').slice(0, 6))} />
        <Label>새 비밀번호</Label>
        <TextInput style={styles.input} placeholder="비밀번호 (8자 이상, 영문+숫자 포함)" placeholderTextColor={colors.text.muted}
          value={resetPw} onChangeText={setResetPw} secureTextEntry />
        <Label>새 비밀번호 확인</Label>
        <TextInput style={styles.input} placeholder="새 비밀번호를 다시 입력하세요" placeholderTextColor={colors.text.muted}
          value={resetPwConfirm} onChangeText={setResetPwConfirm} secureTextEntry />
        {resetPwConfirm && resetPw !== resetPwConfirm ? (
          <AppText variant="caption" style={styles.error}>비밀번호가 일치하지 않습니다.</AppText>
        ) : null}
        <Button label={resetLoading ? '변경 중...' : '비밀번호 변경'} fullWidth disabled={resetLoading} onPress={handleForgotConfirm} />
        <TouchableOpacity style={styles.forgotLink} onPress={handleForgotRequest} disabled={resetLoading}>
          <AppText variant="footnote" tone="secondary">코드 다시 받기</AppText>
        </TouchableOpacity>
        <View style={styles.footer}>
          <TouchableOpacity onPress={() => { resetError(); setMode('login'); }}>
            <AppText variant="footnote" tone="accent">로그인으로 돌아가기</AppText>
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
      <TextInput style={[styles.input, { marginBottom: 4 }]} placeholder="닉네임을 입력하세요" placeholderTextColor={colors.text.muted}
        maxLength={NICKNAME_MAX_LEN + 10 /* 공백 정리 전 여유 — 최종 길이는 검사에서 판정 */}
        value={nickname} onChangeText={setNickname} />
      {/* v3.230c: 닉네임 변경 모달과 같은 안내·글자수 카운터(정리 후 코드포인트 기준) */}
      <View style={styles.nickMetaRow}>
        <AppText variant="caption" tone="muted" style={{ flex: 1 }}>{NICKNAME_GUIDE}</AppText>
        <AppText variant="caption" style={{ color: nicknameLength(normalizeNickname(nickname)) > NICKNAME_MAX_LEN ? colors.status.error : colors.text.muted }}>
          {`${nicknameLength(normalizeNickname(nickname))}/${NICKNAME_MAX_LEN}`}
        </AppText>
      </View>
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
              {h.ok ? <Feather name="check" size={10} color={colors.accent.primary} /> : '·'} {h.label}
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
          <TextInput style={styles.input} placeholder="친구에게 받은 코드 (4~12자)" placeholderTextColor={colors.text.muted}
            maxLength={12} autoCapitalize="characters" value={referralCode}
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
      {!isMinor ? <SocialLoginButtons logPrefix="AuthPanel:register" referralCode={referralCode} /> : null}
      {/* v3.230 A7-1: 추천코드가 있으면 소셜 가입에도 적용된다는 안내 칩(미성년은 소셜·추천 모두 숨김) */}
      {!isMinor && validReferral ? <ReferralChip /> : null}
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
  // v3.207(⑦): 비밀번호 재설정 진입/재요청 링크
  forgotLink: { alignSelf: 'center', marginTop: spacing.md, paddingVertical: spacing.xs },
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
  // v3.230c: 닉네임 안내·글자수 카운터 행
  nickMetaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.sm },
  // v3.230 A7-1: 추천코드 적용 안내 칩
  refChip: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    backgroundColor: colors.bg.surface1, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border.accent,
    padding: spacing.md, marginTop: spacing.md,
  },
  consentUrlBox: {
    backgroundColor: colors.bg.surface1, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border.subtle, marginBottom: spacing.lg,
  },
});
