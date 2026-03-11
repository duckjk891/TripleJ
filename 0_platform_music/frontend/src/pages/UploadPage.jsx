import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiUploadCloud, FiMusic, FiX, FiImage } from 'react-icons/fi';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../api';
import './UploadPage.css';

const GENRES = ['발라드', '댄스', '힙합', 'R&B', '인디', '록', '기타'];
const AUDIO_ACCEPT = '.mp3,.wav,.ogg,.flac,.m4a';
const IMAGE_ACCEPT = '.jpg,.jpeg,.png,.webp';

export default function UploadPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const audioInputRef = useRef(null);
  const imageInputRef = useRef(null);

  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [audioFile, setAudioFile] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  // Artist
  const [artists, setArtists] = useState([]);
  const [selectedArtistId, setSelectedArtistId] = useState('');
  const [isNewArtist, setIsNewArtist] = useState(false);
  const [newArtistName, setNewArtistName] = useState('');

  // Album
  const [albums, setAlbums] = useState([]);
  const [selectedAlbumId, setSelectedAlbumId] = useState('');
  const [isNewAlbum, setIsNewAlbum] = useState(false);
  const [newAlbumTitle, setNewAlbumTitle] = useState('');
  const [noAlbum, setNoAlbum] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Load artists
  useEffect(() => {
    const fetchArtists = async () => {
      try {
        const { data } = await api.getArtists({ limit: 200 });
        setArtists(data.artists || data || []);
      } catch (err) {
        console.error('Failed to load artists:', err);
      }
    };
    if (user) fetchArtists();
  }, [user]);

  // Load albums when artist changes
  useEffect(() => {
    if (!selectedArtistId || isNewArtist) {
      setAlbums([]);
      return;
    }
    const fetchAlbums = async () => {
      try {
        const { data } = await api.getArtistAlbums(selectedArtistId);
        setAlbums(data || []);
      } catch (err) {
        console.error('Failed to load albums:', err);
      }
    };
    fetchAlbums();
  }, [selectedArtistId, isNewArtist]);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('audio/')) {
      setAudioFile(file);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!title.trim()) { setError('곡 제목을 입력해주세요.'); return; }
    if (!audioFile) { setError('오디오 파일을 선택해주세요.'); return; }
    if (!isNewArtist && !selectedArtistId) { setError('아티스트를 선택해주세요.'); return; }
    if (isNewArtist && !newArtistName.trim()) { setError('아티스트 이름을 입력해주세요.'); return; }

    setUploading(true);
    setProgress(0);

    try {
      let artistId = selectedArtistId;
      let albumId = selectedAlbumId;

      // Create new artist if needed
      if (isNewArtist) {
        const { data } = await api.createArtist(newArtistName.trim(), genre || '기타', '');
        artistId = data.id;
      }

      // Create new album if needed
      if (!noAlbum && isNewAlbum && newAlbumTitle.trim()) {
        const { data } = await api.createAlbum(newAlbumTitle.trim(), artistId, genre || '기타', '');
        albumId = data.id;
      }

      if (noAlbum) {
        albumId = '';
      }

      // Upload song
      const formData = new FormData();
      formData.append('file', audioFile);
      formData.append('title', title.trim());
      formData.append('artist_id', artistId);
      if (albumId) formData.append('album_id', albumId);
      if (genre) formData.append('genre', genre);
      if (lyrics.trim()) formData.append('lyrics', lyrics.trim());

      await api.uploadSong(formData, (progressEvent) => {
        const pct = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        setProgress(pct);
      });

      // Upload cover image if provided
      if (imageFile && albumId) {
        const imgFormData = new FormData();
        imgFormData.append('file', imageFile);
        imgFormData.append('type', 'album');
        imgFormData.append('id', albumId);
        await api.uploadImage(imgFormData).catch(() => {});
      }

      setSuccess('업로드가 완료되었습니다!');
      setTimeout(() => navigate('/'), 1500);
    } catch (err) {
      setError(err.response?.data?.error || '업로드에 실패했습니다.');
    } finally {
      setUploading(false);
    }
  };

  if (!user) {
    return (
      <div className="page-content">
        <div className="container">
          <div className="upload-login-prompt">
            <div className="upload-login-prompt__icon">
              <FiUploadCloud />
            </div>
            <div className="upload-login-prompt__text">
              로그인하여 음악을 업로드하세요
            </div>
            <Link to="/login" className="upload-login-prompt__btn">
              로그인
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="upload-page">
        <form className="upload-card" onSubmit={handleSubmit}>
          <h1 className="upload-card__title">음악 업로드</h1>

          {error && <div className="upload-card__error">{error}</div>}
          {success && <div className="upload-card__success">{success}</div>}

          {/* Audio file */}
          <div className="upload-card__field">
            <label className="upload-card__label">오디오 파일 *</label>
            <div
              className={`upload-card__dropzone ${dragOver ? 'upload-card__dropzone--drag' : ''}`}
              onClick={() => audioInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <div className="upload-card__dropzone-icon"><FiUploadCloud /></div>
              <div className="upload-card__dropzone-text">
                <strong>클릭</strong>하거나 파일을 드래그하세요
              </div>
              <div className="upload-card__dropzone-hint">MP3, WAV, OGG, FLAC, M4A</div>
            </div>
            <input
              ref={audioInputRef}
              type="file"
              accept={AUDIO_ACCEPT}
              style={{ display: 'none' }}
              onChange={(e) => setAudioFile(e.target.files[0] || null)}
            />
            {audioFile && (
              <div className="upload-card__file-info">
                <span className="upload-card__file-icon"><FiMusic /></span>
                <span className="upload-card__file-name">{audioFile.name}</span>
                <button type="button" className="upload-card__file-remove" onClick={() => setAudioFile(null)}>
                  <FiX />
                </button>
              </div>
            )}
          </div>

          {/* Title */}
          <div className="upload-card__field">
            <label className="upload-card__label">곡 제목 *</label>
            <input
              className="upload-card__input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="곡 제목을 입력하세요"
            />
          </div>

          {/* Artist */}
          <div className="upload-card__field">
            <label className="upload-card__label">아티스트 *</label>
            <div className="upload-card__row">
              {isNewArtist ? (
                <input
                  className="upload-card__input"
                  type="text"
                  value={newArtistName}
                  onChange={(e) => setNewArtistName(e.target.value)}
                  placeholder="새 아티스트 이름"
                />
              ) : (
                <select
                  className="upload-card__select"
                  value={selectedArtistId}
                  onChange={(e) => { setSelectedArtistId(e.target.value); setSelectedAlbumId(''); }}
                >
                  <option value="">아티스트 선택</option>
                  {artists.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              )}
              <button
                type="button"
                className={`upload-card__toggle-btn ${isNewArtist ? 'upload-card__toggle-btn--active' : ''}`}
                onClick={() => { setIsNewArtist(!isNewArtist); setSelectedArtistId(''); setNewArtistName(''); }}
              >
                {isNewArtist ? '목록에서 선택' : '새 아티스트'}
              </button>
            </div>
          </div>

          {/* Album */}
          <div className="upload-card__field">
            <label className="upload-card__label">앨범</label>
            {noAlbum ? (
              <div className="upload-card__row">
                <span style={{ fontSize: 13, color: 'var(--color-text-sub)' }}>앨범 없이 업로드합니다</span>
                <button
                  type="button"
                  className="upload-card__toggle-btn upload-card__toggle-btn--active"
                  onClick={() => setNoAlbum(false)}
                >
                  앨범 선택
                </button>
              </div>
            ) : (
              <div className="upload-card__row">
                {isNewAlbum ? (
                  <input
                    className="upload-card__input"
                    type="text"
                    value={newAlbumTitle}
                    onChange={(e) => setNewAlbumTitle(e.target.value)}
                    placeholder="새 앨범 제목"
                  />
                ) : (
                  <select
                    className="upload-card__select"
                    value={selectedAlbumId}
                    onChange={(e) => setSelectedAlbumId(e.target.value)}
                    disabled={!selectedArtistId && !isNewArtist}
                  >
                    <option value="">{(selectedArtistId || isNewArtist) ? '앨범 선택' : '아티스트를 먼저 선택하세요'}</option>
                    {albums.map((a) => (
                      <option key={a.id} value={a.id}>{a.title}</option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  className={`upload-card__toggle-btn ${isNewAlbum ? 'upload-card__toggle-btn--active' : ''}`}
                  onClick={() => { setIsNewAlbum(!isNewAlbum); setSelectedAlbumId(''); setNewAlbumTitle(''); }}
                >
                  {isNewAlbum ? '목록에서 선택' : '새 앨범'}
                </button>
                <button
                  type="button"
                  className="upload-card__toggle-btn"
                  onClick={() => { setNoAlbum(true); setIsNewAlbum(false); setSelectedAlbumId(''); }}
                >
                  없음
                </button>
              </div>
            )}
          </div>

          {/* Genre */}
          <div className="upload-card__field">
            <label className="upload-card__label">장르</label>
            <select
              className="upload-card__select"
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
            >
              <option value="">장르 선택</option>
              {GENRES.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>

          {/* Cover image */}
          <div className="upload-card__field">
            <label className="upload-card__label">앨범 커버 이미지 (선택)</label>
            <div
              className="upload-card__dropzone"
              onClick={() => imageInputRef.current?.click()}
              style={{ padding: '20px' }}
            >
              <div className="upload-card__dropzone-icon"><FiImage /></div>
              <div className="upload-card__dropzone-text">
                <strong>클릭</strong>하여 이미지를 선택하세요
              </div>
              <div className="upload-card__dropzone-hint">JPG, PNG, WebP</div>
            </div>
            <input
              ref={imageInputRef}
              type="file"
              accept={IMAGE_ACCEPT}
              style={{ display: 'none' }}
              onChange={(e) => setImageFile(e.target.files[0] || null)}
            />
            {imageFile && (
              <div className="upload-card__file-info">
                <span className="upload-card__file-icon"><FiImage /></span>
                <span className="upload-card__file-name">{imageFile.name}</span>
                <button type="button" className="upload-card__file-remove" onClick={() => setImageFile(null)}>
                  <FiX />
                </button>
              </div>
            )}
          </div>

          {/* Lyrics */}
          <div className="upload-card__field">
            <label className="upload-card__label">가사 (선택)</label>
            <textarea
              className="upload-card__textarea"
              value={lyrics}
              onChange={(e) => setLyrics(e.target.value)}
              placeholder="가사를 입력하세요"
            />
          </div>

          {/* Progress */}
          {uploading && (
            <div className="upload-card__progress">
              <div className="upload-card__progress-bar">
                <div className="upload-card__progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <div className="upload-card__progress-text">업로드 중... {progress}%</div>
            </div>
          )}

          <button className="upload-card__submit" type="submit" disabled={uploading}>
            {uploading ? '업로드 중...' : '업로드'}
          </button>
        </form>
      </div>
    </div>
  );
}
