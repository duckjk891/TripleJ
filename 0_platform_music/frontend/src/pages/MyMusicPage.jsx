import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { FiUploadCloud, FiTrash2, FiMusic, FiPlay, FiPause } from 'react-icons/fi';
import { useAuth } from '../contexts/AuthContext';
import { usePlayer } from '../contexts/PlayerContext';
import * as api from '../api';
import UploadPage from './UploadPage';
import StudioTab from '../components/StudioTab';
import StudioTab2 from '../components/StudioTab2';
import './MyMusicPage.css';

const SORT_OPTIONS = [
  { value: 'created_at', label: '최신순' },
  { value: 'play_count', label: '재생순' },
  { value: 'like_count', label: '좋아요순' },
];

export default function MyMusicPage() {
  const { user } = useAuth();
  const { play, currentSong, isPlaying, togglePlay } = usePlayer();
  const [activeTab, setActiveTab] = useState('tracks');
  const [generationPrefill, setGenerationPrefill] = useState(null);

  const handleSendToUpload = (genData) => {
    setGenerationPrefill(genData);
    setActiveTab('upload');
  };
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState('created_at');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [deleting, setDeleting] = useState(null);

  const fetchTracks = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data } = await api.getMyTracks({ page, limit: 20, sort });
      setTracks(data.tracks || data.items || []);
      setTotalPages(data.total_pages || Math.ceil((data.total || 0) / 20) || 1);
    } catch (err) {
      console.error('Failed to fetch tracks:', err);
      setTracks([]);
    } finally {
      setLoading(false);
    }
  }, [user, page, sort]);

  useEffect(() => {
    if (activeTab === 'tracks') {
      fetchTracks();
    }
  }, [activeTab, fetchTracks]);

  const handleDelete = async (trackId, trackTitle) => {
    if (!window.confirm(`"${trackTitle}" 트랙을 삭제하시겠습니까?`)) return;
    setDeleting(trackId);
    try {
      await api.deleteTrack(trackId);
      setTracks((prev) => prev.filter((t) => t.id !== trackId));
    } catch (err) {
      alert(err.response?.data?.error || '삭제에 실패했습니다.');
    } finally {
      setDeleting(null);
    }
  };

  const handleSortChange = (newSort) => {
    setSort(newSort);
    setPage(1);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
  };

  const formatGenre = (genre) => {
    if (!genre) return '';
    if (Array.isArray(genre)) return genre.join(', ');
    return genre;
  };

  const handlePlay = (track) => {
    // If already playing this track, toggle play/pause
    if (currentSong?.id === track.id) {
      togglePlay();
      return;
    }
    // Map track to song format for PlayerContext
    const song = {
      id: track.id,
      title: track.title,
      artist_name: track.uploader_nickname || user?.nickname || '',
      cover_image: track.cover_image_url || '',
    };
    const songList = tracks.map((t) => ({
      id: t.id,
      title: t.title,
      artist_name: t.uploader_nickname || user?.nickname || '',
      cover_image: t.cover_image_url || '',
    }));
    play(song, songList);
  };

  if (!user) {
    return (
      <div className="page-content">
        <div className="container">
          <div className="mymusic-login-prompt">
            <div className="mymusic-login-prompt__icon"><FiMusic /></div>
            <div className="mymusic-login-prompt__text">로그인하여 내 음악을 관리하세요</div>
            <Link to="/login" className="mymusic-login-prompt__btn">로그인</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="mymusic-page">
        <h1 className="mymusic-page__title">내 음악</h1>

        {/* Tabs */}
        <div className="mymusic-tabs">
          <button
            className={`mymusic-tab ${activeTab === 'tracks' ? 'mymusic-tab--active' : ''}`}
            onClick={() => setActiveTab('tracks')}
          >
            내 트랙
          </button>
          <button
            className={`mymusic-tab ${activeTab === 'upload' ? 'mymusic-tab--active' : ''}`}
            onClick={() => setActiveTab('upload')}
          >
            새 업로드
          </button>
          <button
            className={`mymusic-tab ${activeTab === 'studio' ? 'mymusic-tab--active' : ''}`}
            onClick={() => setActiveTab('studio')}
          >
            작업실
          </button>
          <button
            className={`mymusic-tab ${activeTab === 'studio2' ? 'mymusic-tab--active' : ''}`}
            onClick={() => setActiveTab('studio2')}
          >
            작업실2
          </button>
        </div>

        {/* Tab 1: Track list */}
        {activeTab === 'tracks' && (
          <div className="mymusic-tracks">
            {/* Sort */}
            <div className="mymusic-tracks__toolbar">
              <select
                className="mymusic-tracks__sort"
                value={sort}
                onChange={(e) => handleSortChange(e.target.value)}
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {loading ? (
              <div className="mymusic-loading">로딩 중...</div>
            ) : tracks.length === 0 ? (
              <div className="mymusic-empty">
                <div className="mymusic-empty__icon"><FiMusic /></div>
                <p className="mymusic-empty__text">아직 업로드한 트랙이 없습니다.</p>
                <button
                  className="mymusic-empty__btn"
                  onClick={() => setActiveTab('upload')}
                >
                  <FiUploadCloud /> 첫 트랙 업로드하기
                </button>
              </div>
            ) : (
              <>
                <div className="mymusic-track-list">
                  {tracks.map((track) => (
                    <div key={track.id} className={`mymusic-track-card ${currentSong?.id === track.id ? 'mymusic-track-card--playing' : ''}`}>
                      <div className="mymusic-track-card__top">
                        <button
                          className={`mymusic-track-card__play-btn ${currentSong?.id === track.id && isPlaying ? 'mymusic-track-card__play-btn--active' : ''}`}
                          onClick={() => handlePlay(track)}
                        >
                          {currentSong?.id === track.id && isPlaying ? <FiPause /> : <FiPlay />}
                        </button>
                        <div className="mymusic-track-card__title" onClick={() => handlePlay(track)} style={{ cursor: 'pointer' }}>
                          {track.title}
                        </div>
                        <div className="mymusic-track-card__play-count">
                          <span className="mymusic-track-card__stat-icon">▶</span>
                          {(track.play_count || 0).toLocaleString()}
                        </div>
                      </div>
                      <div className="mymusic-track-card__middle">
                        <div className="mymusic-track-card__genre">
                          {formatGenre(track.genre) && `장르: ${formatGenre(track.genre)}`}
                        </div>
                        <div className="mymusic-track-card__like-count">
                          <span className="mymusic-track-card__stat-icon">♥</span>
                          {(track.like_count || 0).toLocaleString()}
                        </div>
                      </div>
                      <div className="mymusic-track-card__bottom">
                        <span className="mymusic-track-card__date">
                          {formatDate(track.created_at)}
                        </span>
                        <span className={`mymusic-track-card__badge ${track.is_public === false ? 'mymusic-track-card__badge--private' : ''}`}>
                          {track.is_public === false ? '비공개' : '공개'}
                        </span>
                        <button
                          className="mymusic-track-card__delete"
                          onClick={() => handleDelete(track.id, track.title)}
                          disabled={deleting === track.id}
                        >
                          <FiTrash2 />
                          {deleting === track.id ? '삭제 중...' : '삭제'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="mymusic-pagination">
                    <button
                      className="mymusic-pagination__btn"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      이전
                    </button>
                    <span className="mymusic-pagination__info">
                      {page} / {totalPages}
                    </span>
                    <button
                      className="mymusic-pagination__btn"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      다음
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Tab 2: Upload */}
        {activeTab === 'upload' && (
          <div className="mymusic-upload-tab">
            <UploadPage generationPrefill={generationPrefill} onClearPrefill={() => setGenerationPrefill(null)} />
          </div>
        )}

        {/* Tab 3: Studio */}
        {activeTab === 'studio' && (
          <StudioTab />
        )}

        {/* Tab 4: Studio2 */}
        {activeTab === 'studio2' && (
          <StudioTab2 onSendToUpload={handleSendToUpload} />
        )}
      </div>
    </div>
  );
}
