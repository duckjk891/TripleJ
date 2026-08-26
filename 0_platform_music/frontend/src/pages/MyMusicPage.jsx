import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { FiUploadCloud, FiTrash2, FiMusic, FiPlay, FiPause, FiFolder, FiImage, FiFilm, FiAlertCircle, FiUser, FiRefreshCw, FiPlus, FiEdit2, FiDisc } from 'react-icons/fi';
import { useAuth } from '../contexts/AuthContext';
import { usePlayer } from '../contexts/PlayerContext';
import * as api from '../api';
import UploadPage from './UploadPage';
import StudioTab from '../components/StudioTab';
// v209 — StudioTab2(작업실2)를 작사실/작곡실로 분할(2단계), MV촬영실 신설 + StudioTab2.jsx 삭제(3단계).
import LyricsStudioTab from '../components/studio/LyricsStudioTab';
import ComposeStudioTab from '../components/studio/ComposeStudioTab';
import MVStudioTab from '../components/studio/MVStudioTab';
import AlbumCreateModal from '../components/AlbumCreateModal';
import ItemSelectModal from '../components/ItemSelectModal';
import MyVoiceCloneSection from '../components/MyVoiceCloneSection';
import ConsentGateModal from '../components/ConsentGateModal';
import FaceVerifyFlow from '../components/FaceVerifyFlow';
import TrackShareButton from '../components/TrackShareButton';
import AppealModal from '../components/AppealModal';
import CoverEditModal from '../components/CoverEditModal';
import { hasConsentCached, checkConsent } from '../utils/consent';
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
  const [mode, setMode] = useState('real'); // 'real' | 'virtual'

  // 착용 아이템 슬롯(실사·가상 공통) — 광고상품 {id,name,image_object_name,product_url,category}|null
  const [selectedTop, setSelectedTop] = useState(null);
  const [selectedBottom, setSelectedBottom] = useState(null);
  const [selectedShoes, setSelectedShoes] = useState(null);
  // 아이템 선택 모달 오픈 카테고리('상의'|'하의'|'신발'|null) — 페이지 이동 없이 모달로 띄워 state 보존
  const [itemModalCategory, setItemModalCategory] = useState(null);

  // 실사(real) 흐름 상태
  const [generating, setGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewObjectName, setPreviewObjectName] = useState(null);
  const [saving, setSaving] = useState(false);
  const [photoFile, setPhotoFile] = useState(null);
  // v161 — 외모 텍스트 프롬프트(사진 없이도 생성 가능한 텍스트 경로). 사진과 병행 시 보정 텍스트로 함께 전송.
  const [userText, setUserText] = useState('');
  const [realFormOpen, setRealFormOpen] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0); // 실사 생성 경과시간(초)
  const photoInputRef = useRef(null);
  // v125 — 실사 사진 업로드 전 얼굴 사진 AI 처리(photo_ai) 동의 게이트 모달
  const [photoGateOpen, setPhotoGateOpen] = useState(false);
  // v137 — 사진 확약 체크(실사·가상 공통): 미체크 시 생성 버튼 비활성.
  // 체크 상태는 생성 form 에 portrait_confirmed=true 로 전달(BE 는 로그만 — 필드 없어도 동작).
  const [portraitConfirmed, setPortraitConfirmed] = useState(false);
  // v135 — 얼굴 인증(생체 대조) 플로우 모달. FACE_VERIFY_ENABLED(flag) ON 일 때만 열린다.
  // flag OFF 면 이 state 는 항상 false — 기존 실사 생성 흐름 렌더/동작 불변.
  const [faceFlowOpen, setFaceFlowOpen] = useState(false);
  // 비동기 job 폴링 인터벌 id — 언마운트/새 생성 시작 시 반드시 정리(누수 금지)
  const charPollRef = useRef(null);

  // 가상화(virtual / 그림·만화) 흐름 상태
  const [vGenerating, setVGenerating] = useState(false);
  const [vPreviewUrl, setVPreviewUrl] = useState(null);
  const [vPreviewObjectName, setVPreviewObjectName] = useState(null);
  const [vArtStyle, setVArtStyle] = useState(null);
  const [vSaving, setVSaving] = useState(false);
  const [vPhotoFile, setVPhotoFile] = useState(null);
  // v161 — 가상화 섹션 외모 텍스트 프롬프트(텍스트-only 생성 경로)
  const [vUserText, setVUserText] = useState('');
  const [vFormOpen, setVFormOpen] = useState(false);
  const [vElapsedSec, setVElapsedSec] = useState(0); // 가상화 생성 경과시간(초)
  const [imageModel, setImageModel] = useState('gpt_image_2');
  // v158 — 별 경제 v1.2: 캐릭터 생성 비용(⭐) — /points/costs 단일 소스({ costs } 래핑), 실패 시 10 폴백
  const [characterCost, setCharacterCost] = useState(10);
  const [styleSamples, setStyleSamples] = useState([]);
  const [stylesLoading, setStylesLoading] = useState(false);
  const [selectedStyleKey, setSelectedStyleKey] = useState(null);
  const [customStyleFile, setCustomStyleFile] = useState(null);
  const vPhotoInputRef = useRef(null);
  const styleInputRef = useRef(null);

  useEffect(() => {
    api.getMyCharacter()
      .then(({ data }) => setCharacter(data.character))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // 가상화 모드 진입 시 화풍 샘플 1회 로드
  useEffect(() => {
    if (mode !== 'virtual' || styleSamples.length > 0 || stylesLoading) return;
    setStylesLoading(true);
    api.getStyleSamples()
      .then(({ data }) => {
        const list = Array.isArray(data) ? data : (data?.samples || []);
        setStyleSamples(list);
        if (import.meta.env.DEV) {
          console.info('[MyMusicPage] style samples loaded', { count: list.length });
        }
      })
      .catch((err) => {
        console.error('[MyMusicPage] style samples load failed', err);
        setStyleSamples([]);
      })
      .finally(() => setStylesLoading(false));
  }, [mode, styleSamples.length, stylesLoading]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.info('[MyMusic][CharacterSection]', {
        empty: !character,
        items: character?.used_items?.length ?? 0,
        hasSheet: !!character?.sheet_url,
        hasName: !!character?.name,
        hasAge: !!character?.age,
        tags: character?.personality_tags?.length ?? 0,
        hasText: !!character?.personality_text,
      });
    }
  }, [character]);

  // v158 — 캐릭터 생성 비용 로드 (표기용 — 실패 시 기본값 10 유지)
  useEffect(() => {
    api.getPointCosts()
      .then(({ data }) => {
        if (typeof data?.costs?.character === 'number') setCharacterCost(data.costs.character);
      })
      .catch((err) => {
        console.error('[MyMusicPage] getPointCosts failed (fallback 10)', { status: err?.response?.status, message: err?.message });
      });
  }, []);

  // ── 비동기 캐릭터 job 폴링 (접수 → 5초 폴링 → 완료 미리보기) ──────────
  const clearCharPoll = useCallback(() => {
    if (charPollRef.current) {
      clearInterval(charPollRef.current);
      charPollRef.current = null;
    }
  }, []);

  // 언마운트 시 인터벌 정리(누수 방지)
  useEffect(() => clearCharPoll, [clearCharPoll]);

  // 공용 폴링 헬퍼 — 5초 간격, 최대 15분(180 tick), 일시 네트워크 오류 3회 연속까지 허용.
  // 새 폴링 시작 시 기존 인터벌은 정리한다(실사/가상 동시 1개만 유지).
  const pollCharacterJob = useCallback((jobId, { onTick, onDone, onFailed }) => {
    clearCharPoll();
    const POLL_MS = 5000;
    const MAX_TICKS = 180; // 15분
    const MAX_CONSECUTIVE_ERRORS = 3;
    const startedAt = Date.now();
    let ticks = 0;
    let consecutiveErrors = 0;
    let lastStatus = 'processing';
    const intervalId = setInterval(async () => {
      // 정리된(교체된) 인터벌의 잔여 tick 은 무시
      if (charPollRef.current !== intervalId) return;
      ticks += 1;
      if (onTick) onTick(Math.floor((Date.now() - startedAt) / 1000));
      if (ticks > MAX_TICKS) {
        clearCharPoll();
        onFailed('시간 초과');
        return;
      }
      try {
        const { data: job } = await api.getCharacterJob(jobId);
        if (charPollRef.current !== intervalId) return; // await 중 정리됐으면 무시
        consecutiveErrors = 0;
        if (import.meta.env.DEV && job.status !== lastStatus) {
          console.info(`[MyMusicPage] char job ${jobId} status=${job.status}`);
          lastStatus = job.status;
        }
        if (job.status === 'done') {
          clearCharPoll();
          onDone(job);
        } else if (job.status === 'failed') {
          clearCharPoll();
          onFailed(job.error || '생성 실패');
        }
        // 'processing' → 계속 폴링
      } catch (err) {
        if (charPollRef.current !== intervalId) return;
        consecutiveErrors += 1;
        console.error('[MyMusicPage] char job poll error', {
          jobId,
          consecutiveErrors,
          status: err.response?.status,
        });
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          clearCharPoll();
          onFailed('상태 조회에 반복 실패했습니다.');
        }
      }
    }, POLL_MS);
    charPollRef.current = intervalId;
  }, [clearCharPoll]);

  // 경과시간 표시 — "N분 M초"
  const formatElapsed = (sec) => `${Math.floor(sec / 60)}분 ${sec % 60}초`;

  // 모달에서 아이템 선택 → 현재 열린 카테고리(itemModalCategory) 기준으로 해당 슬롯에 저장.
  // 페이지 언마운트가 없으므로 업로드 사진/다른 선택/화풍 state 가 그대로 보존된다.
  const handleItemPicked = (item) => {
    const category = itemModalCategory;
    if (!category) return;
    const slot = {
      id: item.id,
      name: item.name,
      image_object_name: item.image_object_name,
      product_url: item.product_url,
      category,
    };
    if (category === '상의') setSelectedTop(slot);
    else if (category === '하의') setSelectedBottom(slot);
    else if (category === '신발') setSelectedShoes(slot);
    if (import.meta.env.DEV) {
      console.info('[MyMusicPage] item picked', { category });
    }
  };

  // 선택분만 생성 formData 에 부착(백엔드 generate-sheet / -cartoon 의 *_object_name 필드)
  const appendItemObjectNames = (formData) => {
    if (selectedTop) formData.append('top_object_name', selectedTop.image_object_name);
    if (selectedBottom) formData.append('bottom_object_name', selectedBottom.image_object_name);
    if (selectedShoes) formData.append('shoes_object_name', selectedShoes.image_object_name);
    if (import.meta.env.DEV) {
      console.info('[MyMusicPage] gen items', {
        top: !!selectedTop,
        bottom: !!selectedBottom,
        shoes: !!selectedShoes,
      });
    }
  };

  // 선택 슬롯 → save 페이로드의 used_items 배열(저장카드 "착용 아이템" 표시용)
  const buildUsedItems = () =>
    [selectedTop, selectedBottom, selectedShoes].filter(Boolean).map((it) => ({
      id: it.id,
      name: it.name,
      image_object_name: it.image_object_name,
      product_url: it.product_url,
      category: it.category,
    }));

  // v125 — 실사 캐릭터 사진 업로드 트리거 앞 photo_ai 동의 게이트.
  // 세션 캐시 히트 시 동기 진행(파일 선택 제스처 유지), 미동의/확인 실패 시 모달 표시.
  const handleRealPhotoTrigger = async () => {
    if (hasConsentCached('photo_ai')) {
      photoInputRef.current?.click();
      return;
    }
    try {
      const agreed = await checkConsent('photo_ai');
      if (agreed) {
        photoInputRef.current?.click();
        return;
      }
    } catch (err) {
      console.error('[ConsentGate] check failed', {
        key: 'photo_ai',
        status: err?.response?.status,
      });
    }
    setPhotoGateOpen(true);
  };

  // v161 — 생성 소스 판별(photo|text|photo+text) — 로그·게이트 분기 공용
  const genSource = (file, text) => {
    if (file && text.trim()) return 'photo+text';
    if (file) return 'photo';
    return 'text';
  };

  // v135 — 실사화 생성 게이트: flag ON 이면 얼굴 인증 플로우를 먼저 통과해야 한다.
  // flag OFF(현재 기본)면 status 확인 후 기존 흐름 그대로 진행 — 렌더/동작 불변.
  // v161 — 텍스트-only(사진 미첨부) 경로는 얼굴 인증·사진 확약이 사진 전용 게이트이므로 스킵.
  const handleGenerate = async () => {
    if (!photoFile && !userText.trim()) {
      alert('얼굴 사진을 선택하거나 외모 설명을 입력해주세요.');
      return;
    }
    if (photoFile) {
      // v137 — 사진 확약 미체크 시 생성 중단 (사진 첨부 시에만)
      if (!portraitConfirmed) {
        alert('사진 확약(본인 또는 인물 동의 확인)에 체크해야 생성할 수 있습니다.');
        return;
      }
      try {
        const { data: fv } = await api.getFaceVerifyStatus();
        if (fv?.enabled) {
          if (import.meta.env.DEV) console.info('[FaceVerifyFlow] gate on — opening flow before real gen');
          setFaceFlowOpen(true);
          return; // onVerified 콜백에서 submitRealGeneration 재개
        }
      } catch (err) {
        // 상태 확인 실패 시 기존 흐름 진행 — 최종 방어는 BE 403(face_verification_required)
        console.error('[FaceVerifyFlow] status check failed', {
          status: err?.response?.status,
          message: err?.message,
        });
      }
    }
    await submitRealGeneration();
  };

  // 실사화 생성 본체 (v135 이전의 handleGenerate 본문 — 얼굴 인증 통과 후에도 여기로 재개)
  const submitRealGeneration = async () => {
    // v161 — 사진 또는 외모 텍스트 중 하나는 필요 (BE 도 둘 다 없으면 400)
    if (!photoFile && !userText.trim()) {
      alert('얼굴 사진을 선택하거나 외모 설명을 입력해주세요.');
      return;
    }
    setGenerating(true);
    setElapsedSec(0);
    try {
      const formData = new FormData();
      // v161 — file optional: 사진 첨부 시에만 전송, 외모 텍스트는 있으면 항상 전송(사진+텍스트 보정 겸용)
      if (photoFile) formData.append('file', photoFile);
      if (userText.trim()) formData.append('user_text', userText.trim());
      formData.append('image_model', imageModel);
      // v137 — 사진 확약 체크 상태 전달 (BE 는 로그만 — 사진 첨부 시에만 의미)
      if (photoFile && portraitConfirmed) formData.append('portrait_confirmed', 'true');
      appendItemObjectNames(formData);
      if (import.meta.env.DEV) {
        console.info('[MyMusicPage] generate', {
          mode: 'real',
          source: genSource(photoFile, userText),
          image_model: imageModel,
        });
      }
      // 접수(job_id 즉시 반환) → 5초 폴링 → 완료 시 미리보기
      const { data } = await api.generateCharacterSheetAsync(formData);
      api.notifyPointsRefresh(); // v158 — 캐릭터 ⭐ 차감(접수 시점) 즉시 헤더 배지 갱신
      if (import.meta.env.DEV) {
        console.info('[MyMusicPage] char job started', { job_id: data.job_id, mode: 'real' });
      }
      pollCharacterJob(data.job_id, {
        onTick: setElapsedSec,
        onDone: (job) => {
          setPreviewUrl(api.characterPreviewUrl(job.preview_url));
          setPreviewObjectName(job.object_name);
          setGenerating(false);
        },
        onFailed: (err) => {
          console.error('[MyMusicPage] char job failed', { err });
          setGenerating(false);
          api.notifyPointsRefresh(); // v158 — 실패 자동 환불 반영
          alert('캐릭터 시트 생성에 실패했습니다. 사용된 별은 자동으로 환불됩니다.');
        },
      });
    } catch (err) {
      console.error('[MyMusicPage] char job submit failed', err);
      setGenerating(false);
      // v135 — BE 게이트 403 폴백: 얼굴 인증 플로우 모달을 띄우고 통과 시 재시도 (v161 — 사진 경로 전용)
      if (photoFile && err.response?.status === 403 && err.response?.data?.error === 'face_verification_required') {
        if (import.meta.env.DEV) console.info('[FaceVerifyFlow] 403 fallback — opening flow');
        setFaceFlowOpen(true);
        return;
      }
      // v139 — 스트라이크 생성 제한 403 공통 처리
      if (api.isGenerationRestricted(err)) {
        api.alertGenerationRestricted(err);
        return;
      }
      // v158 — 별 부족(402) 분기
      if (api.isInsufficientPoints(err)) {
        api.notifyPointsRefresh();
        alert(`별이 부족해요. 캐릭터 시트 생성에는 ⭐${characterCost}개가 필요합니다.`);
        return;
      }
      alert(err.response?.data?.error || '캐릭터 시트 생성에 실패했습니다.');
    }
  };

  const handleSave = async () => {
    if (!previewObjectName) return;
    setSaving(true);
    try {
      await api.saveCharacter({
        sheet_object_name: previewObjectName,
        used_items: buildUsedItems(),
      });
      const { data } = await api.getMyCharacter();
      setCharacter(data.character);
      setPreviewUrl(null);
      setPreviewObjectName(null);
      setPhotoFile(null);
      setRealFormOpen(false);
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
    setPreviewUrl(null);
    setPreviewObjectName(null);
    setPhotoFile(null);
    setRealFormOpen(true);
  };

  // ── 가상화(virtual) 핸들러 ──────────────────────────────
  const handleSelectStyle = (key) => {
    setSelectedStyleKey(key);
    setCustomStyleFile(null); // 샘플 선택 시 업로드 화풍 해제
  };

  const handleCustomStyleChange = (file) => {
    setCustomStyleFile(file || null);
    if (file) setSelectedStyleKey(null); // 업로드 화풍 선택 시 샘플 해제
  };

  const handleGenerateCartoon = async () => {
    // v161 — 사진 또는 외모 텍스트 중 하나는 필요 (BE 도 둘 다 없으면 400)
    if (!vPhotoFile && !vUserText.trim()) {
      alert('얼굴 사진을 선택하거나 외모 설명을 입력해주세요.');
      return;
    }
    if (!selectedStyleKey && !customStyleFile) {
      alert('화풍(샘플 택1 또는 직접 업로드)을 선택해주세요.');
      return;
    }
    // v137 — 사진 확약 미체크 시 생성 중단 (v161 — 사진 첨부 시에만)
    if (vPhotoFile && !portraitConfirmed) {
      alert('사진 확약(본인 또는 인물 동의 확인)에 체크해야 생성할 수 있습니다.');
      return;
    }
    setVGenerating(true);
    setVElapsedSec(0);
    try {
      const formData = new FormData();
      // v161 — file optional: 사진 첨부 시에만 전송, 외모 텍스트는 있으면 항상 전송(사진+텍스트 보정 겸용)
      if (vPhotoFile) formData.append('file', vPhotoFile);
      if (vUserText.trim()) formData.append('user_text', vUserText.trim());
      formData.append('image_model', imageModel);
      // v137 — 사진 확약 체크 상태 전달 (BE 는 로그만 — 사진 첨부 시에만 의미)
      if (vPhotoFile && portraitConfirmed) formData.append('portrait_confirmed', 'true');
      if (customStyleFile) {
        formData.append('style_image', customStyleFile);
      } else {
        formData.append('style_preset', selectedStyleKey);
      }
      appendItemObjectNames(formData);
      const fallbackStyle = customStyleFile ? 'custom' : selectedStyleKey;
      if (import.meta.env.DEV) {
        console.info('[MyMusicPage] generate', {
          mode: 'cartoon',
          source: genSource(vPhotoFile, vUserText),
          style: fallbackStyle,
          image_model: imageModel,
        });
      }
      // 접수(job_id 즉시 반환) → 5초 폴링 → 완료 시 미리보기
      const { data } = await api.generateCharacterSheetCartoonAsync(formData);
      api.notifyPointsRefresh(); // v158 — 캐릭터 ⭐ 차감(접수 시점) 즉시 헤더 배지 갱신
      if (import.meta.env.DEV) {
        console.info('[MyMusicPage] char job started', { job_id: data.job_id, mode: 'cartoon' });
      }
      pollCharacterJob(data.job_id, {
        onTick: setVElapsedSec,
        onDone: (job) => {
          setVPreviewUrl(api.characterPreviewUrl(job.preview_url));
          setVPreviewObjectName(job.object_name);
          setVArtStyle(job.art_style || fallbackStyle);
          setVGenerating(false);
        },
        onFailed: (err) => {
          console.error('[MyMusicPage] char job failed', { err });
          setVGenerating(false);
          api.notifyPointsRefresh(); // v158 — 실패 자동 환불 반영
          alert('가상화 캐릭터 시트 생성에 실패했습니다. 사용된 별은 자동으로 환불됩니다.');
        },
      });
    } catch (err) {
      console.error('[MyMusicPage] cartoon gen submit failed', err);
      setVGenerating(false);
      // v139 — 스트라이크 생성 제한 403 공통 처리
      if (api.isGenerationRestricted(err)) {
        api.alertGenerationRestricted(err);
        return;
      }
      // v158 — 별 부족(402) 분기
      if (api.isInsufficientPoints(err)) {
        api.notifyPointsRefresh();
        alert(`별이 부족해요. 가상화 캐릭터 시트 생성에는 ⭐${characterCost}개가 필요합니다.`);
        return;
      }
      alert(err.response?.data?.error || '가상화 캐릭터 시트 생성에 실패했습니다.');
    }
  };

  const handleSaveVirtual = async () => {
    if (!vPreviewObjectName) return;
    setVSaving(true);
    try {
      await api.saveCharacter({
        sheet_object_name: vPreviewObjectName,
        variant: 'virtual',
        art_style: vArtStyle,
        used_items: buildUsedItems(),
      });
      const { data } = await api.getMyCharacter();
      setCharacter(data.character);
      setVPreviewUrl(null);
      setVPreviewObjectName(null);
      setVPhotoFile(null);
      setSelectedStyleKey(null);
      setCustomStyleFile(null);
      setVFormOpen(false);
    } catch (err) {
      console.error('[MyMusicPage] virtual save failed', err);
      alert(err.response?.data?.error || '가상화 캐릭터 저장에 실패했습니다.');
    } finally {
      setVSaving(false);
    }
  };

  const handleRegenerateVirtual = () => {
    setVPreviewUrl(null);
    setVPreviewObjectName(null);
    setVPhotoFile(null);
    setVArtStyle(null);
    setSelectedStyleKey(null);
    setCustomStyleFile(null);
    setVFormOpen(true);
  };

  if (loading) {
    return <div className="mymusic-loading">로딩 중...</div>;
  }

  const hasReal = !!character?.sheet_url;
  const hasVirtual = !!character?.virtual_sheet_object_name;

  // ── 착용 아이템 선택 슬롯(실사·가상 공통) ───────────────
  const renderItemSlots = () => {
    const slots = [
      { label: '상의', category: '상의', data: selectedTop, clear: () => setSelectedTop(null) },
      { label: '하의', category: '하의', data: selectedBottom, clear: () => setSelectedBottom(null) },
      { label: '신발', category: '신발', data: selectedShoes, clear: () => setSelectedShoes(null) },
    ];
    return (
      <div className="mymusic-character__items">
        <p className="mymusic-character__style-title">착용 아이템 (선택)</p>
        <p className="mymusic-character__empty-hint">
          선택한 광고상품을 캐릭터가 실제로 착용한 모습으로 생성됩니다.
        </p>
        <div className="mymusic-character__outfit-row">
          {slots.map((slot) => (
            <div key={slot.category} className="mymusic-character__outfit-box">
              {slot.data ? (
                <>
                  <div className="mymusic-character__outfit-image">
                    <img
                      src={api.adImageUrl(slot.data.image_object_name)}
                      alt={slot.data.name || slot.label}
                      className="mymusic-character__outfit-preview"
                      onError={(e) => {
                        if (e?.currentTarget) e.currentTarget.style.visibility = 'hidden';
                      }}
                    />
                    <button
                      type="button"
                      className="mymusic-character__file-remove mymusic-character__outfit-remove"
                      title={`${slot.label} 제거`}
                      onClick={slot.clear}
                    >
                      <FiTrash2 />
                    </button>
                  </div>
                  <div className="mymusic-character__outfit-name" title={slot.data.name}>
                    {slot.data.name}
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  className="mymusic-character__outfit-image mymusic-character__outfit-select"
                  onClick={() => setItemModalCategory(slot.category)}
                >
                  <FiPlus />
                  <span>{slot.label} 선택</span>
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  // ── 실사(real) 저장본 표시 ──────────────────────────────
  const renderRealSaved = () => {
    const tags = Array.isArray(character?.personality_tags)
      ? character.personality_tags.filter(Boolean)
      : [];

    const byCategory = {};
    if (Array.isArray(character?.used_items)) {
      for (const it of character.used_items) {
        if (it?.category) byCategory[it.category] = it;
      }
    }
    const outfitSlots = [
      { label: '상의', data: byCategory['상의'] || null },
      { label: '하의', data: byCategory['하의'] || null },
      { label: '신발', data: byCategory['신발'] || null },
    ];

    const handleSheetError = (e) => {
      if (e?.currentTarget) e.currentTarget.style.display = 'none';
    };

    const handleItemImgError = (slot) => () => {
      console.warn('[MyMusic][CharacterSection] image load failed', {
        kind: 'item',
        object_name: slot?.data?.image_object_name ?? null,
      });
    };

    const handleItemClick = (item) => (e) => {
      if (!item?.product_url) return;
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      if (import.meta.env.DEV) {
        console.info('[MyMusic][CharacterSection] adClick', { id: item.id ?? null });
      }
      if (item.id) {
        api.recordAdClick(item.id).catch(() => {});
      }
      window.open(item.product_url, '_blank', 'noopener,noreferrer');
    };

    const hasProfile =
      !!character?.name ||
      !!character?.age ||
      tags.length > 0 ||
      !!character?.personality_text;

    return (
      <div className="mymusic-character__variant">
        <div className="mymusic-character__sheet">
          <img
            src={api.characterPreviewUrl(character.sheet_url)}
            alt="내 캐릭터 시트"
            className="mymusic-character__sheet-img"
            onError={handleSheetError}
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

        {hasProfile && (
          <div className="mymusic-character__profile-row">
            {(character?.name || character?.age) && (
              <div className="mymusic-character__profile-line">
                {character?.name && (
                  <span className="mymusic-character__profile-name">{character.name}</span>
                )}
                {character?.age && (
                  <span className="mymusic-character__profile-age">{character.age}세</span>
                )}
              </div>
            )}
            {tags.length > 0 && (
              <div className="mymusic-character__chips">
                {tags.map((tag, i) => (
                  <span key={`${tag}-${i}`} className="mymusic-character__chip">
                    {tag}
                  </span>
                ))}
              </div>
            )}
            {character?.personality_text && (
              <p className="mymusic-character__profile-text">{character.personality_text}</p>
            )}
          </div>
        )}

        <p className="mymusic-character__outfit-hint">착용 아이템</p>
        <div className="mymusic-character__outfit-row">
          {outfitSlots.map((slot) => {
            const data = slot.data;
            const hasImg = !!data?.image_object_name;
            const hasUrl = !!data?.product_url;
            return (
              <div key={slot.label} className="mymusic-character__outfit-box">
                {data ? (
                  <>
                    <div
                      className={
                        'mymusic-character__outfit-image' +
                        (hasUrl ? ' mymusic-character__outfit-image--clickable' : '')
                      }
                      onClick={hasUrl ? handleItemClick(data) : undefined}
                      role={hasUrl ? 'button' : undefined}
                      tabIndex={hasUrl ? 0 : undefined}
                      onKeyDown={
                        hasUrl
                          ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleItemClick(data)(e);
                              }
                            }
                          : undefined
                      }
                    >
                      {hasImg ? (
                        <img
                          src={api.adImageUrl(data.image_object_name)}
                          alt={data.name || slot.label}
                          className="mymusic-character__outfit-preview"
                          onError={handleItemImgError(slot)}
                        />
                      ) : (
                        <div className="mymusic-character__outfit-empty">{slot.label} 미선택</div>
                      )}
                    </div>
                    {data.name && (
                      <div
                        className={
                          'mymusic-character__outfit-name' +
                          (hasUrl ? ' mymusic-character__outfit-name--clickable' : '')
                        }
                        onClick={hasUrl ? handleItemClick(data) : undefined}
                      >
                        {data.name}
                      </div>
                    )}
                    {hasUrl && (
                      <a
                        href={data.product_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mymusic-character__outfit-link"
                        onClick={handleItemClick(data)}
                      >
                        쇼핑몰에서 보기 ▶
                      </a>
                    )}
                  </>
                ) : (
                  <div className="mymusic-character__outfit-image">
                    <div className="mymusic-character__outfit-empty">{slot.label} 미선택</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ── 실사(real) 미리보기(생성됨·미저장) 표시 ──────────────
  const renderRealPreview = () => (
    <div className="mymusic-character__variant">
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
            {generating
              ? `생성 중... (${formatElapsed(elapsedSec)})`
              : <>다시 생성 <span className="mymusic-character__cost-badge">⭐{characterCost}</span></>}
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

  // ── v137 — 사진 확약 체크 + 보관·비학습 고지 (실사·가상 공통) ──
  const renderPortraitConfirm = () => (
    <div className="mymusic-character__portrait-confirm">
      <label className="mymusic-character__confirm-label">
        <input
          type="checkbox"
          checked={portraitConfirmed}
          onChange={(e) => setPortraitConfirmed(e.target.checked)}
        />
        <span>위 사진은 본인이거나, 사진 속 인물의 동의를 받았음을 확인합니다</span>
      </label>
      <p className="mymusic-character__photo-notice">
        업로드한 사진은 캐릭터 생성·재생성 용도로만 보관되며 AI 학습에 사용되지 않습니다.
        캐릭터 삭제 시 함께 삭제됩니다.
      </p>
    </div>
  );

  // ── v161 — 외모 텍스트 입력칸(실사·가상 공통 헬퍼) ──
  // 사진 없이 텍스트만으로도 생성 가능. 텍스트-only 모드일 때 얼굴 인증 불필요 안내 노출.
  const renderAppearanceInput = ({ value, onChange, file }) => (
    <div className="mymusic-character__appearance">
      <p className="mymusic-character__appearance-title">외모 설명 (선택)</p>
      <textarea
        className="mymusic-character__appearance-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="예: 얼굴이 동그랗고 긴 생머리인 20대 여자 아이돌"
        rows={3}
        maxLength={500}
      />
      {!file && value.trim() ? (
        <p className="mymusic-character__appearance-hint mymusic-character__appearance-hint--active">
          사진 없이 설명만으로 가상 인물을 만들어요 — 본인인증이 필요 없어요.
        </p>
      ) : (
        <p className="mymusic-character__appearance-hint">
          사진 없이 텍스트만으로도 생성할 수 있어요. (사진 없이 생성 시 얼굴 인증 불필요)
        </p>
      )}
    </div>
  );

  // ── 실사(real) 업로드 폼 ────────────────────────────────
  const renderRealForm = () => (
    <div className="mymusic-character__variant">
      <div className="mymusic-character__empty">
        <div className="mymusic-character__empty-icon"><FiUser /></div>
        <p className="mymusic-character__empty-text">
          사진을 업로드하거나 외모를 설명해 실사(photorealistic) AI 캐릭터 시트를 만들어보세요.
        </p>
        <p className="mymusic-character__empty-hint">
          실사(photorealistic) 스타일로 정면, 측면, 전신, 표정 변화 등 다양한 앵글의 캐릭터 시트가 생성됩니다.
        </p>

        <div className="mymusic-character__upload-area">
          <div
            className="mymusic-character__dropzone"
            onClick={handleRealPhotoTrigger}
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

        {/* v161 — 외모 텍스트 입력칸 (사진 없이도 생성 가능) */}
        {renderAppearanceInput({ value: userText, onChange: setUserText, file: photoFile })}

        {/* v137/v161 — 사진 확약 체크는 사진 첨부 시에만 노출 */}
        {photoFile && renderPortraitConfirm()}

        {renderItemSlots()}

        {/* 이미지 모델 선택 (가상화 탭과 동일, 기본 gpt_image_2) */}
        <div className="mymusic-character__model-row">
          <label className="mymusic-character__model-label">이미지 모델</label>
          <select
            className="mymusic-character__model-select"
            value={imageModel}
            onChange={(e) => setImageModel(e.target.value)}
          >
            <option value="gpt_image_2">gpt_image_2 (기본)</option>
            <option value="nb_pro">nb_pro</option>
          </select>
        </div>

        <button
          className="mymusic-character__generate-btn"
          onClick={handleGenerate}
          disabled={(!photoFile && !userText.trim()) || (!!photoFile && !portraitConfirmed) || generating}
          title={
            (!photoFile && !userText.trim())
              ? '얼굴 사진을 선택하거나 외모 설명을 입력해주세요'
              : (photoFile && !portraitConfirmed ? '사진 확약에 체크해야 생성할 수 있습니다' : undefined)
          }
        >
          {generating ? (
            <>
              <span className="mymusic-character__spinner" />
              캐릭터 시트 생성 중... ({formatElapsed(elapsedSec)})
            </>
          ) : (
            <>캐릭터 시트 생성하기 <span className="mymusic-character__cost-badge">⭐{characterCost}</span></>
          )}
        </button>
        {!photoFile && !userText.trim() && (
          <p className="mymusic-character__generate-guide">
            얼굴 사진 또는 외모 설명 중 하나를 입력하면 생성할 수 있어요.
          </p>
        )}
      </div>
    </div>
  );

  // ── 가상화(virtual) 저장본 표시 ─────────────────────────
  const renderVirtualSaved = () => {
    const handleSheetError = (e) => {
      if (e?.currentTarget) e.currentTarget.style.display = 'none';
    };
    const styleLabel =
      styleSamples.find((s) => s.key === character?.virtual_art_style)?.label ||
      (character?.virtual_art_style === 'custom' ? '직접 업로드' : character?.virtual_art_style);
    return (
      <div className="mymusic-character__variant">
        <div className="mymusic-character__sheet">
          {styleLabel && (
            <div className="mymusic-character__sheet-label">화풍: {styleLabel}</div>
          )}
          <img
            src={api.characterPreviewUrl(character.virtual_sheet_object_name)}
            alt="내 가상화 캐릭터 시트"
            className="mymusic-character__sheet-img"
            onError={handleSheetError}
          />
          <div className="mymusic-character__actions">
            <button
              className="mymusic-character__btn mymusic-character__btn--primary"
              onClick={handleRegenerateVirtual}
            >
              <FiRefreshCw /> 다시 만들기
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── 가상화(virtual) 미리보기(생성됨·미저장) 표시 ─────────
  const renderVirtualPreview = () => (
    <div className="mymusic-character__variant">
      <div className="mymusic-character__sheet">
        <div className="mymusic-character__sheet-label">생성된 가상화 캐릭터 시트 미리보기</div>
        <img
          src={vPreviewUrl}
          alt="가상화 캐릭터 시트 미리보기"
          className="mymusic-character__sheet-img"
        />
        <div className="mymusic-character__actions">
          <button
            className="mymusic-character__btn mymusic-character__btn--primary"
            onClick={handleSaveVirtual}
            disabled={vSaving}
          >
            {vSaving ? '저장 중...' : '저장하기'}
          </button>
          <button
            className="mymusic-character__btn"
            onClick={handleGenerateCartoon}
            disabled={vGenerating}
          >
            {vGenerating
              ? `생성 중... (${formatElapsed(vElapsedSec)})`
              : <>다시 생성 <span className="mymusic-character__cost-badge">⭐{characterCost}</span></>}
          </button>
          <button
            className="mymusic-character__btn"
            onClick={() => { setVPreviewUrl(null); setVPreviewObjectName(null); }}
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );

  // ── 가상화(virtual) 업로드 + 화풍 선택 폼 ────────────────
  const renderVirtualForm = () => (
    <div className="mymusic-character__variant">
      <div className="mymusic-character__empty">
        <div className="mymusic-character__empty-icon"><FiUser /></div>
        <p className="mymusic-character__empty-text">
          사진(또는 외모 설명)과 화풍을 선택해 그림/만화 스타일의 가상화 캐릭터 시트를 만들어보세요.
        </p>
        <p className="mymusic-character__empty-hint">
          실사 캐릭터와는 별도 슬롯에 저장됩니다. (실사 캐릭터는 그대로 유지)
        </p>

        {/* 1) 사진 업로드 */}
        <div className="mymusic-character__upload-area">
          <div
            className="mymusic-character__dropzone"
            onClick={() => vPhotoInputRef.current?.click()}
          >
            <div className="mymusic-character__dropzone-icon"><FiImage /></div>
            <div className="mymusic-character__dropzone-text">
              <strong>클릭</strong>하여 얼굴 사진을 선택하세요
            </div>
            <div className="mymusic-character__dropzone-hint">JPG, PNG, WebP (10MB 이하)</div>
          </div>
          <input
            ref={vPhotoInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp"
            style={{ display: 'none' }}
            onChange={(e) => setVPhotoFile(e.target.files[0] || null)}
          />
          {vPhotoFile && (
            <div className="mymusic-character__file-info">
              <FiImage />
              <span className="mymusic-character__file-name">{vPhotoFile.name}</span>
              <button
                className="mymusic-character__file-remove"
                onClick={() => setVPhotoFile(null)}
              >
                <FiTrash2 />
              </button>
            </div>
          )}
        </div>

        {/* v161 — 외모 텍스트 입력칸 (사진 없이도 생성 가능) */}
        {renderAppearanceInput({ value: vUserText, onChange: setVUserText, file: vPhotoFile })}

        {/* v137/v161 — 사진 확약 체크는 사진 첨부 시에만 노출 */}
        {vPhotoFile && renderPortraitConfirm()}

        {/* 2) 화풍 선택 (샘플 갤러리) */}
        <p className="mymusic-character__style-title">화풍 선택</p>
        {stylesLoading ? (
          <div className="mymusic-loading">화풍 샘플 로딩 중...</div>
        ) : (
          <div className="mymusic-character__style-gallery">
            {styleSamples.map((sample) => (
              <button
                key={sample.key}
                type="button"
                className={
                  'mymusic-character__style-card' +
                  (selectedStyleKey === sample.key ? ' mymusic-character__style-card--active' : '')
                }
                onClick={() => handleSelectStyle(sample.key)}
              >
                <img
                  src={api.styleSamplePreviewUrl(sample.key)}
                  alt={sample.label || sample.key}
                  className="mymusic-character__style-thumb"
                  onError={(e) => { if (e?.currentTarget) e.currentTarget.style.visibility = 'hidden'; }}
                />
                <span className="mymusic-character__style-label">{sample.label || sample.key}</span>
              </button>
            ))}
          </div>
        )}

        {/* 3) 직접 화풍 업로드 */}
        <div className="mymusic-character__style-custom">
          <button
            type="button"
            className={
              'mymusic-character__btn' +
              (customStyleFile ? ' mymusic-character__btn--primary' : '')
            }
            onClick={() => styleInputRef.current?.click()}
          >
            <FiImage /> 원하는 화풍이 없어요 → 직접 업로드
          </button>
          <input
            ref={styleInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp"
            style={{ display: 'none' }}
            onChange={(e) => handleCustomStyleChange(e.target.files[0] || null)}
          />
          {customStyleFile && (
            <div className="mymusic-character__file-info">
              <FiImage />
              <span className="mymusic-character__file-name">{customStyleFile.name}</span>
              <button
                className="mymusic-character__file-remove"
                onClick={() => handleCustomStyleChange(null)}
              >
                <FiTrash2 />
              </button>
            </div>
          )}
        </div>

        {/* 4) 이미지 모델 선택 */}
        <div className="mymusic-character__model-row">
          <label className="mymusic-character__model-label">이미지 모델</label>
          <select
            className="mymusic-character__model-select"
            value={imageModel}
            onChange={(e) => setImageModel(e.target.value)}
          >
            <option value="gpt_image_2">gpt_image_2 (기본)</option>
            <option value="nb_pro">nb_pro</option>
          </select>
        </div>

        {renderItemSlots()}

        <button
          className="mymusic-character__generate-btn"
          onClick={handleGenerateCartoon}
          disabled={
            (!vPhotoFile && !vUserText.trim())
            || (!selectedStyleKey && !customStyleFile)
            || (!!vPhotoFile && !portraitConfirmed)
            || vGenerating
          }
          title={
            (!vPhotoFile && !vUserText.trim())
              ? '얼굴 사진을 선택하거나 외모 설명을 입력해주세요'
              : (vPhotoFile && !portraitConfirmed ? '사진 확약에 체크해야 생성할 수 있습니다' : undefined)
          }
        >
          {vGenerating ? (
            <>
              <span className="mymusic-character__spinner" />
              가상화 캐릭터 시트 생성 중... ({formatElapsed(vElapsedSec)})
            </>
          ) : (
            <>가상화 캐릭터 시트 생성하기 <span className="mymusic-character__cost-badge">⭐{characterCost}</span></>
          )}
        </button>
        {!vPhotoFile && !vUserText.trim() && (
          <p className="mymusic-character__generate-guide">
            얼굴 사진 또는 외모 설명 중 하나를 입력하면 생성할 수 있어요.
          </p>
        )}
      </div>
    </div>
  );

  const renderReal = () => {
    if (previewUrl) return renderRealPreview();
    if (hasReal && !realFormOpen) return renderRealSaved();
    return renderRealForm();
  };

  const renderVirtual = () => {
    if (vPreviewUrl) return renderVirtualPreview();
    if (hasVirtual && !vFormOpen) return renderVirtualSaved();
    return renderVirtualForm();
  };

  return (
    <div className="mymusic-character">
      <div className="mymusic-character__mode-tabs">
        <button
          type="button"
          className={
            'mymusic-character__mode-tab' +
            (mode === 'real' ? ' mymusic-character__mode-tab--active' : '')
          }
          onClick={() => setMode('real')}
        >
          실사화 캐릭터
        </button>
        <button
          type="button"
          className={
            'mymusic-character__mode-tab' +
            (mode === 'virtual' ? ' mymusic-character__mode-tab--active' : '')
          }
          onClick={() => setMode('virtual')}
        >
          가상화(그림) 캐릭터
        </button>
      </div>
      {mode === 'real' ? renderReal() : renderVirtual()}

      {itemModalCategory && (
        <ItemSelectModal
          category={itemModalCategory}
          onSelect={handleItemPicked}
          onClose={() => setItemModalCategory(null)}
        />
      )}

      {/* v125 — photo_ai 동의 게이트: 동의 시 파일 선택 진행, 취소 시 중단 */}
      {photoGateOpen && (
        <ConsentGateModal
          consentKey="photo_ai"
          onAgree={() => {
            setPhotoGateOpen(false);
            photoInputRef.current?.click();
          }}
          onClose={() => setPhotoGateOpen(false)}
        />
      )}

      {/* v135 — 얼굴 인증(생체 대조) 플로우: flag ON + 실사화 생성 시에만 열림.
          검증 통과 시 원래 생성(submitRealGeneration) 재개, 닫기 시 생성 중단.
          cartoon(가상) 경로는 게이트 대상 아님. */}
      {faceFlowOpen && (
        <FaceVerifyFlow
          photoFile={photoFile}
          onVerified={() => {
            setFaceFlowOpen(false);
            submitRealGeneration();
          }}
          onClose={() => setFaceFlowOpen(false)}
        />
      )}
    </div>
  );
}

function MyAlbumsSection() {
  const navigate = useNavigate();
  const [albums, setAlbums] = useState([]);
  const [loading, setLoading] = useState(false);
  const [myTracks, setMyTracks] = useState([]);
  const [modalMode, setModalMode] = useState(null); // 'create' | 'edit' | null
  const [editingAlbum, setEditingAlbum] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const fetchAlbums = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.getMyAlbums({ limit: 100 });
      const list = Array.isArray(data) ? data : data.albums || [];
      setAlbums(list);
      console.info(`[MyAlbumsTab] action=fetch album_count=${list.length}`);
    } catch (err) {
      console.warn('[MyAlbumsTab] fetch failed', { status: err.response?.status });
      setAlbums([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMyTracksForModal = useCallback(async () => {
    try {
      const { data } = await api.getMyTracks({ page: 1, limit: 200, sort: 'created_at' });
      setMyTracks(data.tracks || data.items || []);
    } catch (err) {
      console.warn('[MyAlbumsTab] tracks fetch failed', { status: err.response?.status });
      setMyTracks([]);
    }
  }, []);

  useEffect(() => {
    fetchAlbums();
  }, [fetchAlbums]);

  const openCreate = async () => {
    await fetchMyTracksForModal();
    setEditingAlbum(null);
    setModalMode('create');
    console.info('[MyAlbumsTab] action=open_create');
  };

  const openEdit = async (album) => {
    await fetchMyTracksForModal();
    // 상세를 한 번 더 받아 tracks 를 채움
    try {
      const { data } = await api.getAlbum(album.id);
      setEditingAlbum(data);
    } catch {
      setEditingAlbum(album);
    }
    setModalMode('edit');
    console.info(`[MyAlbumsTab] action=open_edit album_id=${album.id}`);
  };

  const handleDelete = async (album) => {
    if (!window.confirm(`"${album.title}" 앨범을 삭제하시겠습니까?`)) return;
    setDeletingId(album.id);
    try {
      await api.deleteAlbum(album.id);
      setAlbums((prev) => prev.filter((a) => a.id !== album.id));
      console.info(`[MyAlbumsTab] action=delete album_id=${album.id}`);
    } catch (err) {
      console.warn('[MyAlbumsTab] delete failed', { album_id: album.id, status: err.response?.status });
      alert(err.response?.data?.error || '삭제에 실패했습니다.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleSaved = () => {
    fetchAlbums();
  };

  return (
    <div className="mymusic-albums">
      <div className="mymusic-albums__toolbar">
        <button className="mymusic-albums__create-btn" onClick={openCreate}>
          <FiPlus /> 앨범 생성
        </button>
      </div>

      {loading ? (
        <div className="mymusic-loading">로딩 중...</div>
      ) : albums.length === 0 ? (
        <div className="mymusic-empty">
          <div className="mymusic-empty__icon"><FiDisc /></div>
          <p className="mymusic-empty__text">아직 만든 앨범이 없습니다.</p>
          <button className="mymusic-empty__btn" onClick={openCreate}>
            <FiPlus /> 첫 앨범 만들기
          </button>
        </div>
      ) : (
        <div className="mymusic-album-grid">
          {albums.map((album) => (
            <div key={album.id} className="mymusic-album-card">
              <div
                className="mymusic-album-card__cover"
                onClick={() => navigate(`/album/${album.id}`)}
                role="button"
                tabIndex={0}
              >
                {album.cover_image ? (
                  <img src={album.cover_image} alt="" />
                ) : (
                  <span>♪</span>
                )}
              </div>
              <div className="mymusic-album-card__title" title={album.title}>
                {album.title}
              </div>
              <div className="mymusic-album-card__meta">
                {album.track_count ?? album.tracks?.length ?? 0}곡
                {album.is_public === false && <span className="mymusic-album-card__badge">비공개</span>}
              </div>
              <div className="mymusic-album-card__actions">
                <button onClick={() => openEdit(album)} title="수정">
                  <FiEdit2 /> 수정
                </button>
                <button
                  onClick={() => handleDelete(album)}
                  disabled={deletingId === album.id}
                  title="삭제"
                >
                  <FiTrash2 /> {deletingId === album.id ? '삭제 중...' : '삭제'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalMode && (
        <AlbumCreateModal
          mode={modalMode}
          album={editingAlbum}
          myTracks={myTracks}
          onClose={() => {
            setModalMode(null);
            setEditingAlbum(null);
          }}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

export default function MyMusicPage() {
  const { user } = useAuth();
  const { play, currentSong, isPlaying, togglePlay } = usePlayer();
  const navigate = useNavigate();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState('tracks');
  const [generationPrefill, setGenerationPrefill] = useState(null);
  const [draftData, setDraftData] = useState(null);

  // location.state 수신 → 탭 전환 후 history state clear (중복 소비 방지)
  useEffect(() => {
    const st = location.state;
    if (!st) return;
    if (st.tab) setActiveTab(st.tab);
    navigate(location.pathname, { replace: true, state: null });
  }, [location, navigate]);

  const handleSendToUpload = (genData) => {
    setGenerationPrefill(genData);
    setActiveTab('upload');
  };

  // v209 — 작사실 [작곡하기 →] 인계 (handleSendToUpload 동형 패턴)
  const [composePrefill, setComposePrefill] = useState(null);
  const handleSendToCompose = (draftDoc) => {
    if (import.meta.env.DEV) console.info('[MyMusic] sendToCompose', { id: draftDoc?.id });
    setComposePrefill(draftDoc);
    setActiveTab('compose');
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
        // v209 픽스: track 소스 MV 드래프트 복원 관통 (GET /mv/jobs/{id} 응답 필드 계약)
        audio_track_id: data.audio_track_id || null,
      });
      // v209 3단계: MV 임시저장 [불러오기] 타겟을 새 업로드 → MV촬영실로 리타겟
      setActiveTab('mvstudio');
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
  // v139 — 소명: blinded 트랙 ↔ my-affected 매칭 맵({ [trackId]: item }) + 소명 모달 대상 트랙
  const [affectedMap, setAffectedMap] = useState({});
  const [appealTrackId, setAppealTrackId] = useState(null);
  // v207 — 커버 수정 모달 대상 트랙
  const [coverEditTrack, setCoverEditTrack] = useState(null);

  // v139 — blinded 트랙이 있을 때만 my-affected 조회 (has_appeal 로 버튼 상태 결정)
  useEffect(() => {
    if (!tracks.some((t) => t.report_blinded)) return undefined;
    let alive = true;
    api.getMyAffectedReports()
      .then(({ data }) => {
        if (!alive) return;
        const map = {};
        (Array.isArray(data?.reports) ? data.reports : (Array.isArray(data?.items) ? data.items : [])).forEach((it) => {
          if (it.target_type === 'track' && it.target_id != null) {
            map[String(it.target_id)] = it;
          }
        });
        setAffectedMap(map);
        if (import.meta.env.DEV) {
          console.info('[AppealModal] my-affected track map loaded', {
            count: Object.keys(map).length,
          });
        }
      })
      .catch((err) => {
        console.error('[AppealModal] my-affected load failed', {
          status: err?.response?.status,
        });
      });
    return () => { alive = false; };
  }, [tracks]);

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
    play(song);
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
            className={`mymusic-tab ${activeTab === 'myalbums' ? 'mymusic-tab--active' : ''}`}
            onClick={() => setActiveTab('myalbums')}
          >
            내 앨범
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
          {/* v209: 'studio2' 키 유지(외부 location.state {tab:'studio2'} 호환) — 라벨·렌더만 작사실로 */}
          <button
            className={`mymusic-tab ${activeTab === 'studio2' ? 'mymusic-tab--active' : ''}`}
            onClick={() => setActiveTab('studio2')}
          >
            작사실
          </button>
          <button
            className={`mymusic-tab ${activeTab === 'compose' ? 'mymusic-tab--active' : ''}`}
            onClick={() => setActiveTab('compose')}
          >
            작곡실
          </button>
          <button
            className={`mymusic-tab ${activeTab === 'mvstudio' ? 'mymusic-tab--active' : ''}`}
            onClick={() => setActiveTab('mvstudio')}
          >
            MV촬영실
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
                        {/* v137 — 신고 처리 블라인드 표시 (report_blinded 필드 없으면 미표시) */}
                        {track.report_blinded && (
                          <span className="mymusic-track-card__blinded">
                            🚫 신고 처리로 비공개되었습니다
                          </span>
                        )}
                        {/* v139 — 소명하기 (제출됨이면 비활성) */}
                        {track.report_blinded && (
                          affectedMap[String(track.id)]?.has_appeal ? (
                            <button className="mymusic-track-card__appeal-btn" disabled>
                              소명 제출됨
                            </button>
                          ) : (
                            <button
                              className="mymusic-track-card__appeal-btn"
                              onClick={() => setAppealTrackId(track.id)}
                            >
                              소명하기
                            </button>
                          )
                        )}
                        <TrackShareButton track={{ id: track.id, title: track.title }} size={14} />
                        {/* v207 — 커버 수정 (공유·삭제 사이) */}
                        <button
                          className="mymusic-track-card__cover-btn"
                          onClick={() => setCoverEditTrack(track)}
                          title="커버 수정"
                        >
                          <FiImage /> 커버 수정
                        </button>
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

        {/* Tab: My Albums */}
        {activeTab === 'myalbums' && (
          <MyAlbumsSection />
        )}

        {/* Tab 2: Upload */}
        {activeTab === 'upload' && (
          <div className="mymusic-upload-tab">
            {/* v209 3단계: draftData(MV 임시저장)는 MV촬영실 소관으로 이동 — UploadPage prop 소멸 */}
            <UploadPage
              generationPrefill={generationPrefill}
              onClearPrefill={() => setGenerationPrefill(null)}
            />
          </div>
        )}

        {/* Tab 3: Studio */}
        {activeTab === 'studio' && (
          <StudioTab />
        )}

        {/* Tab 4: Studio2 */}
        {activeTab === 'studio2' && (
          <LyricsStudioTab onSendToCompose={handleSendToCompose} />
        )}

        {activeTab === 'compose' && (
          <ComposeStudioTab
            onSendToUpload={handleSendToUpload}
            prefillDraft={composePrefill}
            onClearPrefill={() => setComposePrefill(null)}
          />
        )}

        {activeTab === 'mvstudio' && (
          <MVStudioTab
            draftData={draftData}
            onClearDraft={() => setDraftData(null)}
          />
        )}

        {/* Tab 6: Character */}
        {activeTab === 'character' && (
          <>
            <CharacterSection />
            <MyVoiceCloneSection />
          </>
        )}

        {/* Tab 7: Drafts */}
        {activeTab === 'drafts' && (
          <DraftsSection onLoadDraft={handleLoadDraft} />
        )}

        {/* v207 — 커버 수정 모달 (내 트랙 진입점) */}
        {coverEditTrack && (
          <CoverEditModal
            track={coverEditTrack}
            onClose={() => setCoverEditTrack(null)}
            onUpdated={(newCoverUrl) => {
              setTracks((prev) => prev.map((t) => (
                t.id === coverEditTrack.id ? { ...t, cover_image_url: newCoverUrl } : t
              )));
            }}
          />
        )}

        {/* v139 — 소명 제출 모달 (blinded 트랙) */}
        {appealTrackId && (
          <AppealModal
            targetType="track"
            targetId={appealTrackId}
            onClose={() => setAppealTrackId(null)}
            onSubmitted={() => {
              const key = String(appealTrackId);
              setAffectedMap((m) => ({
                ...m,
                [key]: { ...(m[key] || {}), has_appeal: true },
              }));
            }}
          />
        )}
      </div>
    </div>
  );
}
