// v3.359 [Governance] 창작 기록 보기 — 서버 리포트를 사람이 읽는 문장으로(순수 함수, Node 하네스 검증 대상).

const STAGE_LABEL: Record<string, string> = { lyrics: '작사', compose: '작곡', arrange: '편곡', cover: '커버', video: '영상' };
const TYPE_LABEL: Record<string, string> = {
  SESSION_START: '창작 시작', DIRECTION: '창작 지시', GEN_REQUEST: 'AI 생성 요청', GEN_RESPONSE: 'AI 생성 결과',
  LISTEN: '들어 보기', CANDIDATE_SELECT: '후보 선택', LYRIC_EDIT: '가사 저장', FINALIZE: '발매 확정',
};
const ANSWER_LABEL: Record<string, string> = {
  genre: '장르', mood: '분위기', topic: '주제', keywords: '키워드', perspective: '시점', language: '언어', structure: '구성',
  duration_sec: '길이(초)', rap: '랩', duet: '듀엣', extra_request: '추가 요청', tempo: '빠르기', vocal: '보컬',
  vocal_style: '창법', style: '스타일', reference_style: '참고 분위기', bpm: 'BPM', key: '조성', excluded_styles: '제외 스타일',
  my_voice: '내 목소리', sub_vocal: '보조 보컬', sub_vocal_style: '보조 창법', instrumental: '반주만', vocal_age: '목소리 나이',
  reference_audio_weight: '참고 음원 반영(%)', title: '제목', shot: '구도', expression: '표정', palette: '색감',
  background: '배경', background_photo: '배경 사진', lyrics_excerpt: '가사 문구', with_artist: '아티스트 포함',
  artist_kind: '아티스트 종류', art_style: '화풍', format: '형식', layout: '배치', shape: '모양', lyrics: '가사 표시',
  font: '글꼴', fontcolor: '글자색', subpos: '자막 위치', clip_start: '구간 시작', clip_end: '구간 끝',
};

export function creationEventLabel(e: { type?: string; detail?: any }): string {
  const base = TYPE_LABEL[e?.type || ''] || e?.type || '';
  if (e?.type === 'DIRECTION' && e.detail?.stage) return `${STAGE_LABEL[e.detail.stage] || e.detail.stage} 지시`;
  if (e?.type === 'GEN_REQUEST' && e.detail?.engine) return `${base}(${e.detail.engine === 'lyrics' ? '가사' : e.detail.engine})`;
  return base;
}

function fmtVal(v: any): string {
  if (v === true) return '예';
  if (v === false) return '아니요';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

/** 지시 상세 → "장르: 발라드 (직접 입력)" 줄 목록. 빈 값·기본값은 뺀다. */
export function directionLines(detail: any): string[] {
  const answers = detail?.answers || {};
  const typed: string[] = detail?.typed_fields || [];
  const out: string[] = [];
  Object.entries(answers).forEach(([k, v]) => {
    if (v === null || v === undefined || v === '' || v === false || (Array.isArray(v) && !v.length)) return;
    out.push(`${ANSWER_LABEL[k] || k}: ${fmtVal(v)}${typed.includes(k) ? ' (직접 입력)' : ''}`);
  });
  const ref = detail?.reference || {};
  if (ref.audio) out.push('참고 음원 사용');
  if (ref.link) out.push('참고 링크 사용');
  if (ref.named_work) out.push('특정 작품을 가리키는 표현 있음');
  return out;
}

/** 사람의 개입 요약 → 문장 목록 */
export function summaryLines(s: any): string[] {
  if (!s) return ['요약 정보가 없어요.'];
  const out: string[] = [];
  if (s.directions) out.push(`창작 지시 ${s.directions}번${s.typed_answers ? ` (직접 입력 ${s.typed_answers}개)` : ''}`);
  if (s.lyrics_fully_human) out.push('가사를 처음부터 직접 썼어요');
  else if (typeof s.lyrics_ai_similarity_permille === 'number') {
    out.push(`최종 가사가 AI 초안과 ${Math.round(s.lyrics_ai_similarity_permille / 10)}% 같아요(나머지는 직접 고침)`);
  }
  if (s.lyric_user_edits) out.push(`가사 직접 수정 ${s.lyric_user_edits}번`);
  if (s.lyric_gen_requests) out.push(`가사 생성 요청 ${s.lyric_gen_requests}번`);
  if (s.music_gen_requests) out.push(`작곡 생성 요청 ${s.music_gen_requests}번`);
  if (s.listens) out.push(`후보 들어 보기 ${s.listens}번`);
  if (s.candidate_selects) out.push(`후보 선택 ${s.candidate_selects}번`);
  return out.length ? out : ['기록된 개입이 없어요.'];
}

export function fmtKstDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${k.getUTCFullYear()}.${p(k.getUTCMonth() + 1)}.${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}
