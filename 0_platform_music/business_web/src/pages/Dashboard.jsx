import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getDashboard, getBrandInsights, friendlyError, CATEGORIES } from '../api';
import PeriodTabs from '../components/PeriodTabs';
import ItemImage from '../components/ItemImage';
import { TrendChart, HBars, fmt } from '../components/Charts';
import Icon from '../components/Icons';

const PERIOD_TEXT = { daily: '오늘', weekly: '최근 7일', monthly: '최근 30일' };
const SHOW_STEP = 20;

export default function Dashboard() {
  const [period, setPeriod] = useState('weekly');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(SHOW_STEP);
  const [itemCat, setItemCat] = useState(''); // 상품별 성과 부위 필터(10-20 피드백) — 표만 거른다(위 합계는 전체)

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    getDashboard(period)
      .then((res) => { if (alive) { setData({ ...res.data, _period: period }); setShow(SHOW_STEP); } })
      .catch((err) => { if (alive) setError(friendlyError(err, '성과를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period]);

  const allItems = data?.items || [];
  const items = itemCat ? allItems.filter((it) => it.category === itemCat) : allItems;
  const itemTotal = data?.item_total ?? allItems.length;
  const catCount = (c) => allItems.filter((it) => it.category === c).length;
  // '오늘'일 때 어제와 비교(추이 그래프의 마지막 두 날)
  const chart = data?.chart_data || [];
  // 기간을 바꾼 직후 새 데이터가 오기 전에는 비교하지 않는다(이전 기간 숫자로 잘못된 % 가 잠깐 보였다)
  const isDaily = data?._period === 'daily';
  const yesterday = isDaily && chart.length >= 2 ? chart[chart.length - 2] : null;
  const vsYesterday = (today, prev) => {
    if (!yesterday) return undefined;
    if (!prev) return today ? '어제 0' : '어제와 같아요';
    const d = Math.round(((today - prev) / prev) * 100);
    return `어제 ${fmt(prev)} · ${d > 0 ? `+${d}` : d}%`;
  };

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
        <Kpi label="착장 선택" value={fmt(data?.total_impressions)} sub={vsYesterday(data?.total_impressions, yesterday?.impressions)} hint="사용자가 착장 목록에서 이 상품을 골라 입혀 본 횟수(같은 사람은 6시간에 1번만 셉니다)." />
        <Kpi label="상품 페이지 클릭" value={fmt(data?.total_clicks)} sub={vsYesterday(data?.total_clicks, yesterday?.clicks)} hint="곡 화면 등에서 착장을 눌러 상품 페이지로 이동한 횟수." />
        <Kpi label="클릭률" value={`${Number(data?.ctr || 0).toFixed(1)}%`} hint="클릭 ÷ 착장 선택." />
        <Kpi label="담김" value={fmt(data?.total_wishes)} sub="지금 담겨 있는 수" hint="사용자가 '담기'로 저장해 둔 수(기간과 관계없이 현재 기준)." />
      </div>

      <section className="panel">
        <div className="panel__head">
          <h2>{period === 'monthly' ? '최근 30일' : '최근 7일'} 추이{isDaily && <span className="muted small"> · 노란 막대가 오늘</span>}</h2>
          <div className="legend"><span><i className="lg-bar" />착장 선택</span><span><i className="lg-line" />클릭</span></div>
        </div>
        {loading && !data ? <div className="skeleton" style={{ height: 180 }} /> : <TrendChart data={chart} highlightLast={isDaily} />}
      </section>

      <BrandInsights period={period} />

      <section className="panel">
        <div className="panel__head">
          <h2>상품별 성과</h2>
          <span className="muted small">클릭 많은 순 · 상품을 누르면 자세히 볼 수 있어요{itemTotal > allItems.length ? ` · 상위 ${allItems.length.toLocaleString()}개` : ''}</span>
        </div>
        {allItems.length > 0 && (
          <div className="chips chips--filter" role="group" aria-label="상품별 성과 부위">
            {['', ...CATEGORIES].map((c) => {
              const n = c ? catCount(c) : allItems.length;
              if (c && !n) return null;
              return <button key={c || 'all'} className={`chip chip--sm ${itemCat === c ? 'is-on' : ''}`} onClick={() => { setItemCat(c); setShow(SHOW_STEP); }}>{c || '전체'} <span className="chip__n">{n.toLocaleString()}</span></button>;
            })}
          </div>
        )}
        {loading && !data ? (
          <div className="skeleton" style={{ height: 220 }} />
        ) : allItems.length > 0 && items.length === 0 ? (
          <div className="empty">이 부위에는 상품이 없어요.</div>
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
      <span>{label}{hint && <i className="kpi__i" aria-label={hint}><Icon name="info" size={13} /></i>}</span>
      <b>{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  );
}

// v3.381 — 내 상품 전체에 반응한 사용자(성별·연령대), 내 옷을 입힌 아티스트, 세부 종류별 성과
function BrandInsights({ period }) {
  const [cat, setCat] = useState('');
  const [ins, setIns] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);
    getBrandInsights(period, cat)
      .then((r) => { if (alive) setIns(r.data); })
      .catch(() => { if (alive) setFailed(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period, cat]);

  const genders = ins?.genders || [];
  const ages = (ins?.age_bands || []).slice().sort((a, b) => a.key.localeCompare(b.key, 'ko', { numeric: true }));
  const gTotal = genders.reduce((s, g) => s + g.count, 0);
  const pct = (k) => {
    const g = genders.find((x) => x.key === k);
    return gTotal && g ? Math.round((g.count / gTotal) * 100) : 0;
  };
  const stars = ins?.stars || [];
  const subs = (ins?.subs || []).filter((r) => r.items > 0);

  return (
    <>
      <div className="seg-row">
        <h2 className="seg-row__title">내 브랜드에 반응한 사람들</h2>
        <div className="chips" role="group" aria-label="카테고리">
          {['', ...CATEGORIES].map((c) => (
            <button key={c || 'all'} className={`chip chip--sm ${cat === c ? 'is-on' : ''}`} onClick={() => setCat(c)}>{c || '전체'}</button>
          ))}
        </div>
      </div>
      {failed && <div className="notice notice--err">반응 분석을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</div>}
      <div className={`grid2 grid2--panels ${loading ? 'is-loading' : ''}`}>
        <section className="panel">
          <div className="panel__head">
            <h2>성별·연령대</h2>
            <span className="muted small">착장 선택·클릭·담기를 한 사람 {fmt(ins?.reacted_users)}명</span>
          </div>
          {loading && !ins ? <div className="skeleton" style={{ height: 160 }} /> : gTotal === 0 ? (
            <div className="empty">아직 반응한 사람이 없어요.</div>
          ) : (
            <>
              <div className="ratio" aria-label={`여성 ${pct('여성')}%, 남성 ${pct('남성')}%`}>
                <i className="ratio__f" style={{ width: `${pct('여성')}%` }} />
                <i className="ratio__m" style={{ width: `${pct('남성')}%` }} />
              </div>
              <div className="ratio__legend">
                <span><i className="ratio__f" />여성 {pct('여성')}%</span>
                <span><i className="ratio__m" />남성 {pct('남성')}%</span>
                {genders.filter((g) => g.key !== '여성' && g.key !== '남성').map((g) => <span key={g.key}><i />{g.key} {Math.round((g.count / gTotal) * 100)}%</span>)}
              </div>
              <h3 style={{ marginTop: 14 }}>연령대</h3>
              <HBars rows={ages} labelKey="key" />
            </>
          )}
        </section>
        <section className="panel">
          <div className="panel__head">
            <h2>내 옷을 입힌 아티스트</h2>
            <span className="muted small" title="입힌 곡은 공개된 곡을 기간과 관계없이 모두 센 수예요. 클릭·담김은 고른 기간 동안 그 아티스트 곡에서 나온 수예요.">{cat ? `${cat} 상품만` : '전체 상품'} · 입힌 곡은 누적</span>
          </div>
          {loading && !ins ? <div className="skeleton" style={{ height: 160 }} /> : stars.length === 0 ? (
            <div className="empty">아직 내 옷을 입힌 공개 곡이 없어요.</div>
          ) : (
            <div className="table-wrap">
              <table className="tbl tbl--stars">
                <thead><tr><th>아티스트</th><th className="num">입힌 곡</th><th className="num">클릭</th><th className="num">담김</th><th className="num hide-sm">팔로워</th></tr></thead>
                <tbody>
                  {stars.slice(0, 10).map((s, i) => (
                    <tr key={`${s.nickname}-${i}`}>
                      <td>
                        <span className="cell-star"><b>{s.nickname}</b>{s.items?.length > 0 && <small title={s.items.join(', ')}>{s.items.join(' · ')}</small>}</span>
                      </td>
                      <td className="num">{fmt(s.worn_count)}</td>
                      <td className="num">{fmt(s.click_count)}</td>
                      <td className="num">{fmt(s.wish_count)}</td>
                      <td className="num hide-sm">{fmt(s.follower_count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      <section className={`panel ${loading ? 'is-loading' : ''}`}>
        <div className="panel__head">
          <h2>옷 종류별 성과{cat ? <span className="muted small"> · {cat}</span> : null}</h2>
        </div>
        <p className="panel__desc">내 상품을 니트·스니커즈처럼 <b>옷 종류</b>로 묶어서, 어떤 종류가 사용자에게 많이 선택되고 클릭됐는지 보여 줘요. 종류는 상품 이름을 보고 MAIDOL이 자동으로 나눠요(앱 착장 목록의 세부 종류와 같아요).</p>
        {subs.length > 0 && subs[0].clicks + subs[0].impressions > 0 && (
          <p className="panel__best">가장 반응이 좋은 종류: <b>{subs[0].category} · {subs[0].sub}</b> — 상품 {fmt(subs[0].items)}개, 착장 선택 {fmt(subs[0].impressions)}번, 클릭 {fmt(subs[0].clicks)}번</p>
        )}
        {loading && !ins ? <div className="skeleton" style={{ height: 140 }} /> : subs.length === 0 ? (
          <div className="empty">아직 등록한 상품이 없어요.</div>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>옷 종류</th><th className="num" title="이 종류에 들어가는 내 상품 수">상품 수</th><th className="num" title="사용자가 이 종류 상품을 골라 입혀 본 횟수">착장 선택</th><th className="num" title="상품 페이지로 이동한 횟수">클릭</th><th className="num" title="클릭 ÷ 착장 선택">클릭률</th><th className="num" title="'담기'로 저장한 횟수(고른 기간)">담기</th></tr></thead>
              <tbody>
                {subs.slice(0, 20).map((r) => (
                  <tr key={`${r.category}-${r.sub}`}>
                    <td><span className="muted">{r.category} · </span>{r.sub}</td>
                    <td className="num">{fmt(r.items)}</td>
                    <td className="num">{fmt(r.impressions)}</td>
                    <td className="num">{fmt(r.clicks)}</td>
                    <td className="num">{r.impressions ? ((r.clicks / r.impressions) * 100).toFixed(1) : '0.0'}%</td>
                    <td className="num">{fmt(r.wishes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
