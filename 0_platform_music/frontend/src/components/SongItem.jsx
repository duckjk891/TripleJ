import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiPlay, FiHeart, FiPlus, FiDownload } from 'react-icons/fi';
import { usePlayer } from '../contexts/PlayerContext';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../api';
import { getAlbumGradient } from '../utils';
import AddToPlaylistModal from './AddToPlaylistModal';
import './SongItem.css';

export default function SongItem({ song, rank, showAlbum = true, songs, isLiked, onToggleLike }) {
  const { play } = usePlayer();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [showPlaylistModal, setShowPlaylistModal] = useState(false);

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
    setShowPlaylistModal(true);
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
        style={!(song.cover_image && song.cover_image.startsWith('/api/files')) ? { background: getAlbumGradient(song.album_id || song.id) } : {}}
        onClick={handlePlay}
      >
        {song.cover_image && song.cover_image.startsWith('/api/files') ? (
          <img src={song.cover_image} alt="" className="song-item__art-img" />
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
          <Link to={`/artist/${song.artist_id}`}>{song.artist_name}</Link>
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
        <button className="song-item__action-btn" onClick={handleAddToPlaylist} title="플레이리스트 추가">
          <FiPlus />
        </button>
        <button className="song-item__action-btn" onClick={handleDownload} title="다운로드">
          <FiDownload />
        </button>
      </div>

      {showPlaylistModal && (
        <AddToPlaylistModal
          songId={song.id}
          onClose={() => setShowPlaylistModal(false)}
        />
      )}
    </div>
  );
}
