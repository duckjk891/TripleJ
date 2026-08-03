import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { FiPlay, FiCalendar, FiMusic, FiEdit2, FiTrash2 } from 'react-icons/fi';
import SongItem from '../components/SongItem';
import AlbumCreateModal from '../components/AlbumCreateModal';
import { usePlayer } from '../contexts/PlayerContext';
import { useAuth } from '../contexts/AuthContext';
import { getAlbumGradient, formatDate } from '../utils';
import * as api from '../api';
import './AlbumDetailPage.css';

export default function AlbumDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { play } = usePlayer();
  const { user } = useAuth();
  const [album, setAlbum] = useState(null);
  const [loading, setLoading] = useState(true);
  const [likedIds, setLikedIds] = useState(new Set());
  const [showEdit, setShowEdit] = useState(false);
  const [myTracks, setMyTracks] = useState([]);
  const [deleting, setDeleting] = useState(false);

  const fetchAlbum = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.getAlbum(id);
      setAlbum(data);
      const tracks = data.tracks || [];
      console.info(`[AlbumDetailPage] loaded album_id=${data.id} track_count=${tracks.length}`);

      if (user && tracks.length > 0) {
        const likesRes = await api.checkLikes(tracks.map((s) => s.id).join(','));
        setLikedIds(new Set(likesRes.data.liked_ids));
      }
    } catch (err) {
      console.warn('[AlbumDetailPage] fetch failed', {
        id,
        status: err.response?.status,
      });
    } finally {
      setLoading(false);
    }
  }, [id, user]);

  useEffect(() => {
    fetchAlbum();
  }, [fetchAlbum]);

  const handlePlayAll = () => {
    const tracks = album?.tracks || [];
    if (tracks.length) {
      play(tracks[0], tracks);
    }
  };

  const handleToggleLike = async (songId) => {
    if (!user) {
      navigate('/login');
      return;
    }
    try {
      if (likedIds.has(songId)) {
        await api.unlikeSong(songId);
        setLikedIds((prev) => {
          const s = new Set(prev);
          s.delete(songId);
          return s;
        });
      } else {
        await api.likeSong(songId);
        setLikedIds((prev) => new Set([...prev, songId]));
      }
    } catch (err) {
      console.warn('[AlbumDetailPage] like toggle failed', { song_id: songId, status: err.response?.status });
    }
  };

  const openEdit = async () => {
    try {
      const { data } = await api.getMyTracks({ page: 1, limit: 200, sort: 'created_at' });
      setMyTracks(data.tracks || data.items || []);
    } catch (err) {
      console.warn('[AlbumDetailPage] my_tracks fetch failed', { status: err.response?.status });
    }
    setShowEdit(true);
  };

  const handleDelete = async () => {
    if (!album) return;
    if (!window.confirm(`"${album.title}" 앨범을 삭제하시겠습니까?`)) return;
    setDeleting(true);
    try {
      await api.deleteAlbum(album.id);
      console.info(`[AlbumDetailPage] action=delete album_id=${album.id}`);
      navigate('/mymusic');
    } catch (err) {
      console.warn('[AlbumDetailPage] delete failed', { album_id: album.id, status: err.response?.status });
      alert(err.response?.data?.error || '삭제에 실패했습니다.');
      setDeleting(false);
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

  const tracks = album.tracks || [];
  const isOwner = user && album.owner_id && user.id === album.owner_id;
  const hasCoverImage = !!album.cover_image;

  return (
    <div className="page-content">
      <div className="container album-detail">
        <div className="album-detail__header">
          <div
            className="album-detail__cover"
            style={!hasCoverImage ? { background: getAlbumGradient(album.id) } : {}}
          >
            {hasCoverImage ? (
              <img
                src={album.cover_image}
                alt=""
                className="album-detail__cover-img"
              />
            ) : (
              <span>♪</span>
            )}
          </div>
          <div className="album-detail__info">
            <div className="album-detail__type">ALBUM</div>
            <h1 className="album-detail__title">{album.title}</h1>
            <div className="album-detail__artist">
              {album.artist_id ? (
                <Link to={`/artist/${album.artist_id}`} title="채널 보기">{album.artist_name}</Link>
              ) : (
                <span>{album.artist_name}</span>
              )}
            </div>
            <div className="album-detail__meta">
              <span><FiCalendar /> {formatDate(album.release_date || album.created_at)}</span>
              <span><FiMusic /> {tracks.length}곡</span>
            </div>
            <div className="album-detail__actions">
              <button
                className="album-detail__play-all"
                onClick={handlePlayAll}
                disabled={tracks.length === 0}
              >
                <FiPlay /> 전체 재생
              </button>
              {isOwner && (
                <>
                  <button
                    className="album-detail__action-btn"
                    onClick={openEdit}
                  >
                    <FiEdit2 /> 수정
                  </button>
                  <button
                    className="album-detail__action-btn album-detail__action-btn--danger"
                    onClick={handleDelete}
                    disabled={deleting}
                  >
                    <FiTrash2 /> {deleting ? '삭제 중...' : '삭제'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        <h2 className="album-detail__songs-title">트랙 목록</h2>
        <div className="album-detail__songs">
          {tracks.map((song, idx) => (
            <SongItem
              key={song.id}
              song={{ ...song, album_id: album.id, album_title: album.title }}
              rank={idx + 1}
              showAlbum={false}
              songs={tracks.map((s) => ({
                ...s,
                album_id: album.id,
                album_title: album.title,
              }))}
              queueAll
              isLiked={likedIds.has(song.id)}
              onToggleLike={handleToggleLike}
            />
          ))}
        </div>

        {showEdit && (
          <AlbumCreateModal
            mode="edit"
            album={album}
            myTracks={myTracks}
            onClose={() => setShowEdit(false)}
            onSaved={() => {
              setShowEdit(false);
              fetchAlbum();
            }}
          />
        )}
      </div>
    </div>
  );
}
