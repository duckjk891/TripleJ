import { useState, useEffect, useRef, useCallback } from 'react';
import { FiEdit3 } from 'react-icons/fi';
import * as api from '../../api';
import useFeedAudio from '../../hooks/useFeedAudio';
import FeedPostCard from './FeedPostCard';
import FeedComposer from './FeedComposer';
import './FeedList.css';

const PAGE_LIMIT = 10;

/**
 * v131 — 채널(작성자별) 피드 목록.
 * 최신순 페이징(더 보기), isSelf 면 [새 피드 작성] → FeedComposer.
 * 피드 오디오(useFeedAudio) 1개를 카드들에 공유. 첫 로드시 첫 BGM 자동재생 시도.
 * v133 — kind prop: 'feed'(기본) | 'community'(공지 게시판, BGM 자동재생 없음).
 */
export default function FeedList({ authorId, isSelf, kind = 'feed' }) {
  const isCommunity = kind === 'community';
  const [feeds, setFeeds] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingFeed, setEditingFeed] = useState(null);

  const feedAudio = useFeedAudio();
  const autoPlayedRef = useRef(false);
  const feedAudioRef = useRef(feedAudio);
  useEffect(() => { feedAudioRef.current = feedAudio; }, [feedAudio]);

  // 첫 페이지 로드 (+ 작성자 변경 시 리셋)
  useEffect(() => {
    let cancelled = false;
    autoPlayedRef.current = false;
    setLoading(true);
    setFeeds([]);
    setTotal(0);
    setPage(1);
    setComposerOpen(false);
    setEditingFeed(null);
    if (import.meta.env.DEV) console.info('[FeedList] getUserFeeds start', { authorId, kind, page: 1 });
    api.getUserFeeds(authorId, 1, PAGE_LIMIT, kind)
      .then((res) => {
        if (cancelled) return;
        const list = res.data?.feeds || [];
        setFeeds(list);
        const totalCount = res.data?.pagination?.total ?? res.data?.total ?? list.length;
        setTotal(totalCount);
        if (import.meta.env.DEV) {
          console.info('[FeedList] getUserFeeds done', { authorId, kind, count: list.length, total: totalCount });
        }
        // 피드 열람 시 BGM 자동재생 시도 — 첫 피드의 BGM (차단 시 훅이 '재생 대기' 폴백)
        // v133 — community(공지)에는 BGM 이 없으므로 feed 목록에서만 시도
        if (kind === 'feed' && !autoPlayedRef.current) {
          const first = list.find((f) => f.bgm_track && !f.bgm_track.deleted);
          if (first) {
            autoPlayedRef.current = true;
            if (import.meta.env.DEV) console.info('[FeedList] bgm autoplay attempt', { feed_id: first.id });
            feedAudioRef.current.playBgm(first.bgm_track, first.id);
          }
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[FeedList] getUserFeeds failed', { err, authorId, kind });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [authorId, kind]);

  const handleLoadMore = useCallback(async () => {
    if (loadingMore) return;
    const nextPage = page + 1;
    setLoadingMore(true);
    if (import.meta.env.DEV) console.info('[FeedList] getUserFeeds more', { authorId, kind, page: nextPage });
    try {
      const res = await api.getUserFeeds(authorId, nextPage, PAGE_LIMIT, kind);
      const list = res.data?.feeds || [];
      setFeeds((prev) => {
        const seen = new Set(prev.map((f) => f.id));
        return [...prev, ...list.filter((f) => !seen.has(f.id))];
      });
      const moreTotal = res.data?.pagination?.total ?? res.data?.total;
      if (typeof moreTotal === 'number') setTotal(moreTotal);
      setPage(nextPage);
    } catch (err) {
      console.error('[FeedList] getUserFeeds more failed', { err, authorId, kind, page: nextPage });
    } finally {
      setLoadingMore(false);
    }
  }, [authorId, kind, page, loadingMore]);

  const handleComposerSaved = (feed) => {
    if (!feed?.id) {
      // 응답 형태가 예상과 다르면 목록 재조회 대신 닫기만 (tester 통합 단계에서 맞춤)
      console.error('[FeedList] composer saved but no feed in response');
      setComposerOpen(false);
      setEditingFeed(null);
      return;
    }
    if (editingFeed) {
      setFeeds((prev) => prev.map((f) => (f.id === feed.id ? feed : f)));
    } else {
      setFeeds((prev) => [feed, ...prev]);
      setTotal((t) => t + 1);
    }
    setComposerOpen(false);
    setEditingFeed(null);
  };

  const handleEdit = (feed) => {
    setEditingFeed(feed);
    setComposerOpen(true);
    // 에디터가 목록 상단에 뜨므로 위로 스크롤
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { /* ignore */ }
  };

  const handleDeleted = (feedId) => {
    setFeeds((prev) => prev.filter((f) => f.id !== feedId));
    setTotal((t) => Math.max(0, t - 1));
    if (feedAudio.bgmOwnerId === feedId) feedAudio.stopBgm();
  };

  return (
    <div className="feed-list">
      {isSelf && !composerOpen && (
        <button
          type="button"
          className="feed-list__compose-btn"
          onClick={() => { setEditingFeed(null); setComposerOpen(true); }}
        >
          <FiEdit3 /> {isCommunity ? '새 공지 작성' : '새 피드 작성'}
        </button>
      )}

      {composerOpen && (
        <FeedComposer
          initialFeed={editingFeed}
          kind={kind}
          onSaved={handleComposerSaved}
          onCancel={() => { setComposerOpen(false); setEditingFeed(null); }}
        />
      )}

      {loading ? (
        <div className="feed-list__empty">
          {isCommunity ? '공지를 불러오는 중...' : '피드를 불러오는 중...'}
        </div>
      ) : feeds.length === 0 ? (
        <div className="feed-list__empty">
          {isCommunity
            ? (isSelf ? '첫 공지를 작성해보세요.' : '아직 공지가 없습니다.')
            : (isSelf ? '첫 피드를 작성해보세요.' : '아직 작성한 피드가 없습니다.')}
        </div>
      ) : (
        feeds.map((feed) => (
          <FeedPostCard
            key={feed.id}
            feed={feed}
            feedAudio={feedAudio}
            showAuthor={false}
            onEdit={handleEdit}
            onDeleted={handleDeleted}
          />
        ))
      )}

      {!loading && feeds.length < total && (
        <button
          type="button"
          className="feed-list__more-btn"
          onClick={handleLoadMore}
          disabled={loadingMore}
        >
          {loadingMore ? '불러오는 중...' : `더 보기 (${feeds.length}/${total})`}
        </button>
      )}
    </div>
  );
}
