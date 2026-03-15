import './Footer.css';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer__inner">
        <div className="footer__info">
          <span className="footer__brand">AIMU</span>
          <p className="footer__text">
            (주) AIMU | AI Music Universe<br />
            AI로 만든 음악을 공유하는 플랫폼<br />
            &copy; 2024 AIMU. All Rights Reserved.
          </p>
        </div>
        <div className="footer__links">
          <a href="#">이용약관</a>
          <a href="#">개인정보처리방침</a>
          <a href="#">고객센터</a>
        </div>
      </div>
    </footer>
  );
}
