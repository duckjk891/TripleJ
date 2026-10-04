import { useState, useEffect, useCallback } from 'react';
import { getAdminLogs, errMsg } from '../api';
import { formatDate } from './Dashboard';

// admin_logs.action → 한글 (모르는 값은 원문 표시)
const ACTIONS = {
  ban_user: '사용자 정지', unban_user: '정지 해제', change_role: '역할 변경', update_role: '역할 변경',
  lift_restriction: '이용 제한 해제', reset_strikes: '위반 기록 초기화',
  delete_track: '곡 삭제', update_track_visibility: '곡 공개 변경',
  report_blind: '신고: 블라인드', report_delete: '신고: 삭제', report_dismiss: '신고: 기각',
  report_confirm_delete: '신고: 확정 삭제', report_restore: '신고: 복원',
  blind_club: '크루 블라인드', face_purge: '얼굴 수색 몰수', issue_status_change: '오류 신고 상태 변경',
  points_adjust: '별 지급/차감', admin_adjust: '별 지급/차감', issue_probe: '에러 서버 점검',
  official_feed_create: '공식 피드 작성', official_feed_delete: '공식 피드 삭제',
  official_comment: '공식 댓글 작성', official_comment_delete: '공식 댓글 삭제',
  items_import: '착장 CSV 가져오기', item_update: '착장 수정', item_delete: '착장 삭제',
};
const TARGETS = {
  user: '사용자', track: '곡', feed: '피드', comment: '피드 댓글', track_comment: '곡 댓글', dm_message: 'DM 메시지',
  club: '크루', club_post: '크루 글', club_member: '크루 멤버', club_message: '크루 채팅', issue: '오류 신고', report: '신고',
};

export default function LogsPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [targetType, setTargetType] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { page, limit: 30 };
      if (targetType) params.target_type = targetType;
      const res = await getAdminLogs(params);
      setLogs(res.data.logs || []);
      setTotalPages(res.data.pagination?.totalPages || 1);
    } catch (e) {
      setError(errMsg(e, '관리 기록을 불러오지 못했습니다.'));
    } finally {
      setLoading(false);
    }
  }, [page, targetType]);
  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <h2 className="page-title">관리 기록</h2>
      <div className="filters">
        <select className="select" value={targetType} onChange={(e) => { setTargetType(e.target.value); setPage(1); }}>
          <option value="">모든 대상</option>
          {Object.entries(TARGETS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <span className="cell-sub">관리자가 수행한 조치의 감사 기록입니다. 행을 누르면 상세가 열립니다.</span>
      </div>
      {error && <p className="error-msg">{error}</p>}
      {loading ? <p className="loading">로딩 중…</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>시각</th><th>관리자</th><th>조치</th><th>대상</th></tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="row-click" onClick={() => setOpen(l)}>
                  <td className="nowrap">{formatDate(l.created_at)}</td>
                  <td className="nowrap">{l.admin_nickname || '-'}</td>
                  <td className="cell-main">{ACTIONS[l.action] || l.action}</td>
                  <td>
                    <span className="badge badge--gray">{TARGETS[l.target_type] || l.target_type || '-'}</span>{' '}
                    {l.target_nickname || <span className="cell-sub">{String(l.target_id || '').slice(0, 12)}</span>}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && <tr><td colSpan={4} className="td-empty">기록이 없습니다</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {totalPages > 1 && (
        <div className="pagination">
          <button className="btn btn--sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>이전</button>
          <span className="pagination__info">{page} / {totalPages}</span>
          <button className="btn btn--sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>다음</button>
        </div>
      )}
      {open && (
        <div className="modal-overlay" onClick={() => setOpen(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal__title">{ACTIONS[open.action] || open.action}</h3>
            <dl className="kv" style={{ marginBottom: 12 }}>
              <dt>시각</dt><dd>{formatDate(open.created_at)}</dd>
              <dt>관리자</dt><dd>{open.admin_nickname || '-'}</dd>
              <dt>대상</dt><dd>{TARGETS[open.target_type] || open.target_type || '-'} {open.target_nickname || ''}<div className="cell-sub">{open.target_id}</div></dd>
            </dl>
            <div className="pre">{open.details ? JSON.stringify(open.details, null, 2) : '(상세 없음)'}</div>
            <div className="modal__footer"><button className="btn" onClick={() => setOpen(null)}>닫기</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
