import { useState, useEffect, useCallback, Fragment } from 'react';
import AdminLayout from '../components/AdminLayout';
import AdminBroadcastModal from '../components/AdminBroadcastModal';
import { getAdminNotices, getAdminNoticeDetail } from '../api';
import { formatDate } from '../utils/format';
import './AdminNoticesPage.css';

// 공지 관리 (v194) — 전체발송으로 나간 공지 DM 의 이력 + 읽음 통계.
// 발송/재발송은 신규 API 없이 기존 POST /admin/cs/broadcast(AdminBroadcastModal) 를 그대로 쓴다.
// 행 클릭 → 확장행에서 본문 전문(상세 API) + "이 공지 재발송"(모달 prefill).
// 로그 prefix `[AdminNotices]` — 모든 라인에 추적자 notice(=id 앞 8자) 포함.
// **공지 본문 원문·관리자 닉네임 원문은 콘솔에 출력하지 않는다**(길이·건수·상태만).

const LIST_LIMIT = 20;

// 상태 뱃지. stale(=sending 고착 추정)은 서버 판정값이며 status 표시를 덮어쓴다 — 프론트 재판정 금지.
const STATUS_META = {
  sending: { label: '발송중', badge: 'admin-badge--yellow' },
  done: { label: '완료', badge: 'admin-badge--green' },
  failed: { label: '실패', badge: 'admin-badge--red' },
};

const STALE_META = { label: '중단됨(확인 필요)', badge: 'admin-badge--gray' };

// AdminBroadcastModal.jsx 의 AUDIENCES 와 동일 값·동일 라벨(발송 대상 표기 일원화).
const AUDIENCE_LABELS = {
  all: '전체',
  users: '일반 사용자',
  customers: '고객',
};

function statusMeta(notice) {
  if (notice?.stale === true) return STALE_META;
  return STATUS_META[notice?.status] || { label: notice?.status || '-', badge: 'admin-badge--gray' };
}

function audienceLabel(value) {
  return AUDIENCE_LABELS[value] || value || '-';
}

function shortId(id) {
  return String(id ?? '').slice(0, 8);
}

function num(v) {
  return (typeof v === 'number' ? v : 0).toLocaleString();
}

// 읽음률 표기 — 서버 계산값을 **재계산 없이** 소수 1자리로 고정한다(50.0 → "50.0", 0 → "0.0").
// JS 숫자 문자열화가 `.0` 을 버리는 것만 교정하는 **표시 전용** 변환이다.
// 숫자가 아니거나 유한하지 않은 값(NaN/Infinity/null/undefined)은 "0.0" 폴백 — 화면에 NaN 노출 금지.
function rate(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n.toFixed(1) : '0.0';
}

export default function AdminNoticesPage() {
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);

  // 행 확장 — id → {loading, error, data(상세 전문)}
  const [expandedId, setExpandedId] = useState(null);
  const [detailState, setDetailState] = useState({});

  // 발송/재발송 모달 — prefill 은 열 때만 주입된다(모달 내부 useEffect 계약).
  const [modal, setModal] = useState({ open: false, text: '', audience: '', title: '📢 공지 발송' });

  const loadNotices = useCallback(async (pageNum) => {
    setLoading(true);
    setError('');
    try {
      const { data } = await getAdminNotices({ page: pageNum, limit: LIST_LIMIT });
      const list = Array.isArray(data?.notices) ? data.notices : [];
      if (!Array.isArray(data?.notices)) {
        console.warn('[AdminNotices] unexpected notices response shape', { keys: Object.keys(data || {}) });
      }
      setNotices(list);
      const pg = data?.pagination || {};
      const tp =
        pg.totalPages ?? pg.pages ?? pg.total_pages ??
        (pg.total && pg.limit ? Math.ceil(pg.total / pg.limit) : 1);
      setTotalPages(Math.max(1, tp || 1));
      if (import.meta.env.DEV) console.info('[AdminNotices] list loaded', { page: pageNum, count: list.length });
    } catch (err) {
      console.error('[AdminNotices] getAdminNotices failed', { status: err?.response?.status, message: err?.message });
      setNotices([]);
      setError('공지 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 페이지 전환·발송 성공 시 재조회. 열려 있던 확장행은 접는다(다른 페이지의 행이 남지 않도록).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpandedId(null);
    loadNotices(page);
  }, [page, reloadKey, loadNotices]);

  const fetchDetail = useCallback(async (id) => {
    setDetailState((m) => ({ ...m, [id]: { loading: true } }));
    try {
      const { data } = await getAdminNoticeDetail(id);
      const detail = data?.notice || data || {};
      setDetailState((m) => ({ ...m, [id]: { loading: false, data: detail } }));
      if (import.meta.env.DEV) {
        console.info('[AdminNotices] detail loaded', { notice: shortId(id), text_len: (detail.text || '').length });
      }
    } catch (err) {
      console.error('[AdminNotices] getAdminNoticeDetail failed', {
        notice: shortId(id), status: err?.response?.status, message: err?.message,
      });
      setDetailState((m) => ({ ...m, [id]: { loading: false, error: true } }));
    }
  }, []);

  const handleToggle = useCallback((id) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (import.meta.env.DEV) console.info('[AdminNotices] row expanded', { notice: shortId(id) });
    const cached = detailState[id];
    if (!cached || cached.error) fetchDetail(id);
  }, [expandedId, detailState, fetchDetail]);

  // v188 선례 — 텍스트를 드래그해 복사하는 도중 행이 접히지 않도록 selection 가드.
  const handleRowClick = useCallback((id) => {
    const selected = window.getSelection?.().toString() || '';
    if (selected) return;
    handleToggle(id);
  }, [handleToggle]);

  // 키보드 접근성(Enter/Space). 행 내부 버튼에서 올라온 키 이벤트는 버튼이 자체 처리하므로 무시.
  const handleRowKeyDown = useCallback((e, id) => {
    if (e.target !== e.currentTarget) return;
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    e.preventDefault(); // Space 페이지 스크롤 방지
    handleToggle(id);
  }, [handleToggle]);

  const handleOpenNew = useCallback(() => {
    setModal({ open: true, text: '', audience: '', title: '📢 공지 발송' });
  }, []);

  const handleResend = useCallback((id, detail) => {
    const text = detail?.text || '';
    const audience = detail?.audience || '';
    if (import.meta.env.DEV) {
      console.info('[AdminNotices] resend prefill', { notice: shortId(id), text_len: text.length, audience });
    }
    setModal({ open: true, text, audience, title: '📢 공지 재발송' });
  }, []);

  const handleCloseModal = useCallback(() => {
    setModal((m) => ({ ...m, open: false }));
  }, []);

  // 발송/재발송 성공 → 1페이지부터 재조회. 방금 발송한 건은 백그라운드 fan-out 중이라
  // status:"sending" 으로 잡히는 것이 정상이다.
  const handleSent = useCallback(() => {
    setPage(1);
    setReloadKey((k) => k + 1);
  }, []);

  return (
    <AdminLayout>
      <div className="admin-notices">
        <div className="admin-notices__header">
          <h2 className="admin-page-title">공지 관리</h2>
          <button className="admin-notices__send-btn" onClick={handleOpenNew}>
            📢 공지 발송
          </button>
        </div>

        <AdminBroadcastModal
          open={modal.open}
          onClose={handleCloseModal}
          onSuccess={handleSent}
          initialText={modal.text}
          initialAudience={modal.audience}
          title={modal.title}
        />

        {error ? (
          <div className="admin-error">
            <p>{error}</p>
            <button className="admin-btn admin-btn--small" onClick={() => loadNotices(page)}>재시도</button>
          </div>
        ) : loading ? (
          <p className="admin-loading">로딩 중...</p>
        ) : (
          <>
            <div className="admin-table-wrap">
              <table className="admin-table--full admin-notices__table">
                <thead>
                  <tr>
                    <th>발송시각</th><th>발송 관리자</th><th>대상</th><th>발송수</th>
                    <th>성공/실패</th><th>읽음</th><th>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {notices.map((n) => {
                    const st = statusMeta(n);
                    const expanded = expandedId === n.id;
                    const detail = detailState[n.id];
                    const body = detail?.data || null;
                    return (
                      <Fragment key={n.id}>
                        {/* role="button" 은 두지 않는다 — table row 시맨틱(행 위치·열 연관)이 깨진다.
                            tabIndex/aria-expanded/키보드로 보조기술 경로를 제공한다(v188 선례). */}
                        <tr
                          className={`admin-notices__row ${expanded ? 'admin-notices__row--selected' : ''}`}
                          tabIndex={0}
                          aria-expanded={expanded}
                          onClick={() => handleRowClick(n.id)}
                          onKeyDown={(e) => handleRowKeyDown(e, n.id)}
                        >
                          <td className="admin-notices__nowrap">{formatDate(n.created_at)}</td>
                          <td className="admin-notices__admin-cell" title={n.admin_nickname || undefined}>
                            {n.admin_nickname || '-'}{n.admin_code ? `#${n.admin_code}` : ''}
                          </td>
                          <td className="admin-notices__nowrap">{audienceLabel(n.audience)}</td>
                          <td className="admin-notices__num">{num(n.targets)}</td>
                          <td className="admin-notices__num admin-notices__nowrap">
                            {num(n.sent)} / <span className={n.failed > 0 ? 'admin-notices__failed' : ''}>{num(n.failed)}</span>
                          </td>
                          {/* read_rate 는 서버 계산값 그대로 표시 — 프론트 재계산 금지(분모 규칙이 서버에 있다).
                              rate() 는 소수 1자리 고정(N명 (X.X%))만 담당하는 표시 전용 포맷터. */}
                          <td className="admin-notices__nowrap">
                            {num(n.read_count)}명 ({rate(n.read_rate)}%)
                          </td>
                          <td><span className={`admin-badge ${st.badge}`}>{st.label}</span></td>
                        </tr>
                        {expanded && (
                          <tr className="admin-notices__detail-row">
                            <td colSpan={7}>
                              <div className="admin-notices__detail">
                                {detail?.loading && !body ? (
                                  <p className="admin-notices__panel-status">본문 불러오는 중...</p>
                                ) : detail?.error ? (
                                  <>
                                    <p className="admin-notices__panel-status">공지 본문을 불러오지 못했습니다.</p>
                                    <button className="admin-btn admin-btn--small" onClick={(e) => { e.stopPropagation(); fetchDetail(n.id); }}>
                                      재시도
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    {/* 줄바꿈 보존(pre-line) — 원문 그대로 보여준다 */}
                                    <p className="admin-notices__text">{body?.text || n.text_preview || ''}</p>
                                    <dl className="admin-notices__meta">
                                      <div><dt>대상</dt><dd>{audienceLabel(body?.audience ?? n.audience)}</dd></div>
                                      <div><dt>글자수</dt><dd>{num(body?.text_len ?? n.text_len)}자</dd></div>
                                      <div><dt>전달</dt><dd>{num(body?.delivered ?? n.delivered)}건</dd></div>
                                      {/* 항목은 **항상** 렌더한다 — sending 행처럼 값이 없으면 항목이 통째로
                                          사라지는 대신 `-` 를 보인다. formatDate 는 null/undefined/빈 문자열을
                                          `-` 로 돌려주므로 Invalid Date·1970-01-01 이 나올 경로가 없다. */}
                                      <div><dt>완료 시각</dt><dd>{formatDate(body?.finished_at ?? n.finished_at)}</dd></div>
                                    </dl>
                                    <div className="admin-notices__detail-actions">
                                      <button
                                        className="admin-btn admin-btn--small"
                                        // 행 클릭 토글과 겹쳐 확장이 즉시 닫히는 것을 방지
                                        onClick={(e) => { e.stopPropagation(); handleResend(n.id, body); }}
                                        disabled={!body?.text}
                                      >
                                        이 공지 재발송
                                      </button>
                                      <span className="admin-notices__hint">
                                        본문이 모달에 채워집니다 — 대상은 모달에서 바꿀 수 있습니다.
                                      </span>
                                    </div>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {notices.length === 0 && (
                    <tr><td colSpan={7} className="admin-empty">발송된 공지가 없습니다</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="admin-pagination">
                <button className="admin-btn admin-btn--small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>이전</button>
                <span className="admin-pagination__info">{page} / {totalPages}</span>
                <button className="admin-btn admin-btn--small" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>다음</button>
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
