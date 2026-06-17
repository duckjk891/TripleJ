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
 *   onRefetched?: (updatedGenerationDoc) => void  // 백필 성공 시 부모에 알림 (선택)
 *
 * 로그:
 *   - 토글 시 console.info('[LyricsTimestamp] toggle', {genId, variantIndex, expanded})
 *   - segments 가 비어있을 때 안내 메시지만 표시 (에러 아님)
 *   - 비어있고 generationId 가 있으면 "타임스탬프 불러오기" 버튼으로 백필 요청
 */

import { useState, useEffect, useId } from 'react';
import { FiChevronDown, FiChevronRight, FiClock } from 'react-icons/fi';
import * as api from '../api';
import './LyricsTimestampToggle.css';

function formatTime(sec) {
  if (sec == null || !isFinite(sec) || sec < 0) return '--:--';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  // 1자리 소수점 (mm:ss.s)
  const sStr = s.toFixed(1).padStart(4, '0'); // "07.3" 형태 보장
  return `${String(m).padStart(2, '0')}:${sStr}`;
}

// 응답 generation doc 에서 이 variant 의 timestamps 추출
function extractVariantTimestamps(doc, variantIndex) {
  const variants = Array.isArray(doc?.variants) ? doc.variants : [];
  if (variants.length === 0) return [];
  // index 가 명시되어 있으면 그걸로 매칭, 아니면 배열 위치 사용
  const byIndex = variants.find((vv) => vv?.index === variantIndex);
  const target = byIndex || variants[variantIndex];
  return Array.isArray(target?.timestamps) ? target.timestamps : [];
}

export default function LyricsTimestampToggle({
  segments,
  generationId,
  variantIndex = 0,
  className = '',
  label = '가사 타임스탬프',
  onRefetched = null,
}) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  // segments prop 으로 초기화하되, 성공적인 refetch 로 덮어쓸 수 있는 로컬 상태
  const [localSegs, setLocalSegs] = useState(
    Array.isArray(segments) ? segments : []
  );
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // 부모가 새 segments 를 내려주면 동기화 (단, refetch 로 채워진 값이 있으면 유지)
  useEffect(() => {
    const incoming = Array.isArray(segments) ? segments : [];
    setLocalSegs((prev) => {
      // 부모가 실제 데이터를 내려준 경우 그것을 우선 반영
      if (incoming.length > 0) return incoming;
      // 부모가 여전히 빈 배열이고, 로컬에 refetch 로 채운 값이 있으면 유지
      if (prev.length > 0) return prev;
      return incoming;
    });
  }, [segments]);

  const segs = Array.isArray(localSegs) ? localSegs : [];

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

  const handleRefetch = async (force = false) => {
    if (loading || !generationId) return;
    const tag = force ? 'reorganize' : 'refetch';
    setLoading(true);
    setErrorMsg('');
    if (import.meta.env.DEV) {
      console.info(`[LyricsTimestamp] ${tag} calling`, {
        genId: generationId,
        variantIndex,
      });
    }
    try {
      const { data } = await api.refetchGenerationTimestamps(generationId, force);
      const newSegs = extractVariantTimestamps(data, variantIndex);
      setLocalSegs(newSegs);
      if (import.meta.env.DEV) {
        console.info(`[LyricsTimestamp] ${tag} ok`, {
          genId: generationId,
          variantIndex,
          segs: newSegs.length,
        });
      }
      if (typeof onRefetched === 'function') {
        try {
          onRefetched(data);
        } catch { /* 부모 콜백 오류는 본 컴포넌트 표시에 영향 없음 */ }
      }
      if (newSegs.length === 0) {
        setErrorMsg('타임스탬프가 아직 없습니다');
      }
    } catch (err) {
      console.error(`[LyricsTimestamp] ${tag} failed`, {
        err,
        genId: generationId,
        variantIndex,
      });
      setErrorMsg(
        force ? '타임스탬프 정리에 실패했습니다.' : '불러오기에 실패했습니다'
      );
    } finally {
      setLoading(false);
    }
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
            <div className="lyrics-ts__empty">
              <div>가사 타임스탬프 없음</div>
              {generationId && (
                <button
                  type="button"
                  className="lyrics-ts__refetch"
                  onClick={() => handleRefetch(false)}
                  disabled={loading}
                >
                  {loading ? '불러오는 중...' : '타임스탬프 불러오기'}
                </button>
              )}
              {errorMsg && (
                <div className="lyrics-ts__error" role="alert">
                  {errorMsg}
                </div>
              )}
            </div>
          ) : (
            <>
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
              {generationId && (
                <div className="lyrics-ts__reorganize-bar">
                  <button
                    type="button"
                    className="lyrics-ts__refetch lyrics-ts__reorganize"
                    onClick={() => handleRefetch(true)}
                    disabled={loading}
                  >
                    {loading ? '정리 중...' : '타임스탬프 다시 정리'}
                  </button>
                  {errorMsg && (
                    <div className="lyrics-ts__error" role="alert">
                      {errorMsg}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
