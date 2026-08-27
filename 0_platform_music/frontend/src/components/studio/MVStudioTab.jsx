import { useState, useEffect, useRef } from 'react';
import { FiClock, FiRefreshCw, FiZap, FiImage, FiArrowLeft, FiCheck } from 'react-icons/fi';
import * as api from '../../api';
import MVProductionSection from '../MVProductionSection';
import '../../pages/UploadPage.css';
import '../StudioTab2.css';

// v209 3단계 — 「MV촬영실」: 곡 선택(작곡실 완성곡 + 내 트랙 공개/비공개) → 커버 확인 스텝(D4)
// → MVProductionSection(MV 제작 본체) 렌더 + 임시저장(MV job draft). 기존 UploadPage 내장 MV 흐름의 이관처.
// - 곡 인계: generation 소스 = audio_generation_id / track 소스 = track_id (+audio_url object name, duration_sec)
// - track.cover_image_url 은 object name 저장 확정(실측) — cover_object_name 으로 그대로 전달
// - 임시저장 탭(getMVJobs) [불러오기] → draftData prop 수신 (MyMusicPage handleLoadDraft 리타겟)
export default function MVStudioTab({ draftData, onClearDraft }) {
  // ── 곡 선택 풀 ──
  const [poolGenerations, setPoolGenerations] = useState([]); // status==='completed'
  const [poolTracks, setPoolTracks] = useState([]);
  const [loadingPool, setLoadingPool] = useState(false);

  // ── v211: 내 MV 리스트 (완성물 전용 — 진행 중 job 은 임시저장 탭 소관, 중복 편성 방지 D8) ──
  const [myMvJobs, setMyMvJobs] = useState([]);
  const [mvActionBusy, setMvActionBusy] = useState(null); // job_id 진행 중 표시

  // ── 선택된 곡 (null 이면 선택 화면) ──
  // { source:'generation'|'track'|'draft', id, title, genre, mood, lyrics, prompt, aiModel,
  //   audioGenerationId, trackId, audioObjectName, audioDurationSec }
  const [selectedSong, setSelectedSong] = useState(null);

  // ── 커버 확인 스텝 (D4) — MVProductionSection 의 aiCoverObjectName 계약에 대응 ──
  const [coverObjectName, setCoverObjectName] = useState(null);
  const [coverPreview, setCoverPreview] = useState(null);
  const [generatingCover, setGeneratingCover] = useState(false);
  const [coverCost, setCoverCost] = useState(5);
  const [coverImageModel, setCoverImageModel] = useState('nb_pro');

  // ── 공용 라이트박스 (MVProductionSection onRequestLightbox 소비처) ──
  const [selectedImage, setSelectedImage] = useState(null);

  // ── 임시저장 (구 UploadPage 소관에서 이관 — 실행부는 MVProductionSection.saveDraft) ──
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSaveMsg, setDraftSaveMsg] = useState('');
  const mvSectionRef = useRef(null);

  // ── MV 임시저장 인계 로컬 사본 — draftData 도착 시점엔 MVProductionSection 이 아직 미마운트
  // (selectedSong null)이므로, 부모(MyMusicPage)를 즉시 clear 하되 사본을 자식에 관통시켜
  // 마운트 시 effect 가 job_id 를 소비하게 한다. 곡을 새로 고르면 사본 폐기(스테일 복원 방지).
  const [mvDraft, setMvDraft] = useState(null);

  // ── 곡 풀 로드 (양쪽 다 무과금 조회) ──
  const fetchPool = async () => {
    setLoadingPool(true);
    try {
      const [genRes, trackRes, mvRes] = await Promise.all([
        api.getGenerations({ limit: 50 }),
        api.getMyTracks({ limit: 50 }),
        api.getMVJobs(),
      ]);
      const completed = (genRes.data?.generations || []).filter((g) => g.status === 'completed');
      // v209 픽스: 신고 블라인드 트랙은 곡 풀에서 비노출 (서버 403 가드와 별개로 선택 자체 차단)
      const tracks = (trackRes.data?.tracks || []).filter((t) => !t.report_blinded);
      // v211: 내 MV = 완성물(최종 합본 존재)만
      const mvJobs = (mvRes.data?.jobs || []).filter(
        (j) => j.status === 'completed' && j.result_music_video_url,
      );
      setPoolGenerations(completed);
      setPoolTracks(tracks);
      setMyMvJobs(mvJobs);
      if (import.meta.env.DEV) {
        console.info('[MVStudio] pool loaded', { completed: completed.length, tracks: tracks.length, mv_jobs: mvJobs.length });
      }
    } catch (err) {
      console.error('[MVStudio] fetch pool failed', { status: err?.response?.status, message: err?.message });
    } finally {
      setLoadingPool(false);
    }
  };

  useEffect(() => {
    fetchPool();
    // 마운트 1회 의도 — fetchPool 은 비메모이즈 함수 (StudioTab2 fetchHistory 선례)
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 커버 생성 비용 로드 (실패 시 기본 5 — UploadPage v158 관행)
  useEffect(() => {
    api.getPointCosts()
      .then(({ data }) => {
        if (typeof data?.costs?.cover === 'number') setCoverCost(data.costs.cover);
      })
      .catch((err) => {
        console.error('[MVStudio] getPointCosts failed (fallback 5)', { status: err?.response?.status, message: err?.message });
      });
  }, []);

  // ── 곡 선택 ──
  const handleSelectGeneration = (gen) => {
    setSelectedSong({
      source: 'generation',
      id: gen.id,
      title: gen.title || '',
      genre: gen.genre || '',
      mood: gen.mood || '',
      lyrics: gen.lyrics || '',
      prompt: gen.prompt || '',
      aiModel: gen.model === 'suno' ? 'Suno' : (gen.model || ''),
      audioGenerationId: gen.id,
      trackId: null,
      audioObjectName: null,
      audioDurationSec: Number.isFinite(gen.duration) ? gen.duration : null,
    });
    // D4: 작곡실 완성곡은 커버가 전무(generations 에 커버 필드 없음) → 커버 확인 스텝에서 준비
    setCoverObjectName(null);
    setCoverPreview(null);
    if (import.meta.env.DEV) console.info('[MVStudio] song selected', { source: 'generation', id: gen.id, has_cover: false });
  };

  const joinList = (v) => (Array.isArray(v) ? v.join(', ') : (v || ''));

  const handleSelectTrack = (t) => {
    const cover = t.cover_image_url || null; // 실측: object name 저장 확정 — 역변환 불요
    setSelectedSong({
      source: 'track',
      id: t.id,
      title: t.title || '',
      genre: joinList(t.genre),
      mood: joinList(t.mood),
      // 소급 lyrics 없는 기존 파일 업로드 트랙 → 빈 값 허용 (진행 비차단)
      lyrics: t.lyrics || '',
      prompt: t.prompt || '',
      aiModel: t.ai_model || '',
      audioGenerationId: null,
      trackId: t.id,
      audioObjectName: t.audio_url || null, // tracks doc.audio_url = 오디오 object name (merge-audio 용)
      audioDurationSec: Number.isFinite(t.duration_sec) && t.duration_sec > 0 ? t.duration_sec : null,
    });
    setCoverObjectName(cover);
    setCoverPreview(cover ? api.coverPreviewUrl(cover) : null);
    if (import.meta.env.DEV) {
      console.info('[MVStudio] song selected', {
        source: 'track', id: t.id, has_cover: !!cover, is_public: t.is_public !== false,
      });
    }
  };

  const handleChangeSong = () => {
    // 진행 중 MV job 은 서버에 보존됨(임시저장 탭에서 이어가기) — 화면 상태만 해제
    setSelectedSong(null);
    setCoverObjectName(null);
    setCoverPreview(null);
    setDraftSaveMsg('');
    setMvDraft(null); // 다음 곡 선택 시 스테일 job 복원 방지
  };

  // ── 임시저장 탭 [불러오기] 인계 — MVProductionSection(자식)이 job_id 를 먼저 소비(자식 effect 선실행),
  //    이 effect 는 곡 메타 구성 + onClearDraft (구 UploadPage draftData 패턴 동일) ──
  useEffect(() => {
    if (draftData) {
      setMvDraft(draftData);
      const trackId = draftData.audio_track_id || null; // v209 픽스: track 소스 드래프트 복원 관통
      setSelectedSong({
        source: trackId ? 'track' : (draftData.audio_generation_id ? 'generation' : 'draft'),
        id: trackId || draftData.audio_generation_id || draftData.job_id,
        title: draftData.title || '',
        genre: draftData.genre || '',
        mood: draftData.mood || '',
        lyrics: draftData.lyrics || '',
        prompt: draftData.prompt || '',
        aiModel: draftData.ai_model || '',
        audioGenerationId: draftData.audio_generation_id || null,
        trackId,
        audioObjectName: null,
        audioDurationSec: null,
      });
      // 커버는 MVProductionSection.loadMvJobDetail → onCoverAdopted 로 역주입됨
      if (import.meta.env.DEV) console.info('[MVStudio] draft received', { job_id: draftData.job_id, audio_track_id: trackId });
      if (onClearDraft) onClearDraft();
      // v209 픽스: track 소스면 트랙 doc 재조회로 오디오(audio_url)/duration/가사/커버 컨텍스트 재공급 —
      // 없으면 씬 생성 duration 측정·merge-audio·씬 게이트가 온전치 않다 (tester 실증).
      if (trackId) {
        api.getTrackDetail(trackId)
          .then(({ data: t }) => {
            setSelectedSong((prev) => (prev && prev.trackId === trackId ? {
              ...prev,
              lyrics: prev.lyrics || t.lyrics || '',
              genre: prev.genre || joinList(t.genre),
              mood: prev.mood || joinList(t.mood),
              audioObjectName: t.audio_url || null,
              audioDurationSec: Number.isFinite(t.duration_sec) && t.duration_sec > 0 ? t.duration_sec : null,
            } : prev));
            // 커버: job 저장분(onCoverAdopted 역주입)이 정본 — 비어 있을 때만 트랙 커버 채택
            if (t.cover_image_url) {
              setCoverObjectName((prev) => prev || t.cover_image_url);
              setCoverPreview((prev) => prev || api.coverPreviewUrl(t.cover_image_url));
            }
            if (import.meta.env.DEV) {
              console.info('[MVStudio] draft track context refetched', {
                track_id: trackId, has_audio: !!t.audio_url, duration_sec: t.duration_sec, has_cover: !!t.cover_image_url,
              });
            }
          })
          .catch((err) => {
            console.error('[MVStudio] draft track refetch failed', { track_id: trackId, status: err?.response?.status, message: err?.message });
          });
      }
    }
  }, [draftData]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── D4 커버 확인 스텝: generate-cover 유도 (UploadPage v207 파이프라인의 최소 payload 재사용) ──
  const handleGenerateCover = async () => {
    if (!selectedSong?.title?.trim()) {
      alert('커버를 생성하려면 곡 제목이 필요합니다.');
      return;
    }
    setGeneratingCover(true);
    try {
      if (import.meta.env.DEV) {
        console.info('[MVStudio] generateCover request', { image_model: coverImageModel, source: selectedSong.source });
      }
      const { data } = await api.generateCover({
        title: selectedSong.title.trim(),
        genre: selectedSong.genre || null,
        mood: selectedSong.mood || null,
        style: null,
        character_object_name: null,
        user_prompt: null,
        prompt_model: null,
        location_id: null,
        image_model: coverImageModel,
        vocal_gender: 'female',
      });
      api.notifyPointsRefresh(); // 커버 ⭐ 차감 즉시 헤더 배지 갱신
      setCoverObjectName(data.object_name);
      setCoverPreview(api.coverPreviewUrl(data.object_name));
      // 씬이 이미 있는 상태에서 커버가 바뀌면 기존 계약대로 scenesInvalidated 통지
      mvSectionRef.current?.notifyCoverChanged();
    } catch (err) {
      if (api.isGenerationRestricted(err)) {
        api.alertGenerationRestricted(err);
      } else if (api.isInsufficientPoints(err)) {
        console.error('[MVStudio] generateCover insufficient points', { status: err?.response?.status });
        api.notifyPointsRefresh();
        alert(`별이 부족해요. AI 커버 생성에는 ⭐${coverCost}개가 필요합니다.`);
      } else {
        alert(err.response?.data?.error || 'AI 커버 생성에 실패했습니다.');
      }
    } finally {
      setGeneratingCover(false);
    }
  };

  // ── 임시저장 래퍼 (구 UploadPage handleSaveDraft 동일 분해 — 실행부는 자식 ref.saveDraft) ──
  const handleSaveDraft = async () => {
    setSavingDraft(true);
    setDraftSaveMsg('');
    try {
      await mvSectionRef.current?.saveDraft();
      setDraftSaveMsg('임시저장되었습니다');
      setTimeout(() => setDraftSaveMsg(''), 3000);
    } catch (err) {
      alert(err.response?.data?.error || '임시저장에 실패했습니다.');
    } finally {
      setSavingDraft(false);
    }
  };

  // ── v211: MV 곡 연결 — attachment 요약 (D3 계약: 리스트 응답 attachment 우선, 부재 시 attached_* 폴백) ──
  const mvAttachment = (job) => {
    if (job.attachment && typeof job.attachment === 'object') return job.attachment;
    if (job.attached_track_id) return { state: 'released', song_id: job.attached_track_id, song_title: null };
    if (job.attached_generation_id) return { state: 'unreleased', song_id: job.attached_generation_id, song_title: null };
    return { state: 'none', song_id: null, song_title: null };
  };

  const handleAttachJob = async (job, replace = false) => {
    if (mvActionBusy) return;
    setMvActionBusy(job.job_id);
    try {
      if (import.meta.env?.DEV) console.info('[MVStudio] attach', { jobId: job.job_id, replace });
      await api.attachMVJob(job.job_id, replace);
      await fetchPool(); // attachment 상태 재조회
    } catch (err) {
      const status = err?.response?.status;
      if (status === 409 && !replace) {
        // 곡당 1개 충돌 — 교체 confirm 후 replace 재호출 (D8)
        const t = err?.response?.data?.conflicting_title;
        const ok = window.confirm(
          t
            ? `이 곡에는 이미 다른 MV(「${t}」 작업)가 붙어 있습니다. 이 MV로 교체할까요?`
            : '이 곡에는 이미 다른 MV가 붙어 있습니다. 이 MV로 교체할까요?',
        );
        if (ok) {
          setMvActionBusy(null);
          await handleAttachJob(job, true);
          return;
        }
      } else {
        console.error('[MVStudio] attach failed', { jobId: job.job_id, status, message: err?.message });
        alert(err?.response?.data?.error || '곡에 붙이기에 실패했습니다.');
      }
    } finally {
      setMvActionBusy(null);
    }
  };

  const handleDetachJob = async (job) => {
    if (mvActionBusy) return;
    if (!window.confirm('이 MV를 곡에서 뗄까요? (곡 상세·플레이어에서 더 이상 재생되지 않습니다)')) return;
    setMvActionBusy(job.job_id);
    try {
      if (import.meta.env?.DEV) console.info('[MVStudio] detach', { jobId: job.job_id });
      await api.detachMVJob(job.job_id);
      await fetchPool();
    } catch (err) {
      console.error('[MVStudio] detach failed', { jobId: job.job_id, status: err?.response?.status, message: err?.message });
      alert(err?.response?.data?.error || '떼기에 실패했습니다.');
    } finally {
      setMvActionBusy(null);
    }
  };

  // [교체] = attach {replace:true} (전용 엔드포인트 없음 — D3). 확인 다이얼로그 필수.
  const handleReplaceJob = (job) => {
    if (mvActionBusy) return;
    if (!window.confirm('이 MV를 곡에 강제 재부착(교체)할까요? 곡에 붙어 있던 다른 MV 연결은 해제됩니다.')) return;
    handleAttachJob(job, true);
  };

  // ── 곡 선택 풀 행 렌더 (한 목록 — 소스 뱃지) ──
  const renderPoolRow = (key, badge, badgeClass, title, subtitle, meta, onSelect, extraBadge) => (
    <div key={key} className="s2__gen-card">
      <div className="s2__gen-top">
        <div className="s2__gen-info">
          {title && <div className="s2__gen-title">{title}</div>}
          {subtitle && <div className="s2__gen-prompt">{subtitle}</div>}
        </div>
        <span className={`s2__gen-status ${badgeClass}`}>{badge}</span>
      </div>
      <div className="s2__gen-meta">
        {meta.map((m, i) => m && <span key={`${i}-${m}`} className="s2__gen-tag">{m}</span>)}
        {extraBadge}
      </div>
      <div className="s2__gen-player">
        <button className="s2__draft-resume" onClick={onSelect}>
          <FiZap /> 이 곡으로 MV 만들기
        </button>
      </div>
    </div>
  );

  return (
    <div className="s2">
      {!selectedSong && (
        <>
          <div className="s2__history" style={{ marginTop: 0 }}>
            <div className="s2__history-header">
              <h3 className="s2__history-title">
                <FiClock /> MV 만들 곡 선택
              </h3>
              <button className="s2__history-refresh" onClick={fetchPool} disabled={loadingPool}>
                <FiRefreshCw className={loadingPool ? 's2__spin' : ''} />
              </button>
            </div>
            <p className="s2__hint">
              작곡실 완성곡과 내 트랙(공개·비공개)에서 곡을 고르면 가사·커버를 자동으로 가져옵니다.
            </p>

            {loadingPool && poolGenerations.length === 0 && poolTracks.length === 0 ? (
              <div className="s2__history-empty">로딩 중...</div>
            ) : poolGenerations.length === 0 && poolTracks.length === 0 ? (
              <div className="s2__history-empty">아직 곡이 없습니다. 작곡실에서 곡을 만들거나 트랙을 업로드해보세요.</div>
            ) : (
              <div className="s2__history-list">
                {poolGenerations.map((gen) =>
                  renderPoolRow(
                    `gen-${gen.id}`,
                    '🎼 작곡실 완성곡',
                    's2__gen-status--completed',
                    gen.title || '(제목 없음)',
                    gen.prompt,
                    [gen.genre, gen.mood],
                    () => handleSelectGeneration(gen),
                    gen.result_track_id ? (
                      <span className="s2__gen-tag s2__gen-tag--model">업로드됨</span>
                    ) : null,
                  ),
                )}
                {poolTracks.map((t) =>
                  renderPoolRow(
                    `track-${t.id}`,
                    t.is_public === false ? '🔒 내 트랙 (비공개)' : '🎧 내 트랙 (공개)',
                    's2__gen-status--pending',
                    t.title || '(제목 없음)',
                    t.prompt,
                    [joinList(t.genre), joinList(t.mood)],
                    () => handleSelectTrack(t),
                    t.cover_image_url ? null : (
                      <span className="s2__gen-tag">커버 없음</span>
                    ),
                  ),
                )}
              </div>
            )}
          </div>

          {/* ── v211: 내 MV — 완성 뮤직비디오 리스트 + 곡 연결(붙이기/떼기/교체) ──
              진행 중(미완성) job 관리는 임시저장 탭 현행 유지 (D8 — 완성물 전용, 중복 편성 방지) */}
          <div className="s2__history">
            <div className="s2__history-header">
              <h3 className="s2__history-title">
                <FiClock /> 내 MV
              </h3>
              <button className="s2__history-refresh" onClick={fetchPool} disabled={loadingPool}>
                <FiRefreshCw className={loadingPool ? 's2__spin' : ''} />
              </button>
            </div>
            <p className="s2__hint">
              완성된 MV를 곡에 붙이면 곡 상세·플레이어 동영상 탭에서 재생됩니다. 붙이기 전에는 노출되지 않아요.
            </p>
            {myMvJobs.length === 0 ? (
              <div className="s2__history-empty">아직 완성된 MV가 없습니다. 곡을 골라 MV를 만들어보세요.</div>
            ) : (
              <div className="s2__history-list">
                {myMvJobs.map((job) => {
                  const att = mvAttachment(job);
                  const busy = mvActionBusy === job.job_id;
                  const songLabel = att.song_title ? `「${att.song_title}」` : '연결된 곡';
                  return (
                    <div key={job.job_id} className="s2__gen-card">
                      <div className="s2__gen-top">
                        <div className="s2__gen-info" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          {job.thumbnail_url && (
                            <img
                              src={job.thumbnail_url}
                              alt=""
                              style={{ width: '44px', height: '44px', objectFit: 'cover', borderRadius: '6px', background: '#111', flexShrink: 0 }}
                            />
                          )}
                          <div>
                            <div className="s2__gen-title">🎬 {job.title || '(제목 없음)'}</div>
                            {att.state === 'released' && (
                              <div style={{ fontSize: '12px', color: '#ddd', marginTop: '2px' }}>
                                🔗 {songLabel} <span style={{ color: '#9eff9e', fontSize: '11px' }}>✅ 발매됨</span>
                              </div>
                            )}
                            {att.state === 'unreleased' && (
                              <div style={{ fontSize: '12px', color: '#ddd', marginTop: '2px' }}>
                                🔗 {songLabel} <span style={{ color: '#e8c87a', fontSize: '11px' }}>🕓 발매 전 (발매 시 자동 반영)</span>
                              </div>
                            )}
                            {att.state === 'broken' && (
                              <div style={{ fontSize: '12px', color: '#f4a261', marginTop: '2px' }}>
                                ⚠ 연결 곡 없음 (곡이 삭제됨) — [떼기]로 정리하세요
                              </div>
                            )}
                          </div>
                        </div>
                        <span className="s2__gen-status s2__gen-status--completed">완성</span>
                      </div>
                      {job.result_music_video_url && (
                        <video
                          src={job.result_music_video_url}
                          controls
                          preload="none"
                          poster={job.thumbnail_url || undefined}
                          style={{ width: '100%', maxHeight: '220px', borderRadius: '8px', background: '#000', marginTop: '8px' }}
                        />
                      )}
                      <div className="s2__gen-player">
                        {att.state === 'none' && (
                          <button
                            className="s2__draft-resume"
                            onClick={() => handleAttachJob(job)}
                            disabled={busy}
                          >
                            {busy ? '붙이는 중...' : '🔗 곡에 붙이기'}
                          </button>
                        )}
                        {(att.state === 'released' || att.state === 'unreleased') && (
                          <>
                            <button
                              className="s2__draft-resume"
                              onClick={() => handleDetachJob(job)}
                              disabled={busy}
                            >
                              {busy ? '처리 중...' : '떼기'}
                            </button>
                            <button
                              className="s2__draft-resume"
                              onClick={() => handleReplaceJob(job)}
                              disabled={busy}
                            >
                              교체
                            </button>
                          </>
                        )}
                        {att.state === 'broken' && (
                          <button
                            className="s2__draft-resume"
                            onClick={() => handleDetachJob(job)}
                            disabled={busy}
                          >
                            {busy ? '처리 중...' : '떼기'}
                          </button>
                        )}
                      </div>
                      <div className="s2__gen-bottom">
                        <span className="s2__gen-date">{job.created_at ? new Date(job.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {selectedSong && (
        <div className="upload-page" style={{ padding: 0 }}>
          {/* 선택 곡 헤더 */}
          <div className="upload-card" style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff' }}>
                  🎬 {selectedSong.title || '(제목 없음)'}
                </div>
                <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>
                  {selectedSong.source === 'track' ? '내 트랙' : selectedSong.source === 'generation' ? '작곡실 완성곡' : 'MV 임시저장'}
                  {selectedSong.genre ? ` · ${selectedSong.genre}` : ''}
                  {selectedSong.lyrics ? '' : ' · 가사 없음(자막 미표시)'}
                </div>
              </div>
              <button type="button" className="s2__btn-back" onClick={handleChangeSong}>
                <FiArrowLeft /> 다른 곡 선택
              </button>
            </div>

            {/* ── D4: 커버 확인 스텝 — 서버 400("커버 이미지가 필요합니다") 사전 가드 ── */}
            <div className="upload-card__field" style={{ marginTop: '16px' }}>
              <label className="upload-card__label">커버 이미지 (MV 씬 생성에 필수)</label>
              {coverObjectName ? (
                <div className="upload-cover-preview">
                  <img
                    src={coverPreview || api.coverPreviewUrl(coverObjectName)}
                    alt="커버 이미지"
                    className="upload-cover-preview__img"
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedImage({ url: coverPreview || api.coverPreviewUrl(coverObjectName), title: '커버 이미지', subtitle: selectedSong.title || '' })}
                  />
                  <div className="upload-cover-preview__actions">
                    <span style={{ fontSize: '12px', color: '#9eff9e', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <FiCheck /> 커버 준비됨
                    </span>
                  </div>
                </div>
              ) : (
                <div className="upload-mv-hint" style={{ marginBottom: '8px' }}>
                  이 곡에는 커버가 없습니다. MV 씬 생성에는 커버 이미지가 필요해요 — 아래 버튼으로 만들어주세요.
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '8px' }}>
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
                    <>
                      {coverObjectName ? '커버 다시 생성' : 'AI 커버 생성'}
                      <span className="upload-cover-cost-badge">⭐{coverCost}</span>
                    </>
                  )}
                </button>
                <span style={{ fontSize: '11px', color: '#888' }}>
                  곡 제목·장르·분위기 기반으로 생성됩니다.
                </span>
              </div>
            </div>
          </div>

          {/* ── MV 제작 본체 — MVProductionSection 재사용 (1단계 계약 그대로 + 3단계 track 소스 확장) ── */}
          <div className="upload-card">
            <MVProductionSection
              ref={mvSectionRef}
              title={selectedSong.title}
              genre={selectedSong.genre}
              mood={selectedSong.mood}
              lyrics={selectedSong.lyrics}
              tags={''}
              prompt={selectedSong.prompt}
              aiTool={selectedSong.aiModel}
              fromGeneration={selectedSong.audioGenerationId}
              audioFile={null}
              trackId={selectedSong.trackId}
              audioObjectName={selectedSong.audioObjectName}
              audioDurationSec={selectedSong.audioDurationSec}
              aiCoverObjectName={coverObjectName}
              coverImageModel={coverImageModel}
              vocalGender={'female'}
              selectedLocationId={null}
              includeCharacter={false}
              characterVariant={'real'}
              selectedCharSheet={() => null}
              draftData={mvDraft}
              onCoverAdopted={(objectName, previewUrl) => {
                // MV 드래프트 복원의 커버 역주입 — 프록시 URL 폴백으로 미리보기 보장
                setCoverObjectName(objectName);
                setCoverPreview(previewUrl || api.coverPreviewUrl(objectName));
              }}
              onCoverImageModelRestore={setCoverImageModel}
              onRequestLightbox={setSelectedImage}
            />

            {/* 임시저장 (MV job draft — 구 UploadPage 액션에서 이관) */}
            {draftSaveMsg && (
              <div className="upload-card__success">
                <FiCheck style={{ marginRight: 6, verticalAlign: 'middle' }} />
                {draftSaveMsg}
              </div>
            )}
            <div className="upload-card__actions">
              <button
                type="button"
                className="upload-card__draft-btn"
                onClick={handleSaveDraft}
                disabled={savingDraft}
              >
                {savingDraft ? '저장 중...' : '임시저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 공용 이미지 라이트박스 — 커버/자산(주인공·장소) 확대 (구 UploadPage v61 모달 이관) */}
      {selectedImage && (
        <div className="upload-mv-scene-modal-overlay" onClick={() => setSelectedImage(null)}>
          <div className="upload-mv-scene-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="upload-mv-scene-modal__close" onClick={() => setSelectedImage(null)}>✕</button>
            <div className="upload-mv-scene-modal__image-wrap upload-mv-scene-modal__image-wrap--contain">
              {selectedImage.url ? (
                <img
                  src={selectedImage.url}
                  alt={selectedImage.title || '이미지'}
                  className="upload-mv-scene-modal__image"
                />
              ) : (
                <div className="upload-mv-scene-modal__placeholder">
                  <FiImage /> 이미지 없음
                </div>
              )}
            </div>
            {(selectedImage.title || selectedImage.subtitle) && (
              <div className="upload-mv-scene-modal__info">
                {selectedImage.title && (
                  <h3 className="upload-mv-scene-modal__title">{selectedImage.title}</h3>
                )}
                {selectedImage.subtitle && (
                  <div className="upload-mv-scene-modal__desc">{selectedImage.subtitle}</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
