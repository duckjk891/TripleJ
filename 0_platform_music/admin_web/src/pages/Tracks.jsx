import { useState, useEffect, useCallback } from 'react';
import { getTracks, deleteTrack, updateTrackVisibility } from '../api';
import { formatDate } from './Dashboard';
import { appAlert, appConfirm, appPrompt } from '../components/dialog';

export default function TracksPage() {
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [visibility, setVisibility] = useState('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { search, page, limit: 20 };
      if (visibility !== 'all') params.is_public = visibility === 'public';
      const res = await getTracks(params);
      setTracks(res.data.tracks || []);
      setTotalPages(res.data.pagination?.totalPages || 1);
    } catch {
      setError('트랙 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [search, page, visibility]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const handleToggle = async (t) => {
    try {
      await updateTrackVisibility(t.id, !t.is_public);
      fetchList();
    } catch (err) {
      await appAlert(err.response?.data?.error || '공개 설정 변경에 실패했습니다.');
    }
  };

  const handleDelete = async (t) => {
    if (!(await appConfirm(`"${t.title}" 트랙을 삭제하시겠습니까?\n음원·데이터가 삭제되며 되돌릴 수 없습니다.`))) return;
    try {
      await deleteTrack(t.id);
      fetchList();
    } catch (err) {
      await appAlert(err.response?.data?.error || '트랙 삭제에 실패했습니다.');
    }
  };

  return (
    <div>
      <h2 className="page-title">곡 관리</h2>

      <div className="filters">
        <form className="search-form" onSubmit={(e) => { e.preventDefault(); setPage(1); fetchList(); }}>
          <input
            className="input" type="text" placeholder="제목·업로더 검색"
            value={search} onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn" type="submit">검색</button>
        </form>
        <div className="filter-group">
          {[['all', '전체'], ['public', '공개'], ['private', '비공개']].map(([v, l]) => (
            <button key={v} className={`filter-btn ${visibility === v ? 'active' : ''}`}
              onClick={() => { setVisibility(v); setPage(1); }}>{l}</button>
          ))}
        </div>
      </div>

      {error && <p className="error-msg">{error}</p>}
      {loading ? <p className="loading">로딩 중…</p> : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>제목</th><th>업로더</th><th>장르</th><th>재생수</th><th>공개</th><th>등록일</th><th>액션</th></tr>
              </thead>
              <tbody>
                {tracks.map((t) => (
                  <tr key={t.id}>
                    <td className="cell-main">
                      {t.title}
                      {t.report_blinded && <span className="badge badge--red" style={{ marginLeft: 6 }}>신고 블라인드</span>}
                    </td>
                    <td>{t.uploader_nickname || '-'}</td>
                    <td>{Array.isArray(t.genre) ? t.genre.join(', ') : (t.genre || '-')}</td>
                    <td>{(t.play_count ?? 0).toLocaleString()}</td>
                    <td>
                      <span className={`badge ${t.is_public ? 'badge--green' : 'badge--gray'}`}>
                        {t.is_public ? '공개' : '비공개'}
                      </span>
                    </td>
                    <td className="nowrap">{formatDate(t.created_at)}</td>
                    <td>
                      <div className="actions">
                        <button className="btn btn--sm" onClick={() => handleToggle(t)}>
                          {t.is_public ? '비공개로' : '공개로'}
                        </button>
                        <button className="btn btn--sm btn--danger" onClick={() => handleDelete(t)}>삭제</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {tracks.length === 0 && <tr><td colSpan={7} className="td-empty">트랙이 없습니다</td></tr>}
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
