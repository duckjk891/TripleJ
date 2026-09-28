/**
 * v3.251 아티스트 인지도(RP) 레벨 모델 + 기획사 레거시 룩업
 *
 * - 아티스트: 5티어 × 세부 5단계(5→1) = 총 25스텝 (기획안 v2.0 확정)
 *   연습생 → 신인 → 루키 → 라이징 → 아이돌, 각 티어 안에서 5가 시작·1이 정점.
 *   표기: "연습생 5" · "루키 3" · "아이돌 1".
 *   서버(/character/list recognition)가 정본 — 이 표는 표시(진행바·폴백)용 미러.
 *   구 이모지 등급표(ARTIST_RANKS: 신인~레전드)는 v3.251에서 폐기(이모지 전시 금지 방침).
 * - 기획사: 레거시 유지(companyStore 무접촉) — emoji 필드는 빈 문자열로 미사용화.
 */

// ─── 아티스트 인지도 (v3.251) ────────────────────────────────

export type RecognitionTier = 'trainee' | 'newcomer' | 'rookie' | 'rising' | 'idol';

export type RecognitionSub = 1 | 2 | 3 | 4 | 5;

export interface ArtistRecognition {
  /** 누적 인지도 포인트(RP) — 서버 정본 */
  rp: number;
  tier: RecognitionTier;
  /** 세부 단계 — 5가 시작, 1이 정점 */
  sub: RecognitionSub;
  /** 표시 라벨 — '연습생 5' … '아이돌 1' (서버 label 우선) */
  label: string;
  /** 전체 25스텝 중 위치(1..25) */
  step: number;
}

export const RECOGNITION_TIER_ORDER: RecognitionTier[] = [
  'trainee', 'newcomer', 'rookie', 'rising', 'idol',
];

export const RECOGNITION_TIER_LABELS: Record<RecognitionTier, string> = {
  trainee: '연습생',
  newcomer: '신인',
  rookie: '루키',
  rising: '라이징',
  idol: '아이돌',
};

/**
 * 티어별 세부 5→1 진입 RP (대표 확정 v2.1 — 표시용 미러, 서버 recognition 이 항상 우선).
 * 배열 인덱스 0 = sub 5(티어 시작), 4 = sub 1(티어 정점 진입).
 * 용도는 진행바의 '현재/다음 단계' 표시뿐 — 서버 rp가 표와 어긋나도(드리프트) 0..1 클램프로 강등.
 */
export const RECOGNITION_THRESHOLDS: Record<RecognitionTier, [number, number, number, number, number]> = {
  trainee: [0, 20, 40, 60, 80],
  newcomer: [100, 300, 600, 1000, 1600],
  rookie: [2400, 3500, 5000, 7000, 9500],
  rising: [12500, 16500, 21500, 28000, 36000],
  idol: [45000, 56000, 70000, 85000, 100000],
};

export interface RecognitionStep {
  tier: RecognitionTier;
  sub: RecognitionSub;
  label: string;
  /** 1..25 */
  step: number;
  /** 이 단계 진입에 필요한 누적 RP */
  minRp: number;
}

export function recognitionLabel(tier: RecognitionTier, sub: number): string {
  return `${RECOGNITION_TIER_LABELS[tier]} ${sub}`;
}

/** 25스텝 평탄화(오름차순) — step = 인덱스+1 */
export const RECOGNITION_STEPS: RecognitionStep[] = RECOGNITION_TIER_ORDER.flatMap((tier, ti) =>
  RECOGNITION_THRESHOLDS[tier].map((minRp, i) => {
    const sub = (5 - i) as RecognitionSub;
    return {
      tier,
      sub,
      label: recognitionLabel(tier, sub),
      step: ti * 5 + i + 1,
      minRp,
    };
  })
);

export const RECOGNITION_MAX_STEP = RECOGNITION_STEPS.length; // 25

export const DEFAULT_RECOGNITION: ArtistRecognition = {
  rp: 0,
  tier: 'trainee',
  sub: 5,
  label: recognitionLabel('trainee', 5),
  step: 1,
};

function stepOf(tier: RecognitionTier, sub: RecognitionSub): number {
  return RECOGNITION_TIER_ORDER.indexOf(tier) * 5 + (5 - sub) + 1;
}

/** rp만으로 단계 산출(서버 tier 누락 시 표시 폴백) */
export function recognitionFromRp(rp: number): ArtistRecognition {
  const safe = typeof rp === 'number' && Number.isFinite(rp) && rp > 0 ? rp : 0;
  let cur = RECOGNITION_STEPS[0];
  for (const s of RECOGNITION_STEPS) {
    if (safe >= s.minRp) cur = s;
  }
  return { rp: safe, tier: cur.tier, sub: cur.sub, label: cur.label, step: cur.step };
}

/**
 * 서버 recognition 페이로드 방어 파싱.
 * 구서버(필드 부재)·비정상 값 = 연습생 5(DEFAULT) 강등 — 크래시 0.
 * tier·sub 가 유효하면 서버 값을 그대로 신뢰(label·step 은 누락 시 클라 산출).
 */
export function normalizeRecognition(raw: unknown): ArtistRecognition {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_RECOGNITION };
  const r = raw as Record<string, unknown>;
  const rp = typeof r.rp === 'number' && Number.isFinite(r.rp) && r.rp > 0 ? r.rp : 0;
  const tier = (RECOGNITION_TIER_ORDER as string[]).includes(r.tier as string)
    ? (r.tier as RecognitionTier)
    : null;
  const sub = typeof r.sub === 'number' && [1, 2, 3, 4, 5].includes(r.sub)
    ? (r.sub as RecognitionSub)
    : null;
  if (!tier || !sub) {
    // tier/sub 누락(구서버·부분 응답) — rp 기준 표시 폴백(rp도 없으면 연습생 5)
    return recognitionFromRp(rp);
  }
  const step = typeof r.step === 'number' && r.step >= 1 && r.step <= RECOGNITION_MAX_STEP
    ? Math.floor(r.step)
    : stepOf(tier, sub);
  const label = typeof r.label === 'string' && r.label ? r.label : recognitionLabel(tier, sub);
  return { rp, tier, sub, label, step };
}

/** 현재 단계 진입 RP(진행바 시작점) */
export function recognitionStepBaseRp(rec: Pick<ArtistRecognition, 'step'>): number {
  const s = RECOGNITION_STEPS[Math.min(Math.max(rec.step, 1), RECOGNITION_MAX_STEP) - 1];
  return s ? s.minRp : 0;
}

/** 다음 단계 진입 RP — 아이돌 1(최고 단계)이면 null */
export function recognitionNextStepRp(rec: Pick<ArtistRecognition, 'step'>): number | null {
  if (rec.step >= RECOGNITION_MAX_STEP) return null;
  const s = RECOGNITION_STEPS[rec.step]; // step은 1-base → 다음 = 인덱스 step
  return s ? s.minRp : null;
}

/** 진행바 비율 0..1 — 최고 단계는 1 고정 */
export function recognitionProgress(rec: Pick<ArtistRecognition, 'rp' | 'step'>): number {
  const next = recognitionNextStepRp(rec);
  if (next == null) return 1;
  const base = recognitionStepBaseRp(rec);
  if (next <= base) return 0;
  return Math.min(1, Math.max(0, (rec.rp - base) / (next - base)));
}

// ─── 기획사 (레거시 — companyStore 무접촉 유지) ─────────────

export interface CompanyTier {
  label: string;
  minLevel: number;
  /** v3.251: 이모지 전시 금지 — 빈 문자열 고정(표시부는 Feather 아이콘 사용) */
  emoji: string;
}

const COMPANY_TIERS: CompanyTier[] = [
  { label: '인디', minLevel: 1, emoji: '' },
  { label: '중소', minLevel: 5, emoji: '' },
  { label: '메이저', minLevel: 10, emoji: '' },
  { label: '글로벌', minLevel: 20, emoji: '' },
];

export function getCompanyTier(level: number): CompanyTier {
  let cur = COMPANY_TIERS[0];
  for (const t of COMPANY_TIERS) {
    if (level >= t.minLevel) cur = t;
  }
  return cur;
}

export function companyExpForNextLevel(currentLevel: number): number {
  return Math.max(200, currentLevel * 200);
}

export function companyLevelUpBonus(newLevel: number): number {
  return 100;
}
