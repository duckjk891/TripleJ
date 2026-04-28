/**
 * 음원 다운로드 가격 정책 (v44 확정안 A)
 *
 * 곡당 ₩500 / 부가세 9% / PG 3% / 플랫폼 22% / Creator 66%
 */

export const TRACK_PRICE_KRW = 500;

export const VAT_RATE = 0.09;        // 9% 부가세 (10/110에 가깝게 단순화)
export const PG_RATE = 0.03;         // 3% PG 수수료
export const PLATFORM_RATE = 0.22;   // 22% 플랫폼 수수료
export const CREATOR_RATE = 0.66;    // 66% creator 몫

export const MIN_PAYOUT_KRW = 10000;
export const PAYOUT_FEE_KRW = 1000;

export interface RevenueSplit {
  total: number;
  vat: number;
  pgFee: number;
  platformFee: number;
  creator: number;
}

/** 결제 금액을 부가세/PG/플랫폼/creator로 분해 */
export function splitRevenue(priceKrw: number = TRACK_PRICE_KRW): RevenueSplit {
  const vat = Math.round(priceKrw * VAT_RATE);
  const pgFee = Math.round(priceKrw * PG_RATE);
  const platformFee = Math.round(priceKrw * PLATFORM_RATE);
  const creator = priceKrw - vat - pgFee - platformFee;
  return { total: priceKrw, vat, pgFee, platformFee, creator };
}

export function formatKrw(amount: number): string {
  return `₩${amount.toLocaleString()}`;
}

/**
 * 플랫폼 수수료(₩100)를 디렉터들에게 분배하는 명목 비율.
 * 영수증에 "디렉터들이 일한 보상" 명목으로 표시.
 * 실제 정산은 백엔드에서 플랫폼 1건으로 처리됨.
 */
export interface DirectorFeeShare {
  key: 'lyricist' | 'composer' | 'image' | 'artist';
  label: string;
  emoji: string;
  ratio: number; // 플랫폼 수수료 대비 비율 (합계 1.0)
}

export const DIRECTOR_FEE_SPLIT: DirectorFeeShare[] = [
  { key: 'lyricist', label: '작사 디렉터', emoji: '✍️', ratio: 0.30 },
  { key: 'composer', label: '작곡 디렉터', emoji: '🎵', ratio: 0.40 },
  { key: 'image',    label: '이미지 디렉터', emoji: '🎨', ratio: 0.15 },
  { key: 'artist',   label: '아티스트 디렉터', emoji: '🎤', ratio: 0.15 },
];

export interface DirectorFeeRow extends DirectorFeeShare {
  amount: number;
}

/** 플랫폼 수수료(₩) → 디렉터별 분배 행 배열 */
export function splitPlatformFee(platformFeeKrw: number): DirectorFeeRow[] {
  return DIRECTOR_FEE_SPLIT.map((d) => ({
    ...d,
    amount: Math.round(platformFeeKrw * d.ratio),
  }));
}
