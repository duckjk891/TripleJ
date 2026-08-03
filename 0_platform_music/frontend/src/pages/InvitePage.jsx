import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import * as api from '../api';
import './InvitePage.css';

// v154 — 초대 착지 페이지 /invite/:code (비로그인 열람).
// getInviteInfo(code) → "{닉네임}님이 MAIDOL에 초대했어요!" + 추천코드 + 복사
// + CTA [MAIDOL 시작하기](play_store_url 새 탭) + 보조 "웹에서 바로 가입하기"(/register?ref=코드).
// 404(무효/탈퇴 유저 코드) 시 안내 + 홈으로.

// 클립보드 복사 — clipboard API → execCommand 폴백 (useTrackShare.copyLink 패턴)
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export default function InvitePage() {
  const { code } = useParams();
  // phase: loading | ready | invalid | error
  const [phase, setPhase] = useState('loading');
  const [info, setInfo] = useState(null); // { referral_code, inviter_nickname, play_store_url }
  const [copyMessage, setCopyMessage] = useState('');
  const copyTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (import.meta.env.DEV) console.info('[InvitePage] load invite info', { code });
      try {
        const { data } = await api.getInviteInfo(code);
        if (cancelled) return;
        if (import.meta.env.DEV) {
          console.info('[InvitePage] load success', { code: data?.referral_code });
        }
        setInfo(data || {});
        setPhase('ready');
      } catch (err) {
        if (cancelled) return;
        console.error('[InvitePage] getInviteInfo failed', {
          code,
          status: err?.response?.status,
          message: err?.message,
        });
        setPhase(err?.response?.status === 404 ? 'invalid' : 'error');
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  const referralCode = info?.referral_code || '';

  const handleCopyCode = async () => {
    const copied = await copyText(referralCode);
    if (import.meta.env.DEV) console.info('[InvitePage] copy code', { copied });
    setCopyMessage(copied ? '복사 완료!' : '복사에 실패했습니다.');
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopyMessage(''), 4000);
  };

  const handleStart = () => {
    if (import.meta.env.DEV) console.info('[InvitePage] cta play store open');
    if (info?.play_store_url) {
      window.open(info.play_store_url, '_blank', 'noopener');
    }
  };

  return (
    <div className="page-content">
      <div className="invite-page">
        <div className="invite-card">
          <div className="invite-card__logo">
            <img src="/aimu-logo.svg" alt="MAIDOL" />
          </div>

          {phase === 'loading' && (
            <p className="invite-card__status">초대 정보를 불러오는 중...</p>
          )}

          {(phase === 'invalid' || phase === 'error') && (
            <>
              <h1 className="invite-card__title">
                {phase === 'invalid'
                  ? '유효하지 않은 초대 링크입니다'
                  : '초대 정보를 불러오지 못했습니다'}
              </h1>
              <p className="invite-card__desc">
                {phase === 'invalid'
                  ? '링크가 잘못되었거나 만료되었어요. 주소를 다시 확인해주세요.'
                  : '잠시 후 다시 시도해주세요.'}
              </p>
              <Link to="/" className="invite-card__cta">
                홈으로
              </Link>
            </>
          )}

          {phase === 'ready' && (
            <>
              <h1 className="invite-card__title">
                <span className="invite-card__nickname">{info?.inviter_nickname}</span>
                님이 MAIDOL에 초대했어요!
              </h1>
              <p className="invite-card__desc">
                AI가 만든 음악의 새로운 세계 🎵 아래 추천코드로 가입하면
                두 사람 모두 ⭐50 을 받아요.
              </p>

              <div className="invite-card__code-box">
                <span className="invite-card__code">{referralCode}</span>
                <button
                  type="button"
                  className="invite-card__copy-btn"
                  title="추천코드 복사"
                  onClick={handleCopyCode}
                >
                  📋 복사
                </button>
              </div>
              {copyMessage && <p className="invite-card__copy-message">{copyMessage}</p>}

              <button type="button" className="invite-card__cta" onClick={handleStart}>
                MAIDOL 시작하기
              </button>
              <Link
                to={`/register?ref=${encodeURIComponent(referralCode)}`}
                className="invite-card__web-link"
              >
                웹에서 바로 가입하기
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
