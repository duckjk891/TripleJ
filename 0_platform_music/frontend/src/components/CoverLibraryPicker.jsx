import { useEffect, useState } from 'react';
import * as api from '../api';
import './CoverLibraryPicker.css';

// v215 F6 — 공용 커버 보관함 피커 (PLAN C6).
// 저장소 = cover_sessions 재활용(C1): GET /upload/cover-sessions →
//   {covers:[{cover_session_id, cover_object_name, image_url, title, image_model, current_version,
//     history_count, linked_tracks:[{id,title}], created_at, updated_at}], pagination}
// 소비처 4곳: 커버촬영실 본진(manage) · UploadPage(compact) · MVStudioTab(compact) · CoverEditModal(compact)
// 선택 반환 = onSelect({session_id, cover_object_name, preview, title, linked_tracks})
// manage=true 면 [보기]/[삭제] 버튼 렌더 — 삭제는 연결 곡 존재 시 409 {error, linked_tracks} 안내(R3).
// refreshKey 증가 시 재로드 (생성/삭제 후 부모가 올림).
export default function CoverLibraryPicker({
  compact = false,
  selectedObjectName = null,
  onSelect = null,
  manage = false,
  onView = null,
  refreshKey = 0,
  pageSize = 20,
  emptyHint = null,
}) {
  const [covers, setCovers] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.listCoverSessions({ page, limit: pageSize })
      .then(({ data }) => {
        if (!alive) return;
        setCovers(Array.isArray(data?.covers) ? data.covers : []);
        setPagination(data?.pagination || null);
        setLoadError(false);
        if (import.meta.env.DEV) {
          console.debug('[CoverLibraryPicker] loaded', { page, count: data?.covers?.length ?? 0 });
        }
      })
      .catch((err) => {
        // B1 배포 전(404) 포함 — 빈 상태 + 안내로 강등 (비치명)
        console.error('[CoverLibraryPicker] load failed', { status: err?.response?.status, message: err?.message });
        if (alive) { setCovers([]); setPagination(null); setLoadError(true); }
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [page, pageSize, refreshKey]);

  const previewOf = (c) => c.image_url || api.coverPreviewUrl(c.cover_object_name);

  const handleDelete = async (c) => {
    if (deletingId) return;
    const linked = Array.isArray(c.linked_tracks) ? c.linked_tracks : [];
    if (linked.length > 0) {
      alert(`이 커버는 곡에서 사용 중이라 삭제할 수 없습니다:\n${linked.map((t) => `· ${t.title || t.id}`).join('\n')}`);
      return;
    }
    if (!window.confirm('이 커버를 보관함에서 완전히 삭제할까요? (모든 수정 버전이 함께 삭제됩니다)')) return;
    setDeletingId(c.cover_session_id);
    try {
      await api.deleteCoverSession(c.cover_session_id);
      if (import.meta.env.DEV) console.debug('[CoverLibraryPicker] deleted', { session_id: c.cover_session_id });
      setCovers((prev) => prev.filter((x) => x.cover_session_id !== c.cover_session_id));
    } catch (err) {
      // 안전측 — 서버 409(연결 곡 존재) 안내 표준화 (R3)
      if (err?.response?.status === 409) {
        const lt = err.response?.data?.linked_tracks;
        alert(
          Array.isArray(lt) && lt.length > 0
            ? `이 커버는 곡에서 사용 중이라 삭제할 수 없습니다:\n${lt.map((t) => `· ${t.title || t.id}`).join('\n')}`
            : (err.response?.data?.error || '사용 중인 커버는 삭제할 수 없습니다.'),
        );
      } else {
        console.error('[CoverLibraryPicker] delete failed', { session_id: c.cover_session_id, status: err?.response?.status });
        alert(err?.response?.data?.error || '커버 삭제에 실패했습니다.');
      }
    } finally {
      setDeletingId(null);
    }
  };

  if (loading && covers.length === 0) {
    return <div className="cover-lib__empty">보관함 불러오는 중...</div>;
  }

  if (covers.length === 0) {
    return (
      <div className="cover-lib__empty">
        {loadError
          ? '보관함을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.'
          : (emptyHint || '보관함이 비어 있습니다. 커버촬영실에서 커버를 만들어보세요.')}
      </div>
    );
  }

  return (
    <div className={`cover-lib${compact ? ' cover-lib--compact' : ''}`}>
      <div className="cover-lib__grid">
        {covers.map((c) => {
          const linked = Array.isArray(c.linked_tracks) ? c.linked_tracks : [];
          const selected = selectedObjectName && selectedObjectName === c.cover_object_name;
          return (
            <div
              key={c.cover_session_id}
              className={`cover-lib__card${selected ? ' is-selected' : ''}`}
            >
              <button
                type="button"
                className="cover-lib__thumb-btn"
                title={c.title || c.cover_object_name}
                onClick={() => {
                  if (!onSelect) return;
                  if (import.meta.env.DEV) console.debug('[CoverLibraryPicker] pick', { session_id: c.cover_session_id });
                  // planner 확정 표준 반환 shape — 4소비처 공용 고정 (cover_session_id 는 예약 필드,
                  // v215 소비처 실사용 값은 cover_object_name — 미리보기는 coverPreviewUrl 로 파생)
                  onSelect({
                    cover_session_id: c.cover_session_id,
                    cover_object_name: c.cover_object_name,
                    title: c.title || '',
                  });
                }}
              >
                <img
                  src={previewOf(c)}
                  alt={c.title || '커버'}
                  className="cover-lib__thumb"
                  loading="lazy"
                  onError={(e) => { if (e?.currentTarget) e.currentTarget.style.visibility = 'hidden'; }}
                />
              </button>
              <div className="cover-lib__meta">
                {/* 구형 세션(소급 29건)은 title null — "무제 커버" + 생성일 표기 (planner 확정) */}
                <div className="cover-lib__title" title={c.title || '무제 커버'}>
                  {c.title || '무제 커버'}
                  {!c.title && c.created_at && (
                    <span style={{ color: '#666' }}> · {new Date(c.created_at).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}</span>
                  )}
                </div>
                {linked.length > 0 ? (
                  <span className="cover-lib__badge cover-lib__badge--linked" title={linked.map((t) => t.title || t.id).join(', ')}>
                    🔗 {linked.length}곡 사용 중
                  </span>
                ) : (
                  <span className="cover-lib__badge">미사용</span>
                )}
                {(c.history_count ?? 0) > 1 && (
                  <span className="cover-lib__badge">📜 v{c.current_version ?? 0}</span>
                )}
              </div>
              {manage && (
                <div className="cover-lib__actions">
                  {onView && (
                    <button type="button" className="cover-lib__action-btn" onClick={() => onView({ url: previewOf(c), title: c.title || '커버 이미지' })}>
                      보기
                    </button>
                  )}
                  <button
                    type="button"
                    className="cover-lib__action-btn cover-lib__action-btn--danger"
                    onClick={() => handleDelete(c)}
                    disabled={deletingId === c.cover_session_id}
                  >
                    {deletingId === c.cover_session_id ? '삭제 중...' : '삭제'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {pagination && (pagination.totalPages ?? 1) > 1 && (
        <div className="cover-lib__pager">
          <button type="button" className="cover-lib__action-btn" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            ← 이전
          </button>
          <span className="cover-lib__page-label">{pagination.page} / {pagination.totalPages}</span>
          <button
            type="button"
            className="cover-lib__action-btn"
            disabled={loading || (pagination.totalPages ? page >= pagination.totalPages : covers.length < pageSize)}
            onClick={() => setPage((p) => p + 1)}
          >
            다음 →
          </button>
        </div>
      )}
    </div>
  );
}
