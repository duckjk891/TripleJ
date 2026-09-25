// v3.231 A1·A2·A3 [ArtistAnswerEdit]: 아티스트 만들기 "내 답변 편집" 순수 로직.
// ArtistInputScreen 의 질문 정의·답변 직렬화(v3.109~v3.227)를 여기로 옮기고, 편집(답 교체·파생값 재계산·
// 진행 위치 보존·초안 복원)을 RN 의존 없는 순수 함수로 둔다 — Node 하네스로 검증 가능.
// 편집 방식 = 작곡 디렉터(v3.204④) 비파괴 방식: 말풍선 탭 → 그 질문 입력 영역을 기존 답으로 열고,
// 완료 시 그 말풍선·그 답만 바꾼다(이후 대화·현재 진행 단계/질문/입력은 건드리지 않음).

export interface StyleAnswers {
  gender: string;
  /** v3.109: 아티스트 이름(자유 입력·스킵 가능) — save의 name 필드로 서버 영속 */
  name: string;
  age: string;
  hair: string;
  face: string;
  skin: string;
  body: string;
  height: string;
  mood: string;
}
export type StyleAnswerKey = keyof StyleAnswers;

export const EMPTY_ANSWERS: StyleAnswers = {
  gender: '', name: '', age: '', hair: '', face: '', skin: '', body: '', height: '', mood: '',
};

export interface QuestionDef {
  key: StyleAnswerKey;
  short: string;
  question: string;
  chips: string[];
  placeholder: string;
}

export const QUESTIONS: QuestionDef[] = [
  // v3.82: 성별 질문 — 답변은 user_text에 포함(생성 품질)되고,
  // 생성 성공 시 artistProfileStore에 기록되어 상세 화면에 표시된다.
  {
    key: 'gender', short: '성별',
    question: '먼저, 아티스트의 성별은 어떻게 할까요?',
    chips: ['남성', '여성'],
    placeholder: '예: 여성',
  },
  // v3.109: 이름 질문(대표 피드백) — 자유 입력, 스킵 시 기존 기본 명명 로직(서버) 유지.
  // 답변은 pendingName으로 파이프라인에 실려 save의 name 필드로 서버 영속(v216 계약).
  {
    key: 'name', short: '이름',
    question: '아티스트의 이름을 지어주세요. 건너뛰면 나중에 자동으로 정해드려요.',
    chips: [],
    placeholder: '예: 루나',
  },
  // v3.164(대표): 나이 — 시트 외모(연령대 인상)에 반영되고 상세 화면에 이름·나이·성별로 표시
  {
    key: 'age', short: '나이',
    question: '나이는 몇 살로 할까요? 외모 인상에도 반영돼요.',
    chips: ['10대', '20대 초반', '20대 중반', '20대 후반', '30대'],
    placeholder: '예: 23세',
  },
  {
    key: 'hair', short: '머리',
    question: '머리 스타일과 색은 어떤 느낌이 좋을까요?',
    chips: ['긴 생머리', '단발', '컬리', '짧은컷', '검정', '갈색', '밝은톤'],
    placeholder: '예: 어두운 갈색 웨이브',
  },
  {
    key: 'face', short: '얼굴',
    question: '얼굴 인상은요? 눈·코·입 어떤 느낌이면 좋겠어요?',
    chips: ['큰 눈', '날카로운', '부드러운', '둥근 얼굴', '갸름한 얼굴'],
    placeholder: '예: 둥근 얼굴, 큰 눈, 오똑한 코',
  },
  {
    key: 'skin', short: '피부',
    question: '피부 톤은 어떻게 할까요?',
    chips: ['하얀', '자연스러운', '그을린'],
    placeholder: '예: 약간 그을린 건강한 톤',
  },
  {
    key: 'body', short: '체형',
    // v3.164(대표): 골격 진단 3타입(스트레이트/웨이브/내추럴)으로도 표현
    question: '체형은요? 골격 타입(스트레이트·웨이브·내추럴)으로 골라도 좋아요.',
    chips: ['스트레이트', '웨이브', '내추럴', '마른', '보통', '근육질'],
    placeholder: '예: 웨이브 타입, 슬림한 체형',
  },
  {
    key: 'height', short: '키',
    question: '키는 어느 정도가 어울릴까요?',
    chips: ['아담', '보통', '키 큰'],
    placeholder: '예: 170cm 정도',
  },
  {
    key: 'mood', short: '분위기',
    question: '마지막으로, 전체적인 분위기는?',
    chips: ['도시적', '청순', '강렬한 록', '청량', '몽환적'],
    placeholder: '예: 차가운 카리스마',
  },
];

export const LAST_QUESTION_INDEX = QUESTIONS.length - 1;

// v3.227 H-2: 실사 + 얼굴 사진이 있을 때 외모 질문(머리·얼굴·피부·체형)은 "사진과 다르게 하고 싶을 때만"
// 답하도록 안내 — 답변이 사진을 덮어써 얼굴이 달라지는 문제 완화(건너뛴 항목은 buildFinalText에서 제외 — 직렬화 불변).
// 사진 없음(텍스트 전용)·캐릭터(가상)는 기존 문구 그대로.
export const PHOTO_MODE_KEYS: ReadonlySet<StyleAnswerKey> = new Set<StyleAnswerKey>(['hair', 'face', 'skin', 'body']);
export const PHOTO_MODE_HINT = '사진과 다르게 하고 싶을 때만 적어주세요(건너뛰면 사진 그대로).';
export function questionTextFor(q: QuestionDef, withPhoto: boolean): string {
  return withPhoto && PHOTO_MODE_KEYS.has(q.key) ? `${q.question} ${PHOTO_MODE_HINT}` : q.question;
}

// v3.227 H-1 [ArtistDraft]: 사진 선택/텍스트 전용 선택 버블 — 구 draft(photoIntent 없음)의 의도 추론 근거
export const PHOTO_BUBBLE_PREFIX = '사진 선택: ';
export const TEXT_ONLY_BUBBLE = '사진 없이 만들게요';
export const REUSE_PHOTO_BUBBLE = '이전에 올린 사진으로 만들게요';

export function buildFinalText(answers: StyleAnswers): string {
  const parts: string[] = [];
  // v3.109: 이름 포함 — "이어서 만들기" 보존(conceptText 요약)에도 이름이 실린다
  if (answers.name) parts.push(`이름은 ${answers.name}`);
  if (answers.gender) parts.push(`성별은 ${answers.gender}`);
  if (answers.age) parts.push(`나이는 ${answers.age}`);
  if (answers.hair) parts.push(`머리는 ${answers.hair}`);
  if (answers.face) parts.push(`얼굴은 ${answers.face}`);
  if (answers.skin) parts.push(`피부는 ${answers.skin}`);
  if (answers.body) parts.push(`체형은 ${answers.body}`);
  if (answers.height) parts.push(`키는 ${answers.height}`);
  if (answers.mood) parts.push(`분위기는 ${answers.mood}`);
  return parts.join(', ');
}

/** 컨셉 텍스트(설명 없음 → 기본 문구) — handleStartGeneration(v3.105) 규칙 그대로 */
export const NO_CONCEPT_FALLBACK = '특별한 컨셉 없음 — 자연스러운 느낌으로';
export function conceptTextFrom(answers: StyleAnswers): string {
  return buildFinalText(answers) || NO_CONCEPT_FALLBACK;
}

/** 답변 → 생성 파이프라인 보관값(v3.82 성별·v3.109 이름·v3.164 나이). 빈 답 = null */
export function pendingFromAnswers(answers: StyleAnswers): {
  pendingGender: string | null;
  pendingName: string | null;
  pendingAge: string | null;
} {
  return {
    pendingGender: answers.gender.trim() || null,
    pendingName: answers.name.trim() || null,
    pendingAge: answers.age.trim() || null,
  };
}

export function isStyleAnswerKey(k: unknown): k is StyleAnswerKey {
  return typeof k === 'string' && QUESTIONS.some((q) => q.key === k);
}

export function questionOf(key: StyleAnswerKey): QuestionDef {
  return QUESTIONS.find((q) => q.key === key) as QuestionDef;
}

/** 답변 버블 문구 — 빈 답은 "(머리 생략)" (handleAnswerNext 규칙 그대로) */
export function answerBubbleText(key: StyleAnswerKey, answer: string): string {
  const a = answer.trim();
  return a ? a : `(${questionOf(key).short} 생략)`;
}

/** 칩 토글 — 입력 문자열(쉼표 구분)에 칩을 넣거나 뺀다(handleChipTap 규칙 그대로) */
export function toggleChip(prev: string, chip: string): string {
  const tokens = prev.split(',').map((t) => t.trim()).filter(Boolean);
  if (tokens.includes(chip)) return tokens.filter((t) => t !== chip).join(', ');
  return tokens.length === 0 ? chip : `${prev}, ${chip}`;
}

// ── 대화 메시지 ─────────────────────────────────────────
export interface EditableChatMessage {
  type: 'director' | 'user';
  text: string;
  /** v3.231: 이 user 버블이 답한 질문(편집 대상 식별). 구 초안에는 없음 → inferChatQKeys 로 추론 */
  qKey?: StyleAnswerKey;
}

/**
 * v3.231: 구 초안 호환 — qKey 없는 user 버블은 직전 디렉터 버블이 질문 문구로 시작하면 그 질문의 답으로 본다
 * (사진 모드 안내가 붙은 문구도 startsWith 로 일치). 직전 디렉터 버블이 질문이 아니면 편집 불가(qKey 없음).
 * 사진/설명 선택 버블은 질문 답이 아니고, 한 질문에는 그 뒤 첫 user 버블 하나만 대응한다.
 * 이미 qKey 가 있으면 유지(잘못된 값은 제거).
 */
export function inferChatQKeys<T extends { type: 'director' | 'user'; text: string; qKey?: string }>(
  chat: T[]
): (T & { qKey?: StyleAnswerKey })[] {
  let lastDirector: string | null = null;
  return chat.map((m) => {
    if (m.type === 'director') {
      lastDirector = m.text;
      if (m.qKey !== undefined) {
        const { qKey: _drop, ...rest } = m as any;
        return rest;
      }
      return m as T & { qKey?: StyleAnswerKey };
    }
    if (m.qKey !== undefined) {
      lastDirector = null;
      if (isStyleAnswerKey(m.qKey)) return m as T & { qKey?: StyleAnswerKey };
      const { qKey: _bad, ...rest } = m as any;
      return rest;
    }
    if (isPhotoSourceBubble(m.text) || lastDirector === null) return m as T & { qKey?: StyleAnswerKey };
    const dir: string = lastDirector;
    const q = QUESTIONS.find((qq) => dir.startsWith(qq.question));
    if (!q) return m as T & { qKey?: StyleAnswerKey };
    lastDirector = null; // 한 질문의 답은 그 뒤 첫 user 버블 하나만
    return { ...m, qKey: q.key };
  });
}

/** 사진/설명 선택 버블(사진 바꾸기 대상) */
export function isPhotoSourceBubble(text: string): boolean {
  return text.startsWith(PHOTO_BUBBLE_PREFIX) || text === REUSE_PHOTO_BUBBLE || text === TEXT_ONLY_BUBBLE;
}

/** 사진 바꾸기 힌트·탭을 받는 버블 = 가장 최근 사진/설명 선택 버블 하나(이전 선택 버블은 기록으로만) */
export function latestPhotoBubbleIndex(chat: { type: string; text: string }[]): number {
  for (let i = chat.length - 1; i >= 0; i--) {
    if (chat[i].type === 'user' && isPhotoSourceBubble(chat[i].text)) return i;
  }
  return -1;
}

// ── 편집 차단 ───────────────────────────────────────────
export type EditBlockReason = 'loading' | 'job' | 'photo' | 'leaving' | 'welcome' | null;
export function editBlockReason(s: {
  initialLoading: boolean;
  hasActiveJob: boolean;
  photoResume: boolean;
  leaving: boolean;
  step: string;
}): EditBlockReason {
  if (s.initialLoading) return 'loading';
  if (s.hasActiveJob) return 'job';
  if (s.photoResume) return 'photo';
  if (s.leaving) return 'leaving';
  if (s.step === 'welcome') return 'welcome';
  return null;
}

// ── 편집 열기/커밋 ──────────────────────────────────────
export interface AnswerEditState {
  /** 편집 중인 user 버블 인덱스 */
  idx: number;
  qKey: StyleAnswerKey;
  /** 편집 입력값(칩 토글 + 자유 입력) */
  input: string;
}

/** 버블 탭 → 편집 상태. 입력 초기값 = 현재 답(생략이었다면 빈 값). 편집 대상이 아니면 null */
export function beginAnswerEdit(
  chat: EditableChatMessage[],
  idx: number,
  answers: StyleAnswers
): AnswerEditState | null {
  const m = chat[idx];
  if (!m || m.type !== 'user' || !m.qKey || !isStyleAnswerKey(m.qKey)) return null;
  return { idx, qKey: m.qKey, input: answers[m.qKey] ?? '' };
}

export type CommitResult =
  | { ok: true; chat: EditableChatMessage[]; answers: StyleAnswers; changed: boolean }
  | { ok: false; reason: 'invalid' | 'empty-without-photo' };

/**
 * 편집 커밋 — styleAnswers[qKey] 교체 + 그 버블 텍스트만 교체(이후 대화 보존). 진행 위치(step·qIndex·
 * 현재 질문 입력)는 이 함수가 다루지 않는다(화면이 편집 중에도 원래 값을 그대로 들고 있음 → 자동 복귀).
 * 사진 소스 없이 모든 답이 비게 되는 커밋은 거부(텍스트 전용은 설명이 필요 — v3.76 가드와 같은 기준).
 */
export function commitAnswerEdit(p: {
  chat: EditableChatMessage[];
  answers: StyleAnswers;
  edit: AnswerEditState;
  hasPhotoSource: boolean;
}): CommitResult {
  const { chat, answers, edit } = p;
  const m = chat[edit.idx];
  if (!m || m.type !== 'user' || m.qKey !== edit.qKey) return { ok: false, reason: 'invalid' };
  const value = edit.input.trim();
  const nextAnswers: StyleAnswers = { ...answers, [edit.qKey]: value };
  if (!p.hasPhotoSource && !buildFinalText(nextAnswers).trim()) return { ok: false, reason: 'empty-without-photo' };
  const text = answerBubbleText(edit.qKey, value);
  const nextChat = chat.map((c, i) => (i === edit.idx ? { ...c, text } : c));
  return { ok: true, chat: nextChat, answers: nextAnswers, changed: value !== (answers[edit.qKey] ?? '') || text !== m.text };
}

/**
 * 커밋 후 파생값 재계산 — 이미 계산된 값이 편집 전 답에 머물지 않게.
 * - 질문 단계(questioning): 아무것도 하지 않는다(끝낼 때 한 번 계산하는 현행 유지 — 확인 단계 버튼이 계산)
 * - 가상 화풍 단계(style): pending*(성별·이름·나이) + pendingConceptText 재계산
 * - 확인 단계(review — 답변 직후·Cody 취소 복귀 공통): pending* + taskStore conceptText/userText 재계산
 *   (Cody 는 conceptText 우선으로 읽고, 의상 설명은 Cody 가 생성 직전에 합친다 — 여기선 순수 컨셉만)
 * 의상 성별 필터(v3.230 A4)는 pending 우선 → 초안 성별 순이라 pending 을 새 값(빈 답=null)으로 맞춘다.
 */
export function derivedAfterEdit(p: { step: string; answers: StyleAnswers }): {
  store: {
    pendingGender?: string | null;
    pendingName?: string | null;
    pendingAge?: string | null;
    conceptText?: string;
    userText?: string;
  } | null;
  pendingConceptText?: string;
} {
  if (p.step !== 'style' && p.step !== 'review') return { store: null };
  const concept = conceptTextFrom(p.answers);
  if (p.step === 'style') return { store: { ...pendingFromAnswers(p.answers) }, pendingConceptText: concept };
  return { store: { ...pendingFromAnswers(p.answers), conceptText: concept, userText: concept } };
}

// ── 초안 복원 ───────────────────────────────────────────
export type ArtistStep = 'welcome' | 'questioning' | 'style' | 'review';

/**
 * 초안 복원 단계 판정.
 * - restore(Cody 취소 복귀, A3): 실사·가상 공통 'review'
 * - 구 초안(step='questioning', 마지막 질문, 분위기 답 버블 있음 — 실사가 답과 동시에 Cody 로 넘어가던 v3.230 이전):
 *   실사 'review' / 가상 'style' 로 승격(분위기 버블 중복 방지)
 * - 가상 'review'(restore 로 열렸던 초안을 일반 진입으로 다시 연 경우): 화풍이 메모리에만 있으므로 'style'
 */
export function resolveRestoredStep(p: {
  step: ArtistStep;
  qIndex: number;
  chat: EditableChatMessage[];
  selectedKind: 'real' | 'virtual' | null;
  restore: boolean;
}): ArtistStep {
  if (p.restore) return 'review';
  const virtual = p.selectedKind === 'virtual';
  if (p.step === 'review') return virtual ? 'style' : 'review';
  if (p.step === 'questioning' && p.qIndex >= LAST_QUESTION_INDEX) {
    const lastKey = QUESTIONS[LAST_QUESTION_INDEX].key;
    if (p.chat.some((m) => m.type === 'user' && m.qKey === lastKey)) return virtual ? 'style' : 'review';
  }
  return p.step;
}
