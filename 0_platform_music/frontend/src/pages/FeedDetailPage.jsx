import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as api from '../api';
import useFeedAudio from '../hooks/useFeedAudio';
import FeedPostCard from '../components/feed/FeedPostCard';
import FeedComposer from '../components/feed/FeedComposer';
import './FeedDetailPage.css';

/**
 * v131 — 피드 단건 페이지 (/feed/:feedId — 공유 링크 착지, 비로그인 열람).
 * BGM 자동재생 시도(차단 시 훅이 '재생 대기' 폴백), 소유자 수정/삭제 지원.
 * feedId 를 key 로 걸어 라우트 파라미터 변경 시 상태를 리마운트로 초기화.
 */
export default function FeedDetailPage() {
  const { feedId } = useParams();
  return <FeedDetailContent key={feedId} feedId={feedId} />;
}

function FeedDetailContent({ feedId }) {
  const navigate = useNavigate();
  const [feed, setFeed] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);

  const feedAudio = useFeedAudio();
  const feedAudioRef = useRef(feedAudio);
  useEffect(() => { feedAudioRef.current = feedAudio; }, [feedAudio]);

  useEffect(() => {
    let cancelled = false;
    if (import.meta.env.DEV) console.info('[FeedDetailPage] getFeed start', { feedId });
    api.getFeed(feedId)
      .then((res) => {
        if (cancelled) return;
        const data = res.data?.feed ?? res.data;
        setFeed(data);
        if (import.meta.env.DEV) console.info('[FeedDetailPage] getFeed done', { feedId });
        // 피드 열람 시 BGM 자동재생 시도
        if (data?.bgm_track && !data.bgm_track.deleted) {
          feedAudioRef.current.playBgm(data.bgm_track, data.id);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[FeedDetailPage] getFeed failed', { err, feedId });
        setNotFound(true);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [feedId]);

  const handleDeleted = () => {
    if (feed?.author_id) {
      navigate(`/artist/${feed.author_id}`);
    } else {
      navigate('/');
    }
  };

  return (
    <div className="page-content">
      <div className="container feed-detail">
        {loading ? (
          <div className="feed-detail__status">피드를 불러오는 중...</div>
        ) : notFound || !feed ? (
          <div className="feed-detail__status">피드를 찾을 수 없습니다.</div>
        ) : editing ? (
          <FeedComposer
            initialFeed={feed}
            onSaved={(saved) => { if (saved?.id) setFeed(saved); setEditing(false); }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <FeedPostCard
            feed={feed}
            feedAudio={feedAudio}
            showAuthor
            onEdit={() => setEditing(true)}
            onDeleted={handleDeleted}
          />
        )}
      </div>
    </div>
  );
}
