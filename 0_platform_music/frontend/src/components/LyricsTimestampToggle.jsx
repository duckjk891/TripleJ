/**
 * LyricsTimestampToggle — v74
 *
 * 가사 타임스탬프를 디폴트 접힘 상태로 노출하고, 클릭 / Enter / Space 로
 * 펼침/접힘을 토글한다. ARIA 적용 (aria-expanded, aria-controls).
 *
 * Props:
 *   segments: Array<{text:string, start:number, end:number}>
 *   generationId: string
 *   variantIndex: number
 *   className?: string  // 외부 wrapper 가 추가 스타일을 줄 수 있도록
 *   label?: string      // 토글 헤더 텍스트 (디폴트: "가사 타임스탬프")
 *
 * 로그:
 *   - 토글 시 console.info('[LyricsTimestamp] toggle', {genId, variantIndex, expanded})
 *   - segments 가 비어있을 때 안내 메시지만 표시 (에러 아님)
 */

import { useState, useId } from 'react';
import { FiChevronDown, FiChevronRight, FiClock } from 'react-icons/fi';
import './LyricsTimestampToggle.css';

function formatTime(sec) {
  if (sec == null || !isFinite(sec) || sec < 0) return '--:--';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  // 1자리 소수점 (mm:ss.s)
  const sStr = s.toFixed(1).padStart(4, '0'); // "07.3" 형태 보장
  return `${String(m).padStart(2, '0')}:${sStr}`;
}

export default function LyricsTimestampToggle({
  segments,
  generationId,
  variantIndex = 0,
  className = '',
  label = '가사 타임스탬프',
}) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  const segs = Array.isArray(segments) ? segments : [];

  const handleToggle = (e) => {
    if (e) {
      // 키보드 호출 시 Enter/Space 만 통과 (그 외 키는 무시)
      if (e.type === 'keydown') {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
      }
    }
    const next = !expanded;
    setExpanded(next);
    try {
      console.info('[LyricsTimestamp] toggle', {
        genId: generationId,
        variantIndex,
        expanded: next,
        segmentsCount: segs.length,
      });
    } catch { /* noop */ }
  };

  return (
    <div className={`lyrics-ts ${className}`.trim()}>
      <button
        type="button"
        className={`lyrics-ts__header ${expanded ? 'lyrics-ts__header--open' : ''}`}
        onClick={handleToggle}
        onKeyDown={handleToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
      >
        <span className="lyrics-ts__caret">
          {expanded ? <FiChevronDown /> : <FiChevronRight />}
        </span>
        <FiClock className="lyrics-ts__icon" />
        <span className="lyrics-ts__label">{label}</span>
        <span className="lyrics-ts__count">
          {segs.length > 0 ? `${segs.length} 줄` : '없음'}
        </span>
      </button>

      {expanded && (
        <div
          id={panelId}
          role="region"
          aria-label={label}
          className="lyrics-ts__panel"
        >
          {segs.length === 0 ? (
            <div className="lyrics-ts__empty">가사 타임스탬프 없음</div>
          ) : (
            <ul className="lyrics-ts__list">
              {segs.map((seg, i) => (
                <li key={i} className="lyrics-ts__row">
                  <span className="lyrics-ts__time">
                    {formatTime(seg?.start)}
                    <span className="lyrics-ts__time-sep">→</span>
                    {formatTime(seg?.end)}
                  </span>
                  <span className="lyrics-ts__text">{seg?.text || ''}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
