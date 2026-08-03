import { useState, useEffect, useCallback } from 'react';
import * as api from '../api';
import './AttendanceCard.css';

// 출석체크(데일리 체크인) 모달
// props:
//   onClose         : 모달 닫기
//   onBalanceChange : (balance:int) => void  — 체크인/조회 후 Header 별 잔액 즉시 갱신
//
// 백엔드 계약 (prefix /api/attendance)
//   GET  /attendance/status   → { checked_today, cycle_day, cumulative_count, today_reward,
//                                 calendar:[{day,reward,claimed}x10], balance }
//   POST /attendance/check-in → { success, awarded, cycle_day, cumulative_count, balance, already }
export default function AttendanceCard({ onClose, onBalanceChange }) {
  const [status, setStatus] = useState(null);   // status 응답 dict
  const [loading, setLoading] = useState(true);  // 초기 로드
  const [error, setError] = useState('');        // 사용자 표시용 에러 메시지
  const [claiming, setClaiming] = useState(false);
  const [toast, setToast] = useState(null);      // { text } — 지급 애니메이션 문구
  const [notice, setNotice] = useState('');      // "이미 오늘 출석" 등 안내

  const loadStatus = useCallback(async () => {
    if (import.meta.env.DEV) console.info('[AttendanceCard] calling getAttendanceStatus');
    try {
      const { data } = await api.getAttendanceStatus();
      setStatus(data);
      if (import.meta.env.DEV) {
        console.info('[AttendanceCard] status loaded', {
          checked_today: data?.checked_today,
          cycle_day: data?.cycle_day,
          cumulative_count: data?.cumulative_count,
        });
      }
      if (typeof data?.balance === 'number') onBalanceChange?.(data.balance);
      return data;
    } catch (err) {
      console.error('[AttendanceCard] getAttendanceStatus failed', {
        status: err?.response?.status,
        message: err?.message,
      });
      setError('출석 현황을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
      return null;
    }
  }, [onBalanceChange]);

  // 마운트(모달 open) 시 현황 로드
  useEffect(() => {
    if (import.meta.env.DEV) console.info('[AttendanceCard] modal open');
    let alive = true;
    setLoading(true);
    setError('');
    loadStatus().finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [loadStatus]);

  const handleCheckIn = useCallback(async () => {
    if (claiming || status?.checked_today) return;
    setClaiming(true);
    setNotice('');
    if (import.meta.env.DEV) console.info('[AttendanceCard] check-in start');
    try {
      const { data } = await api.postAttendanceCheckIn();
      if (import.meta.env.DEV) {
        console.info('[AttendanceCard] check-in success', {
          awarded: data?.awarded,
          already: data?.already,
          balance: data?.balance,
        });
      }
      if (typeof data?.balance === 'number') onBalanceChange?.(data.balance);

      if (data?.already) {
        setNotice('이미 오늘 출석했어요 ✅');
      } else if (data?.awarded > 0) {
        setToast({ text: `🎉 ${data.cycle_day}일차 출석! ⭐ +${data.awarded}` });
        window.setTimeout(() => setToast(null), 2600);
      } else {
        console.warn('[AttendanceCard] check-in returned no award', { data });
      }
      // 응답 반영 + 캘린더/claimed 정확성 위해 status 재조회
      await loadStatus();
    } catch (err) {
      console.error('[AttendanceCard] check-in failed', {
        status: err?.response?.status,
        message: err?.message,
      });
      setError('출석체크에 실패했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setClaiming(false);
    }
  }, [claiming, status, loadStatus, onBalanceChange]);

  const checkedToday = !!status?.checked_today;
  const cycleDay = status?.cycle_day;
  const calendar = status?.calendar || [];

  return (
    <div className="attendance__overlay" onClick={onClose}>
      <div
        className="attendance__modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="출석체크"
      >
        <div className="attendance__head">
          <h2 className="attendance__title">⭐ 출석체크</h2>
          <button className="attendance__close" onClick={onClose} aria-label="닫기">✕</button>
        </div>

        {loading ? (
          <div className="attendance__state">불러오는 중…</div>
        ) : error ? (
          <div className="attendance__state attendance__state--error">
            {error}
            <button className="attendance__retry" onClick={() => { setError(''); setLoading(true); loadStatus().finally(() => setLoading(false)); }}>
              다시 시도
            </button>
          </div>
        ) : (
          <>
            <div className="attendance__summary">
              <span className="attendance__cumulative">
                누적 출석 <b>{status?.cumulative_count ?? 0}</b>일
              </span>
              <span className="attendance__progress">
                이번 사이클 {checkedToday ? cycleDay : Math.max(0, (cycleDay ?? 1) - 1)}/10
              </span>
            </div>

            <div className="attendance__grid">
              {calendar.map((c) => {
                const isNext = !checkedToday && c.day === cycleDay;
                const isBonus = c.day === 5 || c.day === 10;
                const cls = [
                  'attendance__cell',
                  c.claimed ? 'is-claimed' : '',
                  isNext ? 'is-next' : '',
                  isBonus ? 'is-bonus' : '',
                ].filter(Boolean).join(' ');
                return (
                  <div key={c.day} className={cls}>
                    <span className="attendance__cell-day">{c.day}일차</span>
                    <span className="attendance__cell-reward">⭐{c.reward}</span>
                    <span className="attendance__cell-mark">
                      {c.claimed ? '✅' : isNext ? '🎁' : '🔒'}
                    </span>
                  </div>
                );
              })}
            </div>

            {notice && <div className="attendance__notice">{notice}</div>}

            <button
              className="attendance__claim"
              onClick={handleCheckIn}
              disabled={checkedToday || claiming}
            >
              {checkedToday
                ? '오늘 출석 완료 ✅'
                : claiming
                  ? '처리 중…'
                  : `⭐ 오늘 출석하고 별 받기${cycleDay ? ` (⭐${status?.today_reward})` : ''}`}
            </button>
          </>
        )}

        {toast && <div className="attendance__toast">{toast.text}</div>}
      </div>
    </div>
  );
}
