import { FiPlay } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import { usePlayer } from '../contexts/PlayerContext';
import { useAuth } from '../contexts/AuthContext';
import { getAlbumGradient } from '../utils';
import Avatar from './Avatar';
import TrackShareButton from './TrackShareButton';
import './AlbumCard.css';

export default function TrackCard({ track, tracks, queueAll = false }) {
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
