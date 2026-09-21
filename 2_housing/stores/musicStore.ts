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
  setCoverTrackId: (v: string | null) => void;
  setCoverTrackTitle: (v: string | null) => void;
  setCoverStyle: (v: string | null) => void;
  setCoverCharacterObjectName: (v: string | null) => void;
  setCoverMessages: (v: CoverChatMessage[] | null) => void;
  setCoverStep: (v: number | null) => void;
  setCoverExtrasSnapshot: (v: CoverExtrasSnapshot | null) => void;
  setCoverLyricsExcerpt: (v: string | null) => void;
  setCoverLyricsId: (v: string | null) => void;
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
  coverTrackId: null,
  coverTrackTitle: null,
  coverStyle: null,
  coverCharacterObjectName: null,
  coverMessages: null,
  coverStep: null,
  coverExtrasSnapshot: null,
  coverLyricsExcerpt: null,
  coverLyricsId: null,
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
  setCoverTrackId: (coverTrackId) => set({ coverTrackId }),
  setCoverTrackTitle: (coverTrackTitle) => set({ coverTrackTitle }),
  setCoverStyle: (coverStyle) => set({ coverStyle }),
  setCoverCharacterObjectName: (coverCharacterObjectName) => set({ coverCharacterObjectName }),
  setCoverMessages: (coverMessages) => set({ coverMessages }),
  setCoverStep: (coverStep) => set({ coverStep }),
  setCoverExtrasSnapshot: (coverExtrasSnapshot) => set({ coverExtrasSnapshot }),
  setCoverLyricsExcerpt: (coverLyricsExcerpt) => set({ coverLyricsExcerpt }),
  setCoverLyricsId: (coverLyricsId) => set({ coverLyricsId }),
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
