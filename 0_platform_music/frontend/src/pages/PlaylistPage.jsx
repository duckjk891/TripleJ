import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FiPlus, FiMusic } from 'react-icons/fi';
import PlaylistCard from '../components/PlaylistCard';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../api';
import './PlaylistPage.css';

export default function PlaylistPage() {
  const { user } = useAuth();
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');

  useEffect(() => {
    if (!user) return;
    const fetchPlaylists = async () => {
      setLoading(true);
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
  }, [user]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    try {
      await api.createPlaylist(newTitle.trim(), newDesc.trim());
      setShowModal(false);
      setNewTitle('');
      setNewDesc('');
      // Refresh
      const { data } = await api.getPlaylists();
      setPlaylists(data);
    } catch (err) {
      console.error('Failed to create playlist:', err);
    }
  };

  if (!user) {
    return (
      <div className="page-content">
        <div className="container playlist-page">
          <h1 className="playlist-page__title">플레이리스트</h1>
          <div className="playlist-page__login-prompt">
            <div className="playlist-page__empty-icon">
              <FiMusic />
            </div>
            <div className="playlist-page__login-text">
              로그인하여 나만의 플레이리스트를 만들어보세요
            </div>
            <Link to="/login" className="playlist-page__login-btn">
              로그인
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="container playlist-page">
        <div className="playlist-page__header">
          <h1 className="playlist-page__title">내 플레이리스트</h1>
          <button className="playlist-page__create-btn" onClick={() => setShowModal(true)}>
            <FiPlus /> 새 플레이리스트
          </button>
        </div>

        {loading ? (
          <div className="playlist-loading">로딩 중...</div>
        ) : playlists.length > 0 ? (
          <div className="playlist-page__grid">
            {playlists.map((pl) => (
              <PlaylistCard key={pl.id} playlist={pl} />
            ))}
          </div>
        ) : (
          <div className="playlist-page__empty">
            <div className="playlist-page__empty-icon">
              <FiMusic />
            </div>
            <div className="playlist-page__empty-text">
              아직 플레이리스트가 없습니다
            </div>
            <button className="playlist-page__create-btn" onClick={() => setShowModal(true)}>
              <FiPlus /> 첫 플레이리스트 만들기
            </button>
          </div>
        )}

        {showModal && (
          <div className="playlist-modal-overlay" onClick={() => setShowModal(false)}>
            <form className="playlist-modal" onClick={(e) => e.stopPropagation()} onSubmit={handleCreate}>
              <h2 className="playlist-modal__title">새 플레이리스트</h2>
              <div className="playlist-modal__field">
                <label className="playlist-modal__label">제목</label>
                <input
                  className="playlist-modal__input"
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="플레이리스트 제목을 입력하세요"
                  autoFocus
                />
              </div>
              <div className="playlist-modal__field">
                <label className="playlist-modal__label">설명 (선택)</label>
                <input
                  className="playlist-modal__input"
                  type="text"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="플레이리스트 설명"
                />
              </div>
              <div className="playlist-modal__actions">
                <button type="button" className="playlist-modal__cancel" onClick={() => setShowModal(false)}>
                  취소
                </button>
                <button type="submit" className="playlist-modal__submit">
                  만들기
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
