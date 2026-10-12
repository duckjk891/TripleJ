import { useState, useEffect, useCallback } from 'react';
import {
  getAgeRatingSummary, getAgeRatingItems, getAgeRatingItem, setAgeRating, reclassifyAgeRating,
} from '../api';
import { formatDate } from './Dashboard';
import { appAlert, appConfirm, appPrompt } from '../components/dialog';
import AuthImage from '../components/AuthImage';

// age1 — 곡·앨범 연령 등급(전체·12·15·19). 19 = 공개 차단(만든 사람만 봄). 미분류 = 15 로 간주.
const RATING_LABEL = { all: '전체', 12: '12세', 15: '15세', 19: '19세' };
const RATING_BADGE = { all: 'badge--green', 12: 'badge--purple', 15: 'badge--amber', 19: 'badge--red' };
const CATEGORY_LABEL = {
  profanity: '욕설', sexual: '성적', violence: '폭력', substances: '음주·흡연·약물',
  hate: '혐오', self_harm: '자해', admin: '관리자',
};
const FILTERS = [
  ['', '전체'], ['unrated', '미분류'], ['all', '전체이용가'], ['12', '12세'], ['15', '15세'],
  ['19', '19세'], ['blocked', '공개 차단'], ['failed', '분류 실패'],
];

function RatingBadge({ rating }) {
  if (!rating) return <span className="badge badge--gray">미분류(15)</span>;
  return <span className={`badge ${RATING_BADGE[rating] || 'badge--gray'}`}>{RATING_LABEL[rating] || rating}</span>;
}

export default function AgeRatingsPage() {
  const [summary, setSummary] = useState(null);
  const [kind, setKind] = useState('tracks');
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const loadSummary = useCallback(async () => {
    try {
      const res = await getAgeRatingSummary();
      setSummary(res.data);
    } catch {
      setSummary(null);
    }
  }, []);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { kind, page, limit: 30 };
      if (filter) params.rating = filter;
      if (search) params.q = search;
      const res = await getAgeRatingItems(params);
      setItems(res.data.items || []);
      setTotalPages(res.data.pagination?.totalPages || 1);
    } catch {
      setError('목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [kind, filter, search, page]);

  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { loadItems(); }, [loadItems]);

  const replaceItem = (it) => setItems((prev) => prev.map((x) => (x.id === it.id ? it : x)));

  const handleSet = async (it, rating) => {
    if (rating === (it.age_rating || '')) return;
    const warn19 = rating === '19'
      ? '\n19세로 바꾸면 이 곡은 공개가 차단되고 만든 사람만 볼 수 있어요.'
      : (it.age_blocked ? '\n공개 차단이 풀리고, 원래 공개였던 곡이면 다시 공개돼요.' : '');
    if (!(await appConfirm(`"${it.title}" 등급을 ${RATING_LABEL[rating]}(으)로 바꿀까요?${warn19}`))) return;
    const note = await appPrompt('수정 사유(관리 기록에 남아요, 생략 가능)', '예: 오분류 — 가사 확인');
    if (note === null) return;
    setBusy(it.id);
    try {
      const res = await setAgeRating(kind, it.id, rating, note || '');
      replaceItem(res.data.item);
      loadSummary();
    } catch (err) {
      await appAlert(err.response?.data?.error || '등급 수정에 실패했습니다.');
    } finally {
      setBusy('');
    }
  };

  const handleReclassify = async (it) => {
    if (!(await appConfirm(`"${it.title}"을(를) AI로 다시 분류할까요?`))) return;
    setBusy(it.id);
    try {
      const res = await reclassifyAgeRating(kind, it.id);
      replaceItem(res.data.item);
      loadSummary();
    } catch (err) {
      if (err.response?.data?.item) replaceItem(err.response.data.item);
      await appAlert(err.response?.data?.error || '재분류에 실패했습니다.');
    } finally {
      setBusy('');
    }
  };

  const handleLyrics = async (it) => {
    try {
      const res = await getAgeRatingItem(kind, it.id);
      const ly = res.data.item?.lyrics;
      await appAlert(`${it.title}\n\n${ly || '(가사 없음)'}`);
    } catch {
      await appAlert('가사를 불러오지 못했습니다.');
    }
  };

  const sw = summary?.switches;
  const dist = summary?.[kind];

  return (
    <div>
      <h2 className="page-title">연령 등급</h2>

      {sw && (
        <div className="card">
          <div className="kv">
            <span>분류</span>
            <span>
              {sw.classify_enabled ? <span className="badge badge--green">진행 중</span> : <span className="badge badge--gray">꺼짐</span>}
              {' '}시작 {sw.classify_from ? formatDate(sw.classify_from) : '미정'} · 모델 {sw.model}
            </span>
            <span>노출 제한</span>
            <span>
              {sw.filter_enabled ? <span className="badge badge--green">켜짐</span> : <span className="badge badge--gray">꺼짐</span>}
              {' '}어린이 = 전체이용가만 · 그 외 = 15세 이하 · 19세 = 공개 차단
              {sw.adult19_visible && ' · 본인확인 성인 19 공개'}
            </span>
          </div>
        </div>
      )}

      {dist && (
        <div className="stats-grid">
          {[['all', '전체이용가'], ['12', '12세'], ['15', '15세'], ['19', '19세'], ['unrated', '미분류']].map(([k, l]) => (
            <div key={k} className="stat-card stat-card--link" onClick={() => { setFilter(k); setPage(1); }}>
              <div className="stat-label">{l}</div>
              <div className={`stat-value ${k === '19' && dist.by_rating[k] ? 'warn' : ''}`}>{dist.by_rating[k] ?? 0}</div>
            </div>
          ))}
          <div className="stat-card stat-card--link" onClick={() => { setFilter('failed'); setPage(1); }}>
            <div className="stat-label">분류 실패</div>
            <div className={`stat-value ${dist.failed ? 'warn' : ''}`}>{dist.failed}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">관리자 수정</div>
            <div className="stat-value">{dist.admin_set}</div>
          </div>
        </div>
      )}

      <div className="filters">
        <div className="filter-group">
          {[['tracks', '곡'], ['albums', '앨범']].map(([v, l]) => (
            <button key={v} className={`filter-btn ${kind === v ? 'active' : ''}`}
              onClick={() => { setKind(v); setPage(1); }}>{l}</button>
          ))}
        </div>
        <form className="search-form" onSubmit={(e) => { e.preventDefault(); setPage(1); loadItems(); }}>
          <input className="input" type="text" placeholder="제목·만든 사람 검색"
            value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="btn" type="submit">검색</button>
        </form>
        <div className="filter-group">
          {FILTERS.map(([v, l]) => (
            <button key={v || 'any'} className={`filter-btn ${filter === v ? 'active' : ''}`}
              onClick={() => { setFilter(v); setPage(1); }}>{l}</button>
          ))}
        </div>
      </div>

      {error && <p className="error-msg">{error}</p>}
      {loading ? <p className="loading">로딩 중…</p> : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>커버</th><th>제목</th><th>만든 사람</th><th>등급</th><th>근거</th><th>상태</th><th>분류</th><th>등급 수정</th></tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td><AuthImage objectName={it.cover_object} /></td>
                    <td className="cell-main" style={{ minWidth: 140 }}>{it.title}</td>
                    <td>{it.owner_nickname || '-'}</td>
                    <td><RatingBadge rating={it.age_rating} /></td>
                    <td style={{ maxWidth: 280 }}>
                      {(it.reasons || []).length === 0 ? <span className="cell-sub">-</span> : (it.reasons || []).map((r, i) => (
                        <div key={i} style={{ fontSize: '0.82rem' }}>
                          <b>{CATEGORY_LABEL[r.category] || r.category}</b> {r.note}
                        </div>
                      ))}
                      {it.error && <div className="error-msg" style={{ fontSize: '0.8rem' }}>실패 {it.attempts}회: {it.error}</div>}
                    </td>
                    <td className="nowrap">
                      {it.age_blocked
                        ? <span className="badge badge--red">공개 차단</span>
                        : <span className={`badge ${it.is_public ? 'badge--green' : 'badge--gray'}`}>{it.is_public ? '공개' : '비공개'}</span>}
                      {it.report_blinded && <span className="badge badge--red" style={{ marginLeft: 4 }}>신고 블라인드</span>}
                    </td>
                    <td className="nowrap" style={{ fontSize: '0.8rem' }}>
                      {it.source === 'admin' ? '관리자' : it.source === 'ai' ? 'AI' : '-'}
                      {it.rated_at && <div className="cell-sub">{formatDate(it.rated_at)}</div>}
                    </td>
                    <td>
                      <div className="actions" style={{ flexWrap: 'nowrap' }}>
                        <select className="select" disabled={busy === it.id} value={it.age_rating || ''}
                          onChange={(e) => handleSet(it, e.target.value)}>
                          <option value="" disabled>선택</option>
                          {['all', '12', '15', '19'].map((v) => <option key={v} value={v}>{RATING_LABEL[v]}</option>)}
                        </select>
                        {kind === 'tracks' && <button className="btn btn--sm" onClick={() => handleLyrics(it)}>가사</button>}
                        <button className="btn btn--sm" disabled={busy === it.id || !sw?.classify_enabled}
                          title={sw?.classify_enabled ? '' : '분류 시작일 이후 사용 가능'}
                          onClick={() => handleReclassify(it)}>재분류</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && <tr><td colSpan={8} className="td-empty">항목이 없습니다</td></tr>}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button className="btn btn--sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>이전</button>
              <span className="pagination__info">{page} / {totalPages}</span>
              <button className="btn btn--sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>다음</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
