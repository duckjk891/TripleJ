import { Link } from 'react-router-dom';
import './Footer.css';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer__inner">
        <div className="footer__info">
          <span className="footer__brand">MAIDOL</span>
          <p className="footer__text">
            MAIDOL | My AI Idol<br />
            AI로 만든 음악을 공유하는 플랫폼<br />
            (주)Lotus AI | 대표 이재규 | 사업자등록번호 334-87-04045<br />
            통신판매업 신고 면제 (자본금 1억원 미만)<br />
            서울시 중구 퇴계로36길 2, 10층 16호·18호<br />
            대표전화 02-2272-8952 | 이메일 kimpearl@lotusai.co.kr<br />
            개인정보보호책임자 김진주<br />
            &copy; 2026 Lotus AI. All Rights Reserved.
          </p>
        </div>
        <div className="footer__links">
          <Link to="/terms">이용약관</Link>
          <Link to="/privacy">개인정보처리방침</Link>
          <a href="mailto:kimpearl@lotusai.co.kr">고객센터</a>
        </div>
      </div>
    </footer>
  );
}
