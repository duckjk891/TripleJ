import { Link } from 'react-router-dom';
import { FiPlay, FiPause, FiLoader } from 'react-icons/fi';
import * as api from '../../api';
import { getAlbumGradient } from '../../utils';
import './FeedTrackCard.css';

// 커버 이미지 경로 정규화 — SongItem 과 동일 패턴
function coverSrc(cover) {
  if (!cover) return null;
  return cover.startsWith('/api/') || cover.startsWith('http')
    ? cover
    : api.coverPreviewUrl(cover);
}

function fmtDuration(sec) {
  if (!sec || sec <= 0) return null;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * v131 — 피드 삽입곡 카드.
 * 커버 + 곡명 + 아티스트명(내 곡 포함 전 카드 동일 표기, 터치 시 /artist/{artist_id}) + ▶/⏸.
 * 삭제된 곡은 플레이스홀더, 비공개 곡은 "비공개" 뱃지.
 * playKey: feedAudio 활성 판별용 카드 식별 키 (feedId:blockIndex 등).
 */
export default function FeedTrackCard({ track, feedAudio, playKey }) {
  if (!track || track.deleted) {
    return (
      <div className="feed-track-card feed-track-card--deleted">
        <div className="feed-track-card__art feed-track-card__art--empty">♪</div>
        <div className="feed-track-card__info">
          <div className="feed-track-card__title">삭제된 곡</div>
          <div className="feed-track-card__artist-text">더 이상 재생할 수 없습니다</div>
        </div>
      </div>
    );
  }

  const isActive = feedAudio && feedAudio.activeKey === playKey;
  const isPlaying = isActive && feedAudio.trackStatus === 'playing';
  const isLoading = isActive && feedAudio.trackStatus === 'loading';
  const cover = coverSrc(track.cover_image);
  const dur = fmtDuration(track.duration_sec);

  const handleToggle = () => {
    if (!feedAudio) return;
    if (import.meta.env.DEV) {
      console.info('[FeedTrackCard] toggle', { track_id: track.id, playing: isPlaying });
    }
    feedAudio.playFeedTrack(track, playKey);
  };

  return (
    <div className={`feed-track-card ${isActive ? 'feed-track-card--active' : ''}`}>
      <div
        className="feed-track-card__art"
        style={!cover ? { background: getAlbumGradient(track.id) } : {}}
        onClick={handleToggle}
      >
        {cover ? <img src={cover} alt="" className="feed-track-card__art-img" /> : <span>♪</span>}
      </div>
      <div className="feed-track-card__info">
        <div className="feed-track-card__title" onClick={handleToggle}>
          {track.title}
          {track.is_public === false && (
            <span className="feed-track-card__badge">비공개</span>
          )}
        </div>
        <div className="feed-track-card__artist">
          <Link to={`/artist/${track.artist_id}`} title="채널 보기">{track.artist_name || 'AI'}</Link>
          {dur && <span className="feed-track-card__duration">{dur}</span>}
        </div>
      </div>
      <button
        type="button"
        className="feed-track-card__play-btn"
        onClick={handleToggle}
        title={isPlaying ? '일시정지' : '재생'}
        disabled={isLoading}
      >
        {isLoading ? <FiLoader className="feed-track-card__spin" /> : isPlaying ? <FiPause /> : <FiPlay />}
      </button>
    </div>
  );
}
