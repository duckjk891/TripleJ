/**
 * 아티스트와 기획사의 레벨 / EXP / 칭호·등급 룩업
 *
 * - 아티스트: 신인(1-3) → 라이징(4-6) → 인기(7-10) → 톱스타(11-15) → 레전드(16+)
 * - 기획사: 인디(1) → 중소(5) → 메이저(10) → 글로벌(20)
 */

// ─── 아티스트 ───────────────────────────────────────────────

export interface ArtistRank {
  label: string;
  minLevel: number;
  emoji: string;
}

const ARTIST_RANKS: ArtistRank[] = [
  { label: '신인', minLevel: 1, emoji: '🌱' },
  { label: '라이징', minLevel: 4, emoji: '⭐' },
  { label: '인기', minLevel: 7, emoji: '🔥' },
  { label: '톱스타', minLevel: 11, emoji: '👑' },
  { label: '레전드', minLevel: 16, emoji: '💎' },
];

export function getArtistRank(level: number): ArtistRank {
  // 가장 높은 minLevel을 만족하는 rank 반환
  let cur = ARTIST_RANKS[0];
  for (const r of ARTIST_RANKS) {
    if (level >= r.minLevel) cur = r;
  }
  return cur;
}

/** Lv N에서 N+1로 가기 위해 필요한 EXP. */
export function artistExpForNextLevel(currentLevel: number): number {
  // 100 * N (단순, 계산하기 쉬움)
  return Math.max(100, currentLevel * 100);
}

/** 아티스트 레벨업 보상 (💎) */
export function artistLevelUpBonus(newLevel: number): number {
  return 50; // 단순 고정. 추후 newLevel * 10 식으로 확장 가능
}

// ─── 기획사 ───────────────────────────────────────────────

export interface CompanyTier {
  label: string;
  minLevel: number;
  emoji: string;
}

const COMPANY_TIERS: CompanyTier[] = [
  { label: '인디', minLevel: 1, emoji: '🏠' },
  { label: '중소', minLevel: 5, emoji: '🏢' },
  { label: '메이저', minLevel: 10, emoji: '🏛️' },
  { label: '글로벌', minLevel: 20, emoji: '🌐' },
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
