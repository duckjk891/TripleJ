import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getDashboard, friendlyError } from '../api';
import PeriodTabs from '../components/PeriodTabs';
import ItemImage from '../components/ItemImage';
import { TrendChart, fmt } from '../components/Charts';

const PERIOD_TEXT = { daily: '오늘', weekly: '최근 7일', monthly: '최근 30일' };
const SHOW_STEP = 20;

export default function Dashboard() {
  const [period, setPeriod] = useState('weekly');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(SHOW_STEP);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    getDashboard(period)
      .then((res) => { if (alive) { setData(res.data); setShow(SHOW_STEP); } })
      .catch((err) => { if (alive) setError(friendlyError(err, '성과를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period]);

  const items = data?.items || [];
  const itemTotal = data?.item_total ?? items.length;

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1>대시보드</h1>
          <p className="muted">{PERIOD_TEXT[period]} 동안의 성과예요. 한국 시간 기준, 오늘 포함.</p>
        </div>
        <PeriodTabs value={period} onChange={setPeriod} />
      </div>

      {error && <div className="notice notice--err">{error}</div>}

      <div className={`kpis ${loading ? 'is-loading' : ''}`}>
        <Kpi label="착장 선택" value={fmt(data?.total_impressions)} hint="사용자가 착장 목록에서 이 상품을 골라 입혀 본 횟수(같은 사람은 6시간에 1번만 셉니다)." />
        <Kpi label="상품 페이지 클릭" value={fmt(data?.total_clicks)} hint="곡 화면 등에서 착장을 눌러 상품 페이지로 이동한 횟수." />
        <Kpi label="클릭률" value={`${Number(data?.ctr || 0).toFixed(1)}%`} hint="클릭 ÷ 착장 선택." />
        <Kpi label="담김" value={fmt(data?.total_wishes)} sub="지금 담겨 있는 수" hint="사용자가 '담기'로 저장해 둔 수(기간과 관계없이 현재 기준)." />
      </div>

      <section className="panel">
        <div className="panel__head">
          <h2>{period === 'monthly' ? '최근 30일' : '최근 7일'} 추이</h2>
          <div className="legend"><span><i className="lg-bar" />착장 선택</span><span><i className="lg-line" />클릭</span></div>
        </div>
        {loading && !data ? <div className="skeleton" style={{ height: 180 }} /> : <TrendChart data={data?.chart_data || []} />}
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2>상품별 성과</h2>
          <span className="muted small">클릭 많은 순 · 상품을 누르면 자세히 볼 수 있어요{itemTotal > items.length ? ` · 상위 ${items.length.toLocaleString()}개` : ''}</span>
        </div>
        {loading && !data ? (
          <div className="skeleton" style={{ height: 220 }} />
        ) : items.length === 0 ? (
          <div className="empty">
            아직 등록한 상품이 없어요.<br />
            <Link className="btn btn--primary btn--sm" to="/items?new=1" style={{ marginTop: 12 }}>첫 상품 등록하기</Link>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>상품</th>
                  <th className="num">착장 선택</th>
                  <th className="num">클릭</th>
                  <th className="num">클릭률</th>
                  <th className="num">담김</th>
                  <th className="num" title="이 상품을 입은 아티스트가 나온 공개 곡 수(기간과 관계없이 누적)">착용 곡</th>
                </tr>
              </thead>
              <tbody>
                {items.slice(0, show).map((it) => (
                  <tr key={it.item_id}>
                    <td>
                      <Link className="cell-item" to={`/items/${it.item_id}`}>
                        <ItemImage obj={it.image_object_name} className="thumb" />
                        <span>
                          <b>{it.name || '이름 없음'}</b>
                          <small>
                            {it.category}
                            {it.admin_hidden ? ' · 운영 정책으로 숨김' : it.is_active === false ? ' · 숨김' : ''}
                          </small>
                        </span>
                      </Link>
                    </td>
                    <td className="num">{fmt(it.impressions)}</td>
                    <td className="num">{fmt(it.clicks)}</td>
                    <td className="num">{Number(it.ctr || 0).toFixed(1)}%</td>
                    <td className="num">{fmt(it.wish_count)}</td>
                    <td className="num">{fmt(it.worn_count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {items.length > show && (
              <button className="btn btn--block btn--ghost" onClick={() => setShow((s) => s + SHOW_STEP)}>더 보기 ({(items.length - show).toLocaleString()}개 남음)</button>
            )}
          </div>
        )}
      </section>
      <p className="footnote">만 14세 미만 사용자의 행동은 성과에 넣지 않습니다. 착용 곡은 공개된 곡만 셉니다.</p>
    </div>
  );
}

function Kpi({ label, value, sub, hint }) {
  return (
    <div className="kpi" title={hint}>
      <span>{label}{hint && <i className="kpi__i" aria-label={hint}>ⓘ</i>}</span>
      <b>{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  );
}
