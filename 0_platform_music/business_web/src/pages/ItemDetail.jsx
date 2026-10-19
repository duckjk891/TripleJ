import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getItem, getInsights, getStars, friendlyError } from '../api';
import PeriodTabs from '../components/PeriodTabs';
import ItemImage from '../components/ItemImage';
import ItemDialog from '../components/ItemDialog';
import { HBars, ColBars, fmt } from '../components/Charts';
import { toast } from '../components/dialog';

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];
const GENDER_KO = { male: '남성', female: '여성', other: '기타', 미입력: '미입력', '기타(소수)': '기타(소수)' };
const NAT_KO = { domestic: '내국인', foreign: '외국인', 미입력: '미입력', '기타(소수)': '기타(소수)' };
const KEY_KO = { 미귀속: '곡 밖(착장 화면 등)' };

export default function ItemDetail() {
  const { id } = useParams();
  const [period, setPeriod] = useState('weekly');
  const [item, setItem] = useState(null);
  const [ins, setIns] = useState(null);
  const [stars, setStars] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const loadItem = () =>
    getItem(id).then((r) => setItem(r.data)).catch((err) => setError(friendlyError(err, '상품을 찾을 수 없어요. 삭제된 상품일 수 있어요.')));

  useEffect(() => { loadItem(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.allSettled([getInsights(id, period), getStars(id, period)]).then(([a, b]) => {
      if (!alive) return;
      if (a.status === 'fulfilled') setIns(a.value.data);
      if (b.status === 'fulfilled') setStars(b.value.data);
      if (a.status === 'rejected' && b.status === 'rejected') setError(friendlyError(a.reason, '성과를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'));
      setLoading(false);
    });
    return () => { alive = false; };
  }, [id, period]);

  const w2c = ins?.wish_to_click;
  const starRows = stars?.stars || [];
  const wornSongs = starRows.reduce((s, r) => s + (r.worn_count || 0), 0);
  const genre = (ins?.by_genre || []).map((r) => ({ key: KEY_KO[r.key] || r.key, count: r.wishes + r.clicks })).slice(0, 8);
  const mood = (ins?.by_mood || []).map((r) => ({ key: KEY_KO[r.key] || r.key, count: r.wishes + r.clicks })).slice(0, 8);
  const hours = (ins?.by_hour || []).map((r) => r.count);
  const weekdays = (ins?.by_weekday || []).map((r) => r.count);
  const demo = ins?.demographics;
  const hasEvents = (w2c?.wishes || 0) + (w2c?.clicks || 0) > 0;

  return (
    <div className="page">
      <Link to="/items" className="back">← 내 상품</Link>
      <div className="page__head">
        <div className="detail-head">
          {item && <ItemImage obj={item.image_object_name} className="detail-head__img" />}
          <div>
            <h1>{item?.name || '상품'}</h1>
            {item && (
              <p className="muted">
                {[item.category, item.gender, item.brand].filter(Boolean).join(' · ')}
                {item.admin_hidden ? ' · 운영 정책으로 숨김' : item.is_active === false ? ' · 숨김' : ' · 노출 중'}
              </p>
            )}
            {item && (
              <div className="row" style={{ marginTop: 6 }}>
                <button className="btn btn--sm" onClick={() => setEditing(true)}>수정</button>
                {item.product_url && <a className="btn btn--sm btn--ghost" href={item.product_url} target="_blank" rel="noreferrer">상품 페이지 열기 ↗</a>}
              </div>
            )}
          </div>
        </div>
        <PeriodTabs value={period} onChange={setPeriod} />
      </div>

      {error && <div className="notice notice--err">{error}</div>}

      <div className={`kpis ${loading ? 'is-loading' : ''}`}>
        <div className="kpi" title="기간 안에 사용자가 이 상품을 '담기' 한 횟수"><span>담기</span><b>{fmt(w2c?.wishes)}</b></div>
        <div className="kpi" title="기간 안에 상품 페이지로 이동한 횟수"><span>상품 페이지 클릭</span><b>{fmt(w2c?.clicks)}</b></div>
        <div className="kpi" title="클릭 ÷ 담기"><span>담기 대비 클릭</span><b>{w2c?.rate == null ? '–' : `${Math.round(w2c.rate * 100)}%`}</b></div>
        <div className="kpi" title="이 상품을 입은 아티스트가 나온 공개 곡 수(누적)"><span>착용 곡</span><b>{fmt(wornSongs)}</b></div>
      </div>

      {!loading && !hasEvents && (
        <div className="notice">이 기간에는 아직 담기·클릭 기록이 없어요. 기간을 늘려 보거나, 상품이 노출되고 있는지 확인해 주세요.</div>
      )}

      <div className="grid2 grid2--panels">
        <section className="panel">
          <h2>어떤 장르 곡에서 반응했나</h2>
          <HBars rows={genre} />
        </section>
        <section className="panel">
          <h2>어떤 분위기 곡에서 반응했나</h2>
          <HBars rows={mood} />
        </section>
        <section className="panel">
          <h2>시간대별 반응 <span className="muted small">(한국 시간)</span></h2>
          <ColBars values={hours} tips={hours.map((_, h) => `${h}시`)} axis={['0시', '6시', '12시', '18시', '23시']} ariaLabel="시간대별 반응" />
        </section>
        <section className="panel">
          <h2>요일별 반응</h2>
          <ColBars values={weekdays} tips={WEEKDAYS} axis={WEEKDAYS} ariaLabel="요일별 반응" />
        </section>
        <section className="panel">
          <h2>반응한 사용자</h2>
          <div className="demo">
            <div><h3>연령대</h3><HBars rows={demo?.age_bands || []} labelKey="band" /></div>
            <div><h3>성별</h3><HBars rows={(demo?.genders || []).map((r) => ({ ...r, key: GENDER_KO[r.key] || r.key }))} /></div>
            <div><h3>지역</h3><HBars rows={(demo?.regions || []).slice(0, 6)} /></div>
            <div><h3>내·외국인</h3><HBars rows={(demo?.nationalities || []).map((r) => ({ ...r, key: NAT_KO[r.key] || r.key }))} /></div>
          </div>
          <p className="footnote">{demo?.min_bucket || 5}명 미만인 묶음은 개인을 알아볼 수 없게 '기타(소수)'로 합칩니다. 만 14세 미만 사용자는 넣지 않습니다.</p>
        </section>
        <section className="panel">
          <h2>이 상품을 입힌 아티스트</h2>
          {starRows.length === 0 ? (
            <div className="empty">아직 이 상품을 입은 공개 곡이 없어요.</div>
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>아티스트(채널)</th><th className="num">착용 곡</th><th className="num">담기</th><th className="num">클릭</th><th className="num">팔로워</th></tr></thead>
                <tbody>
                  {starRows.slice(0, 30).map((s) => (
                    <tr key={s.user_id}>
                      <td>{s.nickname || '이름 없음'}</td>
                      <td className="num">{fmt(s.worn_count)}</td>
                      <td className="num">{fmt(s.wish_count)}</td>
                      <td className="num">{fmt(s.click_count)}</td>
                      <td className="num">{fmt(s.follower_count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="footnote">공개된 채널 이름만 보여 드려요. 담기·클릭은 그 채널의 곡에서 일어난 수{stars?.untracked_clicks ? ` · 곡 밖 클릭 ${fmt(stars.untracked_clicks)}회` : ''}.</p>
        </section>
      </div>

      {editing && item && (
        <ItemDialog
          item={item}
          onClose={() => setEditing(false)}
          onSaved={(msg) => {
            setEditing(false);
            toast(msg);
            if (msg.includes('삭제')) window.location.hash = '#/items';
            else loadItem();
          }}
        />
      )}
    </div>
  );
}
