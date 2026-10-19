// 가벼운 SVG 차트(라이브러리 없이) — 착장 선택은 막대, 클릭은 선. 각자 축 기준을 따로 잡는다
// (클릭이 착장 선택보다 훨씬 작아 한 축에 그리면 선이 바닥에 붙기 때문).
const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');

export function TrendChart({ data = [] }) {
  const W = 640; const H = 180; const PADL = 8; const PADR = 8; const PADT = 14; const PADB = 26;
  const n = data.length;
  if (!n) return <div className="empty">아직 기록이 없어요.</div>;
  const maxI = Math.max(1, ...data.map((d) => d.impressions));
  const maxC = Math.max(1, ...data.map((d) => d.clicks));
  const innerW = W - PADL - PADR; const innerH = H - PADT - PADB;
  const step = innerW / n;
  const bw = Math.max(3, Math.min(28, step * 0.55));
  const x = (i) => PADL + step * i + step / 2;
  const yI = (v) => PADT + innerH - (v / maxI) * innerH;
  const yC = (v) => PADT + innerH - (v / maxC) * innerH;
  const pts = data.map((d, i) => `${x(i)},${yC(d.clicks)}`).join(' ');
  const labelEvery = n > 10 ? Math.ceil(n / 6) : 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="기간별 착장 선택과 클릭 추이">
      <defs>
        <linearGradient id="barg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#6d28d9" stopOpacity=".55" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={PADL} x2={W - PADR} y1={PADT + innerH * (1 - f)} y2={PADT + innerH * (1 - f)} className="chart__grid" />
      ))}
      {data.map((d, i) => (
        <g key={d.label}>
          <rect x={x(i) - bw / 2} y={yI(d.impressions)} width={bw} height={Math.max(0, PADT + innerH - yI(d.impressions))} rx="3" fill="url(#barg)">
            <title>{`${d.label} · 착장 선택 ${fmt(d.impressions)} · 클릭 ${fmt(d.clicks)}`}</title>
          </rect>
          {i % labelEvery === 0 && <text x={x(i)} y={H - 8} textAnchor="middle" className="chart__label">{d.label}</text>}
        </g>
      ))}
      <polyline points={pts} fill="none" stroke="#fbbf24" strokeWidth="2.5" strokeLinejoin="round" />
      {data.map((d, i) => (
        <circle key={`c${d.label}`} cx={x(i)} cy={yC(d.clicks)} r="3" fill="#fbbf24">
          <title>{`${d.label} · 클릭 ${fmt(d.clicks)}`}</title>
        </circle>
      ))}
    </svg>
  );
}

export function HBars({ rows = [], valueKey = 'count', labelKey = 'key', empty = '아직 기록이 없어요.', format = fmt }) {
  if (!rows.length) return <div className="empty">{empty}</div>;
  const max = Math.max(1, ...rows.map((r) => r[valueKey] || 0));
  return (
    <div className="hbars">
      {rows.map((r) => (
        <div className="hbar" key={r[labelKey]}>
          <span className="hbar__label" title={r[labelKey]}>{r[labelKey]}</span>
          <span className="hbar__track"><i style={{ width: `${((r[valueKey] || 0) / max) * 100}%` }} /></span>
          <em>{format(r[valueKey])}</em>
        </div>
      ))}
    </div>
  );
}

export function ColBars({ values = [], tips = [], axis = [], ariaLabel }) {
  const max = Math.max(1, ...values);
  return (
    <div className="cols" role="img" aria-label={ariaLabel}>
      <div className="cols__bars">
        {values.map((v, i) => (
          <i key={i} style={{ height: `${Math.max(2, (v / max) * 100)}%` }} title={`${tips[i] ?? ''} · ${fmt(v)}`} className={v ? '' : 'is-zero'} />
        ))}
      </div>
      <div className="cols__axis">
        {axis.map((l, i) => <span key={i}>{l}</span>)}
      </div>
    </div>
  );
}

export { fmt };
