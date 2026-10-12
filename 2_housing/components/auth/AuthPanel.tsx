// [AuthPanel] 로그인/회원가입 패널 — MAIDOL LoginPage/RegisterPage 이식.
// 로그인: 이메일·비밀번호 + 소셜(구글/카카오 — v3.194 네이버 제거) + 회원가입 이동.
// 가입: [본 폼(내/외국인·이메일·닉네임·기획사명·호칭·비밀번호+확인·추천코드·약관동의)]
// v3.355 (대표 10-12) 신규 가입은 휴대폰 본인확인 필수 → 본인확인이 주는 생년월일·성별·나이(만 14세 이상)는 가입 폼에서
//   받지 않는다(연령 게이트 단계 삭제). 만 14세 미만은 가입 → 본인확인 → 보호자 동의(가입 마무리 화면, 소셜과 같은 경로).
// (v3.101~v3.351 의 이메일 아동 가입 경로 — 연령 게이트·보호자 정보 입력·pending 화면 — 는 v3.355 에서 삭제:
//  아동도 가입 → 본인확인 → 가입 마무리 화면의 보호자 동의(링크·QR)로 통일. 서버 guardian-consent/request 는 구 앱용으로 유지)
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/authStore';
import {
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

// v3.355: 가입 폼 동의 = 만 14세 이상 확인(age14) 제외(나이는 가입 뒤 휴대폰 본인확인이 정함 — 서버도 생년월일 없는 가입은 age14 미요구)
const REGISTER_CONSENT_KEYS = SIGNUP_CONSENT_KEYS.filter((k) => k !== 'age14');
const REGISTER_REQUIRED_KEYS = REQUIRED_CONSENT_KEYS.filter((k) => k !== 'age14');

// v3.207(⑦): 'forgot'(이메일 입력→코드 발송 요청) | 'forgotSent'(코드+새 비밀번호 입력) 추가
type Mode = 'login' | 'form' | 'forgot' | 'forgotSent';

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
  /** v3.276: 간편가입 우선 배치(로그인 모달) — 로그인 화면에서 소셜 버튼을 맨 위에, 이메일 폼은 접어둔다 */
  socialFirst?: boolean;
}

export default function AuthPanel({ onSuccess, onModeChange, initialMode, socialFirst }: AuthPanelProps) {
  // v3.276: socialFirst 에서 이메일 로그인 폼 펼침 여부(기본 접힘 — 소셜 3초 가입이 주 경로)
  const [emailOpen, setEmailOpen] = useState(!socialFirst);
  const { isLoading, error, login, register, clearError } = useAuthStore();
  const [mode, setModeRaw] = useState<Mode>(() => (initialMode === 'register' ? 'form' : 'login'));
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

  // 내/외국인(본인확인이 주지 않는 값이라 가입 폼에서 받는다)
  const [nationality, setNationality] = useState<'domestic' | 'foreign' | null>(null);

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

  const showError = localError || error;
  const resetError = () => { setLocalError(''); clearError(); };

  const pwHints = useMemo(() => ([
    { ok: password.length >= 8, label: '8자 이상' },
    { ok: /[a-zA-Z]/.test(password), label: '영문 포함' },
    { ok: /[0-9]/.test(password), label: '숫자 포함' },
  ]), [password]);

  const loginPwRef = useRef<any>(null); // v3.326 이메일 Enter → 비밀번호
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
    if (!REGISTER_REQUIRED_KEYS.every((k) => consents[k])) {
      setLocalError('필수 동의 항목에 모두 동의해야 가입할 수 있습니다.'); return;
    }
    const ref = referralCode.trim().toUpperCase();
    if (ref && !REFERRAL_RE.test(ref)) {
      setLocalError('추천코드는 4~12자 영문 대문자/숫자입니다. 다시 확인해주세요.'); return;
    }
    if (!nationality) { setLocalError('내국인/외국인 여부를 선택해주세요.'); return; }
    // v3.355: 생년월일·성별·만 14세 이상 확인은 보내지 않는다(가입 뒤 휴대폰 본인확인이 정함)
    const consentsBody: Record<string, any> = { version: CONSENT_VERSION };
    REGISTER_CONSENT_KEYS.forEach((k) => { consentsBody[k] = !!consents[k]; });
    if (__DEV__) console.info('[AuthPanel] register 시도', { emailLen: email.length, hasRef: !!ref });
    const ok = await register(
      email.trim(), password, nickCheck.value,
      normalizeCompany(companyName), displayTitle.trim(),
      {
        nationality,
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
        {/* v3.276: 간편가입 우선 — 소셜 버튼 최상단, 이메일 폼은 "이메일로 로그인" 탭 시 펼침 */}
        {socialFirst ? <SocialLoginButtons logPrefix="AuthPanel:login" referralCode={referralCode} dividerPosition="bottom" /> : null}
        {socialFirst && !emailOpen ? (
          <TouchableOpacity style={styles.forgotLink} onPress={() => { console.info('[AuthPanel] 이메일 로그인 폼 펼침'); setEmailOpen(true); }}>
            <AppText variant="footnote" tone="secondary">이메일로 로그인</AppText>
          </TouchableOpacity>
        ) : null}
        {emailOpen ? (
          <>
        <Label>이메일</Label>
        <TextInput style={styles.input} placeholder="이메일을 입력하세요" placeholderTextColor={colors.text.muted}
          value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address"
          returnKeyType="next" blurOnSubmit={false} onSubmitEditing={() => loginPwRef.current?.focus?.()} />
        <Label>비밀번호</Label>
        {/* v3.326 (오리쟁이 10-06 신고): 비밀번호 입력 후 Enter = 로그인(종전: 소셜 버튼이 눌림) */}
        <TextInput ref={loginPwRef} style={styles.input} placeholder="비밀번호를 입력하세요" placeholderTextColor={colors.text.muted}
          value={password} onChangeText={setPassword} secureTextEntry
          returnKeyType="go" onSubmitEditing={() => { if (!isLoading) void handleLogin(); }} />
        <Button label={isLoading ? '로그인 중...' : '로그인'} fullWidth disabled={isLoading} onPress={handleLogin} />
          </>
        ) : null}
        {!socialFirst ? <SocialLoginButtons logPrefix="AuthPanel:login" referralCode={referralCode} /> : null}
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
          <TouchableOpacity onPress={() => { resetError(); setMode('form'); }}>
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

  // ── 가입: 본 폼 ──
  return (
    <View>
      {/* v3.355: 생년월일·성별은 가입 뒤 휴대폰 본인확인으로 확인(만 14세 미만은 그 뒤 보호자 동의) */}
      <AppText variant="footnote" tone="secondary" style={{ lineHeight: 20, marginBottom: spacing.md }}>
        가입 후 휴대폰 본인확인으로 생년월일·성별을 확인해요. 만 14세 미만은 본인확인 뒤 보호자 동의를 받으면 이용할 수 있어요.
      </AppText>

      {showError ? <AppText variant="footnote" style={styles.error}>{showError}</AppText> : null}

      <Label>내/외국인</Label>
      <View style={styles.radioRow}>
        <Radio selected={nationality === 'domestic'} label="내국인" onPress={() => setNationality('domestic')} />
        <Radio selected={nationality === 'foreign'} label="외국인" onPress={() => setNationality('foreign')} />
      </View>

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

      <Label>추천코드 (선택)</Label>
      <TextInput style={styles.input} placeholder="친구에게 받은 코드 (4~12자)" placeholderTextColor={colors.text.muted}
        maxLength={12} autoCapitalize="characters" value={referralCode}
        onChangeText={(v) => setReferralCode(v.toUpperCase())} />

      <AppText variant="bodyStrong" style={styles.section}>약관 동의</AppText>
      <ConsentList value={consents} onChange={setConsents} keys={REGISTER_CONSENT_KEYS} />

      <View style={{ marginTop: spacing.lg }}>
        <Button
          label={isLoading ? '가입 중...' : '회원가입'}
          fullWidth
          disabled={isLoading || !REGISTER_REQUIRED_KEYS.every((k) => consents[k])}
          onPress={handleRegister}
        />
      </View>

      {/* 소셜 가입도 가입 뒤 휴대폰 본인확인(만 14세 미만은 보호자 동의) — 같은 경로 */}
      <SocialLoginButtons logPrefix="AuthPanel:register" referralCode={referralCode} />
      {/* v3.230 A7-1: 추천코드가 있으면 소셜 가입에도 적용된다는 안내 칩 */}
      {validReferral ? <ReferralChip /> : null}
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
