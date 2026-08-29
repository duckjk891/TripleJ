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

/** v3.93: 생성물 클립(variant) — backend_9004 suno_generator.py:317~ (variants[0]=result_audio_url 미러) */
export interface GenerationVariant {
  audio_url?: string | null;
  suno_audio_id?: string | null;
  duration?: number | null;
  timestamps?: any[];
}

/** v3.93: GET /generate/ 목록 항목 = GET /generate/{id} 단건 (generate.py:86 _serialize 동일 형태) */
export interface GenerationItem {
  id: string;
  title?: string | null;
  genre?: string | null;
  mood?: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed' | string;
  progress?: number;
  lyrics?: string | null;
  prompt?: string | null;
  model?: string;
  result_track_id?: string | null;
  result_audio_url?: string | null;
  variants?: GenerationVariant[];
  error_message?: string | null;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
}

/** v3.93: GET /generate/ 응답 (generate.py:649 list_generations) */
export interface GenerationListResult {
  generations: GenerationItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface GenerationResult {
  id: string;
  status: GenerationStatus;
  resultUrl?: string;
  error?: string;
  progress?: number;
}

/**
 * v3.94: GET /api/fatigue/status 응답 (backend_9004 fatigue.py:46 + fatigue_service.py:160 get_status)
 * ladder = {"1":2,"2":4,"3":8,"4+":12} — 그날 n곡째 완성 시 쿨다운(시간). KST 자정 리셋.
 * skip_wait_count = AdMob SSV 적립 광고권 잔량 (fatigue.py:33 _skip_wait_count).
 */
export interface FatigueStatus {
  today_completed: number;
  cooldown_active: boolean;
  cooldown_until: string | null;
  cooldown_remaining_sec: number;
  skip_point_cost: number; // ⭐5 (points_service.py:31 POINT_COSTS.fatigue_skip)
  skip_minutes: number; // 30
  ladder: Record<string, number>;
  skip_wait_count: number;
}

/** v3.94: POST /api/fatigue/skip 성공 응답 = status payload + skipped_minutes (fatigue.py:123-125) */
export interface FatigueSkipResult extends FatigueStatus {
  skipped_minutes: number;
}
