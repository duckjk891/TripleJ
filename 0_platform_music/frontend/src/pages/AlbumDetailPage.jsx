import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { FiPlay, FiCalendar, FiMusic, FiDisc } from 'react-icons/fi';
import SongItem from '../components/SongItem';
import { usePlayer } from '../contexts/PlayerContext';
import { getAlbumGradient, formatDate } from '../utils';
import * as api from '../api';
import './AlbumDetailPage.css';

export default function AlbumDetailPage() {
  const { id } = useParams();
  const { play } = usePlayer();
  const [album, setAlbum] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAlbum = async () => {
      setLoading(true);
      try {
        const { data } = await api.getAlbum(id);
        setAlbum(data);
      } catch (err) {
        console.error('Failed to load album:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchAlbum();
  }, [id]);

  const handlePlayAll = () => {
    if (album?.songs?.length) {
      play(album.songs[0], album.songs);
    }
  };

  if (loading) {
    return (
      <div className="page-content">
        <div className="container">
          <div className="album-detail__loading">앨범 정보를 불러오는 중...</div>
        </div>
      </div>
    );
  }

  if (!album) {
    return (
      <div className="page-content">
        <div className="container">
          <div className="album-detail__loading">앨범을 찾을 수 없습니다.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="container album-detail">
        <div className="album-detail__header">
          <div
            className="album-detail__cover"
            style={{ background: getAlbumGradient(album.id) }}
          >
            ♪
          </div>
          <div className="album-detail__info">
            <div className="album-detail__type">ALBUM</div>
            <h1 className="album-detail__title">{album.title}</h1>
            <div className="album-detail__artist">
              <Link to={`/artist/${album.artist_id}`}>{album.artist_name}</Link>
            </div>
            <div className="album-detail__meta">
              <span><FiCalendar /> {formatDate(album.release_date)}</span>
              {album.genre && <span><FiDisc /> {album.genre}</span>}
              <span><FiMusic /> {album.songs?.length || 0}곡</span>
            </div>
            <button className="album-detail__play-all" onClick={handlePlayAll}>
              <FiPlay /> 전체 재생
            </button>
          </div>
        </div>

        <h2 className="album-detail__songs-title">수록곡</h2>
        <div className="album-detail__songs">
          {album.songs?.map((song, idx) => (
            <SongItem
              key={song.id}
              song={{ ...song, album_id: album.id, album_title: album.title }}
              rank={idx + 1}
              showAlbum={false}
              songs={album.songs.map((s) => ({
                ...s,
                album_id: album.id,
                album_title: album.title,
              }))}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
