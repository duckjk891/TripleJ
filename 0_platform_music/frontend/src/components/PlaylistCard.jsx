import { useNavigate } from 'react-router-dom';
import { getAlbumGradient } from '../utils';
import './PlaylistCard.css';

export default function PlaylistCard({ playlist }) {
  const navigate = useNavigate();

  return (
    <div
      className="playlist-card"
      onClick={() => navigate(`/playlist/${playlist.id}`)}
    >
      <div
        className="playlist-card__icon"
        style={{ background: getAlbumGradient(playlist.id) }}
      >
        ♪
      </div>
      <div className="playlist-card__title">{playlist.title}</div>
      {playlist.description && (
        <div className="playlist-card__desc">{playlist.description}</div>
      )}
      <div className="playlist-card__count">
        {playlist.song_count || 0}곡
      </div>
    </div>
  );
}
