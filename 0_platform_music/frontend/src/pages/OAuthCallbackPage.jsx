import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

// OAuth 콜백 처리 화면.
// 백엔드가 브라우저를 {frontend}/oauth/callback#token=<JWT> (실패 시 #error=...) 로 돌려보냄.
// 토큰은 URL 해시(#)에 담겨 옴 — 서버 로그/Referer 노출을 피하기 위함.
function parseHash() {
  const raw = (window.location.hash || '').replace(/^#/, '');
  const params = new URLSearchParams(raw);
  return { token: params.get('token'), error: params.get('error') };
}

export default function OAuthCallbackPage() {
  const navigate = useNavigate();
  const { loginWithToken } = useAuth();
  // StrictMode 이중 마운트 / 재실행 가드
  const handledRef = useRef(false);

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
        await loginWithToken(token);
        // 토큰이 주소창 해시에 남지 않도록 replace 로 홈 이동
        navigate('/', { replace: true });
      } catch (err) {
        console.error('[OAuthCallback] failed', { err });
        navigate('/login?social_error=1', { replace: true });
      }
    })();
  }, [loginWithToken, navigate]);

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
