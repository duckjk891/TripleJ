import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { FiUploadCloud, FiTrash2, FiMusic, FiPlay, FiPause, FiFolder, FiImage, FiFilm, FiAlertCircle, FiUser, FiRefreshCw } from 'react-icons/fi';
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

const STATUS_MAP = {
  draft: { label: '초안', color: '#94A3B8' },
  splitting: { label: '씬 분석 중', color: '#7C3AED' },
  scenes_ready: { label: '씬 분할 완료', color: '#06B6D4' },
  generating_images: { label: '이미지 생성 중', color: '#7C3AED' },
  images_ready: { label: '이미지 완료', color: '#06B6D4' },
  generating_videos: { label: '영상 생성 중', color: '#7C3AED' },
  videos_ready: { label: '영상 부분 완료', color: '#06B6D4' },
  concatenating: { label: '합치는 중', color: '#7C3AED' },
  paused: { label: '일시정지', color: '#f59e0b' },
  completed: { label: '완료', color: '#1ed760' },
  failed: { label: '실패', color: '#EF4444' },
};

function DraftsSection({ onLoadDraft }) {
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const fetchDrafts = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.getMVJobs();
      setDrafts(data.jobs || []);
    } catch (err) {
      console.error('Failed to fetch MV jobs:', err);
      setDrafts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts]);

  const handleDelete = async (jobId, title) => {
    if (!window.confirm(`"${title || '제목 없음'}" 초안을 삭제하시겠습니까?`)) return;
    setDeletingId(jobId);
    try {
      await api.deleteMVJob(jobId);
      setDrafts((prev) => prev.filter((d) => d.job_id !== jobId));
    } catch (err) {
      alert(err.response?.data?.error || '삭제에 실패했습니다.');
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
  };

  const getStatusBadge = (status) => {
    const info = STATUS_MAP[status] || { label: status || '알 수 없음', color: '#94A3B8' };
    return (
      <span
        className="mymusic-draft-card__status"
        style={{ background: `${info.color}20`, color: info.color }}
      >
        {info.label}
      </span>
    );
  };

  if (loading) {
    return <div className="mymusic-loading">로딩 중...</div>;
  }

  if (drafts.length === 0) {
    return (
      <div className="mymusic-empty">
        <div className="mymusic-empty__icon"><FiFolder /></div>
        <p className="mymusic-empty__text">저장된 초안이 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="mymusic-drafts">
      <div className="mymusic-drafts__list">
        {drafts.map((draft) => (
          <div key={draft.job_id} className="mymusic-draft-card">
            <div className="mymusic-draft-card__thumb">
              {draft.thumbnail_url ? (
                <img src={draft.thumbnail_url} alt={draft.title || '초안'} className="mymusic-draft-card__thumb-img" />
              ) : (
                <div className="mymusic-draft-card__thumb-placeholder">
                  <FiFilm />
                </div>
              )}
            </div>
            <div className="mymusic-draft-card__info">
              <div className="mymusic-draft-card__title">{draft.title || '제목 없음'}</div>
              <div className="mymusic-draft-card__meta">
                {getStatusBadge(draft.status)}
                <span className="mymusic-draft-card__date">{formatDate(draft.created_at)}</span>
              </div>
              <div className="mymusic-draft-card__progress">
                <span className="mymusic-draft-card__progress-item">
                  <FiImage className="mymusic-draft-card__progress-icon" />
                  이미지 {draft.completed_image_count || 0}/{draft.total_scenes || 0}
                </span>
                <span className="mymusic-draft-card__progress-item">
                  <FiFilm className="mymusic-draft-card__progress-icon" />
                  영상 {draft.completed_video_count || 0}/{draft.total_scenes || 0}
                </span>
              </div>
            </div>
            <div className="mymusic-draft-card__actions">
              <button
                className="mymusic-draft-card__load-btn"
                onClick={() => onLoadDraft(draft.job_id)}
              >
                불러오기
              </button>
              <button
                className="mymusic-draft-card__delete-btn"
                onClick={() => handleDelete(draft.job_id, draft.title)}
                disabled={deletingId === draft.job_id}
              >
                <FiTrash2 />
                {deletingId === draft.job_id ? '삭제 중' : '삭제'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CharacterSection() {
  const [character, setCharacter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewObjectName, setPreviewObjectName] = useState(null);
  const [saving, setSaving] = useState(false);
  const [photoFile, setPhotoFile] = useState(null);
  const photoInputRef = useRef(null);

  useEffect(() => {
    api.getMyCharacter()
      .then(({ data }) => setCharacter(data.character))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleGenerate = async () => {
    if (!photoFile) {
      alert('사진을 먼저 선택해주세요.');
      return;
    }
    setGenerating(true);
    try {
      const formData = new FormData();
      formData.append('file', photoFile);
      const { data } = await api.generateCharacterSheet(formData);
      const base = `${window.location.protocol}//${window.location.hostname}:9000`;
      setPreviewUrl(`${base}${data.preview_url}`);
      setPreviewObjectName(data.object_name);
    } catch (err) {
      alert(err.response?.data?.error || '캐릭터 시트 생성에 실패했습니다.');
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!previewObjectName) return;
    setSaving(true);
    try {
      await api.saveCharacter({ sheet_object_name: previewObjectName });
      const { data } = await api.getMyCharacter();
      setCharacter(data.character);
      setPreviewUrl(null);
      setPreviewObjectName(null);
      setPhotoFile(null);
    } catch (err) {
      alert(err.response?.data?.error || '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('캐릭터를 삭제하시겠습니까?')) return;
    try {
      await api.deleteMyCharacter();
      setCharacter(null);
    } catch (err) {
      alert(err.response?.data?.error || '삭제에 실패했습니다.');
    }
  };

  const handleRegenerate = () => {
    setCharacter(null);
    setPreviewUrl(null);
    setPreviewObjectName(null);
    setPhotoFile(null);
  };

  if (loading) {
    return <div className="mymusic-loading">로딩 중...</div>;
  }

  // Saved character exists
  if (character) {
    return (
      <div className="mymusic-character">
        <div className="mymusic-character__sheet">
          <img
            src={character.sheet_url}
            alt="내 캐릭터 시트"
            className="mymusic-character__sheet-img"
          />
          <div className="mymusic-character__actions">
            <button
              className="mymusic-character__btn mymusic-character__btn--primary"
              onClick={handleRegenerate}
            >
              <FiRefreshCw /> 다시 만들기
            </button>
            <button
              className="mymusic-character__btn mymusic-character__btn--danger"
              onClick={handleDelete}
            >
              <FiTrash2 /> 삭제
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Preview exists (generated but not saved)
  if (previewUrl) {
    return (
      <div className="mymusic-character">
        <div className="mymusic-character__sheet">
          <div className="mymusic-character__sheet-label">생성된 캐릭터 시트 미리보기</div>
          <img
            src={previewUrl}
            alt="캐릭터 시트 미리보기"
            className="mymusic-character__sheet-img"
          />
          <div className="mymusic-character__actions">
            <button
              className="mymusic-character__btn mymusic-character__btn--primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? '저장 중...' : '저장하기'}
            </button>
            <button
              className="mymusic-character__btn"
              onClick={handleGenerate}
              disabled={generating}
            >
              {generating ? '생성 중...' : '다시 생성'}
            </button>
            <button
              className="mymusic-character__btn"
              onClick={() => { setPreviewUrl(null); setPreviewObjectName(null); }}
            >
              취소
            </button>
          </div>
        </div>
      </div>
    );
  }

  // No character — show upload form
  return (
    <div className="mymusic-character">
      <div className="mymusic-character__empty">
        <div className="mymusic-character__empty-icon"><FiUser /></div>
        <p className="mymusic-character__empty-text">
          아직 캐릭터가 없습니다. 사진을 업로드하여 AI 캐릭터 시트를 만들어보세요.
        </p>
        <p className="mymusic-character__empty-hint">
          실사(photorealistic) 스타일로 정면, 측면, 전신, 표정 변화 등 다양한 앵글의 캐릭터 시트가 생성됩니다.
        </p>

        <div className="mymusic-character__upload-area">
          <div
            className="mymusic-character__dropzone"
            onClick={() => photoInputRef.current?.click()}
          >
            <div className="mymusic-character__dropzone-icon"><FiImage /></div>
            <div className="mymusic-character__dropzone-text">
              <strong>클릭</strong>하여 얼굴 사진을 선택하세요
            </div>
            <div className="mymusic-character__dropzone-hint">JPG, PNG, WebP (10MB 이하)</div>
          </div>
          <input
            ref={photoInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp"
            style={{ display: 'none' }}
            onChange={(e) => setPhotoFile(e.target.files[0] || null)}
          />
          {photoFile && (
            <div className="mymusic-character__file-info">
              <FiImage />
              <span className="mymusic-character__file-name">{photoFile.name}</span>
              <button
                className="mymusic-character__file-remove"
                onClick={() => setPhotoFile(null)}
              >
                <FiTrash2 />
              </button>
            </div>
          )}
        </div>

        <button
          className="mymusic-character__generate-btn"
          onClick={handleGenerate}
          disabled={!photoFile || generating}
        >
          {generating ? (
            <>
              <span className="mymusic-character__spinner" />
              캐릭터 시트 생성 중...
            </>
          ) : (
            '캐릭터 시트 생성하기'
          )}
        </button>
      </div>
    </div>
  );
}

export default function MyMusicPage() {
  const { user } = useAuth();
  const { play, currentSong, isPlaying, togglePlay } = usePlayer();
  const [activeTab, setActiveTab] = useState('tracks');
  const [generationPrefill, setGenerationPrefill] = useState(null);
  const [draftData, setDraftData] = useState(null);

  const handleSendToUpload = (genData) => {
    setGenerationPrefill(genData);
    setActiveTab('upload');
  };

  const handleLoadDraft = async (jobId) => {
    try {
      const { data } = await api.getMVJobDetail(jobId);
      setDraftData({
        job_id: data.job_id,
        title: data.title || '',
        genre: data.genre || '',
        mood: data.mood || '',
        prompt: data.prompt || '',
        lyrics: data.lyrics || '',
        tags: data.tags || '',
        ai_model: data.ai_model || '',
        audio_generation_id: data.audio_generation_id || null,
      });
      setActiveTab('upload');
    } catch (err) {
      alert(err.response?.data?.error || '초안을 불러오는데 실패했습니다.');
    }
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
    if (currentSong?.id === track.id) {
      togglePlay();
      return;
    }
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
          <button
            className={`mymusic-tab ${activeTab === 'character' ? 'mymusic-tab--active' : ''}`}
            onClick={() => setActiveTab('character')}
          >
            내 캐릭터
          </button>
          <button
            className={`mymusic-tab ${activeTab === 'drafts' ? 'mymusic-tab--active' : ''}`}
            onClick={() => setActiveTab('drafts')}
          >
            임시저장
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
            <UploadPage
              generationPrefill={generationPrefill}
              onClearPrefill={() => setGenerationPrefill(null)}
              draftData={draftData}
              onClearDraft={() => setDraftData(null)}
            />
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

        {/* Tab 6: Character */}
        {activeTab === 'character' && (
          <CharacterSection />
        )}

        {/* Tab 7: Drafts */}
        {activeTab === 'drafts' && (
          <DraftsSection onLoadDraft={handleLoadDraft} />
        )}
      </div>
    </div>
  );
}
