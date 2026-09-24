import { create } from 'zustand';
import { GenerationStatus, LyricsSourceSnapshot } from '../types';

// ── v3.202(H-⑤): 커버 디렉터 대화 영속 타입 — CoverGenerationScreen의 ChatMessage/coverExtras와
// 구조 동일(구조적 타이핑으로 호환). 화면 이탈·생성 실패 후 재진입 시 대화·답변을 복원한다. ──
export interface CoverChatMessage {
  type: 'director' | 'user';
  text: string;
  step?: number;
  echoOfStep?: number;
}
export interface CoverExtrasSnapshot {
  shot: string | null;
  expression: string | null;
  palette: string | null;
  bgPrompt: string | null;
  bgObjectName: string | null;
  lyricsExcerpt: string | null;
  charKind: 'real' | 'virtual' | null;
  virtualArtStyle: string | null;
}

// ── v3.219 [ComposeDraft]: 작곡 디렉터 대화 draft — MusicGenerationScreen ChatMessage와
// 구조 동일(step/echoOfStep 메타 포함 — 되감기 호환). 단일 스냅샷(커버 coverMessages 관행)으로
// 대화·진행 스텝·답변 상태를 미러링하고, 발매 성공(MusicResult)·'처음부터'에만 지운다.
// lyricsKey 불일치(다른 가사로 진입) 시 폐기 — 잔존 오염 차단. persist 미도입(기본안). ──
export interface ComposeChatMessage {
  type: 'director' | 'user';
  text: string;
  step?: number;
  echoOfStep?: number;
}

export interface ComposeDraftAnswers {
  editedTitle: string;
  editedLyrics: string;
  selectedGenre: string;
  selectedMood: string;
  useVocal: boolean;
  selectedVocalStyle: string;
  selectedVocalGender: string;
  subVocalGender: string;
  subVocalStyle: string;
  refStyle: string;
  negativeTags: string;
  negativeTagsOn: boolean;
  styleWeight: number;
  styleWeightOn: boolean;
  weirdness: number;
  weirdnessOn: boolean;
  audioWeight: number;
  audioWeightOn: boolean;
  personaModel: '' | 'style' | 'voice';
  personaModelOn: boolean;
  selectedPersonaId: string | null;
  bpmValue: number;
  bpmOn: boolean;
  musicalKey: string;
  musicalKeyOn: boolean;
  artistVoiceApplied: boolean;
  selectedArtistId: string | null;
  artistCharacterId: string | null;
}

export interface ComposeDraft {
  /** 가사 신원 키 — lyricsSource.lyrics_id 우선, 없으면 가사 텍스트 해시(미러링 시 재계산) */
  lyricsKey: string;
  step: number;
  chatHistory: ComposeChatMessage[];
  answers: ComposeDraftAnswers;
}

// ── v3.219 [VideoDraft]: 영상 디렉터 대화 draft(선곡·진행·대화) + 스타일 sticky.
// 스타일 파라미터는 완주 후에도 유지(다음 영상에 이전 취향 승계 — creationMode sticky 관행),
// draft(step/chat/선곡)만 저장·공유 완료 시 클리어. persist 미도입(전부 선택지 — 기본안). ──
export interface VideoDraftChatMessage {
  type: 'director' | 'user';
  text: string;
  step?: string;
}

export interface VideoDraft {
  selectedTrackId: string | null;
  selectedTrackTitle: string | null;
  step: string;
  chat: VideoDraftChatMessage[];
}

export interface VideoStylePrefs {
  pickedFormat: 'sns' | 'wide' | 'kakao' | null;
  pickedLayout: 'full' | 'center';
  pickedShape: 'square' | 'circle';
  pickedBg: 'blur' | 'clean' | 'color' | 'solid';
  pickedBgBlur: 'light' | 'mid' | 'strong';
  pickedBgColor: string;
  pickedBgAlpha: string;
  pickedFont: string;
  pickedBold: boolean;
  pickedItalic: boolean;
  pickedColor: string;
  pickedOutline: boolean;
  pickedOutlineColor: string;
  pickedLyricsMode: 'scroll' | 'line';
}

interface MusicState {
  selectedModel: 'suno' | 'wondera';
  lyrics: string;
  genre: string;
  mood: string;
  tempo: string;
  vocal: string;
  vocalStyle: string;
  referenceFile: string | null;
  referenceFileName: string | null;
  /** v3.91: 참고 음원 반영 세기(0.0~1.0). null=미적용(자동) — 생성 body의 audio_weight */
  audioWeight: number | null;
  style: string;
  referenceStyle: string;
  bpm: string;
  musicalKey: string;
  negativeTags: string;
  personaModel: '' | 'style' | 'voice';
  personaId: string | null;
  /** v3.156: 작곡 대화에서 선택한 아티스트(character_id) — 생성 body·발매 출처로 승계되어
   *  차트 아티스트명·착장 스냅샷의 근거가 된다. 미선택 작곡은 null(기획사명 폴백). */
  artistCharacterId: string | null;
  /** v3.102(B-4): 가사 보관함에서 작곡 진입 시 출처 스냅샷 — 생성 lyrics_source·발매 lyrics_id에 사용 */
  lyricsSource: LyricsSourceSnapshot | null;
  subVocal: string;
  subVocalStyle: string;
  /** v3.202(J): 연주곡(Instrumental) 플래그 — true면 가사·보컬 없이 생성(vocal='instrumental').
   *  진입 2경로: ComposeLyricsPick '가사 없이 만들기' 카드(가사 공백), 작곡 대화 보컬 스텝의
   *  'Instrumental (연주곡)' 선택(가사 유지·무보컬). 일반 가사 선택/작곡 진입 시 false로 리셋
   *  (ComposeLyricsPick.handlePick + ComposerSelect 정규화) — 끈적 상태 방지. */
  instrumental: boolean;
  /** v3.203: 연주곡 곡 길이(초) — Suno V6 duration 파라미터(10~360초, 최대 6분) 직접 지원.
   *  작곡 대화 step 310(곡 길이 질문, 연주곡 전용)에서 세팅. null=자동(백엔드 기본 120초).
   *  일반곡 생성(proceedGenerate)·연주곡 해제(성별 재선택) 시 null로 초기화 — 끈적 방지. */
  durationSec: number | null;
  coverTrackId: string | null;
  coverTrackTitle: string | null;
  coverStyle: string | null;
  /** v3.80: 커버에 포함할 캐릭터 슬롯(실사/가상)의 object_name. null=미포함.
   *  로컬 state 대신 store에 두어 대기 후 재진입 시에도 "아티스트 포함" 선택이 유지됨. */
  coverCharacterObjectName: string | null;
  /** v3.202(H-⑤): 커버 디렉터 대화 영속(트랙 모드 전용, 앨범 모드 미사용) — 화면 이탈/실패 후
   *  재진입 시 대화 내역·진행 스텝·보강 답변을 복원해 "안 보이는 답이 요청에 실리는" 괴리를 차단.
   *  성공(결과 확정 경로) 시에만 클리어. */
  coverMessages: CoverChatMessage[] | null;
  coverStep: number | null;
  coverExtrasSnapshot: CoverExtrasSnapshot | null;
  /** v3.202(H-⑤): 가사 반영 답변의 발췌·원본 lyrics_id — 재진입/재생성 시 재조회 없이 승계 */
  coverLyricsExcerpt: string | null;
  coverLyricsId: string | null;
  /** v3.219 [ComposeDraft]: 작곡 대화 진행 draft(null=없음) — 재진입 이어가기 원천 */
  composeDraft: ComposeDraft | null;
  /** v3.219 [VideoDraft]: 영상 대화 진행 draft(null=없음) */
  videoDraft: VideoDraft | null;
  /** v3.219 [VideoDraft]: 영상 스타일 sticky(완주 후에도 유지 — 다음 영상 기본값) */
  videoStylePrefs: VideoStylePrefs | null;
  generationId: string | null;
  savedTrackId: string | null;
  /** v3.200: 창작 기록 세션(Phase 0) id — creationLogService가 관리, 생성/발매 body에 동봉.
   *  서버 미배포·비로그인 시 null 유지(기록 없이 기존 흐름 그대로 — 실패 무해). */
  creationSessionId: string | null;
  /** v3.200(②): 창작 모드 — 작사 디렉터 대화 화면 토글로 선택.
   *  'standard'=일반(현행 동일), 'copyright'=저작권 등록 모드(과정 기록 강조 —
   *  발매 track_type:'copyright_ready'(서버 화이트리스트)에 반영. 세션 payload 반영은
   *  백엔드 SESSION_START 스키마 확장 후속).
   *  사용자가 고른 모드는 다음 곡에도 유지(sticky) — reset() 호출처 없음(v3.156a 주석 참조). */
  creationMode: 'standard' | 'copyright';
  status: GenerationStatus;
  resultUrl: string | null;
  isLoading: boolean;
  error: string | null;
  setSelectedModel: (model: 'suno' | 'wondera') => void;
  setLyrics: (lyrics: string) => void;
  setGenre: (genre: string) => void;
  setMood: (mood: string) => void;
  setTempo: (tempo: string) => void;
  setVocal: (vocal: string) => void;
  setVocalStyle: (style: string) => void;
  setReferenceFile: (uri: string | null, name: string | null) => void;
  setAudioWeight: (v: number | null) => void;
  setStyle: (style: string) => void;
  setReferenceStyle: (referenceStyle: string) => void;
  setBpm: (bpm: string) => void;
  setMusicalKey: (musicalKey: string) => void;
  setNegativeTags: (negativeTags: string) => void;
  setPersonaModel: (v: '' | 'style' | 'voice') => void;
  setPersonaId: (id: string | null) => void;
  setArtistCharacterId: (id: string | null) => void;
  setLyricsSource: (v: LyricsSourceSnapshot | null) => void;
  setSubVocal: (v: string) => void;
  setSubVocalStyle: (v: string) => void;
  setInstrumental: (v: boolean) => void;
  setDurationSec: (v: number | null) => void;
  setCoverTrackId: (v: string | null) => void;
  setCoverTrackTitle: (v: string | null) => void;
  setCoverStyle: (v: string | null) => void;
  setCoverCharacterObjectName: (v: string | null) => void;
  setCoverMessages: (v: CoverChatMessage[] | null) => void;
  setCoverStep: (v: number | null) => void;
  setCoverExtrasSnapshot: (v: CoverExtrasSnapshot | null) => void;
  setCoverLyricsExcerpt: (v: string | null) => void;
  setCoverLyricsId: (v: string | null) => void;
  setComposeDraft: (v: ComposeDraft | null) => void;
  clearComposeDraft: () => void;
  setVideoDraft: (v: VideoDraft | null) => void;
  clearVideoDraft: () => void;
  setVideoStylePrefs: (v: VideoStylePrefs | null) => void;
  /** v3.219: 커버 대화 컨텍스트 일괄 청소 — CoverGenerationScreen clearCoverContext와 동일 필드.
   *  성공 확정(화면측)·로그아웃(authStore) 공용. */
  clearCoverContext: () => void;
  setGenerationId: (id: string | null) => void;
  setSavedTrackId: (id: string | null) => void;
  setCreationSessionId: (id: string | null) => void;
  setCreationMode: (mode: 'standard' | 'copyright') => void;
  setStatus: (status: GenerationStatus) => void;
  setResultUrl: (url: string | null) => void;
  setIsLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialState = {
  selectedModel: 'suno' as const,
  lyrics: '',
  genre: '',
  mood: '',
  tempo: '보통',
  vocal: '',
  vocalStyle: '',
  referenceFile: null,
  referenceFileName: null,
  audioWeight: null,
  style: '',
  referenceStyle: '',
  bpm: '',
  musicalKey: '',
  negativeTags: '',
  personaModel: '' as const,
  personaId: null,
  artistCharacterId: null,
  lyricsSource: null,
  subVocal: '',
  subVocalStyle: '',
  instrumental: false,
  durationSec: null,
  coverTrackId: null,
  coverTrackTitle: null,
  coverStyle: null,
  coverCharacterObjectName: null,
  coverMessages: null,
  coverStep: null,
  coverExtrasSnapshot: null,
  coverLyricsExcerpt: null,
  coverLyricsId: null,
  composeDraft: null,
  videoDraft: null,
  videoStylePrefs: null,
  generationId: null,
  savedTrackId: null,
  creationSessionId: null,
  creationMode: 'standard' as const,
  status: 'idle' as GenerationStatus,
  resultUrl: null,
  isLoading: false,
  error: null,
};

export const useMusicStore = create<MusicState>((set) => ({
  ...initialState,
  setSelectedModel: (selectedModel) => set({ selectedModel }),
  setLyrics: (lyrics) => set({ lyrics }),
  setGenre: (genre) => set({ genre }),
  setMood: (mood) => set({ mood }),
  setTempo: (tempo) => set({ tempo }),
  setVocal: (vocal) => set({ vocal }),
  setVocalStyle: (vocalStyle) => set({ vocalStyle }),
  setReferenceFile: (referenceFile, referenceFileName) =>
    set({ referenceFile, referenceFileName }),
  setAudioWeight: (audioWeight) => set({ audioWeight }),
  setStyle: (style) => set({ style }),
  setReferenceStyle: (referenceStyle) => set({ referenceStyle }),
  setBpm: (bpm) => set({ bpm }),
  setMusicalKey: (musicalKey) => set({ musicalKey }),
  setNegativeTags: (negativeTags) => set({ negativeTags }),
  setPersonaModel: (personaModel) => set({ personaModel }),
  setPersonaId: (personaId) => set({ personaId }),
  setArtistCharacterId: (artistCharacterId) => set({ artistCharacterId }),
  setLyricsSource: (lyricsSource) => set({ lyricsSource }),
  setSubVocal: (subVocal) => set({ subVocal }),
  setSubVocalStyle: (subVocalStyle) => set({ subVocalStyle }),
  setInstrumental: (instrumental) => set({ instrumental }),
  setDurationSec: (durationSec) => set({ durationSec }),
  setCoverTrackId: (coverTrackId) => set({ coverTrackId }),
  setCoverTrackTitle: (coverTrackTitle) => set({ coverTrackTitle }),
  setCoverStyle: (coverStyle) => set({ coverStyle }),
  setCoverCharacterObjectName: (coverCharacterObjectName) => set({ coverCharacterObjectName }),
  setCoverMessages: (coverMessages) => set({ coverMessages }),
  setCoverStep: (coverStep) => set({ coverStep }),
  setCoverExtrasSnapshot: (coverExtrasSnapshot) => set({ coverExtrasSnapshot }),
  setCoverLyricsExcerpt: (coverLyricsExcerpt) => set({ coverLyricsExcerpt }),
  setCoverLyricsId: (coverLyricsId) => set({ coverLyricsId }),
  setComposeDraft: (composeDraft) => set({ composeDraft }),
  clearComposeDraft: () => set({ composeDraft: null }),
  setVideoDraft: (videoDraft) => set({ videoDraft }),
  clearVideoDraft: () => set({ videoDraft: null }),
  setVideoStylePrefs: (videoStylePrefs) => set({ videoStylePrefs }),
  clearCoverContext: () =>
    set({
      coverTrackId: null,
      coverTrackTitle: null,
      coverStyle: null,
      coverCharacterObjectName: null,
      coverMessages: null,
      coverStep: null,
      coverExtrasSnapshot: null,
      coverLyricsExcerpt: null,
      coverLyricsId: null,
    }),
  setGenerationId: (generationId) => set({ generationId }),
  setSavedTrackId: (savedTrackId) => set({ savedTrackId }),
  setCreationSessionId: (creationSessionId) => set({ creationSessionId }),
  setCreationMode: (creationMode) => set({ creationMode }),
  setStatus: (status) => set({ status }),
  setResultUrl: (resultUrl) => set({ resultUrl }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  reset: () => set(initialState),
}));
