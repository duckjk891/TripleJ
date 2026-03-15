import { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiUploadCloud, FiMusic, FiX, FiImage } from 'react-icons/fi';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../api';
import './UploadPage.css';

const GENRES = ['발라드', '댄스', '힙합', 'R&B', '인디', '록', 'Electronic', 'Ambient', 'Lo-fi', 'Cinematic', '기타'];
const AI_TOOLS = ['Suno', 'Udio', 'AIVA', 'Stable Audio', 'MusicGen (Meta)', '기타'];
const AUDIO_ACCEPT = '.mp3,.wav,.ogg,.flac,.m4a';
const IMAGE_ACCEPT = '.jpg,.jpeg,.png,.webp';

export default function UploadPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const audioInputRef = useRef(null);
  const imageInputRef = useRef(null);

  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('');
  const [aiTool, setAiTool] = useState('');
  const [prompt, setPrompt] = useState('');
  const [tags, setTags] = useState('');
  const [mood, setMood] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [audioFile, setAudioFile] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('audio/')) {
      setAudioFile(file);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!title.trim()) { setError('곡 제목을 입력해주세요.'); return; }
    if (!audioFile) { setError('오디오 파일을 선택해주세요.'); return; }

    setUploading(true);
    setProgress(0);

    try {
      const formData = new FormData();
      formData.append('file', audioFile);
      formData.append('title', title.trim());
      if (genre) formData.append('genre', genre);
      if (aiTool) formData.append('ai_model', aiTool);
      if (prompt.trim()) formData.append('prompt', prompt.trim());
      if (tags.trim()) formData.append('tags', tags.trim());
      if (mood.trim()) formData.append('mood', mood.trim());
      if (lyrics.trim()) formData.append('lyrics', lyrics.trim());

      const { data: track } = await api.uploadTrack(formData, (progressEvent) => {
        const pct = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        setProgress(pct);
      });

      // Upload cover image if provided
      if (imageFile && track?.id) {
        const imgFormData = new FormData();
        imgFormData.append('file', imageFile);
        imgFormData.append('type', 'track');
        imgFormData.append('id', track.id);
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
            <div className="upload-login-prompt__icon"><FiUploadCloud /></div>
            <div className="upload-login-prompt__text">로그인하여 AI 음악을 업로드하세요</div>
            <Link to="/login" className="upload-login-prompt__btn">로그인</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="upload-page">
        <form className="upload-card" onSubmit={handleSubmit}>
          <h1 className="upload-card__title">AI 음악 업로드</h1>

          {error && <div className="upload-card__error">{error}</div>}
          {success && <div className="upload-card__success">{success}</div>}

          {/* Audio file */}
          <div className="upload-card__field">
            <label className="upload-card__label">오디오 파일 *</label>
            <div
              className={`upload-card__dropzone ${dragOver ? 'upload-card__dropzone--drag' : ''}`}
              onClick={() => audioInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
            >
              <div className="upload-card__dropzone-icon"><FiUploadCloud /></div>
              <div className="upload-card__dropzone-text"><strong>클릭</strong>하거나 파일을 드래그하세요</div>
              <div className="upload-card__dropzone-hint">MP3, WAV, OGG, FLAC, M4A (50MB 이하)</div>
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
                <button type="button" className="upload-card__file-remove" onClick={() => setAudioFile(null)}><FiX /></button>
              </div>
            )}
          </div>

          {/* Title */}
          <div className="upload-card__field">
            <label className="upload-card__label">곡 제목 *</label>
            <input className="upload-card__input" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="곡 제목을 입력하세요" />
          </div>

          {/* Genre */}
          <div className="upload-card__field">
            <label className="upload-card__label">장르</label>
            <select className="upload-card__select" value={genre} onChange={(e) => setGenre(e.target.value)}>
              <option value="">장르 선택</option>
              {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>

          {/* AI Tool */}
          <div className="upload-card__field">
            <label className="upload-card__label">AI 생성 도구</label>
            <select className="upload-card__select" value={aiTool} onChange={(e) => setAiTool(e.target.value)}>
              <option value="">AI 도구 선택 (선택사항)</option>
              {AI_TOOLS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {/* Prompt */}
          <div className="upload-card__field">
            <label className="upload-card__label">생성 프롬프트 (선택)</label>
            <textarea className="upload-card__textarea" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="AI에 입력한 프롬프트를 공유해보세요" rows={3} />
          </div>

          {/* Tags */}
          <div className="upload-card__field">
            <label className="upload-card__label">태그 (선택, 쉼표로 구분)</label>
            <input className="upload-card__input" type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="예: chill, 새벽, 감성" />
          </div>

          {/* Mood */}
          <div className="upload-card__field">
            <label className="upload-card__label">분위기 (선택, 쉼표로 구분)</label>
            <input className="upload-card__input" type="text" value={mood} onChange={(e) => setMood(e.target.value)} placeholder="예: relaxing, energetic, dark" />
          </div>

          {/* Cover image */}
          <div className="upload-card__field">
            <label className="upload-card__label">커버 이미지 (선택)</label>
            <div className="upload-card__dropzone" onClick={() => imageInputRef.current?.click()} style={{ padding: '20px' }}>
              <div className="upload-card__dropzone-icon"><FiImage /></div>
              <div className="upload-card__dropzone-text"><strong>클릭</strong>하여 이미지를 선택하세요</div>
              <div className="upload-card__dropzone-hint">JPG, PNG, WebP</div>
            </div>
            <input ref={imageInputRef} type="file" accept={IMAGE_ACCEPT} style={{ display: 'none' }} onChange={(e) => setImageFile(e.target.files[0] || null)} />
            {imageFile && (
              <div className="upload-card__file-info">
                <span className="upload-card__file-icon"><FiImage /></span>
                <span className="upload-card__file-name">{imageFile.name}</span>
                <button type="button" className="upload-card__file-remove" onClick={() => setImageFile(null)}><FiX /></button>
              </div>
            )}
          </div>

          {/* Lyrics */}
          <div className="upload-card__field">
            <label className="upload-card__label">가사 (선택)</label>
            <textarea className="upload-card__textarea" value={lyrics} onChange={(e) => setLyrics(e.target.value)} placeholder="가사를 입력하세요" rows={4} />
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
