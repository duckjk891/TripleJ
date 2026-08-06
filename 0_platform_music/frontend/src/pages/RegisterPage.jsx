import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import SocialLoginButtons from '../components/SocialLoginButtons';
import ProfileExtraForm from '../components/ProfileExtraForm';
import ConsentList from '../components/ConsentList';
import { areRequiredConsentsChecked } from '../utils/consent';
import {
  CONSENT_VERSION,
  OPTIONAL_INPUT_NOTICE,
  SIGNUP_CONSENT_KEYS,
} from '../constants/consentTexts';
import * as api from '../api';
import './RegisterPage.css';

// v123 — 가입 STEP 0 게이트: 생년월일(필수) + 내/외국인(필수) 선택 후 만나이 판정.
// v125 — 게이트에 성별(필수) 추가 + 가입 폼 약관 동의 섹션(필수4/선택1) + 동의 이력 페이로드.
//   만14세 이상 → 기존 가입 폼(게이트 값이 페이로드에 포함, 추가 정보 섹션에서는
//   생년월일/내외국인 입력을 숨겨 중복 입력 방지).
//   만14세 미만 → signup-config 조회: OFF = "준비 중" 안내(가입 중단),
//   ON = 보호자 정보 입력 → 동의 요청 → 대기 안내(+테스트 모드 consent_url 링크).
// 주의: 개인정보 — 생년월일/보호자 이름/전화번호 값 자체는 절대 콘솔에 출력하지 않는다.

const CURRENT_YEAR = new Date().getFullYear();
const GATE_YEARS = [];
for (let y = CURRENT_YEAR; y >= 1900; y -= 1) GATE_YEARS.push(y);
const GATE_MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

// 선택된 연·월 기준 말일 (ProfileExtraForm 과 동일 규칙)
const daysInMonth = (year, month) => {
  if (month === '') return 31;
  const y = year === '' ? 2000 : parseInt(year, 10);
  return new Date(y, parseInt(month, 10), 0).getDate();
};

const pad2 = (v) => String(v).padStart(2, '0');

// 만나이 계산 — 생일 미도래 시 -1
const calcKoreanAge = (y, m, d) => {
  const today = new Date();
  let age = today.getFullYear() - y;
  const mm = today.getMonth() + 1;
  const dd = today.getDate();
  if (mm < m || (mm === m && dd < d)) age -= 1;
  return age;
};

const NATIONALITY_LABELS = { domestic: '내국인', foreign: '외국인' };

// v125 — 게이트 성별(필수, 백엔드 계약값: male | female | other)
const GENDER_LABELS = { male: '남성', female: '여성', other: '기타' };

const GUARDIAN_OFF_MESSAGE = '만 14세 미만 가입은 보호자 동의 절차 준비 중입니다.';

// v154 — 추천코드 형식 (백엔드 charset: 대문자+숫자 31종, 혼동문자 0/1/O/I/L 제외)
const REFERRAL_CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/;

// v160 — 엔터테인먼트명 자동접미 (백엔드 auth.py _normalize_company_name 의 UX 미러).
// trim 후 값이 있고 "엔터테인먼트"로 끝나지 않으면 " 엔터테인먼트" 추가(이미 끝나면 그대로 — 중복 방지).
const COMPANY_SUFFIX = '엔터테인먼트';
const normalizeCompanyName = (value) => {
  const trimmed = (value || '').trim();
  if (!trimmed || trimmed.endsWith(COMPANY_SUFFIX)) return trimmed;
  return `${trimmed} ${COMPANY_SUFFIX}`;
};

// v160 — 비밀번호 실시간 조건 3종 (검증 규칙 :185 와 동일 기준 — 규칙 자체는 불변)
const PASSWORD_HINT_RULES = [
  { key: 'length', label: '8자 이상', test: (pw) => pw.length >= 8 },
  { key: 'letter', label: '영문 포함', test: (pw) => /[a-zA-Z]/.test(pw) },
  { key: 'digit', label: '숫자 포함', test: (pw) => /[0-9]/.test(pw) },
];

const PASSWORD_PLACEHOLDER = '비밀번호 (8자 이상, 영문+숫자 포함)';

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // STEP 제어: gate(0단계) → form(14세 이상) | blocked(미만+OFF) | guardian(미만+ON) → pending(동의 대기)
  const [step, setStep] = useState('gate');

  // STEP 0 게이트 — 생년월일(필수) + 내/외국인(필수)
  const [gateYear, setGateYear] = useState('');
  const [gateMonth, setGateMonth] = useState('');
  const [gateDay, setGateDay] = useState('');
  const [gateNationality, setGateNationality] = useState('');
  const [gateGender, setGateGender] = useState(''); // v125 — 성별 필수
  const [gateError, setGateError] = useState('');
  const [gateBusy, setGateBusy] = useState(false);

  // 기존 가입 폼
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [nickname, setNickname] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [displayTitle, setDisplayTitle] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // 추가 정보(선택) — 게이트에서 받는 birth_date/nationality/gender 는 숨김(hiddenFields), 지역만 사용
  const [extraValues, setExtraValues] = useState({
    birth_date: null, gender: null, region: null, nationality: null,
  });
  // v125 — 약관 동의 체크 상태 { [key]: bool }
  const [consentValues, setConsentValues] = useState({});
  // v154 — 추천코드(선택) — 초대 링크 ?ref= 쿼리 프리필 + 대문자 자동 변환
  const [referralCode, setReferralCode] = useState(
    () => (searchParams.get('ref') || '').trim().toUpperCase().slice(0, 4)
  );
  const [referralError, setReferralError] = useState('');

  // v160 — 제출 실패 안내 가시화: 에러 div 가 폼 상단이라 하단 버튼에서 제출 시 화면 밖 —
  // error 변경 시 에러 div 로 부드럽게 스크롤 (에러 div 위치 이동은 회귀 위험으로 기각 — PLAN 설계 3ⓒ)
  const errorRef = useRef(null);
  useEffect(() => {
    if (error && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [error]);

  // 보호자 동의 플로우 (만14세 미만 + 플래그 ON)
  const [guardianName, setGuardianName] = useState('');
  const [guardianPhone, setGuardianPhone] = useState('');
  const [guardianError, setGuardianError] = useState('');
  const [guardianLoading, setGuardianLoading] = useState(false);
  const [consentInfo, setConsentInfo] = useState(null); // { consent_url, status }

  const gateBirthDate =
    gateYear !== '' && gateMonth !== '' && gateDay !== ''
      ? `${gateYear}-${pad2(gateMonth)}-${pad2(gateDay)}`
      : null;

  // 연/월 변경 시 현재 선택된 일이 새 말일을 넘으면 일 선택 해제
  const changeGateBirth = (nextYear, nextMonth, nextDay) => {
    let day = nextDay;
    if (day !== '' && parseInt(day, 10) > daysInMonth(nextYear, nextMonth)) {
      day = '';
    }
    setGateYear(nextYear);
    setGateMonth(nextMonth);
    setGateDay(day);
  };

  // STEP 0 [다음] — 만나이 판정 후 분기
  const handleGateNext = async () => {
    setGateError('');
    if (!gateBirthDate) {
      setGateError('생년월일을 모두 선택해주세요.');
      return;
    }
    if (gateNationality !== 'domestic' && gateNationality !== 'foreign') {
      setGateError('내국인/외국인 여부를 선택해주세요.');
      return;
    }
    // v125 — 성별 필수 (만나이 게이트 판정 로직 자체는 불변)
    if (!GENDER_LABELS[gateGender]) {
      setGateError('성별을 선택해주세요.');
      return;
    }
    const age = calcKoreanAge(
      parseInt(gateYear, 10), parseInt(gateMonth, 10), parseInt(gateDay, 10)
    );
    const isMinor = age < 14;
    if (import.meta.env.DEV) {
      // 개인정보 — 생년월일 값 미출력, 판정 결과만
      console.info('[RegisterPage] gate next', { isMinor });
    }
    if (!isMinor) {
      setStep('form');
      return;
    }
    // 만14세 미만 → 보호자 동의 기능 플래그 조회
    setGateBusy(true);
    try {
      const { data } = await api.getSignupConfig();
      const enabled = !!data?.guardian_consent_enabled;
      if (import.meta.env.DEV) {
        console.info('[RegisterPage] signup-config', { guardianConsentEnabled: enabled });
      }
      setStep(enabled ? 'guardian' : 'blocked');
    } catch (err) {
      console.error('[RegisterPage] getSignupConfig failed', {
        status: err?.response?.status,
        message: err?.message,
      });
      // 조회 실패 시 안전측(준비 중 안내)으로 폴백
      setStep('blocked');
    } finally {
      setGateBusy(false);
    }
  };

  // 게이트로 되돌아가기 — 입력값은 유지
  const backToGate = () => {
    setError('');
    setGuardianError('');
    setStep('gate');
  };

  // 공통: 계정 기본 필드 검증 (14세 이상 폼 / 보호자 플로우 공용)
  const validateAccountFields = () => {
    const trimmedEmail = email.trim();
    const trimmedNickname = nickname.trim();
    if (!trimmedEmail || !password || !trimmedNickname) {
      return { error: '모든 필드를 입력해주세요.' };
    }
    if (password !== passwordConfirm) {
      return { error: '비밀번호가 일치하지 않습니다.' };
    }
    if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      return { error: '비밀번호는 8자 이상이며 영문과 숫자를 모두 포함해야 합니다.' };
    }
    return { email: trimmedEmail, nickname: trimmedNickname };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const base = validateAccountFields();
    // v160 — 제출 시 재정규화(이중 방어 — onBlur 미경유 제출 대비, 백엔드도 동일 정규화)
    const trimmedCompany = normalizeCompanyName(companyName);
    const trimmedTitle = displayTitle.trim();
    if (base.error || !trimmedCompany || !trimmedTitle) {
      if (import.meta.env.DEV) {
        console.info('[RegisterPage] submit blocked', {
          reason: base.error ? 'account_fields' : 'required_fields',
        });
      }
      setError(base.error || '모든 필드를 입력해주세요.');
      return;
    }

    // v125 — 필수 동의 4종 모두 체크돼야 가입 진행(버튼 비활성과 이중 방어)
    if (!areRequiredConsentsChecked(consentValues, SIGNUP_CONSENT_KEYS)) {
      if (import.meta.env.DEV) {
        console.info('[RegisterPage] submit blocked', { reason: 'consents' });
      }
      setError('필수 동의 항목에 모두 동의해야 가입할 수 있습니다.');
      return;
    }

    // v154 — 추천코드(선택) 클라 검증: 비어있거나 4자리 charset 일치
    const trimmedReferral = referralCode.trim().toUpperCase();
    if (trimmedReferral && !REFERRAL_CODE_RE.test(trimmedReferral)) {
      if (import.meta.env.DEV) {
        console.info('[RegisterPage] submit blocked', { reason: 'referral_code' });
      }
      setReferralError('추천코드는 4자리 영문 대문자/숫자입니다. 다시 확인해주세요.');
      return;
    }

    // 값이 있는 선택 필드만 register 페이로드에 포함 + 게이트 값(생년월일/내외국인/성별)은 항상 포함
    const extra = {};
    Object.entries(extraValues).forEach(([k, v]) => {
      if (v !== null) extra[k] = v;
    });
    extra.birth_date = gateBirthDate;
    extra.nationality = gateNationality;
    extra.gender = gateGender; // v125 — 게이트 성별(필수)
    // v125 — 동의 페이로드 (marketing 은 미체크=false 도 기록 — 거부 이력)
    extra.consents = {
      terms: !!consentValues.terms,
      privacy: !!consentValues.privacy,
      overseas: !!consentValues.overseas,
      age14: !!consentValues.age14,
      marketing: !!consentValues.marketing,
      version: CONSENT_VERSION,
    };
    // v154 — 추천코드는 값이 있을 때만 페이로드에 포함(무효 코드는 서버 400)
    if (trimmedReferral) extra.referral_code = trimmedReferral;
    const extraCount = Object.keys(extra).length;

    setLoading(true);
    if (import.meta.env.DEV) {
      console.info('[RegisterPage] register start', {
        extraFields: extraCount,
        hasReferral: !!trimmedReferral,
      });
    }
    try {
      await register(
        base.email, password, base.nickname, trimmedCompany, trimmedTitle, extra
      );
      if (import.meta.env.DEV) {
        console.info('[RegisterPage] register success', { extraFields: extraCount });
      }
      navigate('/');
    } catch (err) {
      console.error('[RegisterPage] register failed', {
        status: err?.response?.status,
        message: err?.message,
      });
      // v123 — 서버측 만14세 미만 판정(guardian_consent_required) 시 준비 중 안내로 전환
      if (err.response?.data?.error === 'guardian_consent_required') {
        setStep('blocked');
        return;
      }
      setError(err.response?.data?.error || '회원가입에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 보호자 동의 요청 (만14세 미만 + 플래그 ON)
  const handleGuardianRequest = async (e) => {
    e.preventDefault();
    setGuardianError('');

    const base = validateAccountFields();
    if (base.error) {
      setGuardianError(base.error);
      return;
    }
    const trimmedGuardianName = guardianName.trim();
    const phoneDigits = guardianPhone.replace(/[^0-9]/g, '');
    if (!trimmedGuardianName) {
      setGuardianError('보호자 이름을 입력해주세요.');
      return;
    }
    if (phoneDigits.length < 10 || phoneDigits.length > 11) {
      setGuardianError('보호자 휴대폰 번호를 정확히 입력해주세요.');
      return;
    }

    setGuardianLoading(true);
    if (import.meta.env.DEV) {
      // 개인정보 — 보호자 이름/전화번호 값 미출력(길이만)
      console.info('[RegisterPage] guardian consent request start', {
        nameLen: trimmedGuardianName.length,
        phoneLen: phoneDigits.length,
      });
    }
    try {
      const { data } = await api.requestGuardianConsent({
        email: base.email,
        password,
        nickname: base.nickname,
        birth_date: gateBirthDate,
        nationality: gateNationality,
        gender: gateGender, // v125 — 아동 가입 경로도 성별 필수(백엔드 동일 적용)
        guardian_name: trimmedGuardianName,
        guardian_phone: phoneDigits,
      });
      if (import.meta.env.DEV) {
        console.info('[RegisterPage] guardian consent request success', {
          status: data?.status,
          hasConsentUrl: !!data?.consent_url,
        });
      }
      setConsentInfo(data || {});
      setStep('pending');
    } catch (err) {
      console.error('[RegisterPage] guardian consent request failed', {
        status: err?.response?.status,
        message: err?.message,
      });
      if (err?.response?.status === 503) {
        setStep('blocked');
        return;
      }
      setGuardianError(
        err.response?.data?.error || err.response?.data?.message || '보호자 동의 요청에 실패했습니다.'
      );
    } finally {
      setGuardianLoading(false);
    }
  };

  // ── STEP 0: 생년월일 + 내/외국인 게이트 ──────────────────────────
  if (step === 'gate') {
    return (
      <div className="page-content">
        <div className="register-page">
          <div className="register-card">
            <div className="register-card__logo">
              <img src="/aimu-logo.svg" alt="AIMU" />
            </div>
            <h1 className="register-card__title">회원가입</h1>
            <p className="register-card__gate-desc">
              가입 전에 생년월일과 내/외국인 여부를 확인합니다.
            </p>

            {gateError && <div className="register-card__error">{gateError}</div>}

            <div className="register-card__field">
              <label className="register-card__label" htmlFor="register-gate-birth-year">
                생년월일 <span className="register-card__required">*</span>
              </label>
              <div className="register-card__birth-row">
                <select
                  id="register-gate-birth-year"
                  className="register-card__select"
                  aria-label="출생 연도"
                  value={gateYear}
                  onChange={(e) => changeGateBirth(e.target.value, gateMonth, gateDay)}
                >
                  <option value="">연도</option>
                  {GATE_YEARS.map((y) => (
                    <option key={y} value={y}>{y}년</option>
                  ))}
                </select>
                <select
                  className="register-card__select"
                  aria-label="출생 월"
                  value={gateMonth}
                  onChange={(e) => changeGateBirth(gateYear, e.target.value, gateDay)}
                >
                  <option value="">월</option>
                  {GATE_MONTHS.map((m) => (
                    <option key={m} value={m}>{m}월</option>
                  ))}
                </select>
                <select
                  className="register-card__select"
                  aria-label="출생 일"
                  value={gateDay}
                  onChange={(e) => changeGateBirth(gateYear, gateMonth, e.target.value)}
                >
                  <option value="">일</option>
                  {Array.from({ length: daysInMonth(gateYear, gateMonth) }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>{d}일</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="register-card__field">
              <span className="register-card__label">
                내/외국인 <span className="register-card__required">*</span>
              </span>
              <div className="register-card__radios" role="radiogroup" aria-label="내/외국인">
                {['domestic', 'foreign'].map((v) => (
                  <label key={v} className="register-card__radio">
                    <input
                      type="radio"
                      name="register-gate-nationality"
                      value={v}
                      checked={gateNationality === v}
                      onChange={() => setGateNationality(v)}
                    />
                    <span>{NATIONALITY_LABELS[v]}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* v125 — 성별(필수) */}
            <div className="register-card__field">
              <span className="register-card__label">
                성별 <span className="register-card__required">*</span>
              </span>
              <div className="register-card__radios" role="radiogroup" aria-label="성별">
                {Object.keys(GENDER_LABELS).map((v) => (
                  <label key={v} className="register-card__radio">
                    <input
                      type="radio"
                      name="register-gate-gender"
                      value={v}
                      checked={gateGender === v}
                      onChange={() => setGateGender(v)}
                    />
                    <span>{GENDER_LABELS[v]}</span>
                  </label>
                ))}
              </div>
            </div>

            <button
              className="register-card__submit"
              type="button"
              onClick={handleGateNext}
              disabled={gateBusy}
            >
              {gateBusy ? '확인 중...' : '다음'}
            </button>

            <div className="register-card__footer">
              이미 계정이 있으신가요?
              <Link to="/login">로그인</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── 만14세 미만 + 플래그 OFF: 준비 중 안내(가입 중단) ─────────────
  if (step === 'blocked') {
    return (
      <div className="page-content">
        <div className="register-page">
          <div className="register-card">
            <div className="register-card__logo">
              <img src="/aimu-logo.svg" alt="AIMU" />
            </div>
            <h1 className="register-card__title">회원가입</h1>
            <div className="register-card__notice-box">
              <p className="register-card__notice-title">{GUARDIAN_OFF_MESSAGE}</p>
              <p className="register-card__notice-sub">
                만 14세 미만은 법정대리인(보호자)의 동의가 있어야 가입할 수 있습니다.
                서비스 준비가 완료되면 보호자 동의 후 가입이 가능합니다.
              </p>
            </div>
            <button className="register-card__submit" type="button" onClick={backToGate}>
              이전으로
            </button>
            <div className="register-card__footer">
              이미 계정이 있으신가요?
              <Link to="/login">로그인</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── 만14세 미만 + 플래그 ON: 보호자 동의 요청 완료(대기) ──────────
  if (step === 'pending') {
    const consentUrl = consentInfo?.consent_url || '';
    return (
      <div className="page-content">
        <div className="register-page">
          <div className="register-card">
            <div className="register-card__logo">
              <img src="/aimu-logo.svg" alt="AIMU" />
            </div>
            <h1 className="register-card__title">보호자 동의 대기</h1>
            <div className="register-card__notice-box">
              <p className="register-card__notice-title">보호자에게 동의를 요청했습니다.</p>
              <p className="register-card__notice-sub">
                보호자가 동의 링크에서 동의를 완료하면 로그인할 수 있습니다.
                동의 링크는 요청 시점부터 72시간 동안 유효합니다.
              </p>
            </div>
            {consentUrl && (
              <div className="register-card__consent-url">
                <p className="register-card__notice-sub">
                  테스트 모드 — 아래 링크에서 보호자 동의를 진행할 수 있습니다.
                </p>
                <a className="register-card__consent-link" href={consentUrl}>
                  {consentUrl}
                </a>
              </div>
            )}
            <div className="register-card__footer">
              <Link to="/login">로그인 화면으로</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── 만14세 미만 + 플래그 ON: 계정 정보 + 보호자 정보 입력 ─────────
  if (step === 'guardian') {
    return (
      <div className="page-content">
        <div className="register-page">
          <form className="register-card" onSubmit={handleGuardianRequest}>
            <div className="register-card__logo">
              <img src="/aimu-logo.svg" alt="AIMU" />
            </div>
            <h1 className="register-card__title">보호자 동의 가입</h1>
            <p className="register-card__gate-desc">
              만 14세 미만은 보호자(법정대리인) 동의 후 가입이 완료됩니다.
            </p>

            <div className="register-card__gate-summary">
              <span>
                생년월일 {gateBirthDate} · {NATIONALITY_LABELS[gateNationality] || ''} · {GENDER_LABELS[gateGender] || ''}
              </span>
              <button type="button" className="register-card__gate-edit" onClick={backToGate}>
                수정
              </button>
            </div>

            {guardianError && <div className="register-card__error">{guardianError}</div>}

            <div className="register-card__field">
              <label className="register-card__label">이메일</label>
              <input
                className="register-card__input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="이메일을 입력하세요"
              />
            </div>

            <div className="register-card__field">
              <label className="register-card__label">닉네임</label>
              <input
                className="register-card__input"
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="닉네임을 입력하세요"
              />
            </div>

            <div className="register-card__field">
              <label className="register-card__label">비밀번호</label>
              <input
                className="register-card__input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={PASSWORD_PLACEHOLDER}
              />
            </div>

            <div className="register-card__field">
              <label className="register-card__label">비밀번호 확인</label>
              <input
                className="register-card__input"
                type="password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                placeholder="비밀번호를 다시 입력하세요"
              />
            </div>

            <div className="register-card__extra-section">
              <h2 className="register-card__extra-title">보호자(법정대리인) 정보</h2>
              <div className="register-card__field">
                <label className="register-card__label">보호자 이름</label>
                <input
                  className="register-card__input"
                  type="text"
                  value={guardianName}
                  onChange={(e) => setGuardianName(e.target.value)}
                  placeholder="보호자 이름"
                  maxLength={60}
                />
              </div>
              <div className="register-card__field">
                <label className="register-card__label">보호자 휴대폰</label>
                <input
                  className="register-card__input"
                  type="tel"
                  value={guardianPhone}
                  onChange={(e) => setGuardianPhone(e.target.value)}
                  placeholder="예: 010-1234-5678"
                  maxLength={20}
                />
              </div>
              <p className="register-card__notice-sub">
                입력한 번호로 동의 요청이 전달됩니다. (현재 테스트 모드 — 실제 문자는 발송되지 않습니다)
              </p>
            </div>

            <button className="register-card__submit" type="submit" disabled={guardianLoading}>
              {guardianLoading ? '요청 중...' : '보호자에게 동의 요청'}
            </button>

            <div className="register-card__footer">
              이미 계정이 있으신가요?
              <Link to="/login">로그인</Link>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // ── 만14세 이상: 기존 가입 폼 (게이트 값 요약 표시) ───────────────
  return (
    <div className="page-content">
      <div className="register-page">
        <form className="register-card" onSubmit={handleSubmit}>
          <div className="register-card__logo">
            <img src="/aimu-logo.svg" alt="AIMU" />
          </div>
          <h1 className="register-card__title">회원가입</h1>

          <div className="register-card__gate-summary">
            <span>
              생년월일 {gateBirthDate} · {NATIONALITY_LABELS[gateNationality] || ''} · {GENDER_LABELS[gateGender] || ''}
            </span>
            <button type="button" className="register-card__gate-edit" onClick={backToGate}>
              수정
            </button>
          </div>

          {error && (
            <div className="register-card__error" ref={errorRef}>
              {error}
            </div>
          )}

          <div className="register-card__field">
            <label className="register-card__label">이메일</label>
            <input
              className="register-card__input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="이메일을 입력하세요"
              autoFocus
            />
          </div>

          <div className="register-card__field">
            <label className="register-card__label">닉네임</label>
            <input
              className="register-card__input"
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="닉네임을 입력하세요"
            />
          </div>

          <div className="register-card__field">
            <label className="register-card__label">기획사명</label>
            <input
              className="register-card__input"
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              onBlur={() => {
                // v160 — blur 시점 자동접미: 사용자가 최종 저장값을 눈으로 확인 (제출 시 재정규화로 이중 방어)
                const normalized = normalizeCompanyName(companyName);
                if (normalized === companyName) return;
                const appended = normalized !== companyName.trim();
                setCompanyName(normalized);
                if (import.meta.env.DEV) {
                  // 개인정보 — 입력값 원문 미출력, 접미어 추가 여부만
                  console.info('[RegisterPage] company suffix applied', { appended });
                }
              }}
              placeholder="예: 이재규 엔터테인먼트"
              maxLength={100}
            />
          </div>

          <div className="register-card__field">
            <label className="register-card__label">호칭</label>
            <input
              className="register-card__input"
              type="text"
              value={displayTitle}
              onChange={(e) => setDisplayTitle(e.target.value)}
              placeholder="예: 대표님"
              maxLength={20}
            />
          </div>

          <div className="register-card__field">
            <label className="register-card__label">비밀번호</label>
            <input
              className="register-card__input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={PASSWORD_PLACEHOLDER}
            />
            {/* v160 — 실시간 조건 힌트: 빈 입력은 중립, 입력 시작 후 충족=초록/미충족=빨강 */}
            <ul className="register-card__pw-hints" aria-live="polite">
              {PASSWORD_HINT_RULES.map(({ key, label, test }) => {
                const state = password === '' ? 'neutral' : test(password) ? 'ok' : 'bad';
                return (
                  <li
                    key={key}
                    className={`register-card__pw-hint register-card__pw-hint--${state}`}
                  >
                    {state === 'ok' ? '✓' : '·'} {label}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="register-card__field">
            <label className="register-card__label">비밀번호 확인</label>
            <input
              className="register-card__input"
              type="password"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              placeholder="비밀번호를 다시 입력하세요"
            />
            {/* v160 — 확인 불일치 실시간 표시 (검증 자체는 제출 시 :185 규칙 그대로) */}
            {passwordConfirm !== '' && passwordConfirm !== password && (
              <p className="register-card__pw-mismatch">비밀번호가 일치하지 않습니다.</p>
            )}
          </div>

          <div className="register-card__extra-section">
            <h2 className="register-card__extra-title">추가 정보 (선택)</h2>
            {/* v125 — 선택 입력(지역 등)은 입력=동의 방식 고지 */}
            <p className="register-card__optional-notice">{OPTIONAL_INPUT_NOTICE}</p>
            {/* 생년월일/내외국인/성별은 STEP 0 게이트에서 입력 완료 — 중복 입력 방지 위해 숨김 */}
            <ProfileExtraForm
              onChange={setExtraValues}
              hiddenFields={['birth_date', 'nationality', 'gender']}
            />
            {/* v154 — 추천코드(선택): 초대 링크 ?ref= 프리필, 대문자 자동 변환 */}
            <div className="register-card__field">
              <label className="register-card__label">추천코드 (선택)</label>
              <input
                className="register-card__input"
                type="text"
                value={referralCode}
                maxLength={4}
                onChange={(e) => {
                  setReferralCode(e.target.value.toUpperCase());
                  setReferralError('');
                }}
                placeholder="친구에게 받은 4자리 코드"
                autoComplete="off"
              />
              {referralError && (
                <p className="register-card__field-error">{referralError}</p>
              )}
            </div>
          </div>

          {/* v125 — 약관 동의 (필수4 + 선택1 + 행태정보 고지) */}
          <div className="register-card__extra-section">
            <h2 className="register-card__extra-title">약관 동의</h2>
            <ConsentList
              keys={SIGNUP_CONSENT_KEYS}
              values={consentValues}
              onChange={setConsentValues}
            />
          </div>

          <button
            className="register-card__submit"
            type="submit"
            disabled={loading || !areRequiredConsentsChecked(consentValues, SIGNUP_CONSENT_KEYS)}
          >
            {loading ? '가입 중...' : '회원가입'}
          </button>

          <SocialLoginButtons logPrefix="RegisterPage" />

          <div className="register-card__footer">
            이미 계정이 있으신가요?
            <Link to="/login">로그인</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
