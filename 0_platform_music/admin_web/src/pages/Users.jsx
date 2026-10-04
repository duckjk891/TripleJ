import { useState, useEffect, useCallback } from 'react';
import AuthImage from '../components/AuthImage';
import { useNavigate } from 'react-router-dom';
import {
  getUsers, updateUserRole, banUser, getUserDetail, getUserRecentContent, liftRestriction, resetStrikes, errMsg,
} from '../api';
import { formatDate } from './Dashboard';
import { appAlert, appConfirm, appPrompt } from '../components/dialog';

const toObjectName = (path) => {
  const s = String(path || '');
  const i = s.indexOf('/admin/media/');
  return i >= 0 ? s.slice(i + '/admin/media/'.length) : s;
};
const isRestricted = (u) => u.restricted_until && new Date(u.restricted_until) > new Date();

function UserModal({ userId, onClose, onChanged }) {
  const [u, setU] = useState(null);
  const [content, setContent] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getUserDetail(userId).then((r) => setU(r.data)).catch(() => {});
    getUserRecentContent(userId).then((r) => setContent(r.data)).catch(() => setContent({ tracks: [], artists: [] }));
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  const run = async (message, fn) => {
    if (!(await appConfirm(message))) return;
    setBusy(true);
    try {
      await fn();
      load();
      onChanged();
    } catch (e) {
      await appAlert(errMsg(e, '처리에 실패했습니다.'));
    } finally {
      setBusy(false);
    }
  };

  const sheets = content ? [
    content.character?.original_photo_path && ['원본 사진', content.character.original_photo_path],
    ...(content.artists || []).map((a) => a.sheet_path && [`${a.name || '아티스트'}`, a.sheet_path]),
  ].filter(Boolean) : [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal__title">{u ? u.nickname : '사용자'}</h3>
        {!u ? <p className="cell-sub">로딩…</p> : (
          <>
            <dl className="kv" style={{ marginBottom: 14 }}>
              <dt>이메일</dt><dd>{u.email}</dd>
              <dt>가입일</dt><dd>{formatDate(u.created_at)}</dd>
              <dt>역할 · 요금제</dt><dd>{u.role} · {u.plan || '-'}</dd>
              <dt>곡 · 재생</dt><dd>{(u.track_count || 0).toLocaleString()}곡 · {(u.total_plays || 0).toLocaleString()}회</dd>
              <dt>소개</dt><dd>{u.bio || '-'}</dd>
              <dt>상태</dt>
              <dd>
                {u.is_banned ? <span className="badge badge--red">정지</span> : <span className="badge badge--green">정상</span>}{' '}
                {isRestricted(u) && <span className="badge badge--amber">이용 제한 ~{formatDate(u.restricted_until)}</span>}{' '}
                <span className={`badge ${u.violation_count > 0 ? 'badge--red' : 'badge--gray'}`}>위반 {u.violation_count}회</span>
                {u.is_banned && u.ban_reason && <div className="cell-sub">정지 사유: {u.ban_reason}</div>}
              </dd>
            </dl>
            <div className="actions" style={{ marginBottom: 16 }}>
              {isRestricted(u) && (
                <button className="btn btn--sm" disabled={busy}
                  onClick={() => run('이용 제한을 지금 해제합니다.', () => liftRestriction(u.id))}>이용 제한 해제</button>
              )}
              {u.violation_count > 0 && (
                <button className="btn btn--sm btn--danger" disabled={busy}
                  onClick={() => run(`위반 기록 ${u.violation_count}회를 모두 초기화합니다. 되돌릴 수 없습니다.`, () => resetStrikes(u.id))}>위반 기록 초기화</button>
              )}
            </div>
          </>
        )}
        <h4 className="section-title">캐릭터 · 최근 곡</h4>
        {!content ? <p className="cell-sub">로딩…</p> : (
          <>
            {sheets.length > 0 && (
              <div className="thumb-row" style={{ marginBottom: 10 }}>
                {sheets.map(([label, path]) => (
                  <div key={path} style={{ textAlign: 'center' }}>
                    <AuthImage objectName={toObjectName(path)} className="thumb thumb--md" />
                    <div className="cell-sub" style={{ maxWidth: 80 }}>{label}</div>
                  </div>
                ))}
              </div>
            )}
            {(content.tracks || []).length === 0 ? <p className="cell-sub">등록한 곡이 없습니다.</p> : (
              <div className="table-wrap">
                <table>
                  <tbody>
                    {content.tracks.map((t) => (
                      <tr key={t.id}>
                        <td className="cell-main">{t.title || '(제목 없음)'}</td>
                        <td>
                          {t.report_blinded ? <span className="badge badge--amber">블라인드</span>
                            : <span className={`badge ${t.is_public ? 'badge--green' : 'badge--gray'}`}>{t.is_public ? '공개' : '비공개'}</span>}
                        </td>
                        <td className="nowrap cell-sub">{formatDate(t.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        <div className="modal__footer"><button className="btn" onClick={onClose}>닫기</button></div>
      </div>
    </div>
  );
}

export default function UsersPage() {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [banned, setBanned] = useState('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [detailId, setDetailId] = useState(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { search, page, limit: 20 };
      if (banned !== 'all') params.banned = banned === 'banned';
      const res = await getUsers(params);
      setUsers(res.data.users || []);
      setTotalPages(res.data.pagination?.totalPages || 1);
    } catch {
      setError('사용자 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [search, page, banned]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const handleRole = async (u) => {
    const next = u.role === 'admin' ? 'user' : 'admin';
    if (!(await appConfirm(`${u.nickname} 님의 역할을 "${next}" 로 변경하시겠습니까?`))) return;
    try {
      await updateUserRole(u.id, next);
      fetchList();
    } catch (err) {
      await appAlert(err.response?.data?.error || '역할 변경에 실패했습니다.');
    }
  };

  const handleBan = async (u) => {
    if (u.is_banned) {
      if (!(await appConfirm(`${u.nickname} 님의 정지를 해제하시겠습니까?`))) return;
      try {
        await banUser(u.id, false);
        fetchList();
      } catch (err) {
        await appAlert(err.response?.data?.error || '정지 해제에 실패했습니다.');
      }
      return;
    }
    const reason = await appPrompt(`${u.nickname} 님을 정지합니다. 사유를 입력하세요:`);
    if (reason === null) return;
    try {
      await banUser(u.id, true, reason);
      fetchList();
    } catch (err) {
      await appAlert(err.response?.data?.error || '정지에 실패했습니다.');
    }
  };

  return (
    <div>
      <h2 className="page-title">사용자 관리</h2>

      <div className="filters">
        <form className="search-form" onSubmit={(e) => { e.preventDefault(); setPage(1); fetchList(); }}>
          <input
            className="input" type="text" placeholder="이메일·닉네임 검색"
            value={search} onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn" type="submit">검색</button>
        </form>
        <div className="filter-group">
          {[['all', '전체'], ['active', '정상'], ['banned', '정지']].map(([v, l]) => (
            <button key={v} className={`filter-btn ${banned === v ? 'active' : ''}`}
              onClick={() => { setBanned(v); setPage(1); }}>{l}</button>
          ))}
        </div>
      </div>

      {error && <p className="error-msg">{error}</p>}
      {loading ? <p className="loading">로딩 중…</p> : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>닉네임</th><th>이메일</th><th>역할</th><th>상태</th><th>가입일</th><th>액션</th></tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="cell-main row-click" onClick={() => setDetailId(u.id)} style={{ textDecoration: 'underline' }}>{u.nickname}</td>
                    <td>{u.email}</td>
                    <td><span className={`badge ${u.role === 'admin' ? 'badge--purple' : 'badge--gray'}`}>{u.role}</span></td>
                    <td>
                      {u.is_banned
                        ? <span className="badge badge--red" title={u.ban_reason || ''}>정지</span>
                        : <span className="badge badge--green">정상</span>}
                      {isRestricted(u) && <span className="badge badge--amber" style={{ marginLeft: 4 }}>제한</span>}
                      {u.violation_count > 0 && <span className="badge badge--red" style={{ marginLeft: 4 }}>위반 {u.violation_count}</span>}
                    </td>
                    <td className="nowrap">{formatDate(u.created_at)}</td>
                    <td>
                      <div className="actions">
                        <button className="btn btn--sm" onClick={() => navigate(`/stars?uid=${u.id}`)}>⭐ 별</button>
                        <button className="btn btn--sm" onClick={() => handleRole(u)}>
                          {u.role === 'admin' ? '관리자 해제' : '관리자로'}
                        </button>
                        <button className={`btn btn--sm ${u.is_banned ? '' : 'btn--danger'}`} onClick={() => handleBan(u)}>
                          {u.is_banned ? '정지 해제' : '정지'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && <tr><td colSpan={6} className="td-empty">사용자가 없습니다</td></tr>}
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
      {detailId && <UserModal userId={detailId} onClose={() => setDetailId(null)} onChanged={fetchList} />}
    </div>
  );
}
