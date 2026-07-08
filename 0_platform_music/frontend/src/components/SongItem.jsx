import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiPlay, FiHeart, FiPlus, FiDownload, FiBookmark } from 'react-icons/fi';
import { usePlayer } from '../contexts/PlayerContext';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../api';
import { getAlbumGradient } from '../utils';
import AddToPlaylistModal from './AddToPlaylistModal';
import './SongItem.css';

export default function SongItem({ song, rank, showAlbum = true, songs, isLiked, onToggleLike }) {
  const { play, addToPlaylist } = usePlayer();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [showAddModal, setShowAddModal] = useState(false);

  const handlePlay = () => {
    play(song, songs);
  };

  const handleLike = () => {
    if (!user) {
      navigate('/login');
      return;
    }
    if (onToggleLike) {
      onToggleLike(song.id);
    }
  };

  const handleAddToPlaylist = () => {
    if (!user) {
      navigate('/login');
      return;
    }
    addToPlaylist(song);
  };

  const handleSaveToPlaylist = () => {
    if (!user) { navigate('/login'); return; }
    if (import.meta.env.DEV) console.info('[SongItem] openAddToPlaylist', { track: song?.id });
    setShowAddModal(true);
  };

  const handleDownload = async () => {
    if (!user) { navigate('/login'); return; }
    try {
      const { data } = await api.downloadTrackFile(song.id);
      const a = document.createElement('a');
      a.href = data.download_url;
      a.download = data.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error('Download failed:', err);
    }
  };

  return (
    <div className="song-item">
      {rank !== undefined && (
        <span className={`song-item__rank ${rank <= 3 ? 'song-item__rank--top3' : ''}`}>
          {rank}
        </span>
      )}

      <div
        className="song-item__art"
        style={!song.cover_image ? { background: getAlbumGradient(song.album_id || song.id) } : {}}
        onClick={handlePlay}
      >
        {song.cover_image ? (
          <img src={song.cover_image.startsWith('/api/') ? song.cover_image : api.coverPreviewUrl(song.cover_image)} alt="" className="song-item__art-img" />
        ) : (
          <span>♪</span>
        )}
        <div className="song-item__art-play">
          <FiPlay />
        </div>
      </div>

      <div className="song-item__info">
        <div className="song-item__title" onClick={handlePlay}>
          {song.title}
        </div>
        <div className="song-item__artist">
          <Link to={`/artist/${song.artist_id || song.uploader_id}`}>{song.artist_name || song.uploader_nickname || 'AI'}</Link>
        </div>
      </div>

      {showAlbum && song.album_title && (
        <div className="song-item__album">
          <Link to={`/album/${song.album_id}`}>{song.album_title}</Link>
        </div>
      )}

      <div className="song-item__actions">
        <button className="song-item__action-btn" onClick={handlePlay} title="재생">
          <FiPlay />
        </button>
        <button
          className={`song-item__action-btn ${isLiked ? 'song-item__action-btn--liked' : ''}`}
          onClick={handleLike}
          title="좋아요"
        >
          <FiHeart style={isLiked ? { color: '#e74c3c', fill: '#e74c3c' } : {}} />
        </button>
        <button className="song-item__action-btn" onClick={handleAddToPlaylist} title="재생목록 추가">
          <FiPlus />
        </button>
        <button className="song-item__action-btn" onClick={handleSaveToPlaylist} title="플레이리스트에 추가">
          <FiBookmark />
        </button>
        <button className="song-item__action-btn" onClick={handleDownload} title="다운로드">
          <FiDownload />
        </button>
      </div>

      {showAddModal && (
        <AddToPlaylistModal songId={song.id} onClose={() => setShowAddModal(false)} />
      )}
    </div>
  );
}
