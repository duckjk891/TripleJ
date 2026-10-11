// v3.330 [VocalAge] 목소리 나이 — 작곡 AI(Suno)는 나이 파라미터가 없고 스타일 문장에 반응한다.
// 2026-10-11 시험(같은 가사·장르, 묘사만 다른 4건): "8-year-old girl vocal" 처럼 나이 숫자로도 아이·10대·성인이
// 충분히 구분됨(대표 청취 확인) → 나이(숫자) + 성별 명사로 스타일 태그 1개를 만든다.
// 아티스트 작곡 = 아티스트 나이(자유 입력 문자열)를 숫자로 해석, 아티스트 없이 = 작곡 대화에서 질문.

export const VOICE_AGE_ANY = '나이 상관없음';

/** 작곡 대화 선택지 — 라벨 → 대표 나이(숫자). null = 태그 없음(기존과 동일) */
export const VOICE_AGE_OPTIONS: { label: string; age: number | null }[] = [
  { label: '어린이 (8살 정도)', age: 8 },
  { label: '초등 고학년 (11살 정도)', age: 11 },
  { label: '10대 (16살 정도)', age: 16 },
  { label: '20대', age: 25 },
  { label: '30대', age: 35 },
  { label: '40대', age: 45 },
  { label: '50대 이상', age: 55 },
  { label: VOICE_AGE_ANY, age: null },
];

export const voiceAgeFromLabel = (label: string): number | null =>
  VOICE_AGE_OPTIONS.find((o) => o.label === label)?.age ?? null;

/** 대화 버블·편집 표시용 라벨(대표 나이 → 선택지 라벨, 없으면 "N살") */
export const voiceAgeLabel = (age: number | null | undefined): string => {
  if (age == null) return VOICE_AGE_ANY;
  return VOICE_AGE_OPTIONS.find((o) => o.age === age)?.label ?? `${age}살`;
};

const MIN_AGE = 5;
const MAX_AGE = 80;

/**
 * 아티스트 나이(자유 입력) → 대표 나이. 실데이터 예: '30대', '20대 초반', '20대 중반, 30대', '8', '1살', '27, 20대 중반', '60'.
 * 첫 표기만 쓴다: 'N대' = 10의 자리 + (초반 2·중반 5·후반 8, 표기 없으면 5), 숫자만 = 그 나이. 5~80으로 제한, 해석 불가 = null.
 */
export function parseArtistAge(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const m = s.match(/(\d{1,3})\s*(대)?\s*(초반|중반|후반)?/);
  if (!m) return null;
  let n = parseInt(m[1], 10);
  if (!Number.isFinite(n)) return null;
  if (m[2]) {
    const off = m[3] === '초반' ? 2 : m[3] === '후반' ? 8 : 5;
    n = Math.floor(n / 10) * 10 + off;
  }
  return Math.min(MAX_AGE, Math.max(MIN_AGE, n));
}

/**
 * 나이 + 보컬 성별 → Suno 스타일 태그. gender: '남성' | '여성' | 그 외(듀엣·미지정 = 성별 중립 명사).
 * 예: (8,'여성') → '8-year-old girl vocal', (16,'남성') → '16-year-old teenage boy vocal', (35,'여성') → '35-year-old woman vocal'
 */
export function vocalAgeTag(age: number | null | undefined, gender?: string | null, duet = false): string {
  if (age == null || !Number.isFinite(age)) return '';
  const a = Math.round(Math.min(MAX_AGE, Math.max(MIN_AGE, age)));
  const g = duet ? '' : (gender || '').trim();
  const noun =
    a <= 12
      ? g === '여성' ? 'girl' : g === '남성' ? 'boy' : 'child'
      : a <= 19
        ? g === '여성' ? 'teenage girl' : g === '남성' ? 'teenage boy' : 'teenage'
        : g === '여성' ? 'woman' : g === '남성' ? 'man' : 'adult';
  return duet ? `${a}-year-old ${noun} duet vocals` : `${a}-year-old ${noun} vocal`;
}
