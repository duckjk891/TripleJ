// v76 — Voice Clone 4-step Wizard
// STEP 1: 샘플 입력 (녹음 or 업로드) + 구간 선택 + 노래/말 선택
// STEP 2: 검증 문구 받기 (폴링)
// STEP 3: 검증 녹음/업로드 + 실력 라디오
// STEP 4: 이름 + 저장 (학습 폴링)
import { useState, useEffect, useRef, useCallback } from 'react';
import { FiMic, FiUpload, FiX, FiPlay, FiSquare, FiRefreshCw, FiChevronRight, FiCheckCircle } from 'react-icons/fi';
import * as api from '../api';
import { requestMic, releaseStream, AudioRecorder } from '../utils/audioRecorder';
import './VoiceCloneWizard.css';

const SUPPORTED_MIMES = 'audio/mp3,audio/mpeg,audio/wav,audio/m4a,audio/x-m4a,audio/webm,audio/ogg';

const SKILL_LEVELS = [
  { value: 'beginner', label: '초급' },
  { value: 'intermediate', label: '중급' },
  { value: 'advanced', label: '상급' },
  { value: 'pro', label: '프로' },
];

const STATUS_LABEL = {
  validating: '입력 분석 중...',
  awaiting_verify: '검증 녹음을 기다리는 중',
  generating: '목소리 학습 중...',
  ready: '학습 완료',
  failed: '학습 실패',
};

function fmtMs(ms) {
  if (!ms) return '00:00';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

// 단일 녹음/업로드 패널
function RecordPanel({ onChange, value, label }) {
  const [tab, setTab] = useState('record');
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState('');
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const tickRef = useRef(null);

  const previewUrl = value?.previewUrl || '';

  useEffect(() => {
    return () => {
      try { releaseStream(streamRef.current); } catch {}
      if (tickRef.current) clearInterval(tickRef.current);
      if (value?.previewUrl) {
        try { URL.revokeObjectURL(value.previewUrl); } catch {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRec = async () => {
    setError('');
    try {
      if (import.meta.env.DEV) console.info('[VoiceCloneWizard] startRec');
      const stream = await requestMic();
      streamRef.current = stream;
      const rec = new AudioRecorder(stream);
      recorderRef.current = rec;
      rec.start();
      setIsRecording(true);
      setElapsedMs(0);
      tickRef.current = setInterval(() => setElapsedMs(rec.getDurationMs()), 200);
    } catch (err) {
      const name = err?.name || '';
      const code = err?.code || '';
      console.error('[VoiceCloneWizard] startRec failed', { name, code, message: err?.message });
      let msg;
      const isSecure = typeof window !== 'undefined' && window.isSecureContext === true;
      if (code === 'UNSUPPORTED' || !isSecure) {
        msg = '브라우저 보안 정책상 마이크는 HTTPS 또는 localhost 에서만 사용할 수 있습니다. "파일 업로드" 탭으로 미리 녹음한 음원을 올려주세요.';
      } else if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        msg = '마이크 권한이 거부되었습니다. 브라우저 주소창의 자물쇠 아이콘에서 마이크를 허용해주세요.';
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        msg = '마이크 장치를 찾을 수 없습니다. 마이크 연결을 확인해주세요.';
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        msg = '마이크가 다른 앱에서 사용 중입니다. 다른 앱을 종료한 뒤 다시 시도해주세요.';
      } else {
        msg = `마이크 시작에 실패했습니다. (${name || err?.message || 'unknown'})`;
      }
      setError(msg);
    }
  };

  const stopRec = async () => {
    try {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      const blob = await recorderRef.current.stop();
      const ext = recorderRef.current.getExtension();
      const ms = recorderRef.current.getDurationMs();
      releaseStream(streamRef.current);
      streamRef.current = null;
      setIsRecording(false);
      const url = URL.createObjectURL(blob);
      const file = new File([blob], `recording.${ext}`, { type: blob.type });
      if (value?.previewUrl) { try { URL.revokeObjectURL(value.previewUrl); } catch {} }
      onChange({ file, previewUrl: url, durationMs: ms, source: 'record' });
      if (import.meta.env.DEV) console.info('[VoiceCloneWizard] stopRec ok', { bytes: blob.size, ms });
    } catch (err) {
      console.error('[VoiceCloneWizard] stopRec failed', { message: err?.message });
      setError('녹음 종료 중 오류가 발생했습니다.');
      setIsRecording(false);
    }
  };

  const handleFile = (file) => {
    if (!file) return;
    if (import.meta.env.DEV) console.info('[VoiceCloneWizard] file selected', { name: file.name, size: file.size, type: file.type });
    const url = URL.createObjectURL(file);
    if (value?.previewUrl) { try { URL.revokeObjectURL(value.previewUrl); } catch {} }
    // duration 은 audio 엘리먼트 onLoadedMetadata 에서 채움
    onChange({ file, previewUrl: url, durationMs: 0, source: 'upload' });
  };

  const handleAudioLoaded = (e) => {
    const dur = e?.target?.duration;
    if (dur && Number.isFinite(dur) && value && !value.durationMs) {
      onChange({ ...value, durationMs: Math.round(dur * 1000) });
    }
  };

  return (
    <div className="vcw-panel">
      {label && <div className="vcw-panel__label">{label}</div>}

      <div className="vcw-tabs">
        <button
          type="button"
          className={`vcw-tab ${tab === 'record' ? 'vcw-tab--active' : ''}`}
          onClick={() => setTab('record')}
        >
          <FiMic /> 마이크 녹음
        </button>
        <button
          type="button"
          className={`vcw-tab ${tab === 'upload' ? 'vcw-tab--active' : ''}`}
          onClick={() => setTab('upload')}
        >
          <FiUpload /> 파일 업로드
        </button>
      </div>

      {tab === 'record' ? (
        <div className="vcw-record">
          <div className="vcw-record__time">{fmtMs(isRecording ? elapsedMs : (value?.durationMs || 0))}</div>
          <div className="vcw-record__controls">
            {!isRecording ? (
              <button type="button" className="vcw-btn vcw-btn--primary" onClick={startRec}>
                <FiMic /> {value?.file ? '다시 녹음' : '녹음 시작'}
              </button>
            ) : (
              <button type="button" className="vcw-btn vcw-btn--danger" onClick={stopRec}>
                <FiSquare /> 정지
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="vcw-upload">
          <label className="vcw-upload__drop">
            <input
              type="file"
              accept={SUPPORTED_MIMES}
              onChange={(e) => handleFile(e.target.files?.[0])}
              hidden
            />
            <FiUpload />
            <span>{value?.file?.name || '오디오 파일을 선택하거나 드래그'}</span>
            <small>MP3 · WAV · M4A · WebM · OGG</small>
          </label>
        </div>
      )}

      {previewUrl && (
        <audio
          src={previewUrl}
          controls
          onLoadedMetadata={handleAudioLoaded}
          className="vcw-audio"
        />
      )}

      {error && <div className="vcw-error">{error}</div>}
    </div>
  );
}

export default function VoiceCloneWizard({ open, onClose, onComplete, resumeClone }) {
  const [step, setStep] = useState(resumeClone ? 2 : 1);
  const [cloneId, setCloneId] = useState(resumeClone?.id || null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // STEP 1
  const [sampleSrc, setSampleSrc] = useState(null);
  const [vocalStartS, setVocalStartS] = useState(0);
  const [vocalEndS, setVocalEndS] = useState(60);
  const [styleMode, setStyleMode] = useState('sing'); // sing | speak (백엔드 ALLOWED_STYLE_MODES 와 일치)

  // STEP 2
  const [validateInfo, setValidateInfo] = useState(resumeClone?.validate_info || null);
  const [phrasePolling, setPhrasePolling] = useState(false);

  // STEP 3
  const [verifySrc, setVerifySrc] = useState(null);
  const [skill, setSkill] = useState('intermediate');

  // STEP 4
  const [voiceName, setVoiceName] = useState(resumeClone?.voice_name || '');
  const [description, setDescription] = useState(resumeClone?.description || '');
  const [statusInfo, setStatusInfo] = useState(null);

  // duration → end seconds 기본값
  useEffect(() => {
    if (sampleSrc?.durationMs && step === 1) {
      const secs = Math.floor(sampleSrc.durationMs / 1000);
      if (!vocalEndS || vocalEndS === 60) {
        setVocalEndS(Math.min(120, Math.max(5, secs)));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sampleSrc?.durationMs]);

  // STEP 2 폴링 (validate_info 도착 대기)
  useEffect(() => {
    if (step !== 2 || !cloneId) return undefined;
    if (validateInfo) return undefined;
    let cancelled = false;
    let tries = 0;
    setPhrasePolling(true);
    const tick = async () => {
      tries += 1;
      if (cancelled) return;
      try {
        const { data } = await api.getVoiceClone(cloneId);
        const cloneDoc = data?.clone || data;
        const docStatus = (cloneDoc?.status || '').toString();
        const info = cloneDoc?.validate_info;
        if (info) {
          if (import.meta.env.DEV) console.info('[VoiceCloneWizard] validate_info received', { tries });
          setValidateInfo(info);
          setPhrasePolling(false);
          return;
        }
        // doc.status === 'failed' 면 sunoapi 가 학습 실패 — 즉시 중단 + 정확한 에러
        if (docStatus === 'failed') {
          const errMsg = cloneDoc?.error_message || 'sunoapi 학습 단계에서 실패했습니다.';
          if (import.meta.env.DEV) console.warn('[VoiceCloneWizard] backend status=failed', { errMsg });
          setErr(`학습에 실패했습니다. (${errMsg}) "다른 문구" 로 재시도하거나 마법사를 닫고 다른 음원으로 시도해주세요.`);
          setPhrasePolling(false);
          return;
        }
      } catch (e) {
        console.error('[VoiceCloneWizard] step2 poll failed', { status: e?.response?.status, message: e?.message });
      }
      if (tries >= 60) {
        setPhrasePolling(false);
        return;
      }
      setTimeout(tick, 1000);
    };
    tick();
    return () => { cancelled = true; setPhrasePolling(false); };
  }, [step, cloneId, validateInfo]);

  // STEP 4 폴링 (status === 'ready')
  useEffect(() => {
    if (step !== 4 || !cloneId) return undefined;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const { data } = await api.getVoiceClone(cloneId);
        const clone = data?.clone || data;
        setStatusInfo(clone);
        if (clone?.status === 'ready') {
          if (import.meta.env.DEV) console.info('[VoiceCloneWizard] clone ready', { id: cloneId });
          if (!cancelled) {
            try { onComplete && onComplete(clone); } catch {}
          }
          return;
        }
        if (clone?.status === 'failed') {
          setErr('학습에 실패했습니다. 다시 시도해주세요.');
          return;
        }
      } catch (e) {
        console.error('[VoiceCloneWizard] step4 poll failed', { status: e?.response?.status, message: e?.message });
      }
      setTimeout(tick, 3000);
    };
    tick();
    return () => { cancelled = true; };
  }, [step, cloneId, onComplete]);

  const handleStep1Next = async () => {
    setErr('');
    const trimmedName = (voiceName || '').trim();
    if (!trimmedName) { setErr('목소리 이름을 입력해주세요.'); return; }
    if (!sampleSrc?.file) { setErr('샘플 오디오를 입력해주세요.'); return; }
    if (vocalStartS < 0 || vocalEndS <= vocalStartS) {
      setErr('구간을 올바르게 입력해주세요. (끝 시각이 시작보다 커야 합니다.)');
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('source_file', sampleSrc.file);
      fd.append('voice_name', trimmedName);
      fd.append('description', description || '');
      fd.append('vocal_start_s', String(vocalStartS));
      fd.append('vocal_end_s', String(vocalEndS));
      fd.append('style_mode', styleMode);
      if (import.meta.env.DEV) console.info('[VoiceCloneWizard] step=1 calling createVoiceClone', { vocal_start_s: vocalStartS, vocal_end_s: vocalEndS, style_mode: styleMode });
      const { data } = await api.createVoiceClone(fd);
      const id = data?.clone_id || data?.id;
      if (!id) throw new Error('clone_id missing in response');
      setCloneId(id);
      setStep(2);
      if (import.meta.env.DEV) console.info('[VoiceCloneWizard] step=1 ok', { clone_id: id });
    } catch (e) {
      const detail =
        e?.response?.data?.detail ||
        e?.response?.data?.error ||
        e?.response?.data?.message ||
        e?.message ||
        '';
      console.error('[VoiceCloneWizard] createVoiceClone failed', {
        status: e?.response?.status,
        detail,
      });
      setErr(`샘플 등록에 실패했습니다.${detail ? ` (${detail})` : ''}`);
    } finally {
      setBusy(false);
    }
  };

  const handleRegeneratePhrase = async () => {
    if (!cloneId) return;
    setErr('');
    setValidateInfo(null);
    try {
      if (import.meta.env.DEV) console.info('[VoiceCloneWizard] regenerate phrase');
      await api.regenerateVoiceClonePhrase(cloneId);
    } catch (e) {
      const detail =
        e?.response?.data?.detail ||
        e?.response?.data?.error ||
        e?.response?.data?.message ||
        e?.message ||
        '';
      console.error('[VoiceCloneWizard] regenerate phrase failed', { status: e?.response?.status, detail });
      setErr(`새 문구 요청에 실패했습니다.${detail ? ` (${detail})` : ''}`);
    }
  };

  const handleStep2Next = () => {
    if (!validateInfo) return;
    setStep(3);
  };

  const handleStep3Next = async () => {
    setErr('');
    if (!verifySrc?.file) { setErr('검증 녹음을 입력해주세요.'); return; }
    if (!cloneId) { setErr('clone_id 가 없습니다.'); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('verify_file', verifySrc.file);
      fd.append('singer_skill_level', skill);
      if (import.meta.env.DEV) console.info('[VoiceCloneWizard] step=3 calling submitVoiceCloneVerify', { skill });
      await api.submitVoiceCloneVerify(cloneId, fd);
      setStep(4);
      if (import.meta.env.DEV) console.info('[VoiceCloneWizard] step=3 ok');
    } catch (e) {
      console.error('[VoiceCloneWizard] submitVoiceCloneVerify failed', { status: e?.response?.status, message: e?.message });
      setErr(e?.response?.data?.error || '검증 제출에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleStep4Background = () => {
    if (import.meta.env.DEV) console.info('[VoiceCloneWizard] close in background');
    try { onClose && onClose(); } catch {}
  };

  const guidanceText = styleMode === 'sing'
    ? "STEP 1 에서 '노래로 부름' 을 선택했어요. 이 문구도 노래로 불러주세요."
    : "STEP 1 에서 '말로 함' 을 선택했어요. 같은 톤으로 말로 읽어주세요.";

  if (!open) return null;

  return (
    <div className="vcw-overlay" role="dialog" aria-modal="true">
      <div className="vcw-modal">
        <div className="vcw-header">
          <div className="vcw-header__title">
            <FiMic /> 보이스 클론 학습
          </div>
          <div className="vcw-header__steps">
            {[1, 2, 3, 4].map((s) => (
              <span
                key={s}
                className={`vcw-step ${step === s ? 'vcw-step--active' : ''} ${step > s ? 'vcw-step--done' : ''}`}
              >
                {step > s ? <FiCheckCircle /> : s}
              </span>
            ))}
          </div>
          <button type="button" className="vcw-close" onClick={onClose} aria-label="닫기">
            <FiX />
          </button>
        </div>

        <div className="vcw-body">
          {err && <div className="vcw-error vcw-error--top">{err}</div>}

          {step === 1 && (
            <div className="vcw-step-1">
              <h4 className="vcw-step__title">1. 목소리 샘플 입력</h4>
              <p className="vcw-step__hint">
                10초~2분 사이의 깨끗한 오디오를 권장합니다. 잡음이 적을수록 결과가 좋아져요.
              </p>

              <div className="vcw-name-field">
                <label>목소리 이름 *</label>
                <input
                  type="text"
                  value={voiceName}
                  onChange={(e) => setVoiceName(e.target.value)}
                  placeholder="예: 내목소리, 아빠목소리, 친구A"
                  maxLength={40}
                />
              </div>

              <RecordPanel value={sampleSrc} onChange={setSampleSrc} label="샘플 오디오" />

              <div className="vcw-range">
                <div className="vcw-range__field">
                  <label>시작 (초)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={vocalStartS}
                    onChange={(e) => setVocalStartS(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  />
                </div>
                <div className="vcw-range__field">
                  <label>끝 (초)</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={vocalEndS}
                    onChange={(e) => setVocalEndS(Math.max(1, parseInt(e.target.value, 10) || 0))}
                  />
                </div>
              </div>

              <div className="vcw-radios">
                <label>
                  <input
                    type="radio"
                    name="style_mode"
                    value="sing"
                    checked={styleMode === 'sing'}
                    onChange={() => setStyleMode('sing')}
                  /> 노래로 부름
                </label>
                <label>
                  <input
                    type="radio"
                    name="style_mode"
                    value="speak"
                    checked={styleMode === 'speak'}
                    onChange={() => setStyleMode('speak')}
                  /> 말로 함
                </label>
              </div>

              <div className="vcw-actions">
                <button type="button" className="vcw-btn vcw-btn--ghost" onClick={onClose}>취소</button>
                <button
                  type="button"
                  className="vcw-btn vcw-btn--primary"
                  onClick={handleStep1Next}
                  disabled={busy}
                >
                  {busy ? '전송 중...' : <>다음 <FiChevronRight /></>}
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="vcw-step-2">
              <h4 className="vcw-step__title">2. 검증 문구 받기</h4>
              <p className="vcw-step__hint">{guidanceText}</p>

              <div className="vcw-phrase-box">
                {(() => {
                  // sunoapi 응답은 string (data.validateInfo: "...") — 백엔드도 string 그대로 저장.
                  // 콜백 경로일 경우 dict 가능성도 대비.
                  const phrase =
                    typeof validateInfo === 'string'
                      ? validateInfo
                      : validateInfo?.phrase || validateInfo?.text || validateInfo?.validateInfo || '';
                  if (phrase) return <div className="vcw-phrase-text">{phrase}</div>;
                  if (phrasePolling) return <div className="vcw-phrase-loading">문구 생성 중...</div>;
                  return <div className="vcw-phrase-loading">문구를 받지 못했습니다. 다시 시도해주세요.</div>;
                })()}
              </div>

              <div className="vcw-actions vcw-actions--between">
                <button type="button" className="vcw-btn vcw-btn--ghost" onClick={handleRegeneratePhrase}>
                  <FiRefreshCw /> 다른 문구
                </button>
                <button
                  type="button"
                  className="vcw-btn vcw-btn--primary"
                  onClick={handleStep2Next}
                  disabled={!validateInfo}
                >
                  다음 <FiChevronRight />
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="vcw-step-3">
              <h4 className="vcw-step__title">3. 검증 녹음</h4>
              <p className="vcw-step__hint">
                위 문구를 {styleMode === 'sing' ? '노래로 불러' : '말로 읽어'} 녹음해주세요.
              </p>

              <div className="vcw-phrase-box vcw-phrase-box--readonly">
                {(() => {
                  const phrase =
                    typeof validateInfo === 'string'
                      ? validateInfo
                      : validateInfo?.phrase || validateInfo?.text || validateInfo?.validateInfo || '';
                  return phrase
                    ? <div className="vcw-phrase-text">{phrase}</div>
                    : <div className="vcw-phrase-loading">(이전 단계에서 받은 문구가 없습니다)</div>;
                })()}
              </div>

              <RecordPanel value={verifySrc} onChange={setVerifySrc} label="검증 녹음" />

              <div className="vcw-skill">
                <label className="vcw-skill__label">가창 실력</label>
                <div className="vcw-skill__opts">
                  {SKILL_LEVELS.map((s) => (
                    <label key={s.value} className={`vcw-skill__opt ${skill === s.value ? 'vcw-skill__opt--active' : ''}`}>
                      <input
                        type="radio"
                        name="skill"
                        value={s.value}
                        checked={skill === s.value}
                        onChange={() => setSkill(s.value)}
                      />
                      {s.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="vcw-actions">
                <button type="button" className="vcw-btn vcw-btn--ghost" onClick={() => setStep(2)}>이전</button>
                <button
                  type="button"
                  className="vcw-btn vcw-btn--primary"
                  onClick={handleStep3Next}
                  disabled={busy}
                >
                  {busy ? '전송 중...' : <>다음 <FiChevronRight /></>}
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="vcw-step-4">
              <h4 className="vcw-step__title">4. 이름 짓고 저장</h4>
              <p className="vcw-step__hint">
                목소리에 이름을 붙여주세요. 학습이 백그라운드에서 진행되며, 완료되면 자동으로 사용할 수 있어요.
              </p>

              <div className="vcw-field">
                <label>목소리 이름 *</label>
                <input
                  type="text"
                  value={voiceName}
                  onChange={(e) => setVoiceName(e.target.value)}
                  maxLength={50}
                  placeholder="예: 내 노래 톤"
                />
              </div>

              <div className="vcw-field">
                <label>설명 (선택)</label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={200}
                  placeholder="예: 발라드 톤으로 학습한 목소리"
                />
              </div>

              <div className="vcw-progress">
                <div className="vcw-progress__label">
                  {STATUS_LABEL[statusInfo?.status] || '대기 중...'}
                </div>
                {statusInfo?.status && statusInfo.status !== 'ready' && (
                  <div className="vcw-progress__bar"><div className="vcw-progress__bar-fill" /></div>
                )}
              </div>

              <div className="vcw-actions">
                <button type="button" className="vcw-btn vcw-btn--ghost" onClick={handleStep4Background}>
                  닫고 백그라운드로
                </button>
                {statusInfo?.status === 'ready' && (
                  <button type="button" className="vcw-btn vcw-btn--primary" onClick={() => onComplete && onComplete(statusInfo)}>
                    완료
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
