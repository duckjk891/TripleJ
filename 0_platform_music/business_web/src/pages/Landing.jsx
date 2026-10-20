import { useState } from 'react';
import { Link } from 'react-router-dom';
import Brand from '../components/Brand';
import { appAlert } from '../components/dialog';
import { sendInquiry, friendlyError } from '../api';
import { useAuth } from '../auth';

const EMPTY = { company: '', contact_name: '', email: '', phone: '', channel_url: '', message: '', agree: false, website: '' };

const HOW = [
  { n: '1', t: '착장 목록에 상품 노출', d: '상의·하의·신발·모자·가방 카테고리에 브랜드 상품이 보이고, 사용자가 자기 AI 아티스트에게 입혀 봅니다.' },
  { n: '2', t: '곡 커버·뮤직비디오에 착용', d: '고른 옷을 입은 아티스트가 곡 커버와 뮤직비디오로 만들어져 곡과 함께 공개됩니다.' },
  { n: '3', t: '상품 페이지로 바로 이동', d: '곡을 듣는 사람이 곡 화면의 착장을 눌러 브랜드 상품 페이지로 이동합니다.' },
];

const CAN = [
  ['01', '상품 등록·수정'],
  ['02', '노출 켜고 끄기'],
  ['03', '착장 선택·클릭·담김 확인'],
  ['04', '어떤 장르·시간대에 반응했는지 보기'],
];

export default function Landing() {
  const { isAuthed } = useAuth();
  const [f, setF] = useState(EMPTY);
  const [sending, setSending] = useState(false);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!f.company.trim() || !f.contact_name.trim() || !f.email.trim() || !f.message.trim()) {
      appAlert('회사명·담당자 이름·이메일·문의 내용을 입력해 주세요.');
      return;
    }
    if (!f.agree) { appAlert('개인정보 수집·이용에 동의해 주세요.'); return; }
    setSending(true);
    try {
      await sendInquiry(f);
      setF(EMPTY);
      appAlert('문의가 접수됐어요. 남겨 주신 이메일로 MAIDOL 담당자가 연락드릴게요.', { title: '감사합니다' });
    } catch (err) {
      appAlert(friendlyError(err, '문의를 보내지 못했어요. 잠시 후 다시 시도해 주세요.'));
    } finally {
      setSending(false);
    }
  };

  const goContact = () => document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' });

  return (
    <div className="landing">
      <header className="lnav">
        <div className="container lnav__in">
          <a href="#/" aria-label="MAIDOL Business 처음으로"><Brand /></a>
          <div className="lnav__act">
            <button className="btn btn--ghost btn--sm hide-sm" onClick={goContact}>광고 문의</button>
            <Link className="btn btn--primary btn--sm" to={isAuthed ? '/dashboard' : '/login'}>{isAuthed ? '광고주 화면' : '광고주 로그인'}</Link>
          </div>
        </div>
      </header>

      <section className="hero">
        <div className="container hero__in">
          <div className="hero__text">
            <div className="eyebrow">FOR BRANDS</div>
            <h1>AI 아이돌이 입는 옷,<br /><em>우리 브랜드</em>로 채워 보세요</h1>
            <p>MAIDOL 사용자는 자기 AI 아티스트에게 옷을 입혀 곡 커버와 뮤직비디오를 만듭니다. 브랜드 상품이 그 착장 목록에 들어가고, 곡과 함께 퍼집니다.</p>
            <div className="row">
              <button className="btn btn--primary btn--lg" onClick={goContact}>입점·광고 문의하기</button>
              <Link className="btn btn--lg" to={isAuthed ? '/dashboard' : '/login'}>광고주 로그인</Link>
            </div>
          </div>
          <div className="hero__visual" aria-hidden="true">
            {/* 화면 배율별로 미리 줄인 사진 — 브라우저가 3배 넘게 줄이면 사진 속 작은 글자가 뭉개졌다(v3.381) */}
            <div className="hero__phone">
              <img
                src="./img/shot-player-520.jpg"
                srcSet="./img/shot-player-260.jpg 260w, ./img/shot-player-520.jpg 520w, ./img/shot-player.jpg 780w"
                sizes="(max-width: 820px) 200px, 290px"
                width="290"
                height="628"
                alt=""
              />
            </div>
            <span className="hero__chip">곡 화면 · 착장</span>
          </div>
        </div>
      </section>

      <section className="lsec">
        <div className="container">
          <h2>어떻게 노출되나요</h2>
          <div className="cards3">
            {HOW.map((h) => (
              <div className="card how" key={h.n}>
                <div className="how__n">{h.n}</div>
                <b>{h.t}</b>
                <span>{h.d}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lsec">
        <div className="container">
          <h2>광고주 전용 화면에서 할 수 있는 일</h2>
          <div className="steps">
            {CAN.map(([n, t]) => <span className="step" key={n}><b>{n}</b>{t}</span>)}
          </div>
          <p className="lsec__note">성과에는 만 14세 미만 사용자의 행동을 넣지 않고, 인원이 적은 묶음은 개인을 알아볼 수 없게 합쳐서 보여 드립니다.</p>
        </div>
      </section>

      <section className="lsec" id="contact">
        <div className="container">
          <h2>입점·광고 문의</h2>
          <p className="lsec__sub">남겨 주시면 MAIDOL 담당자가 이메일로 연락드립니다. 광고주 계정도 이 문의를 통해 만들어 드려요.</p>
          <form className="iform" onSubmit={submit} noValidate>
            <label>회사(브랜드)명 *<input className="input" value={f.company} onChange={set('company')} maxLength={100} autoComplete="organization" /></label>
            <label>담당자 이름 *<input className="input" value={f.contact_name} onChange={set('contact_name')} maxLength={50} autoComplete="name" /></label>
            <label>연락받을 이메일 *<input className="input" type="email" value={f.email} onChange={set('email')} maxLength={120} autoComplete="email" /></label>
            <label>연락처 (선택)<input className="input" value={f.phone} onChange={set('phone')} maxLength={40} autoComplete="tel" /></label>
            <label className="full">판매 채널 주소 (선택)<input className="input" value={f.channel_url} onChange={set('channel_url')} maxLength={300} placeholder="예: 자사몰, 무신사 브랜드관 주소" /></label>
            <label className="full">문의 내용 *<textarea className="input" rows={5} value={f.message} onChange={set('message')} maxLength={2000} placeholder="브랜드 소개, 노출하고 싶은 상품 종류 등을 적어 주세요." /></label>
            <input className="hp" tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} aria-hidden="true" />
            <div className="full iform__foot">
              <label className="check">
                <input type="checkbox" checked={f.agree} onChange={set('agree')} />
                <span>개인정보 수집·이용에 동의합니다. <small>(수집 항목: 회사명·담당자 이름·이메일·연락처 / 목적: 문의 답변 / 보관: 1년 후 삭제)</small></span>
              </label>
              <button className="btn btn--primary" type="submit" disabled={sending}>{sending ? '보내는 중…' : '문의 보내기'}</button>
            </div>
          </form>
        </div>
      </section>

      <footer className="lfoot">
        <div className="container lfoot__in">
          <span>© 로터스에이아이 · MAIDOL (MY AI IDOL)</span>
          <span><a href="https://maidol.ai.kr" target="_blank" rel="noreferrer">maidol.ai.kr</a></span>
        </div>
      </footer>
    </div>
  );
}
