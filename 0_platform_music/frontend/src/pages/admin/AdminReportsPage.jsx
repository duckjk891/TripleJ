import { Fragment, useState, useEffect, useCallback } from 'react';
import AdminLayout from '../../components/AdminLayout';
import {
  getAdminReports,
  actionAdminReport,
  coverPreviewUrl,
  adminEvidenceUrl,
  getAdminReportEvidence,
  getAdminUserRecentContent,
  adminFaceSearch,
  adminPurge,
} from '../../api';
import './AdminReportsPage.css';

// v137 — 어드민 신고 큐 (미처리/처리됨/기각 필터, 대상 미리보기, 블라인드/삭제/기각 처리)
// v138 — 신고 집행 패키지: 긴급 뱃지, 양면 뷰(증거 스냅샷 vs 최근 생성물),
//        확정 삭제(2중 확인)·복원, 인물 수색 → 선택 일괄 몰수.
// 로그 태그: [AdminReports] — reason_text 원문·증거 데이터는 콘솔에 출력하지 않는다.

const STATUS_FILTERS = [
  { value: 'pending', label: '미처리' },
  { value: 'actioned', label: '처리됨' },
  { value: 'dismissed', label: '기각' },
];

const TYPE_LABEL = { track: '트랙', feed: '피드', comment: '댓글' };

const REASON_LABEL = {
  portrait: '초상권 침해',
  copyright: '저작권 침해',
  sexual: '성적·불쾌 콘텐츠',
  abuse: '욕설·괴롭힘',
  other: '기타',
};

const ACTION_LABEL = {
  blind: '블라인드',
  delete: '삭제',
  dismiss: '기각',
  confirm_delete: '확정 삭제',
  restore: '복원',
};

const RESOLUTION_LABEL = {
  removed_by_user: '게시자 삭제로 종결',
};

const EVIDENCE_KIND_LABEL = {
  cover: '커버 이미지',
  character_sheet: '캐릭터 시트',
  sheet: '캐릭터 시트(실사)',
  virtual_sheet: '캐릭터 시트(가상)',
  original_photo: '원본 사진',
  content_json: '본문 텍스트',
  content: '본문 텍스트',
  meta: '메타 정보',
};

// JSON(텍스트) 로 렌더할 kind — BE 실제 키(content/meta) + 구 명칭(content_json) 호환
const EVIDENCE_JSON_KINDS = new Set(['content_json', 'content', 'meta']);

const CONFIRM_DELETE_KEYWORD = '확정삭제';

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

function coverSrc(url) {
  if (!url) return '';
  if (url.startsWith('http') || url.startsWith('/api/')) return url;
  return coverPreviewUrl(url);
}

// v138 — 어드민 전용 미디어(/api/admin/media/...)는 img src 에 토큰 쿼리 필요
// (인터셉터가 못 붙는 <img> 태그 경로 — adminEvidenceUrl 과 동일 패턴)
function adminMediaSrc(url) {
  if (!url) return '';
  if (url.startsWith('/api/admin/')) {
    const token = localStorage.getItem('token') || '';
    return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
  }
  return coverSrc(url);
}

// 신고당한 게시자 user id — BE 필드 확정 전 방어적 추출(대상 자진 삭제 시 부재 가능)
function reportedUserId(report) {
  const snap = report.target || report.target_snapshot || {};
  return (
    report.reported_user_id ||
    report.target_user_id ||
    report.evidence?.owner_id ||
    snap.uploader_id ||
    snap.author_id ||
    null
  );
}

function similarityPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n <= 1 ? n * 100 : n);
}

// 대상 미리보기 — 트랙: 커버 썸네일+제목 / 피드: 발췌 / 댓글: 텍스트 (+삭제된 대상 표시)
function TargetPreview({ report }) {
  const snap = report.target || report.target_snapshot || {};
  if (snap.deleted) {
    return <span className="admin-reports__target-deleted">삭제된 대상</span>;
  }
  if (report.target_type === 'track') {
    return (
      <div className="admin-reports__target">
        {snap.cover_image_url ? (
          <img className="admin-reports__target-thumb" src={coverSrc(snap.cover_image_url)} alt="" />
        ) : (
          <span className="admin-reports__target-thumb admin-reports__target-thumb--empty">♪</span>
        )}
        <div className="admin-reports__target-text">
          <span className="admin-reports__target-title">{snap.title || '-'}</span>
          <span className="admin-reports__target-sub">{snap.uploader_nickname || '-'}</span>
        </div>
      </div>
    );
  }
  if (report.target_type === 'feed') {
    return (
      <div className="admin-reports__target">
        <div className="admin-reports__target-text">
          <span className="admin-reports__target-title">
            {snap.kind === 'community' ? '[공지] ' : ''}
            {snap.text_excerpt || '-'}
          </span>
          <span className="admin-reports__target-sub">{snap.author_nickname || '-'}</span>
        </div>
      </div>
    );
  }
  // comment
  return (
    <div className="admin-reports__target">
      <div className="admin-reports__target-text">
        <span className="admin-reports__target-title">{snap.text || '-'}</span>
        <span className="admin-reports__target-sub">{snap.author_nickname || '-'}</span>
      </div>
    </div>
  );
}

// 증거 항목 1건 — 이미지 kind 는 어드민 증거 프록시 img, content_json 은 텍스트 표시
function EvidenceItem({ reportId, item, idx }) {
  const kind = item?.kind || 'unknown';
  const isJson = EVIDENCE_JSON_KINDS.has(kind);
  const [text, setText] = useState('');
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(isJson);

  useEffect(() => {
    if (!isJson) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await getAdminReportEvidence(reportId, idx);
        if (cancelled) return;
        const data = res.data;
        let display = '';
        if (typeof data === 'string') display = data;
        else if (data && typeof data === 'object') {
          display = data.text || data.text_excerpt || JSON.stringify(data, null, 2);
        }
        setText(display || '(내용 없음)');
      } catch (err) {
        if (cancelled) return;
        console.error('[AdminReports] evidence load failed', {
          report_id: reportId,
          idx,
          status: err?.response?.status,
        });
        setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isJson, reportId, idx]);

  return (
    <div className="admin-reports__evidence-item">
      <span className="admin-reports__evidence-kind">{EVIDENCE_KIND_LABEL[kind] || kind}</span>
      {isJson ? (
        loading ? (
          <span className="admin-reports__pane-empty">불러오는 중...</span>
        ) : failed ? (
          <span className="admin-reports__evidence-failed">증거를 불러오지 못했습니다.</span>
        ) : (
          <pre className="admin-reports__evidence-text">{text}</pre>
        )
      ) : failed ? (
        <span className="admin-reports__evidence-failed">이미지를 불러오지 못했습니다.</span>
      ) : (
        <img
          className="admin-reports__evidence-img"
          src={adminEvidenceUrl(reportId, idx)}
          alt={EVIDENCE_KIND_LABEL[kind] || kind}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

// 양면 뷰 우측 — 게시자의 최근 생성물(트랙 커버 그리드 + 현재 캐릭터)
function RecentContentPane({ userId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!!userId);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const res = await getAdminUserRecentContent(userId);
        if (!cancelled) setData(res.data || {});
      } catch (err) {
        if (cancelled) return;
        console.error('[AdminReports] recent-content load failed', {
          status: err?.response?.status,
        });
        setError('최근 생성물을 불러오지 못했습니다.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  if (!userId) return <p className="admin-reports__pane-empty">게시자 정보를 확인할 수 없습니다.</p>;
  if (loading) return <p className="admin-reports__pane-empty">불러오는 중...</p>;
  if (error) return <p className="admin-reports__evidence-failed">{error}</p>;

  const tracks = Array.isArray(data?.tracks) ? data.tracks : [];
  const character = data?.character || {};
  // v138 BE 실필드: has_original_photo / *_path (구 명칭도 방어 유지)
  const hasOriginal = character.has_original_photo || character.has_original;
  const hasCharacter = character.has_sheet || character.has_virtual_sheet || hasOriginal;
  const originalSrc = character.original_photo_path || character.original_preview_url;
  const sheetSrc = character.sheet_path || character.sheet_preview_url;
  const virtualSheetSrc = character.virtual_sheet_path;

  return (
    <div className="admin-reports__recent">
      {tracks.length > 0 ? (
        <div className="admin-reports__recent-grid">
          {tracks.map((t) => (
            <div key={t.id} className="admin-reports__recent-card">
              {t.cover_image_url ? (
                <img className="admin-reports__recent-thumb" src={coverSrc(t.cover_image_url)} alt="" />
              ) : (
                <span className="admin-reports__recent-thumb admin-reports__recent-thumb--empty">♪</span>
              )}
              <span className="admin-reports__recent-title" title={t.title || ''}>{t.title || '-'}</span>
              <span className={`admin-reports__recent-visibility ${t.is_public ? '' : 'admin-reports__recent-visibility--private'}`}>
                {t.is_public ? '공개' : '비공개'}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="admin-reports__pane-empty">최근 트랙이 없습니다.</p>
      )}

      <div className="admin-reports__recent-character">
        <span className="admin-reports__evidence-kind">현재 캐릭터</span>
        {hasCharacter ? (
          <div className="admin-reports__recent-character-imgs">
            {originalSrc && (
              <figure className="admin-reports__recent-figure">
                <img className="admin-reports__recent-thumb" src={adminMediaSrc(originalSrc)} alt="원본 사진" />
                <figcaption>원본 사진</figcaption>
              </figure>
            )}
            {sheetSrc && (
              <figure className="admin-reports__recent-figure">
                <img className="admin-reports__recent-thumb" src={adminMediaSrc(sheetSrc)} alt="캐릭터 시트(실사)" />
                <figcaption>캐릭터 시트(실사)</figcaption>
              </figure>
            )}
            {virtualSheetSrc && (
              <figure className="admin-reports__recent-figure">
                <img className="admin-reports__recent-thumb" src={adminMediaSrc(virtualSheetSrc)} alt="캐릭터 시트(가상)" />
                <figcaption>캐릭터 시트(가상)</figcaption>
              </figure>
            )}
            {!originalSrc && !sheetSrc && !virtualSheetSrc && (
              <span className="admin-reports__pane-empty">
                {[hasOriginal ? '원본 사진 보유' : null, character.has_sheet ? '시트 보유' : null,
                  character.has_virtual_sheet ? '가상 시트 보유' : null]
                  .filter(Boolean).join(' · ')}
              </span>
            )}
          </div>
        ) : (
          <span className="admin-reports__pane-empty">등록된 캐릭터가 없습니다.</span>
        )}
      </div>
    </div>
  );
}

export default function AdminReportsPage() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [expandedId, setExpandedId] = useState(null);
  const [actingId, setActingId] = useState(null);
  // 인물 수색 모달 — { reportId, loading, error, matches, scanned, skipped, selected, purging }
  const [faceSearch, setFaceSearch] = useState(null);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getAdminReports({ status, page, limit: 20 });
      const list = res.data.reports || [];
      setReports(list);
      const pg = res.data.pagination || {};
      const tp =
        pg.totalPages ?? pg.total_pages ??
        (pg.total && pg.limit ? Math.ceil(pg.total / pg.limit) : 1);
      setTotalPages(Math.max(1, tp || 1));
      if (import.meta.env.DEV) {
        console.info('[AdminReports] fetched', {
          status, page, count: list.length,
          urgent: list.filter((r) => r.urgent).length,
        });
      }
    } catch (err) {
      console.error('[AdminReports] fetch failed', { status: err?.response?.status });
      setError('신고 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [status, page]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const handleAction = async (report, action) => {
    const label = ACTION_LABEL[action] || action;
    const typeLabel = TYPE_LABEL[report.target_type] || report.target_type;
    if (action === 'confirm_delete') {
      // 2중 확인 — confirm 후 "확정삭제" 텍스트 입력
      if (!window.confirm(
        `이 ${typeLabel}을(를) 확정 삭제합니다.\n파생물이 파기되고 증거만 격리 보존되며, 되돌릴 수 없습니다.\n계속하시겠습니까?`,
      )) return;
      const typed = window.prompt(`확정 삭제를 진행하려면 "${CONFIRM_DELETE_KEYWORD}" 를 입력하세요.`);
      if (typed === null) return;
      if (typed.trim() !== CONFIRM_DELETE_KEYWORD) {
        alert('입력이 일치하지 않아 취소되었습니다.');
        return;
      }
    } else if (!window.confirm(`이 ${typeLabel} 신고를 "${label}" 처리하시겠습니까?`)) {
      return;
    }
    setActingId(report.id);
    try {
      await actionAdminReport(report.id, action);
      if (import.meta.env.DEV) {
        console.info('[AdminReports] action done', { report_id: report.id, action });
      }
      setExpandedId(null);
      fetchReports();
    } catch (err) {
      console.error('[AdminReports] action failed', {
        report_id: report.id,
        action,
        status: err?.response?.status,
      });
      alert(err?.response?.data?.detail || err?.response?.data?.error || '신고 처리에 실패했습니다.');
    } finally {
      setActingId(null);
    }
  };

  const handleFaceSearch = async (report) => {
    setFaceSearch({
      reportId: report.id, loading: true, error: '',
      matches: [], scanned: 0, skipped: 0, selected: {}, purging: false,
    });
    try {
      const res = await adminFaceSearch(report.id);
      const matches = Array.isArray(res.data?.matches) ? res.data.matches : [];
      if (import.meta.env.DEV) {
        console.info('[AdminReports] face-search done', {
          report_id: report.id,
          matches: matches.length,
          scanned: res.data?.scanned,
          skipped: res.data?.skipped,
        });
      }
      setFaceSearch((prev) => (prev && prev.reportId === report.id ? {
        ...prev,
        loading: false,
        matches,
        scanned: res.data?.scanned ?? 0,
        skipped: res.data?.skipped ?? 0,
      } : prev));
    } catch (err) {
      console.error('[AdminReports] face-search failed', {
        report_id: report.id,
        status: err?.response?.status,
      });
      setFaceSearch((prev) => (prev && prev.reportId === report.id ? {
        ...prev,
        loading: false,
        error: err?.response?.data?.detail || err?.response?.data?.error || '인물 수색에 실패했습니다.',
      } : prev));
    }
  };

  const closeFaceSearch = () => {
    setFaceSearch((prev) => (prev?.loading || prev?.purging ? prev : null));
  };

  const matchKey = (m) => `${m.type}:${m.id}`;

  const toggleMatch = (m) => {
    setFaceSearch((prev) => {
      if (!prev) return prev;
      const key = matchKey(m);
      return { ...prev, selected: { ...prev.selected, [key]: !prev.selected[key] } };
    });
  };

  const toggleAllMatches = () => {
    setFaceSearch((prev) => {
      if (!prev) return prev;
      const allSelected = prev.matches.length > 0 &&
        prev.matches.every((m) => prev.selected[matchKey(m)]);
      const selected = {};
      if (!allSelected) prev.matches.forEach((m) => { selected[matchKey(m)] = true; });
      return { ...prev, selected };
    });
  };

  const handlePurge = async () => {
    if (!faceSearch || faceSearch.purging) return;
    const targets = faceSearch.matches
      .filter((m) => faceSearch.selected[matchKey(m)])
      .map((m) => ({ type: m.type, id: m.id }));
    if (targets.length === 0) return;
    // 2중 confirm
    if (!window.confirm(`선택한 ${targets.length}건을 일괄 몰수(영구 삭제)합니다. 계속하시겠습니까?`)) return;
    if (!window.confirm('몰수된 항목은 복구할 수 없습니다. 정말 진행하시겠습니까?')) return;
    setFaceSearch((prev) => (prev ? { ...prev, purging: true } : prev));
    try {
      const res = await adminPurge(faceSearch.reportId, targets);
      const purged = res.data?.purged || {};
      if (import.meta.env.DEV) {
        console.info('[AdminReports] purge done', {
          report_id: faceSearch.reportId,
          tracks: purged.tracks,
          characters: purged.characters,
          blacklisted: res.data?.blacklisted,
        });
      }
      alert(
        `몰수 완료 — 트랙 ${purged.tracks ?? 0}건, 캐릭터 ${purged.characters ?? 0}건` +
        (res.data?.blacklisted ? ' (원본 사진 블랙리스트 등록됨)' : ''),
      );
      setFaceSearch(null);
      setExpandedId(null);
      fetchReports();
    } catch (err) {
      console.error('[AdminReports] purge failed', {
        report_id: faceSearch.reportId,
        status: err?.response?.status,
      });
      alert(err?.response?.data?.detail || err?.response?.data?.error || '일괄 몰수에 실패했습니다.');
      setFaceSearch((prev) => (prev ? { ...prev, purging: false } : prev));
    }
  };

  const selectedCount = faceSearch
    ? faceSearch.matches.filter((m) => faceSearch.selected[matchKey(m)]).length
    : 0;
  const allSelected = !!faceSearch && faceSearch.matches.length > 0 &&
    faceSearch.matches.every((m) => faceSearch.selected[matchKey(m)]);

  return (
    <AdminLayout>
      <div className="admin-reports">
        <h2 className="admin-page-title">신고 관리</h2>

        <div className="admin-reports__filters">
          {STATUS_FILTERS.map((opt) => (
            <button
              key={opt.value}
              className={`admin-filter-btn ${status === opt.value ? 'active' : ''}`}
              onClick={() => { setStatus(opt.value); setPage(1); setExpandedId(null); }}
            >
              {opt.label}
            </button>
          ))}
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
                    <th>유형</th>
                    <th>대상</th>
                    <th>사유</th>
                    <th>신고자</th>
                    <th>상태</th>
                    <th>신고일</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => {
                    const isPending = r.status === 'pending';
                    const isBlinded = r.status === 'actioned' && r.action === 'blind';
                    const isConfirmed = r.status === 'actioned' && r.action === 'confirm_delete';
                    const canEnforce = r.target_type === 'track' || r.target_type === 'feed';
                    return (
                      <Fragment key={r.id}>
                        <tr
                          className={[
                            'admin-reports__row',
                            expandedId === r.id ? 'admin-reports__row--open' : '',
                            r.urgent ? 'admin-reports__row--urgent' : '',
                          ].filter(Boolean).join(' ')}
                          onClick={() => setExpandedId((prev) => (prev === r.id ? null : r.id))}
                        >
                          <td>
                            {r.urgent && (
                              <span className="admin-badge admin-reports__urgent-badge">긴급</span>
                            )}
                            {TYPE_LABEL[r.target_type] || r.target_type}
                          </td>
                          <td className="admin-reports__target-cell"><TargetPreview report={r} /></td>
                          <td>{REASON_LABEL[r.reason_code] || r.reason_code}</td>
                          <td>{r.reporter_nickname || '-'}</td>
                          <td>
                            {r.status === 'pending' && (
                              <span className="admin-badge admin-badge--yellow">미처리</span>
                            )}
                            {r.status === 'actioned' && (
                              <span className="admin-badge admin-badge--green">
                                처리됨{r.action ? ` (${ACTION_LABEL[r.action] || r.action})` : ''}
                              </span>
                            )}
                            {r.status === 'dismissed' && (
                              <span className="admin-badge admin-badge--gray">기각</span>
                            )}
                            {r.resolution && (
                              <span className="admin-reports__resolution">
                                {RESOLUTION_LABEL[r.resolution] || r.resolution}
                              </span>
                            )}
                          </td>
                          <td>{formatDate(r.created_at)}</td>
                        </tr>
                        {expandedId === r.id && (
                          <tr className="admin-reports__detail-row">
                            <td colSpan={6}>
                              <div className="admin-reports__detail">
                                {r.reason_text && (
                                  <p className="admin-reports__reason-text">{r.reason_text}</p>
                                )}

                                {/* v139 — 소유자 소명 (큐 응답에 appeal 있으면) */}
                                {r.appeal?.text && (
                                  <div className="admin-reports__appeal">
                                    <h4 className="admin-reports__pane-title">소유자 소명</h4>
                                    <p className="admin-reports__appeal-text">{r.appeal.text}</p>
                                    {r.appeal.created_at && (
                                      <span className="admin-reports__appeal-date">
                                        {formatDate(r.appeal.created_at)}
                                      </span>
                                    )}
                                  </div>
                                )}

                                {/* 양면 뷰 — 左 신고 증거 스냅샷 / 右 게시자의 최근 생성물 */}
                                <div className="admin-reports__panes">
                                  <section className="admin-reports__pane">
                                    <h4 className="admin-reports__pane-title">신고 증거 (접수 시점 스냅샷)</h4>
                                    {(Array.isArray(r.evidence) ? r.evidence : (r.evidence?.items || [])).length > 0 ? (
                                      <div className="admin-reports__evidence-list">
                                        {(Array.isArray(r.evidence) ? r.evidence : (r.evidence?.items || [])).map((item, idx) => (
                                          <EvidenceItem
                                            key={`${r.id}-ev-${idx}`}
                                            reportId={r.id}
                                            item={item || {}}
                                            idx={idx}
                                          />
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="admin-reports__pane-empty">증거 스냅샷이 없습니다.</p>
                                    )}
                                  </section>
                                  <section className="admin-reports__pane">
                                    <h4 className="admin-reports__pane-title">이 사용자의 최근 생성물</h4>
                                    <RecentContentPane userId={reportedUserId(r)} />
                                  </section>
                                </div>

                                <div className="admin-actions">
                                  {isPending && canEnforce && (
                                    <button
                                      className="admin-btn admin-btn--small admin-btn--danger"
                                      disabled={actingId === r.id}
                                      onClick={(e) => { e.stopPropagation(); handleAction(r, 'blind'); }}
                                    >
                                      블라인드
                                    </button>
                                  )}
                                  {isPending && r.target_type === 'comment' && (
                                    <button
                                      className="admin-btn admin-btn--small admin-btn--danger"
                                      disabled={actingId === r.id}
                                      onClick={(e) => { e.stopPropagation(); handleAction(r, 'delete'); }}
                                    >
                                      삭제
                                    </button>
                                  )}
                                  {canEnforce && (isPending || isBlinded) && (
                                    <button
                                      className="admin-btn admin-btn--small"
                                      disabled={!isBlinded || actingId === r.id}
                                      title={isBlinded ? '블라인드를 해제하고 원상 복구합니다.' : '블라인드 상태에서만 복원할 수 있습니다.'}
                                      onClick={(e) => { e.stopPropagation(); handleAction(r, 'restore'); }}
                                    >
                                      복원
                                    </button>
                                  )}
                                  {canEnforce && (isPending || isBlinded) && (
                                    <button
                                      className="admin-btn admin-btn--small admin-btn--danger"
                                      disabled={actingId === r.id}
                                      onClick={(e) => { e.stopPropagation(); handleAction(r, 'confirm_delete'); }}
                                    >
                                      확정 삭제
                                    </button>
                                  )}
                                  {isPending && (
                                    <button
                                      className="admin-btn admin-btn--small"
                                      disabled={actingId === r.id}
                                      onClick={(e) => { e.stopPropagation(); handleAction(r, 'dismiss'); }}
                                    >
                                      기각
                                    </button>
                                  )}
                                  {canEnforce && (isBlinded || isConfirmed) && (
                                    <button
                                      className="admin-btn admin-btn--small admin-btn--danger"
                                      disabled={!!faceSearch}
                                      title="같은 인물의 다른 생성물을 얼굴 대조로 수색합니다."
                                      onClick={(e) => { e.stopPropagation(); handleFaceSearch(r); }}
                                    >
                                      인물 수색
                                    </button>
                                  )}
                                  {!isPending && (
                                    <span className="admin-reports__handled">
                                      {isBlinded
                                        ? '블라인드 상태 — 복원·확정 삭제·인물 수색이 가능합니다.'
                                        : isConfirmed
                                          ? '확정 삭제됨 — 인물 수색이 가능합니다.'
                                          : '처리 완료된 신고입니다.'}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {reports.length === 0 && (
                    <tr><td colSpan={6} className="admin-empty">신고가 없습니다</td></tr>
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

        {/* 인물 수색 결과 모달 */}
        {faceSearch && (
          <div className="admin-reports__modal-overlay" onClick={closeFaceSearch}>
            <div className="admin-reports__modal" onClick={(e) => e.stopPropagation()}>
              <h3 className="admin-reports__modal-title">인물 수색 결과</h3>

              {faceSearch.loading ? (
                <p className="admin-reports__modal-loading">
                  얼굴 대조 수색 중입니다... 대상 수에 따라 수십 초가 걸릴 수 있습니다.
                </p>
              ) : faceSearch.error ? (
                <p className="admin-error">{faceSearch.error}</p>
              ) : (
                <>
                  <p className="admin-reports__modal-summary">
                    검사 {faceSearch.scanned}건 · 스킵 {faceSearch.skipped}건 · 매치 {faceSearch.matches.length}건
                  </p>
                  {faceSearch.matches.length > 0 ? (
                    <>
                      <label className="admin-reports__match-selectall">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleAllMatches}
                          disabled={faceSearch.purging}
                        />
                        전체 선택
                      </label>
                      <ul className="admin-reports__match-list">
                        {faceSearch.matches.map((m) => {
                          const pct = similarityPct(m.similarity);
                          return (
                            <li key={matchKey(m)} className="admin-reports__match-item">
                              <label className="admin-reports__match-label">
                                <input
                                  type="checkbox"
                                  checked={!!faceSearch.selected[matchKey(m)]}
                                  onChange={() => toggleMatch(m)}
                                  disabled={faceSearch.purging}
                                />
                                {m.thumbnail_url ? (
                                  <img
                                    className="admin-reports__match-thumb"
                                    src={adminMediaSrc(m.thumbnail_url)}
                                    alt=""
                                    onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                                  />
                                ) : (
                                  <span className="admin-reports__match-thumb admin-reports__match-thumb--empty">?</span>
                                )}
                                <span className="admin-reports__match-type">
                                  {m.type === 'character' ? '캐릭터' : '트랙'}
                                </span>
                                <span className="admin-reports__match-title" title={m.title || m.id}>
                                  {m.title || m.id}
                                </span>
                                <span className="admin-reports__match-similarity">
                                  {pct !== null ? `${pct}%` : '-'}
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  ) : (
                    <p className="admin-reports__pane-empty">동일 인물로 검출된 항목이 없습니다.</p>
                  )}
                </>
              )}

              <div className="admin-reports__modal-actions">
                <button
                  className="admin-btn admin-btn--small"
                  disabled={faceSearch.loading || faceSearch.purging}
                  onClick={() => setFaceSearch(null)}
                >
                  닫기
                </button>
                {!faceSearch.loading && !faceSearch.error && faceSearch.matches.length > 0 && (
                  <button
                    className="admin-btn admin-btn--small admin-btn--danger"
                    disabled={selectedCount === 0 || faceSearch.purging}
                    onClick={handlePurge}
                  >
                    {faceSearch.purging ? '몰수 중...' : `선택 ${selectedCount}건 일괄 몰수`}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
