export type DirectorType = 'artist' | 'lyricist' | 'composer' | 'image' | 'video';

export interface Director {
  id: string;
  name: string;
  role: string;
  portrait: any;
  sprite: any;
}

export interface DialogueChoice {
  text: string;
  next: number;
  action?: string;
}

export interface DialogueNode {
  id: number;
  speaker: string;
  text: string;
  choices?: DialogueChoice[];
  next?: number;
  action?: string;
}

export interface LyricsParams {
  genre: string;
  mood: string;
  content: string;
  tempo: string;
  language: string;
  duration: number;
  hasRap: boolean;
}

export interface MusicParams {
  lyrics: string;
  title?: string;
  genre: string;
  mood: string;
  tempo: string;
  vocal: string;
  vocalStyle: string;
  model: 'suno' | 'wondera';
  referenceFile?: string;
  style?: string;
  referenceStyle?: string;
  bpm?: string;
  musicalKey?: string;
  negativeTags?: string;
  personaModel?: '' | 'style' | 'voice';
  personaId?: string;
  isDuet?: boolean;
  subVocal?: string;
  subVocalStyle?: string;
  /** v3.91: 참고 음원 반영 세기(0.0~1.0) — 백엔드 GenerateRequest.audio_weight */
  audioWeight?: number | null;
  /** v3.91: 생성 직전 업로드된 참고 음악(upload-reference 응답) — reference_audio_* 필드로 전송 */
  referenceData?: ReferenceUploadResult | null;
}

/** POST /generate/upload-reference/ 응답 (backend_9004 generate.py:305~310) */
export interface ReferenceUploadResult {
  upload_url: string;
  object_name: string;
  filename: string;
  duration_sec: number;
}

export type GenerationStatus = 'idle' | 'pending' | 'processing' | 'completed' | 'failed';

export interface GenerationResult {
  id: string;
  status: GenerationStatus;
  resultUrl?: string;
  error?: string;
  progress?: number;
}
