import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './LandingPage.css';

export default function LandingPage() {
  const { user } = useAuth();
  const ctaTo = user ? '/wizard' : '/register';
  const ctaLabel = user ? '내 이야기 시작하기' : '시작하기';

  return (
    <section className="landing">
      <h1 className="landing__title">두 사람의 이야기를 영상으로</h1>
      <p className="landing__subtitle">
        커플의 이야기를 입력하면, 음악과 뮤직비디오로 만들어 드립니다.
      </p>
      <Link to={ctaTo} className="btn-primary landing__cta">
        {ctaLabel}
      </Link>
    </section>
  );
}
