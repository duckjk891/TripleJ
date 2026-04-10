import { useNavigate } from 'react-router-dom';
import { FiPlay } from 'react-icons/fi';
import { getAlbumGradient } from '../utils';
import * as api from '../api';
import './AlbumCard.css';

export default function AlbumCard({ album }) {
  const navigate = useNavigate();

  return (
    <div className="album-card" onClick={() => navigate(`/album/${album.id}`)}>
      <div
        className="album-card__cover"
        style={!album.cover_image ? { background: getAlbumGradient(album.id) } : {}}
      >
        {album.cover_image ? (
          <img src={album.cover_image.startsWith('/api/') ? album.cover_image : api.coverPreviewUrl(album.cover_image)} alt="" className="album-card__cover-img" />
        ) : (
          <span>♪</span>
        )}
        <div className="album-card__play-overlay">
          <div className="album-card__play-btn">
            <FiPlay />
          </div>
        </div>
      </div>
      <div className="album-card__title" title={album.title}>{album.title}</div>
      <div className="album-card__artist" title={album.artist_name}>{album.artist_name}</div>
    </div>
  );
}
