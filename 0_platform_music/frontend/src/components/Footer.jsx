import './Footer.css';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer__inner">
        <div className="footer__info">
          <span className="footer__brand">melon</span>
          <p className="footer__text">
            (주) 멜론컴퍼니 | 대표이사 : 홍길동<br />
            서울특별시 강남구 테헤란로 1234<br />
            &copy; MELON COMPANY. All Rights Reserved.
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
