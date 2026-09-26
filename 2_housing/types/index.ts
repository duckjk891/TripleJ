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
  /** v3.102(B-4): 가사 보관함에서 고른 가사 출처 스냅샷 — 생성 body의 lyrics_source */
  lyricsSource?: LyricsSourceSnapshot | null;
  /** v3.202(J): 연주곡(Instrumental) — true면 generateWithSuno가 vocal='instrumental'로 전송 */
  instrumental?: boolean;
  /** v3.203: 연주곡 곡 길이(초, Suno V6 duration 10~360) — instrumental일 때만 body.duration에 반영 */
  durationSec?: number;
}

/**
 * v3.102(B-4): 가사 출처 스냅샷 — 서버 LyricsSourceSnapshot(v216 openapi 실측: lyrics_id/title/is_mine).
 * 가사 보관함(lyricsBookStore)은 순수 로컬 자산이라 lyrics_id는 로컬 id 문자열 그대로(서버 무검증 저장).
 */
export interface LyricsSourceSnapshot {
  lyrics_id: string;
  title?: string;
  is_mine?: boolean;
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
  /** v3.228: 서버 실패 확정 시 환불 여부(재시작 정리 포함) — true일 때만 환불 안내(X-K1) */
  refunded?: boolean | null;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
  // v3.102: Kits 음성 변환 필드(voice_conversion_* 등, v3.98 A-8) 제거 — v216 서버 기능 삭제 확정
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
/** v3.118: 피로/쿨다운 디렉터 차원 (backend_9004 v220 fatigue_service.DIRECTORS) — 미지정=composer
 *  v3.214 ⑨: 'video' 추가 — 영상 디렉터(share-video) 피로도 게이트 (스킵비 ⭐2 = share_video 5의 1/3 반올림) */
export type FatigueDirector = 'composer' | 'lyricist' | 'image' | 'artist' | 'video';

export interface FatigueStatus {
  director?: FatigueDirector; // v3.118(v220): 응답에 director 키 추가 — 구 서버 호환 optional
  today_completed: number;
  cooldown_active: boolean;
  cooldown_until: string | null;
  cooldown_remaining_sec: number;
  skip_point_cost: number; // v220 디렉터별 차등: composer ⭐5 / lyricist ⭐2 / image ⭐2 / artist ⭐3 — status 실값만 표기
  skip_minutes: number; // 30
  ladder: Record<string, number>;
  skip_wait_count: number;
  /** v3.236 S1 additive(구 서버 없음): 전부 줄이는 데 필요한 칸 = ceil(잔여/1800) */
  skip_units_needed?: number;
  /** v3.236 S1 additive: 칸 × 단가 */
  skip_total_cost?: number;
  /** v3.236 S1 additive: 일괄 단축 최대 칸(24 = 12h/30m) */
  skip_max_units?: number;
}

/** v3.118: GET /api/fatigue/status?all=1 — 4 디렉터 일괄 (Map 휴식 티켓용 1회 조회) */
export interface FatigueStatusAll {
  directors: Record<FatigueDirector, FatigueStatus>;
  skip_wait_count: number;
}

/** v3.94: POST /api/fatigue/skip 성공 응답 = status payload + skipped_minutes (fatigue.py:123-125) */
export interface FatigueSkipResult extends FatigueStatus {
  skipped_minutes: number;
}

/** v3.236 A5: POST /api/fatigue/skip-bulk 성공 응답 = status payload + 일괄 단축 결과 */
export interface FatigueBulkSkipResult extends FatigueSkipResult {
  /** 요청 칸(클라이언트 units 그대로) */
  units_requested?: number;
  /** 실제 적용 칸(서버 clamp·경합 후) */
  units_applied: number;
  /** 서버 30분 단가 */
  unit_cost?: number;
  /** 경합으로 남은 칸 환불 ⭐(보통 0) */
  points_refunded?: number;
  /** 실제 차감 ⭐(경합 환불 반영 후) */
  points_spent: number;
  /** 요청 후 잔액(없으면 앱이 /points/balance 재조회) */
  balance?: number;
  request_id: string;
  /** 같은 request_id 재요청 → 저장된 응답 재생(추가 차감 없음) */
  replayed: boolean;
}
