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
import CoverStudioTab from '../components/studio/CoverStudioTab';
import AlbumCreateModal from '../components/AlbumCreateModal';
import ItemSelectModal from '../components/ItemSelectModal';
import MyVoiceCloneSection from '../components/MyVoiceCloneSection';
import ConsentGateModal from '../components/ConsentGateModal';
import FaceVerifyFlow from '../components/FaceVerifyFlow';
import TrackShareButton from '../components/TrackShareButton';
import AppealModal from '../components/AppealModal';
import CoverEditModal from '../components/CoverEditModal';
import { loadArtists } from '../components/ArtistPicker';
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
  // v212 — 아티스트 다중화: 카드 목록 + 슬롯 바 + 생성 뷰 상태
  const [artists, setArtists] = useState([]);
  const [slots, setSlots] = useState(null); // {used,max} — list API 응답 (legacy 폴백이면 null)
  const [artistsSource, setArtistsSource] = useState('legacy'); // 'list' | 'legacy'
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('list'); // 'list' | 'create'
  const [createKind, setCreateKind] = useState(null); // null=종류 선택 | 'real' | 'virtual'
  const [regenArtist, setRegenArtist] = useState(null); // [다시 만들기] 대상 — 재생성 character_id 배선
  const [editArtist, setEditArtist] = useState(null); // [프로필 수정] 대상
  // v212 F2 — 프로필 입력 폼 (생성 저장 동봉 + 기존 카드 수정 공용) — 입력 배선 유실 복원
  const [pName, setPName] = useState('');
  const [pAge, setPAge] = useState('');
  const [pGender, setPGender] = useState('');
  const [pTags, setPTags] = useState([]);
  const [pText, setPText] = useState('');
  const [pTagInput, setPTagInput] = useState('');
  const [availableTags, setAvailableTags] = useState([]);
  const [profileSaving, setProfileSaving] = useState(false);
  const [slotBuying, setSlotBuying] = useState(false);
  // v213 F1 — 아티스트↔목소리 연결: ready 보이스클론 목록 + 카드별 드롭다운/진행 상태
  const [readyClones, setReadyClones] = useState([]);
  const [voiceMenuFor, setVoiceMenuFor] = useState(null); // 드롭다운 열린 카드 key(cid)
  const [voiceLinking, setVoiceLinking] = useState(null); // PATCH 진행 중 카드 key(cid)

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

  // v212 — 아티스트 목록 로드 (list API + slots 우선, legacy 단건 폴백 — loadArtists 공용)
  const fetchArtists = useCallback(async () => {
    try {
      const { artists: list, slots: s, source } = await loadArtists();
      setArtists(list);
      setSlots(s);
      setArtistsSource(source);
      if (import.meta.env.DEV) {
        console.debug('[CharacterSection] artists loaded', { count: list.length, source, slots: s });
      }
    } catch (err) {
      console.error('[CharacterSection] artists load failed', { status: err?.response?.status, message: err?.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchArtists(); }, [fetchArtists]);

  // v212 F2 — 성격 태그 고정 목록 (칩 선택식). F1(getPersonalityTags 래퍼) 배선 전엔 직접 입력만 동작.
  useEffect(() => {
    if (typeof api.getPersonalityTags !== 'function') {
      if (import.meta.env.DEV) console.debug('[CharacterSection] getPersonalityTags not wired yet');
      return;
    }
    api.getPersonalityTags()
      .then(({ data }) => setAvailableTags(Array.isArray(data?.tags) ? data.tags : []))
      .catch((err) => {
        console.error('[CharacterSection] personality tags load failed', { status: err?.response?.status });
      });
  }, []);

  // v213 F1 — 내 보이스클론 로드 (연결 후보 = status ready && voice_id 보유 — ComposeStudioTab 필터 관행)
  useEffect(() => {
    api.getVoiceClones()
      .then(({ data }) => {
        const ready = (data?.clones || data?.items || []).filter(
          (c) => c?.status === 'ready' && c?.voice_id,
        );
        setReadyClones(ready);
        if (import.meta.env.DEV) console.debug('[CharacterSection] ready clones loaded', { count: ready.length });
      })
      .catch((err) => {
        console.error('[CharacterSection] getVoiceClones failed', { status: err?.response?.status, message: err?.message });
      });
  }, []);

  // v213 F1 — 목소리 연결/해제 (PATCH persona_id: clone_id 저장, "" = 해제 — V2 규약. ready 검증은 서버 400)
  const handleLinkVoice = async (artist, cloneId) => {
    if (!artist?.character_id || typeof api.patchCharacter !== 'function') {
      alert('목소리 연결은 아티스트 마이그레이션 후 사용할 수 있어요.');
      return;
    }
    setVoiceLinking(artist.character_id);
    try {
      await api.patchCharacter(artist.character_id, { persona_id: cloneId });
      if (import.meta.env.DEV) console.debug('[CharacterSection] voice linked', { cid: artist.character_id, clone_id: cloneId });
      setVoiceMenuFor(null);
      await fetchArtists(); // patchCharacter 가 캐시 무효화 → 재조회로 파생 필드(persona_name 등) 반영
    } catch (err) {
      console.error('[CharacterSection] voice link failed', { cid: artist.character_id, status: err?.response?.status });
      alert(err.response?.data?.error || '목소리 연결에 실패했습니다.');
    } finally {
      setVoiceLinking(null);
    }
  };

  const handleUnlinkVoice = async (artist) => {
    if (!artist?.character_id || typeof api.patchCharacter !== 'function') {
      alert('목소리 연결은 아티스트 마이그레이션 후 사용할 수 있어요.');
      return;
    }
    if (!window.confirm('이 아티스트의 목소리 연결을 해제할까요?')) return;
    setVoiceLinking(artist.character_id);
    try {
      await api.patchCharacter(artist.character_id, { persona_id: '' });
      if (import.meta.env.DEV) console.debug('[CharacterSection] voice unlinked', { cid: artist.character_id });
      await fetchArtists();
    } catch (err) {
      console.error('[CharacterSection] voice unlink failed', { cid: artist.character_id, status: err?.response?.status });
      alert(err.response?.data?.error || '연결 해제에 실패했습니다.');
    } finally {
      setVoiceLinking(null);
    }
  };

  // 가상화 생성 진입 시 화풍 샘플 1회 로드 (v212: mode → createKind)
  useEffect(() => {
    if (createKind !== 'virtual' || styleSamples.length > 0 || stylesLoading) return;
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
  }, [createKind, styleSamples.length, stylesLoading]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.info('[MyMusic][CharacterSection]', {
        count: artists.length,
        source: artistsSource,
        used: slots?.used ?? artists.length,
        max: slots?.max ?? null,
      });
    }
  }, [artists, artistsSource, slots]);

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
      // v212 D4 — 재생성이면 대상 아티스트 character_id 첨부 (슬롯 검사 없음), 신규면 미첨부(서버 슬롯 검사)
      if (regenArtist?.character_id) formData.append('character_id', regenArtist.character_id);
      appendItemObjectNames(formData);
      if (import.meta.env.DEV) {
        console.info('[MyMusicPage] generate', {
          mode: 'real',
          regen_character_id: regenArtist?.character_id || null,
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
      // v212 — 슬롯 만석 409 (⭐ 차감 전 거절 — D4)
      if (err.response?.status === 409 && err.response?.data?.error === 'slot_limit_exceeded') {
        alert(err.response.data.message || '아티스트 슬롯이 가득 찼습니다. ⭐15로 슬롯을 추가하세요.');
        return;
      }
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

  // v212 F2 — 프로필 폼 → save/PATCH 페이로드 (검증 상수는 입력단 maxLength 로 1차 방어)
  const buildProfilePayload = () => ({
    name: pName.trim(),
    age: pAge.trim(),
    gender: pGender.trim(),
    personality_tags: pTags,
    personality_text: pText.trim(),
  });

  const resetProfileForm = (artist = null) => {
    setPName(artist?.name || '');
    setPAge(artist?.age || '');
    setPGender(artist?.gender || '');
    setPTags(Array.isArray(artist?.personality_tags) ? artist.personality_tags.filter(Boolean) : []);
    setPText(artist?.personality_text || '');
    setPTagInput('');
  };

  const toggleProfileTag = (tag) => {
    setPTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : (prev.length >= 20 ? prev : [...prev, tag])));
  };

  // 생성 플로우 종료 공통 (목록 복귀 + 상태 초기화)
  const finishCreateFlow = () => {
    setView('list');
    setCreateKind(null);
    setRegenArtist(null);
    resetProfileForm(null);
    setPortraitConfirmed(false);
  };

  const handleSave = async () => {
    if (!previewObjectName) return;
    setSaving(true);
    try {
      // v212 D4: 재생성 = character_id 지정(① 시트 교체+프로필 갱신) / 신규 = kind 지정(② 슬롯 검사+cid 발급)
      await api.saveCharacter({
        sheet_object_name: previewObjectName,
        used_items: buildUsedItems(),
        ...buildProfilePayload(),
        ...(regenArtist?.character_id
          ? { character_id: regenArtist.character_id }
          : { kind: 'real' }),
      });
      await fetchArtists();
      setPreviewUrl(null);
      setPreviewObjectName(null);
      setPhotoFile(null);
      setRealFormOpen(false);
      finishCreateFlow();
    } catch (err) {
      if (err.response?.status === 409 && err.response?.data?.error === 'slot_limit_exceeded') {
        alert(err.response.data.message || '아티스트 슬롯이 가득 찼습니다. ⭐15로 슬롯을 추가하세요.');
        return;
      }
      alert(err.response?.data?.error || '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  // v212 — 카드 개별 삭제. legacy 합성 카드(cid 없음)는 구 DELETE /me(전체 삭제)라 경고 문구 구분.
  const handleDeleteArtist = async (artist) => {
    const cid = artist?.character_id;
    const canIndividual = !!cid && typeof api.deleteCharacter === 'function';
    const msg = canIndividual
      ? `아티스트 「${artist?.name || (artist?.kind === 'virtual' ? '가상 아티스트' : '실사 아티스트')}」를 삭제하시겠습니까?`
      : '이 계정의 캐릭터 전체가 삭제됩니다(구 버전 데이터). 계속하시겠습니까?';
    if (!window.confirm(msg)) return;
    try {
      if (canIndividual) {
        await api.deleteCharacter(cid);
        if (import.meta.env.DEV) console.debug('[CharacterSection] artist deleted', { cid });
      } else {
        await api.deleteMyCharacter();
      }
      await fetchArtists();
    } catch (err) {
      console.error('[CharacterSection] delete failed', { cid, status: err?.response?.status });
      alert(err.response?.data?.error || '삭제에 실패했습니다.');
    }
  };

  // v212 — 기본(⭐) 지정: PATCH is_default (cid 필요 — legacy 카드는 마이그레이션 전이라 미지원)
  const handleSetDefault = async (artist) => {
    if (!artist?.character_id || typeof api.patchCharacter !== 'function') {
      alert('기본 지정은 아티스트 마이그레이션 후 사용할 수 있어요.');
      return;
    }
    try {
      await api.patchCharacter(artist.character_id, { is_default: true });
      if (import.meta.env.DEV) console.debug('[CharacterSection] set default', { cid: artist.character_id });
      await fetchArtists();
    } catch (err) {
      alert(err.response?.data?.error || '기본 지정에 실패했습니다.');
    }
  };

  // v212 — 프로필 수정 저장: cid → PATCH / legacy → 기존 시트 재저장으로 프로필만 갱신(구계약 ③)
  const handleProfileEditSave = async () => {
    if (!editArtist) return;
    setProfileSaving(true);
    try {
      if (editArtist.character_id && typeof api.patchCharacter === 'function') {
        await api.patchCharacter(editArtist.character_id, buildProfilePayload());
      } else {
        await api.saveCharacter({
          sheet_object_name: editArtist.sheet_object_name,
          used_items: Array.isArray(editArtist.used_items) ? editArtist.used_items : [],
          ...(editArtist.kind === 'virtual'
            ? { variant: 'virtual', art_style: editArtist.art_style || undefined }
            : {}),
          ...buildProfilePayload(),
        });
      }
      if (import.meta.env.DEV) console.debug('[CharacterSection] profile saved', { cid: editArtist.character_id || null });
      setEditArtist(null);
      resetProfileForm(null);
      await fetchArtists();
    } catch (err) {
      console.error('[CharacterSection] profile save failed', { status: err?.response?.status });
      alert(err.response?.data?.error || '프로필 저장에 실패했습니다.');
    } finally {
      setProfileSaving(false);
    }
  };

  // v212 — 슬롯 추가 구매 (⭐15 — POINT_COSTS.extra_slot, 402 분기)
  const handleBuySlot = async () => {
    if (typeof api.spendPoints !== 'function') {
      alert('슬롯 추가 기능 준비 중입니다.');
      return;
    }
    if (!window.confirm('⭐15를 사용해 아티스트 슬롯을 1개 추가할까요?')) return;
    setSlotBuying(true);
    try {
      const { data } = await api.spendPoints('extra_slot');
      api.notifyPointsRefresh();
      if (import.meta.env.DEV) console.debug('[CharacterSection] slot purchased', { max_slots: data?.max_slots });
      if (typeof data?.max_slots === 'number') {
        setSlots((prev) => ({ used: prev?.used ?? artists.length, max: data.max_slots }));
      }
      await fetchArtists();
    } catch (err) {
      if (api.isInsufficientPoints(err)) {
        api.notifyPointsRefresh();
        alert('별이 부족해요. 슬롯 추가에는 ⭐15개가 필요합니다.');
      } else {
        console.error('[CharacterSection] slot purchase failed', { status: err?.response?.status });
        alert(err.response?.data?.error || '슬롯 추가에 실패했습니다.');
      }
    } finally {
      setSlotBuying(false);
    }
  };

  // v212 — 새 아티스트 시작 / 재생성 시작
  const startCreate = (kind, regenTarget = null) => {
    setView('create');
    setCreateKind(kind);
    setRegenArtist(regenTarget);
    resetProfileForm(regenTarget);
    setPreviewUrl(null); setPreviewObjectName(null); setPhotoFile(null);
    setVPreviewUrl(null); setVPreviewObjectName(null); setVPhotoFile(null);
    setSelectedStyleKey(null); setCustomStyleFile(null);
    if (import.meta.env.DEV) console.debug('[CharacterSection] start create', { kind, regen: regenTarget?.character_id || null });
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
      // v212 D4 — 재생성이면 대상 아티스트 character_id 첨부
      if (regenArtist?.character_id) formData.append('character_id', regenArtist.character_id);
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
      // v212 — 슬롯 만석 409 (⭐ 차감 전 거절 — D4)
      if (err.response?.status === 409 && err.response?.data?.error === 'slot_limit_exceeded') {
        alert(err.response.data.message || '아티스트 슬롯이 가득 찼습니다. ⭐15로 슬롯을 추가하세요.');
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
      // v212 D4: 재생성 = character_id(① 시트 교체) / 신규 = kind 지정(② 슬롯 검사).
      // variant 명시 전달 제거 — 래퍼가 legacy 폴백(cid/kind 미지정)에만 주입하는 계약.
      await api.saveCharacter({
        sheet_object_name: vPreviewObjectName,
        art_style: vArtStyle,
        used_items: buildUsedItems(),
        ...buildProfilePayload(),
        ...(regenArtist?.character_id
          ? { character_id: regenArtist.character_id }
          : { kind: 'virtual' }),
      });
      await fetchArtists();
      setVPreviewUrl(null);
      setVPreviewObjectName(null);
      setVPhotoFile(null);
      setSelectedStyleKey(null);
      setCustomStyleFile(null);
      setVFormOpen(false);
      finishCreateFlow();
    } catch (err) {
      console.error('[MyMusicPage] virtual save failed', err);
      if (err.response?.status === 409 && err.response?.data?.error === 'slot_limit_exceeded') {
        alert(err.response.data.message || '아티스트 슬롯이 가득 찼습니다. ⭐15로 슬롯을 추가하세요.');
        return;
      }
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
        {/* v212 F2 — 프로필 입력(저장 시 함께 저장됨) */}
        {renderProfileForm()}
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
        {/* v212 F2 — 프로필 입력(저장 시 함께 저장됨) */}
        {renderProfileForm()}
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

  // ── v212 F2 — 프로필 입력 폼 (생성 저장 동봉 + 수정 패널 공용) ──
  const renderProfileForm = () => (
    <div className="mymusic-character__profile-form" style={{ textAlign: 'left', margin: '12px 0', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <p className="mymusic-character__style-title">아티스트 프로필</p>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <input
          type="text"
          value={pName}
          onChange={(e) => setPName(e.target.value)}
          placeholder="이름"
          maxLength={50}
          style={{ flex: '2 1 160px', padding: '8px 10px', borderRadius: '8px', border: '1px solid #333', background: '#1a1a1a', color: '#ddd', fontSize: '13px' }}
        />
        <input
          type="text"
          value={pAge}
          onChange={(e) => setPAge(e.target.value)}
          placeholder="나이 (예: 22)"
          maxLength={30}
          style={{ flex: '1 1 90px', padding: '8px 10px', borderRadius: '8px', border: '1px solid #333', background: '#1a1a1a', color: '#ddd', fontSize: '13px' }}
        />
        <input
          type="text"
          value={pGender}
          onChange={(e) => setPGender(e.target.value)}
          placeholder="성별 (예: 여성)"
          maxLength={20}
          style={{ flex: '1 1 90px', padding: '8px 10px', borderRadius: '8px', border: '1px solid #333', background: '#1a1a1a', color: '#ddd', fontSize: '13px' }}
        />
      </div>
      <div>
        <p style={{ fontSize: '12px', color: '#888', margin: '0 0 6px' }}>성격 태그 (최대 20개)</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {pTags.map((tag) => (
            <button
              key={`sel-${tag}`}
              type="button"
              className="mymusic-character__chip"
              style={{ cursor: 'pointer', border: '1px solid #7C3AED' }}
              onClick={() => toggleProfileTag(tag)}
            >
              {tag} ×
            </button>
          ))}
          {availableTags.filter((t) => !pTags.includes(t)).map((tag) => (
            <button
              key={`av-${tag}`}
              type="button"
              className="mymusic-character__chip"
              style={{ cursor: 'pointer', opacity: 0.75 }}
              onClick={() => toggleProfileTag(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={pTagInput}
          onChange={(e) => setPTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && pTagInput.trim()) {
              e.preventDefault();
              const tag = pTagInput.trim().slice(0, 20);
              if (!pTags.includes(tag)) toggleProfileTag(tag);
              setPTagInput('');
            }
          }}
          placeholder="직접 입력 후 Enter (20자 이내)"
          maxLength={20}
          style={{ marginTop: '6px', width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #333', background: '#1a1a1a', color: '#ddd', fontSize: '13px', boxSizing: 'border-box' }}
        />
      </div>
      <textarea
        value={pText}
        onChange={(e) => setPText(e.target.value)}
        placeholder="성격 설명 (선택, 500자 이내)"
        rows={3}
        maxLength={500}
        style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #333', background: '#1a1a1a', color: '#ddd', fontSize: '13px', resize: 'vertical', boxSizing: 'border-box' }}
      />
    </div>
  );

  // ── v212 — 슬롯 바 (list 소스일 때만 used/max 표시 — legacy 는 마이그레이션 전 안내) ──
  const renderSlotBar = () => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', padding: '10px 12px', border: '1px solid #333', borderRadius: '10px', background: '#1a1a1a', marginBottom: '14px' }}>
      <span style={{ fontSize: '13px', color: '#ddd' }}>
        🎤 아티스트 슬롯{' '}
        {slots
          ? <strong>{slots.used} / {slots.max}</strong>
          : <span style={{ color: '#888', fontSize: '12px' }}>{artists.length}명 (슬롯 정보는 마이그레이션 후 표시)</span>}
      </span>
      <button
        type="button"
        className="mymusic-character__btn"
        onClick={handleBuySlot}
        disabled={slotBuying}
      >
        {slotBuying ? '구매 중...' : <>슬롯 추가 <span className="mymusic-character__cost-badge">⭐15</span></>}
      </button>
    </div>
  );

  // ── v212 — 프로필 수정 패널 (카드 [프로필 수정] → 인라인) ──
  const renderProfileEditPanel = () => (
    <div style={{ border: '1px solid #7C3AED', borderRadius: '10px', padding: '12px', marginBottom: '14px', background: '#161221' }}>
      <p style={{ margin: '0 0 4px', fontSize: '13px', color: '#cbb6ff', fontWeight: 600 }}>
        「{editArtist?.name || (editArtist?.kind === 'virtual' ? '가상 아티스트' : '실사 아티스트')}」 프로필 수정
      </p>
      {renderProfileForm()}
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button type="button" className="mymusic-character__btn" onClick={() => { setEditArtist(null); resetProfileForm(null); }} disabled={profileSaving}>
          취소
        </button>
        <button type="button" className="mymusic-character__btn mymusic-character__btn--primary" onClick={handleProfileEditSave} disabled={profileSaving}>
          {profileSaving ? '저장 중...' : '프로필 저장'}
        </button>
      </div>
    </div>
  );

  // ── v212 — 아티스트 카드 목록 ──
  const renderArtistCards = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {artists.length === 0 && (
        <div className="mymusic-character__empty">
          <div className="mymusic-character__empty-icon"><FiUser /></div>
          <p className="mymusic-character__empty-text">아직 아티스트가 없습니다. 첫 아티스트를 만들어보세요.</p>
        </div>
      )}
      {artists.map((a) => {
        const key = a.character_id || a.kind;
        const tags = Array.isArray(a.personality_tags) ? a.personality_tags.filter(Boolean) : [];
        return (
          <div key={key} style={{ display: 'flex', gap: '12px', padding: '12px', border: '1px solid #333', borderRadius: '10px', background: '#1a1a1a', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <img
              src={api.characterPreviewUrl(a.sheet_object_name)}
              alt={a.name || 'artist'}
              style={{ width: '84px', height: '84px', objectFit: 'cover', borderRadius: '8px', background: '#111', flexShrink: 0 }}
              onError={(e) => { if (e?.currentTarget) e.currentTarget.style.visibility = 'hidden'; }}
            />
            <div style={{ flex: '1 1 200px', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, color: '#fff', fontSize: '14px' }}>
                  {a.name || (a.kind === 'virtual' ? '가상 아티스트' : '실사 아티스트')}
                </span>
                <span style={{ fontSize: '11px', color: '#888', border: '1px solid #333', borderRadius: '999px', padding: '1px 8px' }}>
                  {a.kind === 'virtual' ? `🎨 가상${a.art_style ? ` · ${a.art_style}` : ''}` : '📷 실사'}
                </span>
                {a.is_default && (
                  <span style={{ fontSize: '11px', color: '#fbbf24' }} title="기본 아티스트">⭐ 기본</span>
                )}
              </div>
              <div style={{ fontSize: '12px', color: '#aaa', marginTop: '4px' }}>
                {[a.age && `${a.age}세`, a.gender].filter(Boolean).join(' · ') || '프로필 미입력'}
              </div>
              {/* v213 F1 — 목소리 연결 행 (persona_id = 보이스클론 clone_id, 표시 재료는 파생 persona_name/persona_status) */}
              <div style={{ fontSize: '12px', color: '#aaa', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                {a.persona_id ? (
                  <>
                    <span>
                      🎤 목소리:{' '}
                      {(a.persona_status === 'missing' || a.persona_status === 'expired') ? (
                        <span style={{ color: '#f4a261' }}>⚠ 삭제(만료)된 목소리 — 해제하세요</span>
                      ) : (
                        <span style={{ color: '#ddd', fontWeight: 600 }}>{a.persona_name || '연결된 목소리'}</span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleUnlinkVoice(a)}
                      disabled={voiceLinking === a.character_id}
                      style={{ fontSize: '11px', padding: '2px 8px', background: 'transparent', border: '1px solid #444', color: '#bbb', borderRadius: '4px', cursor: 'pointer' }}
                    >
                      {voiceLinking === a.character_id ? '처리 중...' : '연결 해제'}
                    </button>
                  </>
                ) : (
                  <>
                    <span>🎤 목소리: 미연결</span>
                    <button
                      type="button"
                      onClick={() => {
                        // legacy 무cid 카드 — 기본 지정과 동일 관행 (마이그레이션 후 사용)
                        if (!a.character_id) {
                          alert('목소리 연결은 아티스트 마이그레이션 후 사용할 수 있어요.');
                          return;
                        }
                        setVoiceMenuFor(voiceMenuFor === a.character_id ? null : a.character_id);
                      }}
                      disabled={voiceLinking === a.character_id}
                      style={{ fontSize: '11px', padding: '2px 8px', background: 'transparent', border: '1px solid #444', color: '#bbb', borderRadius: '4px', cursor: 'pointer' }}
                    >
                      목소리 연결하기 ▼
                    </button>
                  </>
                )}
              </div>
              {!!a.character_id && voiceMenuFor === a.character_id && !a.persona_id && (
                <div style={{ marginTop: '6px', padding: '8px', border: '1px solid #333', borderRadius: '8px', background: '#111', display: 'flex', flexDirection: 'column', gap: '4px', maxWidth: '280px' }}>
                  {readyClones.length === 0 ? (
                    <span style={{ fontSize: '12px', color: '#888' }}>
                      준비된(ready) 보이스클론이 없습니다 — 아래 「내 목소리」 섹션에서 만들 수 있어요.
                    </span>
                  ) : (
                    readyClones.map((c) => {
                      const cloneId = c?.clone_id || c?.id;
                      return (
                        <button
                          key={cloneId}
                          type="button"
                          onClick={() => handleLinkVoice(a, cloneId)}
                          disabled={voiceLinking === a.character_id}
                          style={{ fontSize: '12px', padding: '6px 8px', background: '#1a1a1a', border: '1px solid #333', color: '#ddd', borderRadius: '6px', cursor: 'pointer', textAlign: 'left' }}
                        >
                          🎤 {c.voice_name || c.name || '이름 없음'}
                        </button>
                      );
                    })
                  )}
                </div>
              )}
              {tags.length > 0 && (
                <div className="mymusic-character__chips" style={{ marginTop: '6px' }}>
                  {tags.map((tag, i) => (
                    <span key={`${tag}-${i}`} className="mymusic-character__chip">{tag}</span>
                  ))}
                </div>
              )}
              {a.personality_text && (
                <p style={{ fontSize: '12px', color: '#999', margin: '6px 0 0', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.personality_text}</p>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0 }}>
              {!a.is_default && (
                <button type="button" className="mymusic-character__btn" onClick={() => handleSetDefault(a)}>
                  ⭐ 기본 지정
                </button>
              )}
              <button type="button" className="mymusic-character__btn" onClick={() => { setEditArtist(a); resetProfileForm(a); }}>
                프로필 수정
              </button>
              <button type="button" className="mymusic-character__btn" onClick={() => startCreate(a.kind, a)}>
                <FiRefreshCw /> 다시 만들기
              </button>
              <button type="button" className="mymusic-character__btn mymusic-character__btn--danger" onClick={() => handleDeleteArtist(a)}>
                <FiTrash2 /> 삭제
              </button>
            </div>
          </div>
        );
      })}
      <button
        type="button"
        className="mymusic-character__generate-btn"
        onClick={() => {
          if (slots && slots.used >= slots.max) {
            alert(`아티스트 슬롯이 가득 찼습니다 (${slots.used}/${slots.max}). ⭐15로 슬롯을 추가하세요.`);
            return;
          }
          startCreate(null);
        }}
      >
        ＋ 새 아티스트 만들기
      </button>
    </div>
  );

  // ── v212 — 새 아티스트: 종류(kind) 선택 ──
  const renderKindSelect = () => (
    <div className="mymusic-character__empty">
      <div className="mymusic-character__empty-icon"><FiUser /></div>
      <p className="mymusic-character__empty-text">어떤 아티스트를 만들까요?</p>
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap', marginTop: '10px' }}>
        <button type="button" className="mymusic-character__btn mymusic-character__btn--primary" onClick={() => setCreateKind('real')}>
          📷 실사화 아티스트
        </button>
        <button type="button" className="mymusic-character__btn mymusic-character__btn--primary" onClick={() => setCreateKind('virtual')}>
          🎨 가상화(그림) 아티스트
        </button>
      </div>
    </div>
  );

  return (
    <div className="mymusic-character">
      {/* v212 — 아티스트 목록(기본 뷰) / 생성 플로우(kind 선택 → 기존 real/virtual 폼 재사용) */}
      {view === 'list' && (
        <>
          {renderSlotBar()}
          {editArtist && renderProfileEditPanel()}
          {renderArtistCards()}
        </>
      )}
      {view === 'create' && (
        <>
          <button
            type="button"
            className="mymusic-character__btn"
            style={{ marginBottom: '10px' }}
            onClick={finishCreateFlow}
          >
            ← 아티스트 목록으로
          </button>
          {regenArtist && (
            <p style={{ fontSize: '12px', color: '#cbb6ff', margin: '0 0 8px' }}>
              「{regenArtist.name || (regenArtist.kind === 'virtual' ? '가상 아티스트' : '실사 아티스트')}」 다시 만들기 — 저장하면 이 아티스트의 시트가 교체됩니다.
            </p>
          )}
          {createKind === null && renderKindSelect()}
          {createKind === 'real' && (previewUrl ? renderRealPreview() : renderRealForm())}
          {createKind === 'virtual' && (vPreviewUrl ? renderVirtualPreview() : renderVirtualForm())}
        </>
      )}

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

  // v215 — 커버촬영실 [이 커버로 업로드] 인계 (composePrefill 템플릿 동형)
  const [coverPrefill, setCoverPrefill] = useState(null);
  const handleSendCoverToUpload = (coverData) => {
    if (import.meta.env.DEV) console.info('[MyMusic] sendCoverToUpload', { session_id: coverData?.coverSessionId });
    setCoverPrefill(coverData);
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
            className={`mymusic-tab ${activeTab === 'coverstudio' ? 'mymusic-tab--active' : ''}`}
            onClick={() => setActiveTab('coverstudio')}
          >
            커버촬영실
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
              coverPrefill={coverPrefill}
              onClearCoverPrefill={() => setCoverPrefill(null)}
              onGoCoverStudio={() => setActiveTab('coverstudio')}
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

        {activeTab === 'coverstudio' && (
          <CoverStudioTab onSendCoverToUpload={handleSendCoverToUpload} />
        )}

        {activeTab === 'mvstudio' && (
          <MVStudioTab
            draftData={draftData}
            onClearDraft={() => setDraftData(null)}
            onGoCoverStudio={() => setActiveTab('coverstudio')}
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
