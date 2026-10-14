// v3.302 [CopyrightLog] 사람의 창작 지시(DIRECTION) 기록 페이로드 — 순수 함수(Node 하네스 검증 대상).
// 저작권 판단(정당한 권한자의 실질적·의미 있는 개입 / 의거성)에 쓰는 근거:
//   answers = 질문별 사람의 답, typed_fields = 선택지가 아니라 직접 입력한 항목, reference = 참고 사용 여부.
// 서버 routes/sessions.py DIRECTION 스키마(answers ≤40키·문자열 ≤1000자·리스트 ≤20개)와 일치시킨다.
import {
  GENRE_OPTIONS, MOOD_OPTIONS, CONTENT_OPTIONS, KEYWORD_OPTIONS,
  PERSPECTIVE_OPTIONS, LANGUAGE_OPTIONS, STRUCTURE_OPTIONS,
} from './lyricsPrompt';

export type DirectionPayload = {
  stage: 'lyrics' | 'compose' | 'arrange' | 'cover' | 'video';
  answers: Record<string, string | number | boolean | string[] | null>;
  typed_fields: string[];
  reference: { text: boolean; audio: boolean; link: boolean; named_work: boolean };
};

const clip = (v: any, n = 1000): string => String(v ?? '').slice(0, n);
const isBlank = (v: any) => v == null || String(v).trim() === '' || String(v).trim() === '없음';

/** 특정 작품·가수를 지칭하는 듯한 표현(의거성 위험 신호) — 확정 판정이 아니라 기록용 플래그 */
export function looksLikeNamedWork(text: string | null | undefined): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/\s[-–—]\s/.test(t)) return true; // "가수 - 곡" 형식
  if (/["“”'‘’「」『』《》]/.test(t)) return true; // 인용 부호로 묶은 제목
  if (/(feat\.?|ft\.|커버|원곡|리메이크|패러디)/i.test(t)) return true;
  // "OOO처럼/OOO 느낌/OOO 스타일" + 고유명사 같은 대문자 영단어
  if (/(처럼|느낌|스타일|같은)/.test(t) && /\b[A-Z][A-Za-z0-9&.']+/.test(t)) return true;
  return false;
}

export function buildLyricsDirection(st: {
  genre?: string; mood?: string; content?: string; keywords?: string; perspective?: string;
  language?: string; structure?: string; duration?: number; hasRap?: boolean; isDuet?: boolean; reference?: string;
}): DirectionPayload {
  const answers: DirectionPayload['answers'] = {
    genre: clip(st.genre), mood: clip(st.mood), topic: clip(st.content), keywords: clip(st.keywords),
    perspective: clip(st.perspective), language: clip(st.language), structure: clip(st.structure),
    duration_sec: typeof st.duration === 'number' ? Math.round(st.duration) : null,
    rap: !!st.hasRap, duet: !!st.isDuet, extra_request: isBlank(st.reference) ? '' : clip(st.reference),
  };
  const typed: string[] = [];
  const check = (key: string, value: any, opts: string[]) => {
    if (!isBlank(value) && !opts.includes(String(value))) typed.push(key);
  };
  check('genre', st.genre, GENRE_OPTIONS);
  check('mood', st.mood, MOOD_OPTIONS);
  check('topic', st.content, CONTENT_OPTIONS);
  check('keywords', st.keywords, KEYWORD_OPTIONS);
  check('perspective', st.perspective, PERSPECTIVE_OPTIONS);
  check('language', st.language, LANGUAGE_OPTIONS);
  check('structure', st.structure, STRUCTURE_OPTIONS);
  if (!isBlank(st.reference)) typed.push('extra_request');
  const named = [st.reference, st.content, st.keywords].some((x) => looksLikeNamedWork(x));
  return {
    stage: 'lyrics',
    answers,
    typed_fields: typed,
    reference: { text: !isBlank(st.reference), audio: false, link: false, named_work: named },
  };
}

export function buildComposeDirection(p: {
  genre?: string; mood?: string; tempo?: string; vocal?: string; vocalStyle?: string; style?: string;
  referenceStyle?: string; bpm?: string; musicalKey?: string; negativeTags?: string; personaModel?: string;
  isDuet?: boolean; subVocal?: string; subVocalStyle?: string; instrumental?: boolean; durationSec?: number; vocalAge?: number;
  audioWeight?: number | null; referenceData?: { object_name?: string } | null; referenceLink?: boolean;
}, stage: 'compose' | 'arrange' = 'compose'): DirectionPayload {
  const answers: DirectionPayload['answers'] = {
    genre: clip(p.genre), mood: clip(p.mood), tempo: clip(p.tempo), vocal: clip(p.vocal),
    vocal_style: clip(p.vocalStyle), style: clip(p.style), reference_style: clip(p.referenceStyle),
    bpm: clip(p.bpm), key: clip(p.musicalKey), excluded_styles: clip(p.negativeTags),
    my_voice: p.personaModel === 'voice', duet: !!p.isDuet, sub_vocal: clip(p.subVocal),
    sub_vocal_style: clip(p.subVocalStyle), instrumental: !!p.instrumental,
    vocal_age: typeof p.vocalAge === 'number' ? Math.round(p.vocalAge) : null, // v3.330 [VocalAge]
    duration_sec: typeof p.durationSec === 'number' ? Math.round(p.durationSec) : null,
    reference_audio_weight: typeof p.audioWeight === 'number' ? Math.round(p.audioWeight * 100) : null,
  };
  const typed: string[] = [];
  if (!isBlank(p.referenceStyle)) typed.push('reference_style');
  if (!isBlank(p.negativeTags)) typed.push('excluded_styles');
  if (!isBlank(p.bpm)) typed.push('bpm');
  return {
    stage,
    answers,
    typed_fields: typed,
    reference: {
      text: !isBlank(p.referenceStyle),
      audio: !!p.referenceData?.object_name,
      link: !!p.referenceLink,
      named_work: looksLikeNamedWork(p.referenceStyle),
    },
  };
}

/** v3.359 [Governance] 커버 연출 지시 — 사람이 정한 스타일·구도·표정·색감·배경·아티스트 포함 여부 */
export function buildCoverDirection(p: {
  title?: string; style?: string; shot?: string; expression?: string; palette?: string;
  background_prompt?: string; background_object_name?: string; lyrics_excerpt?: string;
  character_object_name?: string; character_kind?: string; character_art_style?: string;
}): DirectionPayload {
  const answers: DirectionPayload['answers'] = {
    title: clip(p.title, 200), style: clip(p.style), shot: clip(p.shot), expression: clip(p.expression),
    palette: clip(p.palette), background: clip(p.background_prompt), background_photo: !!p.background_object_name,
    lyrics_excerpt: clip(p.lyrics_excerpt, 300), with_artist: !!p.character_object_name,
    artist_kind: clip(p.character_kind), art_style: clip(p.character_art_style),
  };
  const typed: string[] = [];
  if (!isBlank(p.style)) typed.push('style');
  if (!isBlank(p.background_prompt)) typed.push('background');
  return {
    stage: 'cover',
    answers,
    typed_fields: typed,
    reference: {
      text: !isBlank(p.style) || !isBlank(p.background_prompt),
      audio: false,
      link: false,
      named_work: looksLikeNamedWork(p.style) || looksLikeNamedWork(p.background_prompt),
    },
  };
}

/** v3.359 [Governance] 영상 연출 지시 — 형식·배치·가사 표시·글꼴·배경·자막 위치·구간 */
export function buildVideoDirection(params: Record<string, any>): DirectionPayload {
  const answers: DirectionPayload['answers'] = {};
  Object.entries(params || {}).slice(0, 30).forEach(([k, v]) => {
    answers[k] = typeof v === 'number' || typeof v === 'boolean' ? v : clip(v, 200);
  });
  if (!Object.keys(answers).length) answers.format = '';
  return { stage: 'video', answers, typed_fields: [], reference: { text: false, audio: false, link: false, named_work: false } };
}
