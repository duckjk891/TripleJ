import { useState, useEffect, useRef } from 'react';
import { FiX } from 'react-icons/fi';
import * as api from '../api';
import './AppShareModal.css';

// v154 — MAIDOL 앱 추천(리퍼럴) 공유 모달. 헤더 📢 버튼이 오픈(로그인 전용).
// 마운트 시 getMyReferralCode() 로 내 추천코드 로드 → 코드 표시+복사, 공유 4종:
//   카카오톡/인스타그램 = navigator.share(Web Share API) 우선, 미지원 시 링크복사 폴백
//   (Kakao SDK 통합 금지 — 실키 대기 프로젝트 방침), 페이스북 = sharer 새창, 링크 복사.
// invite_url 은 표시/공유용으로 window.location.origin 기반 재조립(백엔드 값과 무관하게 현재 호스트).

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

const SHARE_TARGET_LABEL = { kakao: '카카오톡', instagram: '인스타그램' };

export default function AppShareModal({ onClose }) {
  // phase: loading | ready | error
  const [phase, setPhase] = useState('loading');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const messageTimerRef = useRef(null);

  const showMessage = (msg) => {
    setMessage(msg);
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setMessage(''), 4000);
  };

  useEffect(() => {
    return () => {
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (import.meta.env.DEV) console.info('[AppShareModal] load my referral code');
      try {
        const { data } = await api.getMyReferralCode();
        if (cancelled) return;
        if (import.meta.env.DEV) {
          console.info('[AppShareModal] code loaded', { code: data?.referral_code });
        }
        setCode(data?.referral_code || '');
        setPhase('ready');
      } catch (err) {
        if (cancelled) return;
        console.error('[AppShareModal] getMyReferralCode failed', {
          status: err?.response?.status,
          message: err?.message,
        });
        setPhase('error');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const inviteUrl = code ? `${window.location.origin}/invite/${code}` : '';
  // v160 — URL 중복 방지: navigator.share 는 url 파라미터에만 URL 전달(text 는 base),
  // 복사 2경로(handleCopyLink / Web Share 미지원 폴백)는 URL 포함본(Full) 유지.
  const shareTextBase = `MAIDOL — AI가 만든 음악의 새로운 세계 🎵\n추천코드: ${code}`;
  const shareTextFull = `${shareTextBase}\n${inviteUrl}`;

  const handleCopyCode = async () => {
    const copied = await copyText(code);
    if (import.meta.env.DEV) console.info('[AppShareModal] copy code', { copied });
    showMessage(copied ? '복사 완료!' : '복사에 실패했습니다.');
  };

  const handleCopyLink = async () => {
    const copied = await copyText(shareTextFull);
    if (import.meta.env.DEV) console.info('[AppShareModal] copy link', { copied });
    showMessage(copied ? '초대 링크가 복사되었습니다.' : '복사에 실패했습니다.');
  };

  // 카톡/인스타 — Web Share API 우선, 미지원(데스크톱 등) 시 링크복사 폴백
  const handleWebShare = async (target) => {
    const label = SHARE_TARGET_LABEL[target] || target;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'MAIDOL 추천하기',
          text: shareTextBase,
          url: inviteUrl,
        });
        if (import.meta.env.DEV) console.info('[AppShareModal] web share done', { target });
      } catch (err) {
        // 공유 시트 취소는 조용히 무시
        if (err?.name !== 'AbortError') {
          console.error('[AppShareModal] web share failed', { target, message: err?.message });
          showMessage('공유에 실패했습니다. 링크 복사를 이용해주세요.');
        }
      }
      return;
    }
    const copied = await copyText(shareTextFull);
    if (import.meta.env.DEV) {
      console.info('[AppShareModal] web share unsupported, copy fallback', { target, copied });
    }
    showMessage(
      copied
        ? `링크가 복사되었습니다. ${label}에 붙여넣어 주세요.`
        : '복사에 실패했습니다.'
    );
  };

  const handleFacebook = () => {
    if (import.meta.env.DEV) console.info('[AppShareModal] facebook sharer open');
    window.open(
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(inviteUrl)}`,
      '_blank',
      'noopener'
    );
  };

  return (
    <div className="app-share-modal__overlay" onClick={onClose}>
      <div className="app-share-modal" onClick={(e) => e.stopPropagation()}>
        <div className="app-share-modal__head">
          <h2 className="app-share-modal__title">📢 MAIDOL 추천하기</h2>
          <button
            type="button"
            className="app-share-modal__close"
            aria-label="닫기"
            onClick={onClose}
          >
            <FiX />
          </button>
        </div>

        {phase === 'loading' && (
          <p className="app-share-modal__status">추천코드를 불러오는 중...</p>
        )}

        {phase === 'error' && (
          <p className="app-share-modal__status app-share-modal__status--error">
            추천코드를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.
          </p>
        )}

        {phase === 'ready' && (
          <>
            <p className="app-share-modal__desc">
              친구가 내 추천코드로 가입하면 두 사람 모두 ⭐50 을 받아요!
            </p>

            <div className="app-share-modal__code-box">
              <span className="app-share-modal__code">{code}</span>
              <button
                type="button"
                className="app-share-modal__copy-btn"
                title="추천코드 복사"
                onClick={handleCopyCode}
              >
                📋 복사
              </button>
            </div>

            <div className="app-share-modal__buttons">
              <button
                type="button"
                className="app-share-modal__share-btn"
                onClick={() => handleWebShare('kakao')}
              >
                💬 카카오톡
              </button>
              <button
                type="button"
                className="app-share-modal__share-btn"
                onClick={() => handleWebShare('instagram')}
              >
                📸 인스타그램
              </button>
              <button
                type="button"
                className="app-share-modal__share-btn"
                onClick={handleFacebook}
              >
                📘 페이스북
              </button>
              <button
                type="button"
                className="app-share-modal__share-btn"
                onClick={handleCopyLink}
              >
                🔗 링크 복사
              </button>
            </div>

            {message && <p className="app-share-modal__message">{message}</p>}
          </>
        )}
      </div>
    </div>
  );
}
