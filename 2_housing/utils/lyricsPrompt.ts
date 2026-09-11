/**
 * v3.110 작사 프롬프트 체계 개편 — "쉬운 화면 / 효과적인 프롬프트" 분리.
 *
 * - 사용자에게는 항목별 요약 카드만 보여주고(전문용어·프롬프트 원문 숨김),
 *   실제 /generate/lyrics/ 로 보내는 내용은 여기서 백엔드 계약에 맞게 조립한다.
 * - 백엔드(routes/generate.py LyricsRequest)는 prompt(곡 설명) 외에
 *   genre/mood/style/duration_minutes/duet/language 를 **별도 필드**로 받아
 *   lyrics_generator.py 가 user message 에 다시 붙인다.
 *   → 프론트는 장르·분위기·스타일·길이를 prompt 문장에 중복으로 녹이지 않는다.
 * - 곡 구조 선택은 Suno 섹션 태그 체계([Verse]/[Chorus]/[Bridge]...)로 번역해
 *   백엔드 시스템 프롬프트(섹션 태그 필수)가 최대 성능을 내게 한다.
 */

interface LyricsPromptState {
  genre: string;
  mood: string;
  content: string;
  perspective: string;
  language: string;
  structure: string;
  style: string;
  keywords: string;
  duration: number; // 초
  hasRap: boolean;
  isDuet: boolean;
  reference: string;
}

export interface LyricsRequestPayload {
  prompt: string;
  genre?: string;
  mood?: string;
  style?: string;
  duration_minutes?: number;
  duet?: boolean;
  language?: string;
  // v3.127 (B-12) — 서버 v229 구조화 필드 (prompt 문장 대신 네이티브 전송)
  structure?: string;
  english_ratio?: number;
  has_rap?: boolean;
  // v3.167 — 이야기 필드 서버 영속(가사 자산에 저장 → 발매 시 '이야기' 소급/폴백 근거)
  story_topic?: string;
  story_keywords?: string;
  story_perspective?: string;
  story_reference?: string;
}

// ── 공용 선택지 (LyricsInput 대화 · LyricsPromptReview 카드 수정에서 공유) ──
export const GENRE_OPTIONS = ['댄스', '발라드', '힙합', 'R&B', '트로트', '인디', '록', '포크', '인디팝', '시티팝', '재즈', 'EDM', '클래식'];
export const MOOD_OPTIONS = ['밝고 경쾌한', '슬프고 우울한', '몽환적·신비로운', '에너지틱·강렬한', '로맨틱·달콤한', '그리운·따뜻한', '잔잔하고 편안한', '흥겹고 신나는'];
// v3.128(대표): 장르와 겹쳐 보이던 사운드 선택지를 악기·질감 중심으로 개명 —
// 장르=곡의 종류, 사운드=악기와 질감으로 역할을 확실히 구별 ("피아노 발라드"→장르
// 발라드와, "일렉트로닉"→EDM과 충돌하던 명칭 제거). 구명칭 영문 매핑은 하위 호환 유지.
export const STYLE_OPTIONS = ['어쿠스틱 기타', '피아노 중심', '신디사이저 전자음', '밴드 연주', '오케스트라', '로파이 질감', '레트로 신스', '트로피컬 리듬'];
// v3.118.2(대표): 초등학생~성인 전 연령 포괄 예시
export const CONTENT_OPTIONS = ['첫사랑', '가족의 사랑', '단짝 친구', '방학의 설렘', '시험 응원가', '퇴근길의 위로', '여름 바다 여행', '우리 강아지', '평범한 하루의 행복', '새로운 도전'];
// v3.118.2(대표): 키워드+문구 — 전 연령 포괄
export const KEYWORD_OPTIONS = ['벚꽃', '밤하늘', '바다', '첫눈', '운동장', '떡볶이', '커피 한 잔', '\'야호!\'', '\'다시 만나자\'', '\'괜찮아\''];
export const PERSPECTIVE_OPTIONS = ['1인칭 — 나', '2인칭 — 너에게 말하는', '3인칭 — 관찰자', '독백체', '대화체'];
export const LANGUAGE_OPTIONS = ['한국어 100%', '영어 조금 혼합 (20% 이하)', '영어 많이 혼합 (절반 정도)', '영어 100%'];
export const STRUCTURE_OPTIONS = ['절 — 후렴 (2절)', '절 — 후렴 — 브릿지', '절 — 후렴 (3절)', '절 — 후렴 — 절 — 후렴 — 브릿지 — 후렴', '자유 형식'];
export const DUET_OPTIONS = ['솔로', '듀엣'];
export const DURATION_OPTIONS = [
  { value: 30, label: '30초' },
  { value: 60, label: '1분' },
  { value: 120, label: '2분' },
  { value: 180, label: '3분' },
  { value: 240, label: '4분' },
  { value: 300, label: '5분' },
];

export const formatDuration = (sec: number): string =>
  sec >= 60 ? `${Math.floor(sec / 60)}분` : `${sec}초`;

// 곡 구조(한국어 선택지) → Suno 섹션 태그 시퀀스
const STRUCTURE_TAG_MAP: Record<string, string> = {
  '절 — 후렴 (2절)': '[Intro] - [Verse 1] - [Chorus] - [Verse 2] - [Chorus] - [Outro]',
  '절 — 후렴 — 브릿지': '[Intro] - [Verse] - [Chorus] - [Bridge] - [Chorus] - [Outro]',
  '절 — 후렴 (3절)': '[Intro] - [Verse 1] - [Chorus] - [Verse 2] - [Chorus] - [Verse 3] - [Chorus] - [Outro]',
  '절 — 후렴 — 절 — 후렴 — 브릿지 — 후렴': '[Intro] - [Verse 1] - [Chorus] - [Verse 2] - [Chorus] - [Bridge] - [Chorus] - [Outro]',
};

const PERSPECTIVE_PROMPT_MAP: Record<string, string> = {
  '1인칭 — 나': "1인칭 '나'의 시점으로 써주세요.",
  '2인칭 — 너에게 말하는': "'너'에게 직접 말을 건네는 시점으로 써주세요.",
  '3인칭 — 관찰자': '3인칭 관찰자 시점으로 담담하게 그려주세요.',
  '독백체': '혼잣말하듯 독백체로 써주세요.',
  // v3.167(대표): "나:", "너:" 같은 화자 이름표가 가사에 그대로 찍히던 문제 — 라벨 금지 명시
  '대화체': "두 사람이 대화하듯 주고받는 어투로 써주세요. 단 '나:', '너:', 'A:' 같은 화자 이름표는 절대 쓰지 말고, 자연스러운 가사 문장으로만 표현하세요.",
};

/** 언어 선택지 → 백엔드 language 필드('ko'|'en') */
export const mapLanguageField = (language: string): 'ko' | 'en' =>
  language.includes('영어 100%') || language.trim() === '영어' ? 'en' : 'ko';

/** (v3.127 이후 미사용 — 서버 english_ratio 필드로 대체. 폴백 대비 보존) */
// @ts-ignore -- 보존용
const languageMixLine = (language: string): string | null => {
  if (language.includes('조금 혼합')) return '가사는 한국어 위주로 하되, 영어 표현을 20% 이하로 자연스럽게 섞어주세요.';
  if (language.includes('많이 혼합')) return '한국어와 영어를 절반 정도씩 자연스럽게 섞어 써주세요.';
  return null;
};

/** 초 → 백엔드 duration_minutes — v3.127(B-12): 서버 v229가 4·5분 가이드 지원 → 1~5 */
export const mapDurationMinutes = (durationSec: number): number => {
  if (durationSec < 60) return 1;
  return Math.max(1, Math.min(5, Math.round(durationSec / 60)));
};

/** v3.127 (B-12) — 언어 선택지 → english_ratio (0~100). 중간 혼합만 의미 있음 */
const mapEnglishRatio = (language: string): number | undefined => {
  if (language.includes('조금 혼합')) return 20;
  if (language.includes('많이 혼합')) return 50;
  return undefined;
};

/**
 * 백엔드 계약에 맞는 전송 payload 조립.
 * prompt(곡 설명)에는 백엔드가 별도 필드로 받지 않는 정보만 담는다:
 * 주제·시점·키워드·곡 구조(Suno 태그)·랩·언어 혼합·추가 요청.
 */
export function buildLyricsRequest(state: LyricsPromptState): LyricsRequestPayload {
  const lines: string[] = [];

  // 주제 + 키워드
  const theme = state.content?.trim();
  if (theme) lines.push(`'${theme}'을(를) 주제로 한 노래 가사를 써주세요.`);
  const keywords = state.keywords?.trim();
  if (keywords && keywords !== '없음') {
    lines.push(`'${keywords}' 소재를 가사에 자연스럽게 녹여주세요.`);
  }

  // 시점
  const perspective = state.perspective?.trim();
  if (perspective) {
    lines.push(PERSPECTIVE_PROMPT_MAP[perspective] || `${perspective} 시점으로 써주세요.`);
  }

  // v3.127 (B-12): 곡 구조·랩·언어 혼합·4~5분 분량은 서버 v229 네이티브 필드로 전송
  // (prompt 문장 중복 제거 — 태그 미매핑 구조명만 prompt로 폴백)
  const structure = state.structure?.trim();
  const structureTagSeq =
    structure && structure !== '자유 형식' ? STRUCTURE_TAG_MAP[structure] : undefined;
  if (structure && structure !== '자유 형식' && !structureTagSeq) {
    lines.push(`곡 구조: ${structure}`);
  }

  // 추가 요청 (레퍼런스 등 자유 입력)
  const reference = state.reference?.trim();
  if (reference && reference !== '없음') {
    lines.push(`추가 요청: ${reference}`);
  }

  return {
    prompt: lines.join('\n'),
    genre: state.genre?.trim() || undefined,
    mood: state.mood?.trim() || undefined,
    style: state.style?.trim() || undefined,
    duration_minutes: mapDurationMinutes(state.duration),
    duet: state.isDuet || undefined,
    language: mapLanguageField(state.language || ''),
    // v3.127 (B-12) — 서버 v229 구조화 필드
    structure: structureTagSeq,
    english_ratio: mapEnglishRatio(state.language || ''),
    has_rap: state.hasRap || undefined,
    // v3.167 — 이야기 필드(가사 자산에 함께 저장 → 발매 '이야기' 섹션의 서버측 근거)
    story_topic: state.content?.trim() || undefined,
    story_keywords: (state.keywords?.trim() && state.keywords.trim() !== '없음') ? state.keywords.trim() : undefined,
    story_perspective: state.perspective?.trim() || undefined,
    story_reference: (state.reference?.trim() && state.reference.trim() !== '없음') ? state.reference.trim() : undefined,
  };
}
