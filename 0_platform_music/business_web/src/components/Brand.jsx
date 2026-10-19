// MAIDOL Business 워드마크 — 랜딩(maidol.ai.kr)과 같은 표기: M·AI(보라)·DOL
export default function Brand({ small = false }) {
  return (
    <span className={`brand ${small ? 'brand--sm' : ''}`}>
      <img src="./img/maidol_symbol.png" alt="" aria-hidden="true" />
      <b>M<span className="ai">AI</span>DOL</b>
      <small>Business</small>
    </span>
  );
}
