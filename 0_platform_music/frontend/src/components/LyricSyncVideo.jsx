import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usePlayer } from '../contexts/PlayerContext';
import './LyricSyncVideo.css';

/**
 * v150 — 동영상 탭 "커버 + 가사 싱크" 실시간 재생 ((A)안 = 줄 글라이드)
 *
 * 실제 MV가 없고 가사 타임스탬프만 있는 트랙에서, 커버 이미지를 배경으로
 * 깔고 가사 전체를 세로로 쌓은 뒤 현재 줄이 중앙에 오도록 트랙을 부드럽게
 * (Apple Music / 멜론 스타일) 위로 미끄러뜨린다. 예전처럼 3줄 텍스트만
 * 스왑하지 않으므로 점프컷이 사라진다.
 *
 * 음악 무중단 원칙: 이 컴포넌트는 별도 미디어 엘리먼트를 만들지 않는다.
 * PlayerContext 의 단일 <Audio> 가 그대로 소스이며, 여기서는 context 의
 * `currentTime` 만 읽어 시각적으로 하이라이트할 뿐 오디오를 절대 건드리지
 * 않는다. (videoMode 도 설정하지 않음 → 컨트롤/재생이 오디오에 유지됨)
 *
 * currentTime 은 prop 대신 context 에서 직접 구독한다: PlayerPage 가 쓰는
 * 것과 동일한 usePlayer() 훅을 사용하면 timeupdate 마다 이 컴포넌트가
 * 재렌더되어 가사 하이라이트(idx)가 흐른다. 단, 트랙의 translateY 계산은
 * idx(활성 줄) 가 바뀔 때만 수행하므로 매 timeupdate 마다 reflow 하지 않는다.
 *
 * @param {string|null} coverSrc  커버 이미지 URL
 * @param {Array<{text:string,start:number,end:number}>} segments  가사 타임라인(초)
 */
export default function LyricSyncVideo({ coverSrc, segments }) {
  const { currentTime } = usePlayer();
  const segs = useMemo(() => (Array.isArray(segments) ? segments : []), [segments]);

  const containerRef = useRef(null);
  const trackRef = useRef(null);
  const activeLineRef = useRef(null);
  const [translateY, setTranslateY] = useState(0);

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.info('[LyricSyncVideo] mount', { segCount: segs.length, hasCover: !!coverSrc });
    }
    // 마운트 1회만: segs/coverSrc 변경 재로깅 불필요
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 현재 세그먼트 index = start <= currentTime 인 마지막 세그먼트 (이진 탐색)
  const idx = useMemo(() => {
    try {
      if (segs.length === 0) return -1;
      let lo = 0;
      let hi = segs.length - 1;
      let ans = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (segs[mid].start <= currentTime) {
          ans = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return ans;
    } catch (err) {
      console.error('[LyricSyncVideo] index compute failed', { err });
      return -1;
    }
  }, [segs, currentTime]);

  // 하이라이트 줄이 바뀔 때만 로깅
  const prevIdxRef = useRef(idx);
  useEffect(() => {
    if (idx !== prevIdxRef.current) {
      prevIdxRef.current = idx;
      if (import.meta.env.DEV) console.info('[LyricSyncVideo] line change', { idx });
    }
  }, [idx]);

  // idx === -1 (첫 줄 시작 전) 은 0번 줄을 활성 줄로 취급 → 시작 가사가 중앙에 대기.
  // 마지막 줄 이후에도 idx 는 마지막 줄에 고정되므로 중앙 유지. 단일 줄이면 항상 중앙.
  const activeIdx = idx < 0 ? 0 : idx;

  // 활성 줄의 세로 중심을 컨테이너 세로 중심에 맞추는 translateY 계산.
  // 공식: translateY = containerHeight/2 - (activeLine.offsetTop + activeLine.offsetHeight/2)
  // offsetTop 은 트랙(offsetParent) 기준이라 가변 줄 높이(줄바꿈된 긴 가사)에도 견고하다.
  // 의존성은 idx(→activeIdx) 와 줄 개수뿐 → currentTime 마다 재계산/reflow 하지 않음.
  useLayoutEffect(() => {
    const recalc = () => {
      try {
        const container = containerRef.current;
        const active = activeLineRef.current;
        if (!container || !active) return;
        const next = container.clientHeight / 2 - (active.offsetTop + active.offsetHeight / 2);
        setTranslateY(next);
      } catch (err) {
        console.error('[LyricSyncVideo] layout calc failed', { err });
      }
    };

    recalc();

    // 컨테이너 리사이즈 시 재정렬 (지원 브라우저 한정, 없으면 idx/segs 변경 재계산으로 충분)
    let ro = null;
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      ro = new ResizeObserver(recalc);
      ro.observe(containerRef.current);
    }
    return () => {
      if (ro) ro.disconnect();
    };
    // activeIdx 는 idx 파생값. currentTime 은 의도적으로 제외(매 timeupdate 스래싱 방지).
  }, [activeIdx, segs.length]);

  if (segs.length === 0) return null;

  return (
    <div className="lyric-sync">
      {coverSrc ? (
        <img src={coverSrc} alt="" className="lyric-sync__bg" />
      ) : (
        /* v211 3순위: 커버 없음 = 순흑 배경 + 가사 스크롤 — 구 ♪ 글리프+테마 그라데이션은
           라이트 테마에서 밝은 배경이 스크림(0.35~0.58)을 뚫어 흰 가사 대비가 열화됐다(실측). */
        <div className="lyric-sync__bg lyric-sync__bg--black" />
      )}
      <div className="lyric-sync__scrim" />
      <div className="lyric-sync__lines" ref={containerRef}>
        <div
          className="lyric-sync__track"
          ref={trackRef}
          style={{ transform: `translateY(${translateY}px)` }}
        >
          {segs.map((seg, i) => {
            const dist = Math.abs(i - activeIdx);
            const isActive = idx >= 0 && i === idx;
            let cls = 'lyric-sync__line';
            if (isActive) cls += ' lyric-sync__line--active';
            else if (dist === 1) cls += ' lyric-sync__line--near';
            else cls += ' lyric-sync__line--far';
            return (
              <p
                key={i}
                className={cls}
                ref={i === activeIdx ? activeLineRef : null}
              >
                {seg?.text || ' '}
              </p>
            );
          })}
        </div>
      </div>
    </div>
  );
}
