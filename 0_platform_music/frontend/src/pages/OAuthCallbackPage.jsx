import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import ProfileExtraForm from '../components/ProfileExtraForm';
import ConsentList from '../components/ConsentList';
import { areRequiredConsentsChecked } from '../utils/consent';
import {
  CONSENT_VERSION,
  REQUIRED_CONSENT_KEYS,
  SIGNUP_CONSENT_KEYS,
} from '../constants/consentTexts';
import { updateMyProfile, getMyConsents, recordConsents } from '../api';

// OAuth 콜백 처리 화면.
// 백엔드가 브라우저를 {frontend}/oauth/callback#token=<JWT> (실패 시 #error=...) 로 돌려보냄.
// 토큰은 URL 해시(#)에 담겨 옴 — 서버 로그/Referer 노출을 피하기 위함.
// v125 — 로그인 처리 후 필수 동의 4종 미기록/미동의 계정은 동의 화면을 선행(스킵 불가)한 뒤
//        기존 추가정보 온보딩으로 진행. 이미 동의된 계정은 기존 흐름 그대로.
function parseHash() {
  const raw = (window.location.hash || '').replace(/^#/, '');
  const params = new URLSearchParams(raw);
  return { token: params.get('token'), error: params.get('error') };
}

// 소셜 로그인 직후 인구통계 온보딩 스킵 플래그 — 이번 세션(탭) 동안 재표시 방지
const SKIP_FLAG_KEY = 'aimu:profileExtraSkipped';

export default function OAuthCallbackPage() {
  const navigate = useNavigate();
  const { loginWithToken } = useAuth();
  // StrictMode 이중 마운트 / 재실행 가드
  const handledRef = useRef(false);
  // /auth/me 응답 보관 — 동의 화면 이후 추가정보 필요 판정에 재사용
  const meRef = useRef(null);
  // 로그인 성공 + 인구통계 3종 모두 null 이면 온보딩 폼 표시
  const [showExtraForm, setShowExtraForm] = useState(false);
  const [saving, setSaving] = useState(false);
  // v125 — 필수 동의 미기록 계정의 동의 화면(스킵 불가)
  const [showConsent, setShowConsent] = useState(false);
  const [consentValues, setConsentValues] = useState({});
  const [consentSaving, setConsentSaving] = useState(false);
  const [consentError, setConsentError] = useState('');

  // 인구통계 3종 모두 null + 이번 세션에 스킵 이력 없음 → 온보딩 폼, 아니면 홈 이동.
  // 판정 자체가 실패해도 기존 리다이렉트 흐름은 깨지 않는다.
  const proceedToExtraOrHome = useCallback((me) => {
    let needExtra = false;
    try {
      let skipped = false;
      try {
        skipped = sessionStorage.getItem(SKIP_FLAG_KEY) === '1';
      } catch { /* sessionStorage 접근 실패 시 폼 미표시로 폴백 */ }
      needExtra =
        !skipped &&
        me &&
        me.birth_date == null &&
        me.gender == null &&
        me.region == null;
      if (import.meta.env.DEV) {
        console.info('[OAuthCallback] profile extra check', { needExtra, skipped });
      }
    } catch (checkErr) {
      console.error('[OAuthCallback] profile extra check failed', { message: checkErr?.message });
    }

    if (needExtra) {
      // 토큰이 주소창 해시에 남지 않도록 해시 제거 후 폼 표시
      try {
        window.history.replaceState(null, '', window.location.pathname);
      } catch { /* ignore */ }
      setShowExtraForm(true);
      return;
    }

    // 토큰이 주소창 해시에 남지 않도록 replace 로 홈 이동 (기존 흐름 그대로)
    navigate('/', { replace: true });
  }, [navigate]);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    const { token, error } = parseHash();

    if (error || !token) {
      if (import.meta.env.DEV) {
        console.warn('[OAuthCallback] no token', { hasError: !!error });
      }
      navigate('/login?social_error=1', { replace: true });
      return;
    }

    console.info('[OAuthCallback] token received');

    (async () => {
      try {
        // loginWithToken 은 /auth/me 응답(user 객체)을 그대로 반환한다.
        const me = await loginWithToken(token);
        meRef.current = me;

        // v125 — 필수 동의 4종 최신 상태 확인. 미기록/미동의가 하나라도 있으면 동의 화면 선행.
        // 조회 실패 시에는 로그인 흐름을 깨지 않도록 기존 흐름으로 폴백(다음 로그인 때 재확인).
        let needConsent = false;
        try {
          const { data } = await getMyConsents();
          const consents = data?.consents || {};
          needConsent = REQUIRED_CONSENT_KEYS.some((k) => !consents[k]?.agreed);
          if (import.meta.env.DEV) {
            console.info('[OAuthCallback] consent check', { needConsent });
          }
        } catch (checkErr) {
          console.error('[OAuthCallback] consent check failed', {
            status: checkErr?.response?.status,
            message: checkErr?.message,
          });
        }

        if (needConsent) {
          // 토큰이 주소창 해시에 남지 않도록 해시 제거 후 동의 화면 표시
          try {
            window.history.replaceState(null, '', window.location.pathname);
          } catch { /* ignore */ }
          setShowConsent(true);
          return;
        }

        proceedToExtraOrHome(me);
      } catch (err) {
        console.error('[OAuthCallback] failed', { err });
        navigate('/login?social_error=1', { replace: true });
      }
    })();
  }, [loginWithToken, navigate, proceedToExtraOrHome]);

  const goHome = () => navigate('/', { replace: true });

  const handleSkip = () => {
    try {
      sessionStorage.setItem(SKIP_FLAG_KEY, '1');
    } catch { /* ignore */ }
    if (import.meta.env.DEV) console.info('[OAuthCallback] profile extra skipped');
    goHome();
  };

  const handleExtraSubmit = async (values) => {
    // 값이 있는 필드만 부분 업데이트 — 전부 미선택이면 스킵과 동일 처리
    const payload = {};
    Object.entries(values).forEach(([k, v]) => {
      if (v !== null) payload[k] = v;
    });
    if (Object.keys(payload).length === 0) {
      handleSkip();
      return;
    }
    setSaving(true);
    if (import.meta.env.DEV) {
      console.info('[OAuthCallback] updateMyProfile start', { fields: Object.keys(payload).length });
    }
    try {
      await updateMyProfile(payload);
      if (import.meta.env.DEV) console.info('[OAuthCallback] updateMyProfile success');
    } catch (err) {
      // 저장 실패해도 로그인 자체는 완료 상태 — 기존 목적지로 이동은 그대로 진행
      console.error('[OAuthCallback] updateMyProfile failed', {
        status: err?.response?.status,
        message: err?.message,
      });
    } finally {
      setSaving(false);
      goHome();
    }
  };

  // v125 — [동의하고 계속]: 5종 전부 기록(marketing 은 미체크=false 도 거부 이력으로 기록)
  const requiredConsentOk = areRequiredConsentsChecked(consentValues, SIGNUP_CONSENT_KEYS);

  const handleConsentContinue = async () => {
    if (!requiredConsentOk || consentSaving) return;
    setConsentSaving(true);
    setConsentError('');
    const entries = SIGNUP_CONSENT_KEYS.map((k) => ({ key: k, agreed: !!consentValues[k] }));
    if (import.meta.env.DEV) {
      console.info('[OAuthCallback] recordConsents start', { count: entries.length });
    }
    try {
      await recordConsents(entries, CONSENT_VERSION);
      console.info('[OAuthCallback] consents recorded');
      setShowConsent(false);
      proceedToExtraOrHome(meRef.current);
    } catch (err) {
      console.error('[OAuthCallback] recordConsents failed', {
        status: err?.response?.status,
        message: err?.message,
      });
      setConsentError('동의 처리에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setConsentSaving(false);
    }
  };

  if (showConsent) {
    return (
      <div className="page-content">
        <div
          style={{
            maxWidth: 480,
            margin: '48px auto',
            padding: '28px 24px',
            background: 'var(--color-card)',
            border: '1px solid var(--color-border)',
            borderRadius: 12,
          }}
        >
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>
            서비스 이용 동의
          </h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-sub)', margin: '0 0 16px' }}>
            서비스 이용을 위해 아래 필수 항목에 동의해주세요.
          </p>
          <ConsentList
            keys={SIGNUP_CONSENT_KEYS}
            values={consentValues}
            onChange={setConsentValues}
          />
          {consentError && (
            <p style={{ fontSize: 13, color: 'var(--color-danger, #e05a5a)', margin: '10px 0 0' }}>
              {consentError}
            </p>
          )}
          <button
            type="button"
            onClick={handleConsentContinue}
            disabled={!requiredConsentOk || consentSaving}
            style={{
              width: '100%',
              marginTop: 16,
              padding: '10px 0',
              border: 'none',
              borderRadius: 8,
              background: 'var(--color-primary)',
              color: '#fff',
              fontSize: 14,
              fontWeight: 700,
              cursor: !requiredConsentOk || consentSaving ? 'default' : 'pointer',
              opacity: !requiredConsentOk || consentSaving ? 0.5 : 1,
            }}
          >
            {consentSaving ? '처리 중...' : '동의하고 계속'}
          </button>
        </div>
      </div>
    );
  }

  if (showExtraForm) {
    return (
      <div className="page-content">
        <div
          style={{
            maxWidth: 420,
            margin: '48px auto',
            padding: '28px 24px',
            background: 'var(--color-card)',
            border: '1px solid var(--color-border)',
            borderRadius: 12,
          }}
        >
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 16px' }}>
            추가 정보 입력
          </h1>
          <ProfileExtraForm
            onSubmit={handleExtraSubmit}
            onSkip={handleSkip}
            submitLabel="저장하고 시작하기"
            busy={saving}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div
        style={{
          minHeight: '40vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-text-sub)',
          fontSize: 15,
        }}
      >
        로그인 처리 중...
      </div>
    </div>
  );
}
