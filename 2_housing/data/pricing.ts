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
