import { useNavigate } from 'react-router-dom';
import { FiPlay } from 'react-icons/fi';
import { getAlbumGradient } from '../utils';
import * as api from '../api';
import './AlbumCard.css';

function resolveCoverUrl(cover) {
  if (!cover) return '';
  // 전체 URL(presign 모드) 또는 상대경로(/api/...)는 그대로 사용
  if (cover.startsWith('http') || cover.startsWith('/api/')) return cover;
  // object_name 형태(legacy)면 공용 헬퍼로 프리뷰 URL 생성
  if (import.meta.env.DEV) console.warn('[AlbumCard] legacy cover value', cover);
  return api.coverPreviewUrl(cover);
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
