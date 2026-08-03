import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import * as api from '../api';
import './GuardianConsentPage.css';

// v123 — 보호자(법정대리인) 동의 페이지. 무로그인 접근(토큰 링크 경유).
// getGuardianConsent(token) 으로 동의 고지 데이터 로드 → (모의 본인인증 안내) →
// [동의합니다]/[동의하지 않습니다] → decideGuardianConsent → 결과 화면.
// 404(무효/만료)/409(이미 처리) 에러 처리 포함.
// 주의: 개인정보 — 아동/보호자 관련 값은 절대 콘솔에 출력하지 않는다(로드 성공 여부만).

// 서버 고지 데이터에 collected_items 가 없을 때의 기본 수집 항목 안내
const DEFAULT_COLLECTED_ITEMS = [
  '이메일, 닉네임, 비밀번호(암호화 저장)',
  '생년월일, 내/외국인 여부',
  '보호자 이름·휴대폰 번호 (동의 확인 목적)',
];

export default function GuardianConsentPage() {
  const { token } = useParams();
  // phase: loading | ready | deciding | done | error
  const [phase, setPhase] = useState('loading');
  const [info, setInfo] = useState(null); // 동의 고지 데이터
  const [result, setResult] = useState(null); // { agreed: bool }
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (import.meta.env.DEV) console.info('[GuardianConsent] load start');
      try {
        const { data } = await api.getGuardianConsent(token);
        if (cancelled) return;
        if (import.meta.env.DEV) {
          console.info('[GuardianConsent] load success', { status: data?.status });
        }
        setInfo(data || {});
        setPhase('ready');
      } catch (err) {
        if (cancelled) return;
        console.error('[GuardianConsent] load failed', {
          status: err?.response?.status,
          message: err?.message,
        });
        const status = err?.response?.status;
        if (status === 404) {
          setErrorMsg('유효하지 않거나 만료된 동의 링크입니다.');
        } else if (status === 409) {
          setErrorMsg('이미 처리된 동의 요청입니다.');
        } else {
          setErrorMsg('동의 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
        }
        setPhase('error');
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const handleDecide = async (agree) => {
    setPhase('deciding');
    if (import.meta.env.DEV) console.info('[GuardianConsent] decide start', { agree });
    try {
      await api.decideGuardianConsent(token, agree);
      if (import.meta.env.DEV) console.info('[GuardianConsent] decide success', { agree });
      setResult({ agreed: agree });
      setPhase('done');
    } catch (err) {
      console.error('[GuardianConsent] decide failed', {
        status: err?.response?.status,
        message: err?.message,
      });
      const status = err?.response?.status;
      if (status === 404) {
        setErrorMsg('유효하지 않거나 만료된 동의 링크입니다.');
        setPhase('error');
      } else if (status === 409) {
        setErrorMsg('이미 처리된 동의 요청입니다.');
        setPhase('error');
      } else {
        setErrorMsg('처리에 실패했습니다. 잠시 후 다시 시도해주세요.');
        setPhase('ready');
      }
    }
  };

  const renderBody = () => {
    if (phase === 'loading') {
      return <p className="guardian-consent__loading">동의 정보를 불러오는 중...</p>;
    }

    if (phase === 'error') {
      return (
        <div className="guardian-consent__notice-box">
          <p className="guardian-consent__notice-title">{errorMsg}</p>
          <p className="guardian-consent__notice-sub">
            링크가 만료되었거나 이미 처리된 경우, 자녀가 가입 절차에서 동의를 다시 요청해야 합니다.
          </p>
        </div>
      );
    }

    if (phase === 'done') {
      return (
        <div className="guardian-consent__notice-box">
          {result?.agreed ? (
            <>
              <p className="guardian-consent__notice-title">동의가 완료되었습니다.</p>
              <p className="guardian-consent__notice-sub">
                이제 자녀가 로그인할 수 있습니다. 이 창은 닫으셔도 됩니다.
              </p>
            </>
          ) : (
            <>
              <p className="guardian-consent__notice-title">동의하지 않음으로 처리되었습니다.</p>
              <p className="guardian-consent__notice-sub">
                자녀의 계정은 활성화되지 않으며, 로그인할 수 없습니다.
                다시 가입하려면 보호자 동의를 새로 요청해야 합니다.
              </p>
            </>
          )}
        </div>
      );
    }

    // ready | deciding — 고지 + 동의/거부 버튼
    const childNickname = info?.child_nickname || info?.nickname || '';
    const collectedItems =
      Array.isArray(info?.collected_items) && info.collected_items.length > 0
        ? info.collected_items
        : DEFAULT_COLLECTED_ITEMS;
    const requestedAt = info?.requested_at
      ? new Date(info.requested_at).toLocaleString('ko-KR')
      : null;

    return (
      <>
        <div className="guardian-consent__section">
          <h2 className="guardian-consent__section-title">동의 요청 정보</h2>
          <div className="guardian-consent__row">
            <span className="guardian-consent__row-label">가입 신청 자녀</span>
            <span className="guardian-consent__row-value">{childNickname || '-'}</span>
          </div>
          {requestedAt && (
            <div className="guardian-consent__row">
              <span className="guardian-consent__row-label">요청 일시</span>
              <span className="guardian-consent__row-value">{requestedAt}</span>
            </div>
          )}
        </div>

        <div className="guardian-consent__section">
          <h2 className="guardian-consent__section-title">수집·이용하는 개인정보</h2>
          <ul className="guardian-consent__items">
            {collectedItems.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
          <p className="guardian-consent__sub">
            만 14세 미만 아동의 개인정보는 서비스 제공 목적 범위에서만 이용되며,
            맞춤형 광고 분석에는 사용되지 않습니다.
          </p>
        </div>

        <div className="guardian-consent__mock-notice">
          현재 테스트 모드입니다 — 보호자 본인인증은 모의(mock)로 처리되며,
          버튼 선택만으로 동의/거부가 기록됩니다.
        </div>

        <div className="guardian-consent__actions">
          <button
            type="button"
            className="guardian-consent__btn guardian-consent__btn--agree"
            onClick={() => handleDecide(true)}
            disabled={phase === 'deciding'}
          >
            {phase === 'deciding' ? '처리 중...' : '동의합니다'}
          </button>
          <button
            type="button"
            className="guardian-consent__btn guardian-consent__btn--reject"
            onClick={() => handleDecide(false)}
            disabled={phase === 'deciding'}
          >
            동의하지 않습니다
          </button>
        </div>
        {errorMsg && phase === 'ready' && (
          <p className="guardian-consent__inline-error">{errorMsg}</p>
        )}
      </>
    );
  };

  return (
    <div className="page-content">
      <div className="guardian-consent">
        <div className="guardian-consent__card">
          <h1 className="guardian-consent__title">보호자(법정대리인) 동의</h1>
          <p className="guardian-consent__desc">
            만 14세 미만 아동의 회원가입에 대한 보호자 동의 절차입니다.
          </p>
          {renderBody()}
          <div className="guardian-consent__footer">
            <Link to="/">MAIDOL 홈으로</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
