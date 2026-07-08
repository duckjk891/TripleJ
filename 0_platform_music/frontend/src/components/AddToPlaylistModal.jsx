import { useState, useEffect } from 'react';
import { FiPlus } from 'react-icons/fi';
import { getAlbumGradient } from '../utils';
import * as api from '../api';
import './AddToPlaylistModal.css';

export default function AddToPlaylistModal({ songId, onClose }) {
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  useEffect(() => {
    const fetchPlaylists = async () => {
      try {
        const { data } = await api.getPlaylists();
        setPlaylists(data);
      } catch (err) {
        console.error('Failed to load playlists:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchPlaylists();
  }, []);

  const handleAdd = async (playlistId) => {
    setMessage(null);
    try {
      await api.addSongToPlaylist(playlistId, songId);
      setMessage({ type: 'success', text: '추가되었습니다' });
      setTimeout(() => onClose(), 800);
    } catch (err) {
      if (err.response?.status === 409) {
        setMessage({ type: 'error', text: '이미 추가된 곡입니다' });
      } else {
        setMessage({ type: 'error', text: '추가에 실패했습니다' });
      }
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    try {
      const { data } = await api.createPlaylist(newTitle.trim(), '');
      setNewTitle('');
      setShowCreateForm(false);
      await api.addSongToPlaylist(data.id, songId);
      setMessage({ type: 'success', text: '새 플레이리스트에 추가되었습니다' });
      setTimeout(() => onClose(), 800);
    } catch (err) {
      setMessage({ type: 'error', text: '생성에 실패했습니다' });
    }
  };

  return (
    <div className="add-playlist-modal-overlay" onClick={onClose}>
      <div className="add-playlist-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="add-playlist-modal__title">플레이리스트에 추가</h2>

        {message && (
          <div className={`add-playlist-modal__message add-playlist-modal__message--${message.type}`}>
            {message.text}
          </div>
        )}

        {loading ? (
          <div className="add-playlist-modal__empty">로딩 중...</div>
        ) : playlists.length > 0 ? (
          <div className="add-playlist-modal__list">
            {playlists.map((pl) => (
              <div
                key={pl.id}
                className="add-playlist-modal__item"
                onClick={() => handleAdd(pl.id)}
              >
                <div
                  className="add-playlist-modal__item-icon"
                  style={{ background: getAlbumGradient(pl.id) }}
                >
                  ♪
                </div>
                <div className="add-playlist-modal__item-info">
                  <div className="add-playlist-modal__item-title">{pl.title}</div>
                  <div className="add-playlist-modal__item-count">{pl.track_count || 0}곡</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="add-playlist-modal__empty">
            플레이리스트를 먼저 만들어주세요
          </div>
        )}

        <div className="add-playlist-modal__create">
          {showCreateForm ? (
            <form className="add-playlist-modal__create-form" onSubmit={handleCreate}>
              <input
                className="add-playlist-modal__create-input"
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="플레이리스트 이름"
                autoFocus
              />
              <button type="submit" className="add-playlist-modal__create-btn">만들기</button>
            </form>
          ) : (
            <button
              className="add-playlist-modal__create-toggle"
              onClick={() => setShowCreateForm(true)}
            >
              <FiPlus /> 새 플레이리스트 만들기
            </button>
          )}
        </div>

        <button className="add-playlist-modal__close" onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}
