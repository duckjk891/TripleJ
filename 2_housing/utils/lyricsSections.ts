// [SectionLyrics] v3.281: 곡 구성(벌스·후렴·브릿지…)별 가사 편집을 위한 순수 파서/조립기.
// 외부 테스터 피드백 D — "가사 전체를 텍스트박스 하나로 편집하는 건 모바일에서 너무 어렵다".
//
// 규칙
// - 섹션 시작 = 줄 전체(앞뒤 공백 허용)가 `[...]` 이고, 안쪽이 섹션 키워드
//   (Intro|Verse|Pre-Chorus|Chorus|Post-Chorus|Hook|Bridge|Breakdown|Interlude|Rap|Outro|Refrain|Drop,
//    한국어 벌스|후렴|사비|브릿지|인트로|아웃트로 …)로 시작하는 줄. 대소문자 무시, 뒤 숫자/콜론 수식어 허용.
// - 그 외 `[...]` 줄(듀엣 헤더 `[This song is a duet …]`, 줄 단독 `[Male]` 등)·`===` 구분선·일반 줄은
//   preamble(첫 섹션 이전) 또는 직전 섹션 body 로 **원문 그대로** 보존.
// - 왕복 불변: 편집하지 않으면 joinLyricsSections(parse(x).preamble, parse(x).sections) === x
//   (공백·빈 줄·CRLF 포함). 이를 위해 섹션은 tag(태그 줄 원문) + lead(태그 뒤 줄바꿈) + body + trail(끝 줄바꿈들)
//   로 쪼개 보관하고, 편집 UI 에는 body 만 노출한다.
// - React/RN 의존 없음 — Node 하니스로 단위 검증 가능.

export interface LyricsSection {
  /** 위치 기반 id(s0, s1, …) — 섹션 개수가 바뀌지 않는 한 편집 중에도 안정 */
  id: string;
  /** 태그 줄 원문(예: "[Verse 1: rap flow]", CR 포함 가능) — 재조립 시 그대로 */
  tag: string;
  /** 한국어 표시명(예: "벌스 1", "후렴", "마지막 후렴") */
  label: string;
  /** 숫자 없는 종류명(예: "벌스", "후렴") — "같은 후렴 n곳" 문구용 */
  kind: string;
  /** 태그 수식어(예: "belting, powerful") — 없으면 '' */
  hint: string;
  /** 편집 대상 본문(태그 줄 다음 줄부터, 끝 줄바꿈 제외) */
  body: string;
  /** 태그 줄과 body 사이 줄바꿈('\n' | '\r\n' | '') */
  lead: string;
  /** body 뒤 줄바꿈들(다음 섹션 전 빈 줄 포함) */
  trail: string;
  /** 같은 내용(공백 정규화) 섹션이 2곳 이상이면 공통 키, 아니면 null — 후렴 반복 */
  linkedKey: string | null;
}

export interface ParsedLyrics {
  /** 첫 섹션 태그 이전 원문(줄바꿈 포함). 섹션이 0개면 전체 원문 */
  preamble: string;
  sections: LyricsSection[];
}

// 영어 키워드 — 뒤에 단어 경계(공백·숫자·콜론·대시·괄호·쉼표·끝) 필요. pre/post-chorus 를 chorus 보다 먼저.
const EN_KEYWORD =
  /^(?:(final|last|double|repeat|repeated|instrumental|extended|short)\s+)?(pre[\s-]?chorus|post[\s-]?chorus|intro|verse|chorus|hook|bridge|breakdown|interlude|rap|outro|refrain|drop)(?=$|[\s\d:：\-–—(,./|])/i;
// 한국어 키워드 — 한글은 단어 경계가 없어 "후렴구", "벌스1" 처럼 바로 붙는 경우 허용.
const KO_KEYWORD =
  /^(?:(마지막)\s*)?(프리\s?코러스|포스트\s?코러스|벌스|후렴|사비|브릿지|브리지|인트로|아웃트로|간주|코러스|훅|랩)/;

const EN_LABEL: Record<string, string> = {
  prechorus: '프리코러스',
  postchorus: '포스트코러스',
  intro: '인트로',
  verse: '벌스',
  chorus: '후렴',
  hook: '훅',
  bridge: '브릿지',
  breakdown: '브레이크다운',
  interlude: '간주',
  rap: '랩',
  outro: '아웃트로',
  refrain: '후렴구',
  drop: '드롭',
};
const EN_PREFIX_LABEL: Record<string, string> = {
  final: '마지막',
  last: '마지막',
  double: '더블',
  repeat: '반복',
  repeated: '반복',
  instrumental: '연주',
  extended: '확장',
  short: '짧은',
};
const KO_LABEL: Record<string, string> = {
  사비: '후렴',
  코러스: '후렴',
  브리지: '브릿지',
};

export interface SectionTagInfo {
  label: string;
  kind: string;
  hint: string;
}

/** 한 줄이 섹션 시작 태그면 표시 정보, 아니면 null (CR·앞뒤 공백 무시) */
export function matchSectionTag(line: string): SectionTagInfo | null {
  const t = line.replace(/\r$/, '').trim();
  const m = /^\[([^\[\]\n]+)\]$/.exec(t);
  if (!m) return null;
  const inner = m[1].trim();
  let prefix = '';
  let kind = '';
  let rest = '';
  const en = EN_KEYWORD.exec(inner);
  if (en) {
    prefix = en[1] ? EN_PREFIX_LABEL[en[1].toLowerCase()] || '' : '';
    kind = EN_LABEL[en[2].toLowerCase().replace(/[\s-]/g, '')] || en[2];
    rest = inner.slice(en[0].length);
  } else {
    const ko = KO_KEYWORD.exec(inner);
    if (!ko) return null;
    prefix = ko[1] ? '마지막' : '';
    const raw = ko[2].replace(/\s/g, '');
    kind = KO_LABEL[raw] || raw;
    rest = inner.slice(ko[0].length);
  }
  // 숫자(벌스 1) + 수식어(": rap flow", " - Male", "(soft)")
  const num = /^\s*(\d+)/.exec(rest);
  const number = num ? num[1] : '';
  if (num) rest = rest.slice(num[0].length);
  const hint = rest.replace(/^[\s:：\-–—,./|]+/, '').replace(/^\((.*)\)$/, '$1').trim();
  const label = [prefix, kind, number].filter(Boolean).join(' ');
  return { label, kind, hint };
}

function normalizeBody(body: string): string {
  return body
    .split('\n')
    .map((l) => l.replace(/\r$/, '').trim())
    .filter(Boolean)
    .join('\n');
}

/** 같은 내용 섹션 그룹 키 부여(2곳 이상일 때만) — 제자리 갱신 */
function assignLinkedKeys(sections: LyricsSection[]): void {
  const count = new Map<string, number>();
  const norms = sections.map((s) => normalizeBody(s.body));
  norms.forEach((n) => {
    if (n) count.set(n, (count.get(n) || 0) + 1);
  });
  sections.forEach((s, i) => {
    const n = norms[i];
    s.linkedKey = n && (count.get(n) || 0) >= 2 ? n : null;
  });
}

export function parseLyricsSections(text: string): ParsedLyrics {
  const src = typeof text === 'string' ? text : '';
  // 줄 시작 오프셋과 태그 여부 수집
  const starts: { start: number; end: number; info: SectionTagInfo }[] = [];
  let pos = 0;
  while (pos <= src.length) {
    const nl = src.indexOf('\n', pos);
    const end = nl === -1 ? src.length : nl;
    const line = src.slice(pos, end);
    const info = matchSectionTag(line);
    if (info) starts.push({ start: pos, end, info });
    if (nl === -1) break;
    pos = nl + 1;
  }
  if (starts.length === 0) return { preamble: src, sections: [] };

  const preamble = src.slice(0, starts[0].start);
  const sections: LyricsSection[] = starts.map((s, i) => {
    const next = i + 1 < starts.length ? starts[i + 1].start : src.length;
    const tag = src.slice(s.start, s.end);
    const rest = src.slice(s.end, next);
    const leadM = /^\r?\n/.exec(rest);
    const lead = leadM ? leadM[0] : '';
    const remainder = rest.slice(lead.length);
    const trailM = /(?:\r?\n)+$/.exec(remainder);
    const trail = trailM ? trailM[0] : '';
    const body = remainder.slice(0, remainder.length - trail.length);
    return {
      id: `s${i}`,
      tag,
      label: s.info.label,
      kind: s.info.kind,
      hint: s.info.hint,
      body,
      lead,
      trail,
      linkedKey: null,
    };
  });
  assignLinkedKeys(sections);
  return { preamble, sections };
}

export function joinLyricsSections(preamble: string, sections: LyricsSection[]): string {
  let out = preamble || '';
  if (sections.length === 0) return out;
  // 편집으로 preamble 끝 줄바꿈이 사라졌으면 첫 태그가 같은 줄에 붙지 않게 보정(무편집 시 발동 안 함)
  if (out && !out.endsWith('\n')) out += '\n';
  sections.forEach((s, i) => {
    const body = s.body || '';
    // 무편집 원문에서는 body 가 있으면 lead 도 항상 있다 — 빈 섹션에 새로 입력한 경우만 보정
    const lead = s.lead || (body ? '\n' : '');
    let seg = s.tag + lead + body + (s.trail || '');
    // 다음 태그는 반드시 줄 시작이어야 한다(무편집 원문에서는 이미 '\n' 으로 끝남)
    if (i < sections.length - 1 && !seg.endsWith('\n')) seg += '\n';
    out += seg;
  });
  return out;
}

/** idx 섹션 body 교체(+ sync 이면 같은 linkedKey 섹션 모두). 새 배열 반환, linkedKey 재계산. */
export function updateSectionBody(
  sections: LyricsSection[],
  idx: number,
  body: string,
  sync: boolean,
): LyricsSection[] {
  const target = sections[idx];
  if (!target) return sections;
  const key = target.linkedKey;
  const next = sections.map((s, i) =>
    i === idx || (sync && key != null && s.linkedKey === key) ? { ...s, body } : { ...s },
  );
  assignLinkedKeys(next);
  return next;
}

/** 같은 linkedKey 를 가진 섹션 인덱스(자기 포함). 그룹 아니면 [idx] */
export function linkedIndices(sections: LyricsSection[], idx: number): number[] {
  const key = sections[idx]?.linkedKey;
  if (key == null) return [idx];
  const out: number[] = [];
  sections.forEach((s, i) => {
    if (s.linkedKey === key) out.push(i);
  });
  return out;
}

/** 비어 있지 않은 줄 수 */
export function countLyricLines(body: string): number {
  return body.split('\n').filter((l) => l.trim().length > 0).length;
}

/** v3.284: 본문 끝 줄바꿈 제거 — 끝 줄바꿈은 재조립·재파싱 때 섹션 사이 간격(trail)으로 흡수되므로
 *  편집기는 입력 원문을 로컬 draft 로 들고 상위에는 이 값을 올린다(엔터 무반응·빈 줄 누적 방지) */
export function stripTrailingNewlines(t: string): string {
  return t.replace(/(?:\r?\n)+$/, '');
}
