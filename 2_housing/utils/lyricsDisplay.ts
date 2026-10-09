// v3.306 [LyricsDisplay] 가사 '보여주기' 전용 정리 — 원본(작곡 요청·편집용)은 그대로 둔다(대표 10-08).
//  · [Verse]/[Chorus: …]/[This song is a duet …] 같은 줄 전체 마커 → 줄 삭제
//  · 듀엣 파트 표시 [Female]/[Male]/[Both] 등 줄 안의 [..] → 지움(가사만 남김)
//  · === / == 1절 == 같은 구분 표시 → 지움
//  · (SFX: …) 같은 효과음 지시 줄 → 줄 삭제(v3.314)
//  · 원래 있던 빈 줄(문단 구분)은 1줄로 유지, 마커 삭제로 생긴 빈 줄은 남기지 않음
const BRACKET_RE = /\[[^\]\n]*\]/g;
const OPEN_BRACKET_TAIL_RE = /\[[^\]\n]*$/; // 닫히지 않은 [ … (줄 끝까지)
const EQ_RE = /={2,}/g;
const SEPARATOR_LINE_RE = /^\s*[=\-_~*#]{2,}\s*$/;
// v3.314: '(SFX: …)' 같은 효과음·연출 지시만 있는 줄(괄호 전체) — 가사가 아니므로 숨김. '(오)' 같은 추임새는 유지.
const DIRECTION_LINE_RE = /^\s*\(\s*(sfx|sound|sound effect|effects?|instrumental|inst|효과음|연주)(?=[\s:：)])[^)]*\)\s*$/i;

/** 한 줄 정리(순수) — 표시할 내용이 없으면 '' */
export function cleanLyricLine(line: string): string {
  if (SEPARATOR_LINE_RE.test(line) || DIRECTION_LINE_RE.test(line)) return '';
  return line
    .replace(BRACKET_RE, '')
    .replace(OPEN_BRACKET_TAIL_RE, '')
    .replace(EQ_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** 가사 전체 정리(순수) */
export function cleanLyricsForDisplay(raw: string | null | undefined): string {
  if (!raw) return '';
  const out: string[] = [];
  for (const line of String(raw).replace(/\r\n?/g, '\n').split('\n')) {
    if (!line.trim()) {
      if (out.length && out[out.length - 1] !== '') out.push(''); // 문단 구분 1줄
      continue;
    }
    const c = cleanLyricLine(line);
    if (c) out.push(c);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}
