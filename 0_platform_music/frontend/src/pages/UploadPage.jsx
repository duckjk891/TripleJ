import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiUploadCloud, FiMusic, FiX, FiImage, FiZap } from 'react-icons/fi';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../api';
import './UploadPage.css';

const GENRES = ['발라드', '댄스', '힙합', 'R&B', '인디', '록', 'Electronic', 'Ambient', 'Lo-fi', 'Cinematic', '기타'];
const AI_TOOLS = ['Suno', 'Udio', 'AIVA', 'Stable Audio', 'MusicGen (Meta)', 'YuE', '기타'];
const AUDIO_ACCEPT = '.mp3,.wav,.ogg,.flac,.m4a';
const IMAGE_ACCEPT = '.jpg,.jpeg,.png,.webp';

export default function UploadPage({ generationPrefill, onClearPrefill }) {
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
  const [fromGeneration, setFromGeneration] = useState(null);

  const [generatingCover, setGeneratingCover] = useState(false);
  const [aiCoverPreview, setAiCoverPreview] = useState(null);
  const [aiCoverObjectName, setAiCoverObjectName] = useState(null);

  const [generatingMV, setGeneratingMV] = useState(false);
  const [mvPreview, setMvPreview] = useState(null);
  const [mvObjectName, setMvObjectName] = useState(null);
  const [mvProgress, setMvProgress] = useState('');

  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (generationPrefill) {
      setTitle(generationPrefill.title || '');
      setGenre(generationPrefill.genre || '');
      setMood(generationPrefill.mood || '');
      setPrompt(generationPrefill.prompt || '');
      setLyrics(generationPrefill.lyrics || '');
      setFromGeneration(generationPrefill.generationId);
      setAiTool('YuE');
      if (onClearPrefill) onClearPrefill();
    }
  }, [generationPrefill]);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('audio/')) {
      setAudioFile(file);
    }
  };

  const handleGenerateCover = async () => {
    if (!title.trim()) {
      alert('커버를 생성하려면 먼저 곡 제목을 입력해주세요.');
      return;
    }
    setGeneratingCover(true);
    try {
      const { data } = await api.generateCover({
        title: title.trim(),
        genre: genre || null,
        mood: mood || null,
        style: null,
      });
      const base = `${window.location.protocol}//${window.location.hostname}:9000`;
      const token = localStorage.getItem('token');
      const proxyUrl = `${base}/api/upload/cover-preview/${encodeURIComponent(data.object_name)}?token=${encodeURIComponent(token)}`;
      setAiCoverPreview(proxyUrl);
      setAiCoverObjectName(data.object_name);
      // Clear manual image file since AI cover is chosen
      setImageFile(null);
    } catch (err) {
      alert(err.response?.data?.error || 'AI 커버 생성에 실패했습니다.');
    } finally {
      setGeneratingCover(false);
    }
  };

  const handleClearAiCover = () => {
    setAiCoverPreview(null);
    setAiCoverObjectName(null);
  };

  const handleGenerateMV = async () => {
    if (!title.trim()) {
      alert('곡 제목을 입력해주세요.');
      return;
    }

    setGeneratingMV(true);
    setMvProgress('뮤직비디오 생성 요청 중...');

    try {
      const { data } = await api.generateMV({
        title: title.trim(),
        genre: genre || null,
        mood: mood || null,
        cover_object_name: aiCoverObjectName || null,
      });

      const operationName = data.operation_name;
      setMvProgress('뮤직비디오 생성 중... (최대 2~3분 소요)');

      const pollInterval = setInterval(async () => {
        try {
          const { data: status } = await api.checkMVStatus(operationName);
          if (status.done) {
            clearInterval(pollInterval);
            if (status.error) {
              alert('뮤직비디오 생성 실패: ' + status.error);
              setGeneratingMV(false);
              setMvProgress('');
            } else {
              const base = `${window.location.protocol}//${window.location.hostname}:9000`;
              setMvPreview(`${base}${status.video_url}`);
              setMvObjectName(status.object_name);
              setGeneratingMV(false);
              setMvProgress('');
            }
          }
        } catch (err) {
          clearInterval(pollInterval);
          alert('상태 확인 실패: ' + (err.response?.data?.error || err.message));
          setGeneratingMV(false);
          setMvProgress('');
        }
      }, 10000);
    } catch (err) {
      alert(err.response?.data?.error || '뮤직비디오 생성에 실패했습니다.');
      setGeneratingMV(false);
      setMvProgress('');
    }
  };

  const handleClearMV = () => {
    setMvPreview(null);
    setMvObjectName(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!title.trim()) { setError('곡 제목을 입력해주세요.'); return; }
    if (!fromGeneration && !audioFile) { setError('오디오 파일을 선택해주세요.'); return; }

    setUploading(true);
    setProgress(0);

    try {
      let track;

      if (fromGeneration) {
        // Upload from AI generation - audio is already on the server
        const { data } = await api.uploadFromGeneration({
          generation_id: fromGeneration,
          title: title.trim(),
          genre: genre || undefined,
          mood: mood || undefined,
          tags: tags.trim() || undefined,
          prompt: prompt.trim() || undefined,
          lyrics: lyrics.trim() || undefined,
          ai_model: aiTool || undefined,
          cover_object_name: aiCoverObjectName || undefined,
          mv_object_name: mvObjectName || undefined,
        });
        track = data;
      } else {
        // Normal file upload
        const formData = new FormData();
        formData.append('file', audioFile);
        formData.append('title', title.trim());
        if (genre) formData.append('genre', genre);
        if (aiTool) formData.append('ai_model', aiTool);
        if (prompt.trim()) formData.append('prompt', prompt.trim());
        if (tags.trim()) formData.append('tags', tags.trim());
        if (mood.trim()) formData.append('mood', mood.trim());
        if (lyrics.trim()) formData.append('lyrics', lyrics.trim());
        if (aiCoverObjectName) formData.append('cover_object_name', aiCoverObjectName);
        if (mvObjectName) formData.append('mv_object_name', mvObjectName);

        const { data } = await api.uploadTrack(formData, (progressEvent) => {
          const pct = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setProgress(pct);
        });
        track = data;
      }

      // Upload cover image if provided (skip if AI cover was used)
      if (imageFile && !aiCoverObjectName && track?.id) {
        const imgFormData = new FormData();
        imgFormData.append('file', imageFile);
        imgFormData.append('type', 'track');
        imgFormData.append('id', track.id);
        await api.uploadImage(imgFormData).catch(() => {});
      }

      setSuccess('업로드가 완료되었습니다!');
      setFromGeneration(null);
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
            {fromGeneration ? (
              <div className="upload-card__gen-audio">
                <div className="upload-card__gen-badge">
                  <FiZap className="upload-card__gen-badge-icon" />
                  <span className="upload-card__gen-badge-text">AI 생성 오디오 (자동 연결)</span>
                  <button
                    type="button"
                    className="upload-card__gen-badge-cancel"
                    onClick={() => setFromGeneration(null)}
                  >
                    <FiX /> 취소
                  </button>
                </div>
                <audio
                  controls
                  className="upload-card__gen-player"
                  src={`${window.location.protocol}//${window.location.hostname}:9000/api/generate/${fromGeneration}/stream/?token=${encodeURIComponent(localStorage.getItem('token') || '')}`}
                />
              </div>
            ) : (
              <>
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
              </>
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

            {/* AI cover preview */}
            {aiCoverPreview && (
              <div className="upload-cover-preview">
                <img src={aiCoverPreview} alt="AI 생성 커버" className="upload-cover-preview__img" />
                <div className="upload-cover-preview__actions">
                  <button type="button" className="upload-cover-regenerate" onClick={handleGenerateCover} disabled={generatingCover}>
                    {generatingCover ? '생성 중...' : '다시 생성'}
                  </button>
                  <button type="button" className="upload-cover-remove" onClick={handleClearAiCover}>제거</button>
                </div>
              </div>
            )}

            {/* Show upload dropzone and AI button only when no AI cover is set */}
            {!aiCoverPreview && (
              <>
                <div className="upload-card__dropzone" onClick={() => imageInputRef.current?.click()} style={{ padding: '20px' }}>
                  <div className="upload-card__dropzone-icon"><FiImage /></div>
                  <div className="upload-card__dropzone-text"><strong>클릭</strong>하여 이미지를 선택하세요</div>
                  <div className="upload-card__dropzone-hint">JPG, PNG, WebP</div>
                </div>
                <input ref={imageInputRef} type="file" accept={IMAGE_ACCEPT} style={{ display: 'none' }} onChange={(e) => { setImageFile(e.target.files[0] || null); handleClearAiCover(); }} />
                {imageFile && (
                  <div className="upload-card__file-info">
                    <span className="upload-card__file-icon"><FiImage /></span>
                    <span className="upload-card__file-name">{imageFile.name}</span>
                    <button type="button" className="upload-card__file-remove" onClick={() => setImageFile(null)}><FiX /></button>
                  </div>
                )}

                <div className="upload-cover-divider">
                  <span className="upload-cover-divider__line" />
                  <span className="upload-cover-divider__text">또는</span>
                  <span className="upload-cover-divider__line" />
                </div>

                <button
                  type="button"
                  className="upload-cover-ai-btn"
                  onClick={handleGenerateCover}
                  disabled={generatingCover}
                >
                  {generatingCover ? (
                    <>
                      <span className="upload-cover-spinner" />
                      AI 커버 생성 중...
                    </>
                  ) : (
                    'AI 커버 생성'
                  )}
                </button>
              </>
            )}
          </div>

          {/* Music Video */}
          <div className="upload-card__field">
            <label className="upload-card__label">뮤직비디오 (선택)</label>

            {mvPreview ? (
              <div className="upload-mv-preview">
                <video src={mvPreview} controls className="upload-mv-preview__video" />
                <div className="upload-mv-preview__actions">
                  <button type="button" className="upload-mv-regenerate" onClick={handleGenerateMV} disabled={generatingMV}>
                    {generatingMV ? '생성 중...' : '다시 생성'}
                  </button>
                  <button type="button" className="upload-mv-remove" onClick={handleClearMV}>제거</button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="upload-mv-ai-btn"
                onClick={handleGenerateMV}
                disabled={generatingMV}
              >
                {generatingMV ? (
                  <>
                    <span className="upload-cover-spinner" />
                    {mvProgress || '뮤직비디오 생성 중...'}
                  </>
                ) : (
                  '🎬 AI 뮤직비디오 생성'
                )}
              </button>
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
