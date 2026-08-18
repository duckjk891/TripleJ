import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import AdminLayout from '../components/AdminLayout';
import { getAdminLogs } from '../api';
import { formatDate } from '../utils/format';
import './AdminLogsPage.css';

// 감사 로그 액션 → 한글 라벨 + 뱃지 색. 미등록 action 은 원문 그대로 fallback 표시.
const ACTION_META = {
  change_role: { label: '역할 변경', badge: 'admin-badge--blue' },
  ban_user: { label: '밴', badge: 'admin-badge--red' },
  unban_user: { label: '밴 해제', badge: 'admin-badge--green' },
  lift_restriction: { label: '생성제한 해제', badge: 'admin-badge--green' },
  reset_strikes: { label: '위반 초기화', badge: 'admin-badge--green' },
  delete_track: { label: '트랙 삭제', badge: 'admin-badge--red' },
  change_visibility: { label: '공개 전환', badge: 'admin-badge--blue' },
  report_blind: { label: '신고 블라인드', badge: 'admin-badge--yellow' },
  report_delete: { label: '신고 삭제', badge: 'admin-badge--red' },
  report_dismiss: { label: '신고 기각', badge: 'admin-badge--gray' },
  report_confirm_delete: { label: '신고 확정삭제', badge: 'admin-badge--red' },
  report_restore: { label: '신고 복원', badge: 'admin-badge--green' },
  face_purge: { label: '인물 몰수', badge: 'admin-badge--red' },
  cs_broadcast: { label: '전체 발송', badge: 'admin-badge--blue' },
  cs_send: { label: '지정 발송', badge: 'admin-badge--green' },
  points_adjust: { label: '별 조정', badge: 'admin-badge--yellow' },
  ads_admin_hide: { label: '광고 숨김', badge: 'admin-badge--red' },
  ads_admin_unhide: { label: '광고 숨김 해제', badge: 'admin-badge--green' },
  issue_status_change: { label: '오류신고 상태 변경', badge: 'admin-badge--blue' },
};

const TARGET_TYPE_LABELS = {
  user: '사용자',
  track: '트랙',
  feed: '피드',
  comment: '댓글',
  report: '신고',
  broadcast: '브로드캐스트',
  ad_item: '광고 아이템',
  issue_report: '오류 신고',
};

// details 객체 요약 — key: value 나열. null/비객체/빈 객체는 '-'.
// (details 내용물은 콘솔에 출력하지 않는다.)
function summarizeDetails(details) {
  if (!details || typeof details !== 'object') return '-';
  const entries = Object.entries(details);
  if (entries.length === 0) return '-';
  return entries
    .map(([k, v]) => `${k}: ${v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(', ');
}

export default function AdminLogsPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [action, setAction] = useState('all');
  const [targetType, setTargetType] = useState('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError('');
    if (import.meta.env.DEV) {
      console.info('[AdminLogs] fetch', { page, action, targetType });
    }
    try {
      const params = { page, limit: 20 };
      if (action !== 'all') params.action = action;
      if (targetType !== 'all') params.target_type = targetType;
      const res = await getAdminLogs(params);
      if (!Array.isArray(res.data?.logs)) {
        console.warn('[AdminLogs] unexpected response shape', {
          hasLogs: 'logs' in (res.data || {}),
        });
      }
      setLogs(Array.isArray(res.data?.logs) ? res.data.logs : []);
      setTotalPages(res.data?.pagination?.totalPages || 1);
    } catch (err) {
      console.error('[AdminLogs] fetch failed', {
        status: err?.response?.status,
        message: err?.message,
      });
      setError('감사 로그를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [page, action, targetType]);

  useEffect(() => {
    // 기존 페이지 관행(AdminUsersPage fetchUsers-in-effect)과 동일 패턴 — codebase-wide 후속 정리 대상
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLogs();
  }, [fetchLogs]);

  // select 필터라 디바운스 불필요 — 변경 즉시 page 1 재조회
  const handleActionChange = (e) => {
    setAction(e.target.value);
    setPage(1);
  };

  const handleTargetTypeChange = (e) => {
    setTargetType(e.target.value);
    setPage(1);
  };

  const renderTarget = (log) => {
    if (!log.target_type) return '-';
    const typeLabel = TARGET_TYPE_LABELS[log.target_type] || log.target_type;
    if (log.target_type === 'user' && log.target_id != null) {
      // v177 — target_nickname 있으면 현재 닉네임#태그 표시(title=uuid 원문), null(탈퇴 등)이면 기존 id fallback.
      if (log.target_nickname) {
        return (
          <Link to={`/users/${log.target_id}`} className="admin-logs__link" title={String(log.target_id)}>
            {typeLabel} {log.target_nickname}{log.target_code ? `#${log.target_code}` : ''}
          </Link>
        );
      }
      return (
        <Link to={`/users/${log.target_id}`} className="admin-logs__link">
          {typeLabel} #{log.target_id}
        </Link>
      );
    }
    return log.target_id != null ? `${typeLabel} #${log.target_id}` : typeLabel;
  };

  return (
    <AdminLayout>
      <div className="admin-logs">
        <h2 className="admin-page-title">감사 로그</h2>

        <div className="admin-logs__filters">
          <label className="admin-logs__filter-label">
            액션
            <select className="admin-logs__select" value={action} onChange={handleActionChange}>
              <option value="all">전체</option>
              {Object.entries(ACTION_META).map(([value, meta]) => (
                <option key={value} value={value}>{meta.label}</option>
              ))}
            </select>
          </label>
          <label className="admin-logs__filter-label">
            대상 유형
            <select className="admin-logs__select" value={targetType} onChange={handleTargetTypeChange}>
              <option value="all">전체</option>
              {Object.entries(TARGET_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
        </div>

        {error && (
          <div className="admin-error">
            <p>{error}</p>
            <button className="admin-btn admin-btn--small" onClick={fetchLogs}>재시도</button>
          </div>
        )}

        {loading ? (
          <p className="admin-loading">로딩 중...</p>
        ) : !error && (
          <>
            <div className="admin-table-wrap">
              <table className="admin-table admin-table--full">
                <thead>
                  <tr>
                    <th>시각</th>
                    <th>관리자</th>
                    <th>액션</th>
                    <th>대상</th>
                    <th>상세</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => {
                    const meta = ACTION_META[log.action] || { label: log.action, badge: 'admin-badge--gray' };
                    const detailText = summarizeDetails(log.details);
                    return (
                      <tr key={log.id}>
                        <td className="admin-logs__date-cell">{formatDate(log.created_at)}</td>
                        <td>
                          {log.admin_id != null ? (
                            <Link to={`/users/${log.admin_id}`} className="admin-logs__link">
                              {log.admin_nickname || `#${log.admin_id}`}
                            </Link>
                          ) : (
                            log.admin_nickname || '-'
                          )}
                        </td>
                        <td>
                          <span className={`admin-badge ${meta.badge}`}>{meta.label}</span>
                        </td>
                        <td className="admin-logs__target-cell">{renderTarget(log)}</td>
                        <td className="admin-logs__details-cell" title={detailText !== '-' ? detailText : undefined}>
                          {detailText}
                        </td>
                      </tr>
                    );
                  })}
                  {logs.length === 0 && (
                    <tr><td colSpan={5} className="admin-empty">로그가 없습니다</td></tr>
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
