import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { FiUploadCloud, FiTrash2, FiMusic, FiPlay, FiPause, FiFolder, FiImage, FiFilm, FiAlertCircle, FiUser, FiRefreshCw, FiMic, FiPlus, FiCheck, FiLoader, FiDownload, FiVolume2, FiSquare, FiEdit3, FiStopCircle, FiArrowRight } from 'react-icons/fi';
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
  const [topFile, setTopFile] = useState(null);
  const [bottomFile, setBottomFile] = useState(null);
  const [shoesFile, setShoesFile] = useState(null);
  const [characterText, setCharacterText] = useState('');
  const [refineMode, setRefineMode] = useState(false);
  const [refineText, setRefineText] = useState('');
  const [refining, setRefining] = useState(false);
  const photoInputRef = useRef(null);
  const topInputRef = useRef(null);
  const bottomInputRef = useRef(null);
  const shoesInputRef = useRef(null);

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
      if (topFile) formData.append('top_image', topFile);
      if (bottomFile) formData.append('bottom_image', bottomFile);
      if (shoesFile) formData.append('shoes_image', shoesFile);
      formData.append('user_text', characterText);
      const { data } = await api.generateCharacterSheet(formData);
      setPreviewUrl(api.characterPreviewUrl(data.preview_url));
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
      setTopFile(null);
      setBottomFile(null);
      setShoesFile(null);
      setCharacterText('');
      setRefineMode(false);
      setRefineText('');
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
    setTopFile(null);
    setBottomFile(null);
    setShoesFile(null);
    setCharacterText('');
    setRefineMode(false);
    setRefineText('');
  };

  const handleRefine = async () => {
    if (!refineText.trim()) {
      alert('수정 요청 내용을 입력해주세요.');
      return;
    }
    if (!previewUrl || !photoFile) {
      alert('미리보기 이미지와 원본 사진이 필요합니다.');
      return;
    }
    setRefining(true);
    try {
      // Fetch current preview image as blob
      const sheetResp = await api.fetchAsBlob(previewUrl);
      const sheetBlob = sheetResp.data;

      const formData = new FormData();
      formData.append('sheet_image', sheetBlob, 'sheet.png');
      formData.append('photo', photoFile);
      formData.append('refine_request', refineText.trim());

      const { data } = await api.refineCharacterSheet(formData);
      setPreviewUrl(api.characterPreviewUrl(data.preview_url));
      setPreviewObjectName(data.object_name);
      setRefineText('');
      setRefineMode(false);
    } catch (err) {
      alert(err.response?.data?.error || '캐릭터 시트 수정에 실패했습니다.');
    } finally {
      setRefining(false);
    }
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
              disabled={saving || refining}
            >
              {saving ? '저장 중...' : '저장하기'}
            </button>
            <button
              className="mymusic-character__btn"
              onClick={() => setRefineMode(!refineMode)}
              disabled={refining || generating}
            >
              <FiEdit3 /> 수정 요청
            </button>
            <button
              className="mymusic-character__btn"
              onClick={handleGenerate}
              disabled={generating || refining}
            >
              {generating ? '생성 중...' : '다시 생성'}
            </button>
            <button
              className="mymusic-character__btn"
              onClick={() => { setPreviewUrl(null); setPreviewObjectName(null); setRefineMode(false); setRefineText(''); }}
              disabled={refining}
            >
              취소
            </button>
          </div>

          {refineMode && (
            <div className="mymusic-character__refine">
              <textarea
                className="mymusic-character__refine-input"
                placeholder="수정할 내용을 입력하세요. (예: 머리 색을 빨간색으로 변경, 의상을 정장으로 변경)"
                value={refineText}
                onChange={(e) => setRefineText(e.target.value)}
                rows={3}
                disabled={refining}
              />
              <button
                className="mymusic-character__refine-btn"
                onClick={handleRefine}
                disabled={refining || !refineText.trim()}
              >
                {refining ? (
                  <>
                    <span className="mymusic-character__spinner" />
                    수정 중...
                  </>
                ) : (
                  '수정 적용하기'
                )}
              </button>
            </div>
          )}
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
            className="mymusic-character__photo-box"
            onClick={() => !photoFile && photoInputRef.current?.click()}
          >
            {photoFile ? (
              <>
                <img
                  src={URL.createObjectURL(photoFile)}
                  alt="인물 사진 미리보기"
                  className="mymusic-character__photo-preview"
                />
                <button
                  className="mymusic-character__photo-remove"
                  onClick={(e) => { e.stopPropagation(); setPhotoFile(null); }}
                >
                  <FiTrash2 />
                </button>
              </>
            ) : (
              <>
                <div className="mymusic-character__dropzone-icon"><FiImage /></div>
                <div className="mymusic-character__dropzone-text">
                  <strong>클릭</strong>하여 얼굴 사진을 선택하세요
                </div>
                <div className="mymusic-character__dropzone-hint">JPG, PNG, WebP (10MB 이하)</div>
              </>
            )}
          </div>
          <input
            ref={photoInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp"
            style={{ display: 'none' }}
            onChange={(e) => setPhotoFile(e.target.files[0] || null)}
          />
        </div>

        {/* Character text description */}
        <div className="mymusic-character__text-section">
          <label className="mymusic-character__text-label">
            캐릭터 특징 설명 (선택)
          </label>
          <textarea
            className="mymusic-character__text-input"
            placeholder="예: 차가운 분위기, 키 180cm, 날카로운 눈매, 슬림한 체형"
            value={characterText}
            onChange={(e) => setCharacterText(e.target.value)}
            rows={3}
          />
        </div>

        {/* Outfit image uploads */}
        <p className="mymusic-character__outfit-hint">
          다른 의상으로 변경하고 싶으면 이미지를 첨부하세요 (선택)
        </p>
        <div className="mymusic-character__outfit-row">
          {/* Top */}
          <div className="mymusic-character__outfit-box">
            <div
              className="mymusic-character__outfit-dropzone"
              onClick={() => topInputRef.current?.click()}
            >
              {topFile ? (
                <img
                  src={URL.createObjectURL(topFile)}
                  alt="상의 미리보기"
                  className="mymusic-character__outfit-preview"
                />
              ) : (
                <span className="mymusic-character__outfit-label">상의</span>
              )}
            </div>
            <input
              ref={topInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.webp"
              style={{ display: 'none' }}
              onChange={(e) => setTopFile(e.target.files[0] || null)}
            />
            {topFile && (
              <button
                className="mymusic-character__outfit-remove"
                onClick={() => setTopFile(null)}
              >
                <FiTrash2 />
              </button>
            )}
          </div>

          {/* Bottom */}
          <div className="mymusic-character__outfit-box">
            <div
              className="mymusic-character__outfit-dropzone"
              onClick={() => bottomInputRef.current?.click()}
            >
              {bottomFile ? (
                <img
                  src={URL.createObjectURL(bottomFile)}
                  alt="하의 미리보기"
                  className="mymusic-character__outfit-preview"
                />
              ) : (
                <span className="mymusic-character__outfit-label">하의</span>
              )}
            </div>
            <input
              ref={bottomInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.webp"
              style={{ display: 'none' }}
              onChange={(e) => setBottomFile(e.target.files[0] || null)}
            />
            {bottomFile && (
              <button
                className="mymusic-character__outfit-remove"
                onClick={() => setBottomFile(null)}
              >
                <FiTrash2 />
              </button>
            )}
          </div>

          {/* Shoes */}
          <div className="mymusic-character__outfit-box">
            <div
              className="mymusic-character__outfit-dropzone"
              onClick={() => shoesInputRef.current?.click()}
            >
              {shoesFile ? (
                <img
                  src={URL.createObjectURL(shoesFile)}
                  alt="신발 미리보기"
                  className="mymusic-character__outfit-preview"
                />
              ) : (
                <span className="mymusic-character__outfit-label">신발</span>
              )}
            </div>
            <input
              ref={shoesInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.webp"
              style={{ display: 'none' }}
              onChange={(e) => setShoesFile(e.target.files[0] || null)}
            />
            {shoesFile && (
              <button
                className="mymusic-character__outfit-remove"
                onClick={() => setShoesFile(null)}
              >
                <FiTrash2 />
              </button>
            )}
          </div>
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

const REPAIR_STATUS_MAP = {
  uploading: { label: '업로드 중', color: '#7C3AED' },
  uploaded: { label: '업로드 완료', color: '#06B6D4' },
  enhancing: { label: '다듬기 중', color: '#F59E0B' },
  completed: { label: '완료', color: '#1ed760' },
  failed: { label: '실패', color: '#EF4444' },
};

function VoiceRecordSection() {
  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [recordedFileName, setRecordedFileName] = useState('');
  const mediaRecorderRef = useRef(null);
  const recordingTimerRef = useRef(null);
  const chunksRef = useRef([]);

  // File upload state
  const [uploadFile, setUploadFile] = useState(null);
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  // Repair process state
  const [uploading, setUploading] = useState(false);
  const [repairId, setRepairId] = useState(null);
  const [repairStatus, setRepairStatus] = useState(null);
  const [repairProgress, setRepairProgress] = useState(0);
  const [repairError, setRepairError] = useState(null);
  const pollRef = useRef(null);

  // Method selection state
  const [useLalal, setUseLalal] = useState(true);
  const [useDemucs, setUseDemucs] = useState(true);

  // Audio playback state
  const [originalBlobUrl, setOriginalBlobUrl] = useState(null);
  const [lalalBlobUrl, setLalalBlobUrl] = useState(null);
  const [demucsBlobUrl, setDemucsBlobUrl] = useState(null);
  const [playingType, setPlayingType] = useState(null); // 'original' | 'lalal' | 'demucs'
  const originalAudioRef = useRef(null);
  const lalalAudioRef = useRef(null);
  const demucsAudioRef = useRef(null);
  const [originalTime, setOriginalTime] = useState(0);
  const [lalalTime, setLalalTime] = useState(0);
  const [demucsTime, setDemucsTime] = useState(0);
  const [originalDuration, setOriginalDuration] = useState(0);
  const [lalalDuration, setLalalDuration] = useState(0);
  const [demucsDuration, setDemucsDuration] = useState(0);

  // Per-method status from polling
  const [lalalStatus, setLalalStatus] = useState(null);
  const [demucsStatus, setDemucsStatus] = useState(null);

  // History
  const [repairList, setRepairList] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (originalBlobUrl) URL.revokeObjectURL(originalBlobUrl);
      if (lalalBlobUrl) URL.revokeObjectURL(lalalBlobUrl);
      if (demucsBlobUrl) URL.revokeObjectURL(demucsBlobUrl);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  // ── Recording ──
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setRecordedBlob(blob);
        setRecordedFileName(`recording_${Date.now()}.webm`);
        stream.getTracks().forEach((t) => t.stop());
      };
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      alert('마이크 접근 권한이 필요합니다.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  };

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // ── File upload handlers ──
  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
  const ACCEPTED_TYPES = '.mp3,.wav,.m4a,.ogg,.flac,.webm';

  const handleFileSelect = (file) => {
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      alert('파일 크기가 50MB를 초과합니다.');
      return;
    }
    setUploadFile(file);
    setRecordedBlob(null);
    setRecordedFileName('');
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  // Get the active file (either recorded or uploaded)
  const activeFile = uploadFile || (recordedBlob ? new File([recordedBlob], recordedFileName, { type: 'audio/webm' }) : null);

  // ── Vocal repair process ──
  const handleStartRepair = async () => {
    if (!activeFile) {
      alert('녹음하거나 파일을 업로드해주세요.');
      return;
    }
    setUploading(true);
    setRepairError(null);
    setRepairStatus(null);
    setRepairProgress(0);
    setOriginalBlobUrl(null);
    setLalalBlobUrl(null);
    setDemucsBlobUrl(null);
    setLalalStatus(null);
    setDemucsStatus(null);
    setRepairId(null);

    const method = useLalal && useDemucs ? 'both' : useLalal ? 'lalal' : 'demucs';

    try {
      // Step 1: Upload
      const formData = new FormData();
      formData.append('file', activeFile);
      const { data: uploadData } = await api.uploadVoiceForRepair(formData);
      const id = uploadData.repair_id || uploadData.id;
      setRepairId(id);

      // Step 2: Start enhance with method
      await api.startVocalEnhance(id, method);
      setRepairStatus('enhancing');

      // Step 3: Poll status
      pollRef.current = setInterval(async () => {
        try {
          const { data: statusData } = await api.getVocalRepairStatus(id);
          const status = statusData.status;
          const progress = statusData.progress || 0;
          setRepairStatus(status);
          setRepairProgress(progress);
          if (statusData.lalal_status) setLalalStatus(statusData.lalal_status);
          if (statusData.demucs_status) setDemucsStatus(statusData.demucs_status);

          if (status === 'completed') {
            clearInterval(pollRef.current);
            pollRef.current = null;
            // Fetch audio blob URLs with auth
            await loadAudioBlobs(id, method);
          } else if (status === 'failed') {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setRepairError(statusData.error || '보컬 다듬기에 실패했습니다.');
          }
        } catch (err) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setRepairError('상태 조회에 실패했습니다.');
          setRepairStatus('failed');
        }
      }, 5000);
    } catch (err) {
      setRepairError(err.response?.data?.error || '업로드에 실패했습니다.');
      setRepairStatus('failed');
    } finally {
      setUploading(false);
    }
  };

  const loadAudioBlobs = async (id, method) => {
    try {
      const fetches = [api.fetchVocalRepairOriginal(id)];
      const fetchKeys = ['original'];

      if (method === 'lalal' || method === 'both') {
        fetches.push(api.fetchVocalRepairEnhanced(id, 'lalal'));
        fetchKeys.push('lalal');
      }
      if (method === 'demucs' || method === 'both') {
        fetches.push(api.fetchVocalRepairEnhanced(id, 'demucs'));
        fetchKeys.push('demucs');
      }

      const results = await Promise.all(fetches);
      for (let i = 0; i < results.length; i++) {
        const blob = new Blob([results[i].data]);
        const url = URL.createObjectURL(blob);
        if (fetchKeys[i] === 'original') setOriginalBlobUrl(url);
        else if (fetchKeys[i] === 'lalal') setLalalBlobUrl(url);
        else if (fetchKeys[i] === 'demucs') setDemucsBlobUrl(url);
      }
    } catch (err) {
      console.error('Failed to load audio blobs:', err);
    }
  };

  // ── Audio playback ──
  const audioRefs = { original: originalAudioRef, lalal: lalalAudioRef, demucs: demucsAudioRef };

  const togglePlay = (type) => {
    const audioRef = audioRefs[type];

    if (playingType === type) {
      audioRef.current?.pause();
      setPlayingType(null);
      return;
    }

    // Pause all others
    Object.entries(audioRefs).forEach(([key, ref]) => {
      if (key !== type && ref.current) ref.current.pause();
    });

    if (audioRef.current) {
      audioRef.current.play().catch(() => {});
      setPlayingType(type);
    }
  };

  // ── Download ──
  const handleDownload = async (type) => {
    if (!repairId) return;
    try {
      const res = await api.downloadVocalRepair(repairId, type, type !== 'original' ? type : undefined);
      const blob = new Blob([res.data]);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${type}_${repairId}.mp3`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch {
      alert('다운로드에 실패했습니다.');
    }
  };

  // ── Reset ──
  const handleReset = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (originalBlobUrl) URL.revokeObjectURL(originalBlobUrl);
    if (lalalBlobUrl) URL.revokeObjectURL(lalalBlobUrl);
    if (demucsBlobUrl) URL.revokeObjectURL(demucsBlobUrl);
    setRepairId(null);
    setRepairStatus(null);
    setRepairProgress(0);
    setRepairError(null);
    setOriginalBlobUrl(null);
    setLalalBlobUrl(null);
    setDemucsBlobUrl(null);
    setLalalStatus(null);
    setDemucsStatus(null);
    setPlayingType(null);
    setUploadFile(null);
    setRecordedBlob(null);
    setRecordedFileName('');
  };

  const getStatusBadge = (status) => {
    const info = REPAIR_STATUS_MAP[status] || { label: status || '알 수 없음', color: '#94A3B8' };
    return (
      <span
        className="voice-record__status-badge"
        style={{ background: `${info.color}20`, color: info.color }}
      >
        {info.label}
      </span>
    );
  };

  return (
    <div className="voice-record">
      <div className="voice-record__header">
        <h3 className="voice-record__title"><FiMic /> 내 목소리 녹음 + 보컬 다듬기</h3>
      </div>

      {/* ── Step 1: Record or Upload ── */}
      {!repairStatus && !uploading && (
        <div className="voice-record__input-area">
          {/* Recording */}
          <div className="voice-record__record-box">
            <p className="voice-record__hint">마이크로 직접 녹음하거나, 파일을 업로드하세요.</p>
            <div className="voice-record__record-controls">
              {!isRecording ? (
                <button
                  className="voice-record__rec-btn"
                  onClick={startRecording}
                  disabled={!!recordedBlob}
                >
                  <span className="voice-record__rec-dot" />
                  녹음 시작
                </button>
              ) : (
                <button
                  className="voice-record__rec-btn voice-record__rec-btn--recording"
                  onClick={stopRecording}
                >
                  <FiStopCircle />
                  녹음 정지 ({formatTime(recordingTime)})
                </button>
              )}
            </div>
            {recordedBlob && (
              <div className="voice-record__file-info">
                <FiMusic />
                <span className="voice-record__file-name">{recordedFileName}</span>
                <button
                  className="voice-record__file-remove"
                  onClick={() => { setRecordedBlob(null); setRecordedFileName(''); }}
                >
                  <FiTrash2 />
                </button>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="voice-record__divider">또는</div>

          {/* File upload */}
          <div
            className={`voice-record__dropzone ${dragOver ? 'voice-record__dropzone--active' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <FiUploadCloud className="voice-record__dropzone-icon" />
            <div className="voice-record__dropzone-text">
              <strong>클릭</strong> 또는 파일을 드래그하세요
            </div>
            <div className="voice-record__dropzone-hint">MP3, WAV, M4A, OGG, FLAC (50MB 이하)</div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            style={{ display: 'none' }}
            onChange={(e) => handleFileSelect(e.target.files[0])}
          />
          {uploadFile && (
            <div className="voice-record__file-info">
              <FiMusic />
              <span className="voice-record__file-name">{uploadFile.name}</span>
              <button
                className="voice-record__file-remove"
                onClick={() => setUploadFile(null)}
              >
                <FiTrash2 />
              </button>
            </div>
          )}

          {/* Method selection */}
          <div className="voice-record__method-select">
            <p className="voice-record__method-label">다듬기 방식 선택:</p>
            <div className="voice-record__method-options">
              <label className={`voice-record__method-checkbox ${useLalal ? 'voice-record__method-checkbox--active voice-record__method-checkbox--lalal' : ''}`}>
                <input
                  type="checkbox"
                  checked={useLalal}
                  onChange={(e) => setUseLalal(e.target.checked)}
                />
                <span className="voice-record__method-name">LALAL.AI</span>
                <span className="voice-record__method-desc">고품질 AI 분리</span>
              </label>
              <label className={`voice-record__method-checkbox ${useDemucs ? 'voice-record__method-checkbox--active voice-record__method-checkbox--demucs' : ''}`}>
                <input
                  type="checkbox"
                  checked={useDemucs}
                  onChange={(e) => setUseDemucs(e.target.checked)}
                />
                <span className="voice-record__method-name">Demucs (오픈소스)</span>
                <span className="voice-record__method-desc">Meta AI 오픈소스</span>
              </label>
            </div>
          </div>

          {/* Start repair button */}
          <button
            className="voice-record__enhance-btn"
            onClick={handleStartRepair}
            disabled={!activeFile || uploading || (!useLalal && !useDemucs)}
          >
            <FiVolume2 /> 보컬 다듬기 시작
          </button>
          {!useLalal && !useDemucs && (
            <p className="voice-record__method-warning">최소 하나의 방식을 선택해주세요.</p>
          )}
        </div>
      )}

      {/* ── Step 2: Processing ── */}
      {(uploading || (repairStatus && repairStatus !== 'completed' && repairStatus !== 'failed')) && (
        <div className="voice-record__processing">
          <div className="voice-record__processing-header">
            {getStatusBadge(uploading ? 'uploading' : repairStatus)}
          </div>
          <div className="voice-record__progress-bar">
            <div
              className="voice-record__progress-fill"
              style={{ width: `${uploading ? 10 : repairProgress}%` }}
            />
          </div>
          <p className="voice-record__processing-text">
            {uploading ? '파일 업로드 중...' : 'AI가 보컬을 다듬고 있습니다. 잠시만 기다려주세요...'}
          </p>
          {!uploading && (lalalStatus || demucsStatus) && (
            <div className="voice-record__method-status-list">
              {lalalStatus && (
                <div className="voice-record__method-status">
                  <span className="voice-record__method-status-dot voice-record__method-status-dot--lalal" />
                  <span>LALAL.AI: {lalalStatus === 'completed' ? '완료' : lalalStatus === 'failed' ? '실패' : '처리 중...'}</span>
                </div>
              )}
              {demucsStatus && (
                <div className="voice-record__method-status">
                  <span className="voice-record__method-status-dot voice-record__method-status-dot--demucs" />
                  <span>Demucs: {demucsStatus === 'completed' ? '완료' : demucsStatus === 'failed' ? '실패' : '처리 중...'}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Step 3: Error ── */}
      {repairStatus === 'failed' && (
        <div className="voice-record__error">
          <FiAlertCircle />
          <span>{repairError || '보컬 다듬기에 실패했습니다.'}</span>
          <button className="voice-record__retry-btn" onClick={handleReset}>
            <FiRefreshCw /> 다시 시도
          </button>
        </div>
      )}

      {/* ── Step 4: Completed — Preview ── */}
      {repairStatus === 'completed' && (
        <div className="voice-record__result">
          <div className="voice-record__result-header">
            {getStatusBadge('completed')}
            <button className="voice-record__reset-btn" onClick={handleReset}>
              <FiRefreshCw /> 새로 시작
            </button>
          </div>

          <div className="voice-record__results-grid">
            {/* Original */}
            <div className="voice-record__player-card">
              <div className="voice-record__player-label">원본</div>
              {originalBlobUrl && (
                <>
                  <audio
                    ref={originalAudioRef}
                    src={originalBlobUrl}
                    onTimeUpdate={() => setOriginalTime(originalAudioRef.current?.currentTime || 0)}
                    onLoadedMetadata={() => setOriginalDuration(originalAudioRef.current?.duration || 0)}
                    onEnded={() => setPlayingType(null)}
                  />
                  <div className="voice-record__player-controls">
                    <button
                      className={`voice-record__play-btn ${playingType === 'original' ? 'voice-record__play-btn--active' : ''}`}
                      onClick={() => togglePlay('original')}
                    >
                      {playingType === 'original' ? <FiPause /> : <FiPlay />}
                    </button>
                    <span className="voice-record__player-time">
                      {formatTime(originalTime)} / {formatTime(originalDuration)}
                    </span>
                    <button
                      className="voice-record__download-btn"
                      onClick={() => handleDownload('original')}
                      title="원본 다운로드"
                    >
                      <FiDownload />
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* LALAL.AI Result */}
            {lalalBlobUrl && (
              <div className="voice-record__player-card voice-record__player-card--lalal">
                <div className="voice-record__player-label voice-record__player-label--lalal">LALAL.AI</div>
                <audio
                  ref={lalalAudioRef}
                  src={lalalBlobUrl}
                  onTimeUpdate={() => setLalalTime(lalalAudioRef.current?.currentTime || 0)}
                  onLoadedMetadata={() => setLalalDuration(lalalAudioRef.current?.duration || 0)}
                  onEnded={() => setPlayingType(null)}
                />
                <div className="voice-record__player-controls">
                  <button
                    className={`voice-record__play-btn ${playingType === 'lalal' ? 'voice-record__play-btn--active' : ''}`}
                    onClick={() => togglePlay('lalal')}
                  >
                    {playingType === 'lalal' ? <FiPause /> : <FiPlay />}
                  </button>
                  <span className="voice-record__player-time">
                    {formatTime(lalalTime)} / {formatTime(lalalDuration)}
                  </span>
                  <button
                    className="voice-record__download-btn voice-record__download-btn--lalal"
                    onClick={() => handleDownload('lalal')}
                    title="LALAL.AI 결과 다운로드"
                  >
                    <FiDownload />
                  </button>
                </div>
              </div>
            )}

            {/* Demucs Result */}
            {demucsBlobUrl && (
              <div className="voice-record__player-card voice-record__player-card--demucs">
                <div className="voice-record__player-label voice-record__player-label--demucs">Demucs (오픈소스)</div>
                <audio
                  ref={demucsAudioRef}
                  src={demucsBlobUrl}
                  onTimeUpdate={() => setDemucsTime(demucsAudioRef.current?.currentTime || 0)}
                  onLoadedMetadata={() => setDemucsDuration(demucsAudioRef.current?.duration || 0)}
                  onEnded={() => setPlayingType(null)}
                />
                <div className="voice-record__player-controls">
                  <button
                    className={`voice-record__play-btn ${playingType === 'demucs' ? 'voice-record__play-btn--active' : ''}`}
                    onClick={() => togglePlay('demucs')}
                  >
                    {playingType === 'demucs' ? <FiPause /> : <FiPlay />}
                  </button>
                  <span className="voice-record__player-time">
                    {formatTime(demucsTime)} / {formatTime(demucsDuration)}
                  </span>
                  <button
                    className="voice-record__download-btn voice-record__download-btn--demucs"
                    onClick={() => handleDownload('demucs')}
                    title="Demucs 결과 다운로드"
                  >
                    <FiDownload />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Next step guide */}
          <div className="voice-record__next-step">
            <p className="voice-record__next-step-text">
              결과가 마음에 드시나요? 다듬어진 보컬로 AI 보이스 모델을 학습시켜보세요.
            </p>
            <button
              className="voice-record__next-step-btn"
              onClick={() => {
                const vpSection = document.querySelector('.vp-section');
                if (vpSection) vpSection.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              보이스 모델 학습하기 <FiArrowRight />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const PERSONA_STATUS_MAP = {
  pending: { label: '대기 중', color: '#94A3B8' },
  uploading: { label: '업로드 중', color: '#7C3AED' },
  covering: { label: 'AI 커버 생성 중', color: '#7C3AED' },
  separating: { label: '보컬 분리 중', color: '#06B6D4' },
  creating_persona: { label: 'Persona 생성 중', color: '#F59E0B' },
  completed: { label: '완료', color: '#1ed760' },
  failed: { label: '실패', color: '#EF4444' },
};

function VoicePersonaSection() {
  const [voiceSubTab, setVoiceSubTab] = useState('suno'); // 'suno' | 'kits'
  const [personas, setPersonas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [voiceFile, setVoiceFile] = useState(null);
  const [personaName, setPersonaName] = useState('');
  const [personaDesc, setPersonaDesc] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const [playingAudio, setPlayingAudio] = useState(null); // { id, type: 'vocal'|'cover' }
  const audioRef = useRef(null);
  const voiceInputRef = useRef(null);
  const pollRef = useRef(null);

  // Kits.AI models
  const [kitsModels, setKitsModels] = useState([]);
  const [kitsLoading, setKitsLoading] = useState(false);
  const [kitsLoaded, setKitsLoaded] = useState(false);

  const handlePlayAudio = (personaId, type, url) => {
    if (!url) return;
    // If same audio is playing, stop it
    if (playingAudio && playingAudio.id === personaId && playingAudio.type === type) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setPlayingAudio(null);
      return;
    }
    // Stop any currently playing audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    const token = localStorage.getItem('token');
    // Use presigned URL directly (already has auth in URL params)
    const audio = new Audio(url);
    audio.onended = () => {
      setPlayingAudio(null);
      audioRef.current = null;
    };
    audio.onerror = () => {
      setPlayingAudio(null);
      audioRef.current = null;
    };
    audio.play().catch(() => {
      setPlayingAudio(null);
      audioRef.current = null;
    });
    audioRef.current = audio;
    setPlayingAudio({ id: personaId, type });
  };

  const handleDownload = (personaId, type) => {
    api.downloadVoicePersona(personaId, type)
      .then(res => {
        const blob = new Blob([res.data]);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${type}_${personaId}.mp3`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      })
      .catch(err => alert('다운로드에 실패했습니다.'));
  };

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const fetchPersonas = useCallback(async () => {
    try {
      const { data } = await api.getVoicePersonas();
      setPersonas(data.personas || []);
    } catch (err) {
      console.error('Failed to fetch voice personas:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPersonas();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchPersonas]);

  // Poll for in-progress personas
  useEffect(() => {
    const hasActive = personas.some(
      (p) => p.status !== 'completed' && p.status !== 'failed'
    );
    if (hasActive && !pollRef.current) {
      pollRef.current = setInterval(fetchPersonas, 8000);
    } else if (!hasActive && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [personas, fetchPersonas]);

  // Fetch Kits.AI models when switching to kits tab
  useEffect(() => {
    if (voiceSubTab === 'kits' && !kitsLoaded) {
      setKitsLoading(true);
      api.getKitsVoiceModels()
        .then(({ data }) => {
          const models = data.voice_models?.data || data.voice_models || [];
          setKitsModels(Array.isArray(models) ? models : []);
          setKitsLoaded(true);
        })
        .catch(() => {
          setKitsModels([]);
          setKitsLoaded(true);
        })
        .finally(() => setKitsLoading(false));
    }
  }, [voiceSubTab, kitsLoaded]);

  const handleCreate = async () => {
    if (!voiceFile) {
      alert('음성 파일을 선택해주세요.');
      return;
    }
    if (!personaName.trim()) {
      alert('Persona 이름을 입력해주세요.');
      return;
    }
    setCreating(true);
    try {
      const formData = new FormData();
      formData.append('file', voiceFile);
      formData.append('name', personaName.trim());
      formData.append('description', personaDesc.trim());
      await api.createVoicePersona(formData);
      setVoiceFile(null);
      setPersonaName('');
      setPersonaDesc('');
      setShowForm(false);
      fetchPersonas();
    } catch (err) {
      alert(err.response?.data?.error || 'Voice Persona 생성에 실패했습니다.');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`"${name}" Persona를 삭제하시겠습니까?`)) return;
    setDeletingId(id);
    try {
      await api.deleteVoicePersona(id);
      setPersonas((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      alert(err.response?.data?.error || '삭제에 실패했습니다.');
    } finally {
      setDeletingId(null);
    }
  };

  const getStatusBadge = (status, progress) => {
    const info = PERSONA_STATUS_MAP[status] || { label: status, color: '#94A3B8' };
    return (
      <span
        className="vp-card__status"
        style={{ background: `${info.color}20`, color: info.color }}
      >
        {info.label}{progress > 0 && progress < 100 ? ` (${progress}%)` : ''}
      </span>
    );
  };

  if (loading) {
    return <div className="mymusic-loading">로딩 중...</div>;
  }

  return (
    <div className="vp-section">
      <div className="vp-section__header">
        <h3 className="vp-section__title"><FiMic /> 내 목소리 (Voice Persona)</h3>
      </div>

      {/* Sub-tabs: 우회 방식 | Kits.AI */}
      <div className="vp-subtabs">
        <button
          className={`vp-subtab ${voiceSubTab === 'suno' ? 'vp-subtab--active' : ''}`}
          onClick={() => setVoiceSubTab('suno')}
        >
          우회 방식
        </button>
        <button
          className={`vp-subtab ${voiceSubTab === 'kits' ? 'vp-subtab--active' : ''}`}
          onClick={() => setVoiceSubTab('kits')}
        >
          Kits.AI
        </button>
      </div>

      {/* ── 우회 방식 탭 ── */}
      {voiceSubTab === 'suno' && (
        <>
          <div className="vp-subtab-toolbar">
            <button
              className="vp-section__add-btn"
              onClick={() => setShowForm(!showForm)}
            >
              <FiPlus /> 목소리 추가
            </button>
          </div>

          {showForm && (
            <div className="vp-form">
              <p className="vp-form__hint">
                자신이 부른 노래 파일(mp3, wav 등)을 업로드하면 AI가 목소리를 분석하여 Voice Persona를 생성합니다.
                이후 작업실2에서 음악 생성 시 이 목소리로 노래를 만들 수 있습니다.
              </p>

              <div className="vp-form__field">
                <label className="vp-form__label">Persona 이름</label>
                <input
                  className="vp-form__input"
                  type="text"
                  value={personaName}
                  onChange={(e) => setPersonaName(e.target.value)}
                  placeholder="예: 내 목소리"
                  maxLength={50}
                />
              </div>

              <div className="vp-form__field">
                <label className="vp-form__label">설명 (스타일)</label>
                <input
                  className="vp-form__input"
                  type="text"
                  value={personaDesc}
                  onChange={(e) => setPersonaDesc(e.target.value)}
                  placeholder="예: 따뜻한 남성 보컬, soft pop style"
                  maxLength={200}
                />
              </div>

              <div
                className="vp-form__dropzone"
                onClick={() => voiceInputRef.current?.click()}
              >
                <FiMic className="vp-form__dropzone-icon" />
                <div className="vp-form__dropzone-text">
                  <strong>클릭</strong>하여 노래 파일을 선택하세요
                </div>
                <div className="vp-form__dropzone-hint">MP3, WAV, M4A, OGG, FLAC (50MB 이하)</div>
              </div>
              <input
                ref={voiceInputRef}
                type="file"
                accept=".mp3,.wav,.m4a,.ogg,.flac"
                style={{ display: 'none' }}
                onChange={(e) => setVoiceFile(e.target.files[0] || null)}
              />
              {voiceFile && (
                <div className="vp-form__file-info">
                  <FiMusic />
                  <span className="vp-form__file-name">{voiceFile.name}</span>
                  <button className="vp-form__file-remove" onClick={() => setVoiceFile(null)}>
                    <FiTrash2 />
                  </button>
                </div>
              )}

              <div className="vp-form__actions">
                <button
                  className="vp-form__submit"
                  onClick={handleCreate}
                  disabled={creating || !voiceFile || !personaName.trim()}
                >
                  {creating ? (
                    <><FiLoader className="vp-spin" /> Persona 생성 중...</>
                  ) : (
                    <><FiPlus /> Voice Persona 생성</>
                  )}
                </button>
                <button className="vp-form__cancel" onClick={() => setShowForm(false)}>
                  취소
                </button>
              </div>
            </div>
          )}

          {personas.length === 0 && !showForm ? (
            <div className="vp-empty">
              <FiMic className="vp-empty__icon" />
              <p className="vp-empty__text">아직 등록된 목소리가 없습니다.</p>
              <p className="vp-empty__hint">
                "목소리 추가" 버튼을 눌러 자신의 노래 파일을 업로드하세요.
              </p>
            </div>
          ) : (
            <div className="vp-list">
              {personas.map((p) => (
                <div key={p.id} className={`vp-card ${p.status === 'completed' ? 'vp-card--completed' : ''}`}>
                  <div className="vp-card__icon">
                    {p.status === 'completed' ? <FiCheck /> : <FiMic />}
                  </div>
                  <div className="vp-card__info">
                    <div className="vp-card__name">{p.name}</div>
                    {p.description && <div className="vp-card__desc">{p.description}</div>}
                    <div className="vp-card__meta">
                      {getStatusBadge(p.status, p.progress)}
                      {p.error_message && (
                        <span className="vp-card__error" title={p.error_message}>
                          <FiAlertCircle /> {p.error_message.substring(0, 80)}
                        </span>
                      )}
                    </div>
                    {p.status !== 'completed' && p.status !== 'failed' && p.progress > 0 && (
                      <div className="vp-card__progress-bar">
                        <div
                          className="vp-card__progress-fill"
                          style={{ width: `${p.progress}%` }}
                        />
                      </div>
                    )}
                    {p.status === 'completed' && (p.has_vocal || p.has_cover) && (
                      <div className="vp-card__audio-actions">
                        {p.has_vocal && (
                          <>
                            <button
                              className={`vp-card__audio-btn ${playingAudio?.id === p.id && playingAudio?.type === 'vocal' ? 'vp-card__audio-btn--playing' : ''}`}
                              onClick={() => handlePlayAudio(p.id, 'vocal', p.vocal_url)}
                              title="보컬 미리듣기"
                            >
                              {playingAudio?.id === p.id && playingAudio?.type === 'vocal' ? <FiSquare /> : <FiPlay />}
                              <span>보컬</span>
                            </button>
                            <button
                              className="vp-card__audio-btn vp-card__audio-btn--download"
                              onClick={() => handleDownload(p.id, 'vocal')}
                              title="보컬 다운로드"
                            >
                              <FiDownload />
                            </button>
                          </>
                        )}
                        {p.has_cover && (
                          <>
                            <button
                              className={`vp-card__audio-btn ${playingAudio?.id === p.id && playingAudio?.type === 'cover' ? 'vp-card__audio-btn--playing' : ''}`}
                              onClick={() => handlePlayAudio(p.id, 'cover', p.cover_url)}
                              title="커버 미리듣기"
                            >
                              {playingAudio?.id === p.id && playingAudio?.type === 'cover' ? <FiSquare /> : <FiPlay />}
                              <span>커버</span>
                            </button>
                            <button
                              className="vp-card__audio-btn vp-card__audio-btn--download"
                              onClick={() => handleDownload(p.id, 'cover')}
                              title="커버 다운로드"
                            >
                              <FiDownload />
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    className="vp-card__delete"
                    onClick={() => handleDelete(p.id, p.name)}
                    disabled={deletingId === p.id}
                  >
                    <FiTrash2 />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Kits.AI 탭 ── */}
      {voiceSubTab === 'kits' && (
        <div className="vp-kits">
          {kitsLoading ? (
            <div className="mymusic-loading">Kits.AI 모델 로딩 중...</div>
          ) : kitsModels.length === 0 ? (
            <div className="vp-empty">
              <FiMic className="vp-empty__icon" />
              <p className="vp-empty__text">등록된 Kits.AI 목소리 모델이 없습니다.</p>
              <p className="vp-empty__hint">
                Kits.AI 웹에서 목소리 모델을 학습시킨 후 이곳에서 확인할 수 있습니다.
              </p>
            </div>
          ) : (
            <div className="vp-list">
              {kitsModels.map((m) => (
                <div key={m.id} className="vp-card vp-card--completed">
                  <div className="vp-card__icon">
                    <FiCheck />
                  </div>
                  <div className="vp-card__info">
                    <div className="vp-card__name">{m.title || m.name || `Model ${m.id}`}</div>
                    <div className="vp-card__desc">ID: {m.id}</div>
                    {m.demoUrl && (
                      <div className="vp-card__audio-actions">
                        <button
                          className={`vp-card__audio-btn ${playingAudio?.id === m.id && playingAudio?.type === 'kits-demo' ? 'vp-card__audio-btn--playing' : ''}`}
                          onClick={() => handlePlayAudio(m.id, 'kits-demo', m.demoUrl)}
                          title="데모 미리듣기"
                        >
                          {playingAudio?.id === m.id && playingAudio?.type === 'kits-demo' ? <FiSquare /> : <FiPlay />}
                          <span>데모</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="vp-kits__footer">
            <p className="vp-kits__hint">모델 생성은 kits.ai 웹에서 진행해주세요</p>
            <a
              href="https://app.kits.ai/voices/instant"
              target="_blank"
              rel="noopener noreferrer"
              className="vp-kits__link"
            >
              Kits.AI에서 모델 생성하기
            </a>
          </div>
        </div>
      )}
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
          <>
            <CharacterSection />
            <VoiceRecordSection />
            <VoicePersonaSection />
          </>
        )}

        {/* Tab 7: Drafts */}
        {activeTab === 'drafts' && (
          <DraftsSection onLoadDraft={handleLoadDraft} />
        )}
      </div>
    </div>
  );
}
