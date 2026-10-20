// 가벼운 SVG 차트(라이브러리 없이) — 착장 선택은 막대, 클릭은 선. 각자 축 기준을 따로 잡는다
// (클릭이 착장 선택보다 훨씬 작아 한 축에 그리면 선이 바닥에 붙기 때문).
const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');

// highlightLast: '오늘'을 고르면 마지막(오늘) 막대만 밝게, 나머지는 흐리게 — 7일 그래프 안에서 오늘이 어디인지 보이게(10-20 피드백).
export function TrendChart({ data = [], highlightLast = false }) {
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
  // 날짜 글자는 SVG 밖(HTML)에 둔다 — SVG 안 글자는 화면 폭에 따라 같이 줄어 휴대폰에서 5px 남짓으로 뭉개졌다(v3.381).
  return (
    <div className="trend">
      <svg viewBox={`0 0 ${W} ${H - PADB + 6}`} className="chart" role="img" aria-label="기간별 착장 선택과 클릭 추이" preserveAspectRatio="none">
        <defs>
          <linearGradient id="barg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#a78bfa" />
            <stop offset="1" stopColor="#6d28d9" stopOpacity=".55" />
          </linearGradient>
          <linearGradient id="barToday" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fde68a" />
            <stop offset="1" stopColor="#f59e0b" stopOpacity=".7" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={PADL} x2={W - PADR} y1={PADT + innerH * (1 - f)} y2={PADT + innerH * (1 - f)} className="chart__grid" vectorEffect="non-scaling-stroke" />
        ))}
        {data.map((d, i) => (
          <rect key={d.label} x={x(i) - bw / 2} y={yI(d.impressions)} width={bw} height={Math.max(0, PADT + innerH - yI(d.impressions))} rx="3" fill={highlightLast && i === n - 1 ? 'url(#barToday)' : 'url(#barg)'} opacity={highlightLast && i !== n - 1 ? 0.35 : 1}>
            <title>{`${d.label} · 착장 선택 ${fmt(d.impressions)} · 클릭 ${fmt(d.clicks)}`}</title>
          </rect>
        ))}
        <polyline points={pts} fill="none" stroke="#fbbf24" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* 점은 늘어나지 않게 HTML 로 — preserveAspectRatio=none 에서 SVG 원은 타원이 된다 */}
      <div className="trend__dots" aria-hidden="true">
        {data.map((d, i) => (
          <i key={d.label} title={`${d.label} · 클릭 ${fmt(d.clicks)}`} style={{ left: `${(x(i) / W) * 100}%`, top: `${(yC(d.clicks) / (H - PADB + 6)) * 100}%` }} />
        ))}
      </div>
      <div className="trend__axis" aria-hidden="true">
        {data.map((d, i) => {
          const today = highlightLast && i === n - 1;
          if (!today && i % labelEvery !== 0) return null;
          return <span key={d.label} className={today ? 'is-today' : ''} style={{ left: `${(x(i) / W) * 100}%` }}>{today ? `오늘 ${d.label}` : d.label}</span>;
        })}
      </div>
    </div>
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
