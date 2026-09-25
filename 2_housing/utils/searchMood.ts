// v3.231 A4·A5 [Search] 검색 화면 느낌 칩 — 순수 함수 모듈(I/O 없음, Node 하네스 검증 대상).
//   · A4 로맨스 포커싱(대표 결정 D3): 서버 `/charts/categories` 순서는 그대로 두고 앱에서만 로맨스를 맨 앞으로 옮긴다.
//     진입 시 기본 선택 = 로맨스(목록에 없으면 첫 칩).
//   · A5 느낌 이름 검색 바로 가기: 검색어가 칩 목록의 느낌 이름과 정확히 같으면(앞뒤·중간 공백 무시)
//     일반 검색 대신 그 느낌 목록으로 연결 — 서버 카테고리 색인(S1) 배포 전에도 "로맨스" 0건 해소.
//     로맨스뿐 아니라 칩에 있는 모든 느낌 이름에 같은 규칙(칩과 동일한 목록 기준, 별칭·부분 일치는 하지 않음).

// 검색 화면이 포커싱할 느낌
export const SEARCH_FOCUS_MOOD = '로맨스';

// 느낌 카테고리 폴백 — 서버 constants/categories.py 순서(운동~잠자기). 화면 표시는 orderMoodChips 로 재정렬.
export const MOOD_CATEGORY_FALLBACK: readonly string[] = [
  '운동', '에너지 충전', '휴식', '출퇴근길', '행복한 기분', '집중', '로맨스', '파티', '슬픔', '잠자기',
];

// 비교 키: 앞뒤 공백 제거 + 모든 공백 제거(예: "에너지충전" = "에너지 충전")
const moodKey = (v: string) => (typeof v === 'string' ? v.replace(/\s+/g, '') : '');

// 서버 응답(또는 폴백)을 칩 표시 순서로 — 문자열만·앞뒤 공백 정리·중복 제거, 포커스 느낌을 맨 앞으로.
// 유효 항목이 하나도 없으면 폴백 목록을 같은 규칙으로 정렬해 돌려준다.
export function orderMoodChips(list: unknown, focus: string = SEARCH_FOCUS_MOOD): string[] {
  const src = Array.isArray(list) ? list : [];
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const it of src) {
    if (typeof it !== 'string') continue;
    const name = it.trim();
    const key = moodKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    clean.push(name);
  }
  const base = clean.length ? clean : [...MOOD_CATEGORY_FALLBACK];
  const fk = moodKey(focus);
  const idx = fk ? base.findIndex((c) => moodKey(c) === fk) : -1;
  if (idx <= 0) return base;
  return [base[idx], ...base.slice(0, idx), ...base.slice(idx + 1)];
}

// 진입 시 기본 선택 느낌 — 포커스 느낌이 목록에 있으면 그것, 없으면 첫 칩, 빈 목록이면 null
export function pickDefaultMood(chips: readonly string[], focus: string = SEARCH_FOCUS_MOOD): string | null {
  if (!Array.isArray(chips) || !chips.length) return null;
  const fk = moodKey(focus);
  const hit = fk ? chips.find((c) => moodKey(c) === fk) : undefined;
  return hit ?? chips[0] ?? null;
}

// 검색어가 칩의 느낌 이름과 정확히 같으면 그 칩 이름(칩 표기 그대로), 아니면 null.
// "로맨스 노래"·"로맨"·"로맨틱" 처럼 정확히 같지 않은 검색어는 일반 검색(null).
export function matchMoodQuery(query: string, chips: readonly string[]): string | null {
  const qk = moodKey(query);
  if (!qk || !Array.isArray(chips)) return null;
  return chips.find((c) => moodKey(c) === qk) ?? null;
}
