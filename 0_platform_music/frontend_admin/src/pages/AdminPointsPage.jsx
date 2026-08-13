import { useState, useEffect, useCallback } from 'react';
import AdminLayout from '../components/AdminLayout';
import AdminUserSearchDropdown from '../components/AdminUserSearchDropdown';
import AdminPointsDashboard from '../components/AdminPointsDashboard';
import {
  getAdminPointsSummary,
  getAdminUserPointBalance,
  getAdminUserPointEvents,
  adjustAdminPoints,
  getPointsCosts,
} from '../api';
import { formatDate } from '../utils/format';
import { actionLabel } from '../utils/pointsLabels';
import './AdminPointsPage.css';

// 별(재화) 관리 (v180) — 4블록: ①전체 요약 카드 ②사용자 검색+잔액+지급/차감 ③원장 테이블 ④비용표(읽기 전용).
// 조정 성공 시 잔액·요약·원장 3자 갱신. 로그 prefix `[AdminPoints]`.
// 사유·닉네임 원문은 콘솔에 출력하지 않는다(길이·건수·status 만).

const MAX_ADJUST_AMOUNT = 10000;
const MAX_REASON_LEN = 200;
const EVENTS_LIMIT = 20;

// 액션 한글 라벨(BASE_ACTION_LABELS·actionLabel)은 v181 에서 utils/pointsLabels.js 로 추출 —
// 분석 대시보드와 공유하는 단일 소스. (페이지 파일 named export 는 react-refresh 규칙 위반이라 모듈 분리)

// 비용표 액션 라벨 (POINT_COSTS 키 기준) — 미등록 원문 fallback
const COST_LABELS = {
  lyrics: '작사',
  compose: '작곡',
  cover: '커버 이미지',
  character: '캐릭터 시트',
  fatigue_skip: '피로 쿨다운 스킵',
};

const EVENT_FILTERS = [
  { value: 'all', label: '전체' },
  { value: 'earn', label: '적립' },
  { value: 'spend', label: '사용' },
  { value: 'refund', label: '환불' },
  { value: 'admin', label: '관리자 조정' },
];

function displayName(user) {
  const nickname = user?.nickname || '알 수 없음';
  return user?.code ? `${nickname}#${user.code}` : nickname;
}

export default function AdminPointsPage() {
  // v181 — 탭: 운영(ops, v180 기존 블록) / 분석 대시보드(dash)
  const [tab, setTab] = useState('ops');

  // ① 전체 요약
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState('');

  // ② 선택 사용자 + 잔액 + 조정 폼
  const [selectedUser, setSelectedUser] = useState(null);
  const [balance, setBalance] = useState(null);
  const [direction, setDirection] = useState('grant');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [notice, setNotice] = useState(''); // 조정 폼 인라인 안내(검증/에러)

  // ③ 원장
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // ④ 비용표
  const [costs, setCosts] = useState(null);

  const loadSummary = useCallback(async () => {
    setSummaryError('');
    if (import.meta.env.DEV) console.info('[AdminPoints] loading summary');
    try {
      const { data } = await getAdminPointsSummary();
      setSummary(data || {});
    } catch (err) {
      console.error('[AdminPoints] getAdminPointsSummary failed', { status: err?.response?.status, message: err?.message });
      setSummaryError('요약을 불러오지 못했습니다.');
    }
  }, []);

  const loadBalance = useCallback(async (userId) => {
    try {
      const { data } = await getAdminUserPointBalance(userId);
      if (typeof data?.balance !== 'number') {
        console.warn('[AdminPoints] balance missing in response', { keys: Object.keys(data || {}) });
      }
      setBalance(typeof data?.balance === 'number' ? data.balance : 0);
    } catch (err) {
      console.error('[AdminPoints] getAdminUserPointBalance failed', { status: err?.response?.status, message: err?.message });
      setBalance(null);
    }
  }, []);

  const loadEvents = useCallback(async (userId, pageNum, filterVal) => {
    setEventsLoading(true);
    setEventsError('');
    if (import.meta.env.DEV) console.info('[AdminPoints] loading events', { page: pageNum, filter: filterVal });
    try {
      const params = { page: pageNum, limit: EVENTS_LIMIT };
      if (filterVal !== 'all') params.filter = filterVal;
      const { data } = await getAdminUserPointEvents(userId, params);
      if (!Array.isArray(data?.events)) {
        console.warn('[AdminPoints] unexpected events response shape', { hasEvents: 'events' in (data || {}) });
      }
      setEvents(Array.isArray(data?.events) ? data.events : []);
      setTotalPages(data?.pagination?.totalPages || 1);
      if (import.meta.env.DEV) console.info('[AdminPoints] events loaded', { count: (data?.events || []).length });
    } catch (err) {
      console.error('[AdminPoints] getAdminUserPointEvents failed', { status: err?.response?.status, message: err?.message });
      setEventsError('원장을 불러오지 못했습니다.');
    } finally {
      setEventsLoading(false);
    }
  }, []);

  // 최초 로드 — 요약 + 비용표(1회)
  useEffect(() => {
    // 기존 페이지 관행(AdminLogsPage fetch-in-effect)과 동일 패턴
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSummary();
    (async () => {
      try {
        const { data } = await getPointsCosts();
        setCosts(data?.costs && typeof data.costs === 'object' ? data.costs : {});
      } catch (err) {
        console.error('[AdminPoints] getPointsCosts failed', { status: err?.response?.status, message: err?.message });
        setCosts({});
      }
    })();
  }, [loadSummary]);

  // 원장 로드 — 선택/페이지/필터 변경 시
  useEffect(() => {
    if (!selectedUser?.id) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadEvents(selectedUser.id, page, filter);
  }, [selectedUser, page, filter, loadEvents]);

  const handleSelectUser = useCallback((user) => {
    if (import.meta.env.DEV) console.info('[AdminPoints] user selected', { id8: String(user?.id || '').slice(0, 8) });
    setSelectedUser(user);
    setBalance(null);
    setNotice('');
    setAmount('');
    setReason('');
    setPage(1);
    setFilter('all');
    loadBalance(user.id);
  }, [loadBalance]);

  const handleAdjust = useCallback(async () => {
    if (adjusting || !selectedUser?.id) return;
    const amountNum = Number(amount);
    const reasonTrimmed = reason.trim();
    if (!Number.isInteger(amountNum) || amountNum < 1 || amountNum > MAX_ADJUST_AMOUNT) {
      setNotice(`수량은 1~${MAX_ADJUST_AMOUNT.toLocaleString()} 사이의 정수로 입력해주세요.`);
      return;
    }
    if (!reasonTrimmed) {
      setNotice('사유를 입력해주세요.');
      return;
    }
    if (reasonTrimmed.length > MAX_REASON_LEN) {
      setNotice(`사유는 ${MAX_REASON_LEN}자 이내로 입력해주세요.`);
      return;
    }
    setNotice('');
    const dirLabel = direction === 'grant' ? '지급' : '차감';
    const confirmed = window.confirm(
      `${displayName(selectedUser)} 님에게 별 ${amountNum.toLocaleString()}개를 ${dirLabel}합니다.\n\n사유: ${reasonTrimmed}\n\n진행하시겠습니까?`
    );
    if (!confirmed) return;
    setAdjusting(true);
    if (import.meta.env.DEV) {
      console.info('[AdminPoints] adjusting', {
        target: String(selectedUser.id).slice(0, 8), direction, amount: amountNum, reason_len: reasonTrimmed.length,
      });
    }
    try {
      const { data } = await adjustAdminPoints(selectedUser.id, direction, amountNum, reasonTrimmed);
      const newBalance = typeof data?.balance === 'number' ? data.balance : null;
      if (newBalance === null) {
        console.warn('[AdminPoints] balance missing in adjust response', { keys: Object.keys(data || {}) });
      }
      if (import.meta.env.DEV) console.info('[AdminPoints] adjust done', { direction, amount: amountNum });
      alert(`${dirLabel} 완료 — 현재 잔액 ${newBalance !== null ? newBalance.toLocaleString() : '?'}개`);
      setAmount('');
      setReason('');
      // 3자 갱신: 잔액 + 요약 + 원장
      if (newBalance !== null) setBalance(newBalance);
      else loadBalance(selectedUser.id);
      loadSummary();
      if (page === 1 && filter === 'all') loadEvents(selectedUser.id, 1, 'all');
      else { setPage(1); setFilter('all'); } // effect 가 재조회
    } catch (err) {
      const status = err?.response?.status;
      console.error('[AdminPoints] adjustAdminPoints failed', {
        status, direction, amount: amountNum, reason_len: reasonTrimmed.length, message: err?.message,
      });
      if (status === 400) {
        const detail = err?.response?.data?.detail || err?.response?.data?.error || err?.response?.data?.message;
        setNotice(detail || '입력 값이 올바르지 않습니다.');
      } else if (status === 404) {
        setNotice('사용자를 찾을 수 없습니다.');
      } else if (status === 403) {
        setNotice('권한이 없습니다.');
      } else {
        console.warn('[AdminPoints] unexpected adjust error status', { status });
        setNotice('처리에 실패했습니다. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      setAdjusting(false);
    }
  }, [adjusting, selectedUser, direction, amount, reason, page, filter, loadBalance, loadSummary, loadEvents]);

  const summaryCards = [
    { label: '유통 잔액 합계', value: summary?.total_balance },
    { label: '누적 적립', value: summary?.total_earned },
    { label: '누적 소진', value: summary?.total_spent },
    { label: '오늘 (적립/소진)', value: null, today: true },
  ];

  return (
    <AdminLayout>
      <div className="admin-points">
        <h2 className="admin-page-title">별 관리</h2>

        {/* v181 — 탭 스위치: 운영(v180 블록 그대로) / 분석 대시보드 */}
        <div className="admin-points__tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'ops'}
            className={`admin-points__tab ${tab === 'ops' ? 'admin-points__tab--active' : ''}`}
            onClick={() => setTab('ops')}
          >
            운영
          </button>
          <button
            role="tab"
            aria-selected={tab === 'dash'}
            className={`admin-points__tab ${tab === 'dash' ? 'admin-points__tab--active' : ''}`}
            onClick={() => setTab('dash')}
          >
            분석 대시보드
          </button>
        </div>

        {tab === 'dash' && <AdminPointsDashboard />}

        {tab === 'ops' && (
        <>
        {/* ① 전체 요약 */}
        {summaryError ? (
          <div className="admin-error">
            <p>{summaryError}</p>
            <button className="admin-btn admin-btn--small" onClick={loadSummary}>재시도</button>
          </div>
        ) : (
          <div className="admin-points__stats">
            {summaryCards.map((c) => (
              <div key={c.label} className="admin-points__stat-card">
                <span className="admin-points__stat-label">{c.label}</span>
                <span className="admin-points__stat-value">
                  {c.today
                    ? `+${(summary?.today_earned ?? 0).toLocaleString()} / -${(summary?.today_spent ?? 0).toLocaleString()}`
                    : (c.value ?? 0).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* ② 사용자 검색 + 잔액 + 지급/차감 */}
        <section className="admin-points__section">
          <h3 className="admin-points__section-title">사용자 조정</h3>
          <div className="admin-points__search-row">
            <AdminUserSearchDropdown onSelect={handleSelectUser} disabled={adjusting} />
          </div>

          {selectedUser && (
            <div className="admin-points__user-card">
              <div className="admin-points__user-info">
                <span className="admin-points__user-name">{displayName(selectedUser)}</span>
                <span className="admin-points__user-balance">
                  잔액 <strong>{balance !== null ? balance.toLocaleString() : '...'}</strong> ⭐
                </span>
              </div>

              <div className="admin-points__adjust-form">
                <div className="admin-points__direction" role="radiogroup" aria-label="조정 방향">
                  <label className="admin-points__radio">
                    <input
                      type="radio"
                      name="admin-points-direction"
                      value="grant"
                      checked={direction === 'grant'}
                      onChange={() => { setDirection('grant'); setNotice(''); }}
                      disabled={adjusting}
                    />
                    <span>지급</span>
                  </label>
                  <label className="admin-points__radio">
                    <input
                      type="radio"
                      name="admin-points-direction"
                      value="deduct"
                      checked={direction === 'deduct'}
                      onChange={() => { setDirection('deduct'); setNotice(''); }}
                      disabled={adjusting}
                    />
                    <span>차감</span>
                  </label>
                </div>
                <input
                  type="number"
                  className="admin-points__amount"
                  placeholder="수량"
                  min={1}
                  max={MAX_ADJUST_AMOUNT}
                  value={amount}
                  onChange={(e) => { setAmount(e.target.value); if (notice) setNotice(''); }}
                  disabled={adjusting}
                />
                <input
                  type="text"
                  className="admin-points__reason"
                  placeholder="사유 (필수, 200자 이내)"
                  maxLength={MAX_REASON_LEN}
                  value={reason}
                  onChange={(e) => { setReason(e.target.value); if (notice) setNotice(''); }}
                  disabled={adjusting}
                />
                <button className="admin-points__submit" onClick={handleAdjust} disabled={adjusting}>
                  {adjusting ? '처리 중...' : direction === 'grant' ? '지급' : '차감'}
                </button>
              </div>
              {notice && <p className="admin-points__notice">{notice}</p>}
            </div>
          )}
        </section>

        {/* ③ 원장 */}
        {selectedUser && (
          <section className="admin-points__section">
            <div className="admin-points__ledger-head">
              <h3 className="admin-points__section-title">원장</h3>
              <label className="admin-points__filter-label">
                필터
                <select
                  className="admin-points__select"
                  value={filter}
                  onChange={(e) => { setFilter(e.target.value); setPage(1); }}
                >
                  {EVENT_FILTERS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </label>
            </div>

            {eventsError ? (
              <div className="admin-error">
                <p>{eventsError}</p>
                <button className="admin-btn admin-btn--small" onClick={() => loadEvents(selectedUser.id, page, filter)}>재시도</button>
              </div>
            ) : eventsLoading ? (
              <p className="admin-loading">로딩 중...</p>
            ) : (
              <>
                <div className="admin-table-wrap">
                  <table className="admin-table--full">
                    <thead>
                      <tr>
                        <th>시각</th>
                        <th>액션</th>
                        <th>증감</th>
                        <th>ref</th>
                        <th>일자</th>
                      </tr>
                    </thead>
                    <tbody>
                      {events.map((ev, i) => (
                        <tr key={`${ev.action}-${ev.created_at}-${i}`}>
                          <td className="admin-points__nowrap">{formatDate(ev.created_at)}</td>
                          <td>{actionLabel(ev.action)}</td>
                          <td className={ev.amount > 0 ? 'admin-points__amount-pos' : 'admin-points__amount-neg'}>
                            {ev.amount > 0 ? `+${ev.amount.toLocaleString()}` : ev.amount.toLocaleString()}
                          </td>
                          <td className="admin-points__ref-cell" title={ev.ref || undefined}>{ev.ref || '-'}</td>
                          <td className="admin-points__nowrap">{ev.day || '-'}</td>
                        </tr>
                      ))}
                      {events.length === 0 && (
                        <tr><td colSpan={5} className="admin-empty">내역이 없습니다</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {totalPages > 1 && (
                  <div className="admin-pagination">
                    <button className="admin-btn admin-btn--small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                      이전
                    </button>
                    <span className="admin-pagination__info">{page} / {totalPages}</span>
                    <button className="admin-btn admin-btn--small" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                      다음
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {/* ④ 비용표 (읽기 전용) */}
        <section className="admin-points__section">
          <h3 className="admin-points__section-title">비용표 (읽기 전용)</h3>
          {costs === null ? (
            <p className="admin-loading">로딩 중...</p>
          ) : Object.keys(costs).length === 0 ? (
            <p className="admin-loading">비용표를 불러오지 못했습니다.</p>
          ) : (
            <div className="admin-table-wrap admin-points__costs">
              <table className="admin-table--full">
                <thead>
                  <tr>
                    <th>액션</th>
                    <th>단가</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(costs).map(([action, cost]) => (
                    <tr key={action}>
                      <td>{COST_LABELS[action] || action}</td>
                      <td>⭐ {Number(cost).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        </>
        )}
      </div>
    </AdminLayout>
  );
}
