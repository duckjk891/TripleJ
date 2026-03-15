import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FiPlay, FiTrash2 } from 'react-icons/fi';
import SongItem from '../components/SongItem';
import { usePlayer } from '../contexts/PlayerContext';
import { useAuth } from '../contexts/AuthContext';
import { getAlbumGradient, formatDate } from '../utils';
import * as api from '../api';
import './PlaylistDetailPage.css';

export default function PlaylistDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { play } = usePlayer();
  const { user } = useAuth();
  const [playlist, setPlaylist] = useState(null);
  const [loading, setLoading] = useState(true);
  const [likedIds, setLikedIds] = useState(new Set());

  useEffect(() => {
    const fetchPlaylist = async () => {
      setLoading(true);
      try {
        const { data } = await api.getPlaylist(id);
        setPlaylist(data);

        if (user && data.songs?.length > 0) {
          const likesRes = await api.checkLikes(data.songs.map(s => s.id).join(','));
          setLikedIds(new Set(likesRes.data.liked_ids));
        }
      } catch (err) {
        console.error('Failed to load playlist:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchPlaylist();
  }, [id, user]);

  const handlePlayAll = () => {
    if (playlist?.songs?.length) {
      play(playlist.songs[0], playlist.songs);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('이 플레이리스트를 삭제하시겠습니까?')) return;
    try {
      await api.deletePlaylist(id);
      navigate('/playlist');
    } catch (err) {
      console.error('Failed to delete playlist:', err);
    }
  };

  const handleToggleLike = async (songId) => {
    if (!user) { navigate('/login'); return; }
    try {
      if (likedIds.has(songId)) {
        await api.unlikeSong(songId);
        setLikedIds(prev => { const s = new Set(prev); s.delete(songId); return s; });
      } else {
        await api.likeSong(songId);
        setLikedIds(prev => new Set([...prev, songId]));
      }
    } catch (err) { console.error(err); }
  };

  if (loading) {
    return (
      <div className="page-content">
        <div className="container">
          <div className="playlist-detail__loading">플레이리스트를 불러오는 중...</div>
        </div>
      </div>
    );
  }

  if (!playlist) {
    return (
      <div className="page-content">
        <div className="container">
          <div className="playlist-detail__loading">플레이리스트를 찾을 수 없습니다.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="container playlist-detail">
        <div className="playlist-detail__header">
          <div
            className="playlist-detail__icon"
            style={{ background: getAlbumGradient(playlist.id) }}
          >
            ♪
          </div>
          <div className="playlist-detail__info">
            <div className="playlist-detail__type">PLAYLIST</div>
            <h1 className="playlist-detail__title">{playlist.title}</h1>
            {playlist.description && (
              <p className="playlist-detail__desc">{playlist.description}</p>
            )}
            <div className="playlist-detail__meta">
              {playlist.songs?.length || 0}곡 &middot; {formatDate(playlist.created_at)}
            </div>
            <div className="playlist-detail__actions">
              <button className="playlist-detail__play-btn" onClick={handlePlayAll}>
                <FiPlay /> 전체 재생
              </button>
              <button className="playlist-detail__delete-btn" onClick={handleDelete}>
                <FiTrash2 /> 삭제
              </button>
            </div>
          </div>
        </div>

        <div className="playlist-detail__songs">
          {playlist.songs?.length > 0 ? (
            playlist.songs.map((song, idx) => (
              <SongItem
                key={song.id}
                song={song}
                rank={idx + 1}
                songs={playlist.songs}
                isLiked={likedIds.has(song.id)}
                onToggleLike={handleToggleLike}
              />
            ))
          ) : (
            <div className="playlist-detail__empty">
              플레이리스트에 트랙이 없습니다. 트랙을 추가해보세요.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
