import { useState, useEffect, useCallback } from 'react';
import { FiSearch } from 'react-icons/fi';
import AdminLayout from '../../components/AdminLayout';
import { getAdminTracks, deleteAdminTrack, updateTrackVisibility } from '../../api';
import './AdminTracksPage.css';

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

export default function AdminTracksPage() {
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [visibility, setVisibility] = useState('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchTracks = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { search, page, limit: 20 };
      if (visibility !== 'all') {
        params.is_public = visibility === 'public';
      }
      const res = await getAdminTracks(params);
      setTracks(res.data.tracks || []);
      setTotalPages(res.data.pagination?.totalPages || 1);
    } catch {
      setError('트랙 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [search, page, visibility]);

  useEffect(() => {
    fetchTracks();
  }, [fetchTracks]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    fetchTracks();
  };

  const handleVisibilityToggle = async (track) => {
    const newVisibility = !track.is_public;
    try {
      await updateTrackVisibility(track.id, newVisibility);
      fetchTracks();
    } catch {
      alert('공개 설정 변경에 실패했습니다.');
    }
  };

  const handleDelete = async (track) => {
    const confirmed = window.confirm(
      `"${track.title}" 트랙을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`
    );
    if (!confirmed) return;
    try {
      await deleteAdminTrack(track.id);
      fetchTracks();
    } catch {
      alert('트랙 삭제에 실패했습니다.');
    }
  };

  return (
    <AdminLayout>
      <div className="admin-tracks">
        <h2 className="admin-page-title">트랙 관리</h2>

        <div className="admin-tracks__filters">
          <form className="admin-search-form" onSubmit={handleSearch}>
            <div className="admin-search-input-wrap">
              <FiSearch className="admin-search-icon" />
              <input
                type="text"
                placeholder="트랙 제목 검색..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="admin-search-input"
              />
            </div>
            <button type="submit" className="admin-search-btn">검색</button>
          </form>

          <div className="admin-tracks__visibility-filter">
            {[
              { value: 'all', label: '전체' },
              { value: 'public', label: '공개' },
              { value: 'private', label: '비공개' },
            ].map((opt) => (
              <button
                key={opt.value}
                className={`admin-filter-btn ${visibility === opt.value ? 'active' : ''}`}
                onClick={() => { setVisibility(opt.value); setPage(1); }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="admin-error">{error}</p>}

        {loading ? (
          <p className="admin-loading">로딩 중...</p>
        ) : (
          <>
            <div className="admin-table-wrap">
              <table className="admin-table admin-table--full">
                <thead>
                  <tr>
                    <th>제목</th>
                    <th>업로더</th>
                    <th>장르</th>
                    <th>재생수</th>
                    <th>공개</th>
                    <th>등록일</th>
                    <th>액션</th>
                  </tr>
                </thead>
                <tbody>
                  {tracks.map((t) => (
                    <tr key={t.id}>
                      <td className="admin-tracks__title-cell">{t.title}</td>
                      <td>{t.uploader_nickname || '-'}</td>
                      <td>{Array.isArray(t.genre) ? t.genre.join(', ') : (t.genre || '-')}</td>
                      <td>{(t.play_count ?? 0).toLocaleString()}</td>
                      <td>
                        <span className={`admin-badge ${t.is_public ? 'admin-badge--green' : 'admin-badge--gray'}`}>
                          {t.is_public ? '공개' : '비공개'}
                        </span>
                      </td>
                      <td>{formatDate(t.created_at)}</td>
                      <td className="admin-actions">
                        <button
                          className="admin-btn admin-btn--small"
                          onClick={() => handleVisibilityToggle(t)}
                        >
                          {t.is_public ? '비공개로' : '공개로'}
                        </button>
                        <button
                          className="admin-btn admin-btn--small admin-btn--danger"
                          onClick={() => handleDelete(t)}
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))}
                  {tracks.length === 0 && (
                    <tr><td colSpan={7} className="admin-empty">트랙이 없습니다</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="admin-pagination">
                <button
                  className="admin-btn admin-btn--small"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  이전
                </button>
                <span className="admin-pagination__info">{page} / {totalPages}</span>
                <button
                  className="admin-btn admin-btn--small"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  다음
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
