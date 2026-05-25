import { useNavigate } from 'react-router-dom';
import { FiPlay } from 'react-icons/fi';
import { getAlbumGradient } from '../utils';
import './AlbumCard.css';

function resolveCoverUrl(cover) {
  if (!cover) return '';
  if (cover.startsWith('http') || cover.startsWith('/api/')) return cover;
  // object_name 형태로 들어오면 /api/files/ 로 매핑
  return `/api/files/${cover}`;
}

export default function AlbumCard({ album }) {
  const navigate = useNavigate();
  const coverUrl = resolveCoverUrl(album.cover_image);
  const hasCover = !!coverUrl;

  return (
    <div className="album-card" onClick={() => navigate(`/album/${album.id}`)}>
      <div
        className="album-card__cover"
        style={!hasCover ? { background: getAlbumGradient(album.id) } : {}}
      >
        {hasCover ? (
          <img src={coverUrl} alt="" className="album-card__cover-img" />
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
