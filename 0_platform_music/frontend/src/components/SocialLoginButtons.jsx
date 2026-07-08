import * as api from '../api';
import './SocialLoginButtons.css';

// 구글/카카오/네이버 소셜 로그인 버튼 (로그인=가입 동일 흐름).
// 클릭 시 OAuth 는 페이지 리다이렉트라 axios 가 아닌 window.location.assign 사용.
// URL 은 직접 조립하지 않고 api.oauthLoginPath 헬퍼가 제공.
const PROVIDERS = [
  { key: 'google', label: 'Google 로 계속하기', className: 'social-btn social-btn--google' },
  { key: 'kakao', label: '카카오로 계속하기', className: 'social-btn social-btn--kakao' },
  { key: 'naver', label: '네이버로 계속하기', className: 'social-btn social-btn--naver' },
];

export default function SocialLoginButtons({ logPrefix = 'SocialLogin' }) {
  const handleClick = (provider) => {
    if (import.meta.env.DEV) {
      console.info(`[${logPrefix}] oauth start`, { provider });
    }
    window.location.assign(api.oauthLoginPath(provider));
  };

  return (
    <div className="social-login">
      <div className="social-login__divider">또는</div>
      <div className="social-login__buttons">
        {PROVIDERS.map((p) => (
          <button
            key={p.key}
            type="button"
            className={p.className}
            onClick={() => handleClick(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
