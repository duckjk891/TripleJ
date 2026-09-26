/**
 * v3.236 A2: 휴식 디렉터 ⭐ 단축 — 칸(30분 단위) 계산 순수 함수 모음.
 *
 * 서버(services/fatigue_service.py v3.236 S1)와 같은 공식:
 * - 필요 칸 = ceil(잔여초 / (단위분×60)) — 잔여 0 이하면 0. 마지막 칸은 30분 미만이어도 1칸 전액(D6).
 * - 최대 선택 = min(필요 칸, floor(보유 ⭐ / 단가), 24) — 24 = 사다리 최대 12시간 / 30분.
 *   보유 미확인(null)이면 보유 한도 없이 min(필요 칸, 24) — 최종 판정은 서버(402).
 * React/RN/네트워크 import 금지(Node 하네스에서 직접 검증).
 */

export const FATIGUE_SKIP_UNIT_MINUTES = 30;
/** 서버 MAX_BULK_UNITS(12h/30m)와 동일 */
export const FATIGUE_SKIP_MAX_UNITS = 24;

export type FatigueSkipPlanInput = {
  remainingSec: number;
  unitCost: number;
  unitMinutes?: number;
  /** 보유 ⭐ — null/undefined = 미확인 */
  balance?: number | null;
  maxUnits?: number;
};

export type FatigueSkipPlan = {
  /** 휴식을 전부 없애는 데 필요한 칸 수 */
  neededUnits: number;
  /** 전부 줄이는 데 필요한 ⭐ */
  totalNeeded: number;
  /** 보유 ⭐로 살 수 있는 칸 수(보유 미확인이면 null) */
  affordableUnits: number | null;
  /** 선택 가능한 최대 칸 수(0이면 선택 불가) */
  maxSelectable: number;
  /** 1칸 이상 살 수 있음(보유 미확인이면 true — 서버가 최종 판정) */
  canAfford: boolean;
  /** 최대 선택이 보유 한도에 막힘(= 전부 줄이기엔 ⭐ 부족) */
  limitedByBalance: boolean;
};

const toInt = (n: unknown, fallback = 0): number => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.floor(v) : fallback;
};

/** 필요 칸 = ceil(잔여초 / 단위초) */
export function neededUnitsFor(remainingSec: number, unitMinutes: number = FATIGUE_SKIP_UNIT_MINUTES): number {
  const sec = Math.max(0, toInt(remainingSec));
  const unitSec = Math.max(1, toInt(unitMinutes, FATIGUE_SKIP_UNIT_MINUTES)) * 60;
  return sec <= 0 ? 0 : Math.ceil(sec / unitSec);
}

export function planFatigueSkip(input: FatigueSkipPlanInput): FatigueSkipPlan {
  const unitMinutes = Math.max(1, toInt(input.unitMinutes ?? FATIGUE_SKIP_UNIT_MINUTES, FATIGUE_SKIP_UNIT_MINUTES));
  const unitCost = Math.max(0, toInt(input.unitCost));
  const cap = Math.max(0, toInt(input.maxUnits ?? FATIGUE_SKIP_MAX_UNITS, FATIGUE_SKIP_MAX_UNITS));
  const neededUnits = neededUnitsFor(input.remainingSec, unitMinutes);
  const totalNeeded = neededUnits * unitCost;
  const hasBalance = typeof input.balance === 'number' && Number.isFinite(input.balance);
  const affordableUnits = hasBalance
    ? unitCost > 0
      ? Math.max(0, Math.floor((input.balance as number) / unitCost))
      : cap
    : null;
  const byNeed = Math.min(neededUnits, cap);
  const maxSelectable = affordableUnits == null ? byNeed : Math.min(byNeed, affordableUnits);
  return {
    neededUnits,
    totalNeeded,
    affordableUnits,
    maxSelectable,
    canAfford: affordableUnits == null ? true : affordableUnits >= 1,
    limitedByBalance: affordableUnits != null && affordableUnits < byNeed,
  };
}

/** 30 → "30분", 60 → "1시간", 90 → "1시간 30분" */
export function labelMinutes(minutes: number): string {
  const m = Math.max(0, toInt(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h <= 0) return `${r}분`;
  return r > 0 ? `${h}시간 ${r}분` : `${h}시간`;
}

/** 칸 수만큼 줄인 뒤 남는 초(바닥 0 — 서버 reduce 의 $max[now, …] 와 동일) */
export function remainAfter(remainingSec: number, units: number, unitMinutes: number = FATIGUE_SKIP_UNIT_MINUTES): number {
  const sec = Math.max(0, toInt(remainingSec));
  return Math.max(0, sec - Math.max(0, toInt(units)) * Math.max(1, toInt(unitMinutes, FATIGUE_SKIP_UNIT_MINUTES)) * 60);
}

/** 선택값을 1..max 로 보정(max<1 이면 0 = 선택 불가) */
export function clampSelection(selected: number, max: number): number {
  const mx = Math.max(0, toInt(max));
  if (mx < 1) return 0;
  const s = toInt(selected, 1);
  return Math.min(mx, Math.max(1, s));
}

/** 서버 오류 응답 → 분류(skip-bulk / skip 공용) */
export type FatigueSkipErrorKind =
  | 'legacy' // 404 — 구 서버(skip-bulk 없음)
  | 'cleared' // 409 no_active_cooldown(또는 코드 없는 409 — 구 /skip 계약) — 무과금(차감됐으면 서버가 환불)
  | 'in_progress' // 409 skip_in_progress — 같은 request_id 처리 중 → 같은 ID 로 재시도하면 결과 재생
  | 'conflict' // 409 request_id_conflict — 같은 ID 로 다른 내용 → 새 ID
  | 'cost_changed' // 409 cost_changed — 무과금, 상태 재확인
  | 'insufficient' // 402 포인트 부족
  | 'no_tickets' // 402 no_skip_tickets(광고권)
  | 'invalid' // 400/422
  | 'server_error' // 5xx 응답 — 서버가 결론을 냄(차감됐으면 환불) → 새 ID 로 재시도
  | 'retryable'; // 응답 없음(네트워크·타임아웃) — 처리 여부 불명 → 같은 request_id 로 재시도

const CODE_RE = /^[a-z][a-z0-9_]*$/;

/**
 * 오류 코드 추출 — skip-bulk 는 {error:<한글 메시지>, code:<코드>}, 구 /skip 광고권은 {error:'no_skip_tickets'},
 * FastAPI HTTPException 은 {detail:…}. 코드 형태(소문자_스네이크)만 코드로 인정.
 */
export function serverErrorCode(data: any): string | null {
  if (!data || typeof data !== 'object') return null;
  const cands = [data.code, data.error, data.detail?.code, data.detail?.error, data.detail];
  for (const c of cands) {
    if (typeof c === 'string' && CODE_RE.test(c)) return c;
  }
  return null;
}

/** 오류 응답에 동봉된 상태 payload — skip-bulk 는 {status:{…}}, 평탄화된 경우도 허용 */
export function statusFromErrorBody(data: any): Record<string, any> | null {
  if (!data || typeof data !== 'object') return null;
  const nested = data.status;
  if (nested && typeof nested === 'object' && typeof nested.cooldown_remaining_sec === 'number') return nested;
  if (typeof data.cooldown_remaining_sec === 'number' && typeof data.skip_point_cost === 'number') return data;
  return null;
}

export function classifyFatigueSkipError(err: any): FatigueSkipErrorKind {
  const st = err?.response?.status;
  if (typeof st !== 'number') return 'retryable';
  const code = serverErrorCode(err?.response?.data);
  if (st === 404) return 'legacy';
  if (st === 409) {
    if (code === 'skip_in_progress') return 'in_progress';
    if (code === 'cost_changed') return 'cost_changed';
    if (code === 'request_id_conflict') return 'conflict';
    return 'cleared';
  }
  if (st === 402) return code === 'no_skip_tickets' ? 'no_tickets' : 'insufficient';
  if (st === 400 || st === 422) return 'invalid';
  if (st >= 500) return 'server_error';
  return 'invalid';
}
