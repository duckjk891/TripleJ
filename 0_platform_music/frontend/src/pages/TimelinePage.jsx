import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../api';
import useFeedAudio from '../hooks/useFeedAudio';
import FeedPostCard from '../components/feed/FeedPostCard';
import './TimelinePage.css';

const PAGE_LIMIT = 10;

/**
 * v134 — 타임라인 (인스타형 혼합 랭킹 노출 페이지, /timeline — 비로그인 열람).
 * GET /api/feeds/timeline 랭킹은 서버 몫 — 받은 순서 그대로 렌더.
 * 무한 스크롤: IntersectionObserver 센티널 + 미지원/실패 시 [더 보기] 버튼 폴백.
 * BGM 자동재생 없음(다수 글 흐름) — 탭 시 재생만(FeedPostCard 의 BGM 배너가 처리).
 */
export default function TimelinePage() {
  const navigate = useNavigate();
  const [feeds, setFeeds] = useState([]);
  const [total, setTotal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [ioFallback, setIoFallback] = useState(false);

  const feedAudio = useFeedAudio();

  const pageRef = useRef(0); // 마지막으로 로드 완료한 페이지
  const fetchingRef = useRef(false); // 중복 요청 가드
  const exhaustedRef = useRef(false); // 서버가 빈 페이지 반환 — 추가 로드 중단
  const totalRef = useRef(null);
  const feedsLenRef = useRef(0);
  useEffect(() => { totalRef.current = total; }, [total]);
  useEffect(() => { feedsLenRef.current = feeds.length; }, [feeds]);

  const loadPage = useCallback(async (pageNum) => {
    if (fetchingRef.current || exhaustedRef.current) return;
    if (totalRef.current !== null && feedsLenRef.current >= totalRef.current) return;
    fetchingRef.current = true;
    if (pageNum > 1) setLoadingMore(true);
    if (import.meta.env.DEV) console.info('[TimelinePage] getTimeline start', { page: pageNum });
    try {
      const res = await api.getTimeline(pageNum, PAGE_LIMIT);
      const list = res.data?.feeds || [];
      const totalCount = res.data?.pagination?.total;
      // 서버 랭킹 순서 그대로 뒤에 이어붙임 — id 중복만 제거
      setFeeds((prev) => {
        const seen = new Set(prev.map((f) => f.id));
        return [...prev, ...list.filter((f) => !seen.has(f.id))];
      });
      if (typeof totalCount === 'number') setTotal(totalCount);
      if (list.length === 0 && pageNum > 1) exhaustedRef.current = true; // 방어 — total 과 불일치해도 중단
      pageRef.current = pageNum;
      if (import.meta.env.DEV) {
        console.info('[TimelinePage] getTimeline done', { page: pageNum, count: list.length, total: totalCount });
      }
    } catch (err) {
      console.error('[TimelinePage] getTimeline failed', { err, page: pageNum });
    } finally {
      fetchingRef.current = false;
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  // 첫 페이지 로드
  useEffect(() => { loadPage(1); }, [loadPage]);

  const hasMore = total !== null && feeds.length < total && !exhaustedRef.current;

  const handleLoadMore = useCallback(() => {
    loadPage(pageRef.current + 1);
  }, [loadPage]);

  // 무한 스크롤 센티널 — 뷰포트 진입 시 다음 페이지. 미지원/실패 시 버튼 폴백.
  const sentinelRef = useRef(null);
  useEffect(() => {
    if (loading || !hasMore || ioFallback) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      if (import.meta.env.DEV) console.info('[TimelinePage] IntersectionObserver unsupported, button fallback');
      setIoFallback(true);
      return undefined;
    }
    const el = sentinelRef.current;
    if (!el) return undefined;
    let observer;
    try {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadPage(pageRef.current + 1);
        }
      }, { rootMargin: '200px 0px' });
      observer.observe(el);
    } catch (err) {
      console.error('[TimelinePage] IntersectionObserver failed, button fallback', { err });
      setIoFallback(true);
      return undefined;
    }
    return () => observer.disconnect();
  }, [loading, hasMore, ioFallback, loadPage]);

  // 소유자 수정 — 단건 페이지(/feed/:id)의 인라인 편집 재사용
  const handleEdit = (feed) => {
    navigate(`/feed/${feed.id}`);
  };

  const handleDeleted = (feedId) => {
    setFeeds((prev) => prev.filter((f) => f.id !== feedId));
    setTotal((t) => (typeof t === 'number' ? Math.max(0, t - 1) : t));
    if (feedAudio.bgmOwnerId === feedId) feedAudio.stopBgm();
  };

  return (
    <div className="page-content">
      <div className="container timeline-page">
        <h2 className="timeline-page__title">타임라인</h2>

        {loading ? (
          <div className="timeline-page__status">타임라인을 불러오는 중...</div>
        ) : feeds.length === 0 ? (
          <div className="timeline-page__status">아직 타임라인에 글이 없습니다...</div>
        ) : (
          <div className="timeline-page__list">
            {feeds.map((feed) => (
              <FeedPostCard
                key={feed.id}
                feed={feed}
                feedAudio={feedAudio}
                showAuthor
                onEdit={handleEdit}
                onDeleted={handleDeleted}
              />
            ))}
          </div>
        )}

        {!loading && hasMore && (
          ioFallback ? (
            <button
              type="button"
              className="timeline-page__more-btn"
              onClick={handleLoadMore}
              disabled={loadingMore}
            >
              {loadingMore ? '불러오는 중...' : `더 보기 (${feeds.length}/${total})`}
            </button>
          ) : (
            <div ref={sentinelRef} className="timeline-page__sentinel" aria-hidden="true">
              {loadingMore && <span>불러오는 중...</span>}
            </div>
          )
        )}
      </div>
    </div>
  );
}
