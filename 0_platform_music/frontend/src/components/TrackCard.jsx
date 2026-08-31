import { FiPlay } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import { usePlayer } from '../contexts/PlayerContext';
import { useAuth } from '../contexts/AuthContext';
import { getAlbumGradient } from '../utils';
import Avatar from './Avatar';
import TrackShareButton from './TrackShareButton';
import './AlbumCard.css';

// v214 — showSourceBadge: 옵션 prop (기본 off — SongItem v207 선례와 동일 규약).
export default function TrackCard({ track, tracks, queueAll = false, showSourceBadge = false }) {
  const { play } = usePlayer();
  const { user } = useAuth();

  const handleClick = () => {
    const song = {
      id: track.id,
      title: track.title,
      artist_name: track.uploader_nickname || 'AI',
      cover_image: track.cover_image_url,
      album_id: track.id,
    };
    const songList = tracks?.map(t => ({
      id: t.id,
      title: t.title,
      artist_name: t.uploader_nickname || 'AI',
      cover_image: t.cover_image_url,
      album_id: t.id,
    }));
    play(song, songList, { queueAll });
  };

  return (
    <div className="album-card" onClick={handleClick}>
      <div
        className="album-card__cover"
        style={{ background: getAlbumGradient(track.id) }}
      >
        <span>♪</span>
        <div className="album-card__play-overlay">
          <div className="album-card__play-btn">
            <FiPlay />
          </div>
        </div>
      </div>
      <div className="album-card__title" title={track.title}>{track.title}</div>
      {/* v214 — 곡 출처 뱃지 (옵션·재료 없으면 생략) */}
      {showSourceBadge && (() => {
        const sm = track.source_meta || {};
        const artistName = sm.artist_name || track.user_character_snapshot?.name || null;
        const voiceName = sm.persona_name || null;
        if (!artistName && !voiceName) return null;
        return (
          <div className="album-card__source-badge" style={{ fontSize: '11px', color: '#8a8a9a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {[artistName && `🧑‍🎤 ${artistName}`, voiceName && `🎤 ${voiceName}`].filter(Boolean).join(' · ')}
          </div>
        );
      })()}
      <div className="album-card__meta-row">
        {track.uploader_id ? (
          <Link
            to={user && user.id === track.uploader_id ? '/my-music' : `/artist/${track.uploader_id}`}
            className="album-card__artist album-card__artist--with-avatar"
            title={user && user.id === track.uploader_id ? '내 음악' : '채널 보기'}
            onClick={(e) => e.stopPropagation()}
          >
            <Avatar src={track.uploader_profile_image} name={track.uploader_nickname || 'AI'} size={20} />
            <span className="album-card__artist-name">{track.uploader_nickname || 'AI'}</span>
          </Link>
        ) : (
          <div className="album-card__artist album-card__artist--with-avatar" title={track.uploader_nickname}>
            <Avatar src={track.uploader_profile_image} name={track.uploader_nickname || 'AI'} size={20} />
            <span className="album-card__artist-name">{track.uploader_nickname || 'AI'}</span>
          </div>
        )}
        <TrackShareButton track={{ id: track.id, title: track.title }} size={14} />
      </div>
    </div>
  );
}
