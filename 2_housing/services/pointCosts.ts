import api from './api';

/**
 * v3.230 A5-1 [StarConfirm] ⭐ 단가 단일 소스 — GET /api/points/costs 캐시 + 폴백 표.
 *
 * 서버 계약(routes/points.py `points_costs` → services/points_service.POINT_COSTS, 인증 불필요):
 *   {"costs": {"lyrics":5,"compose":15,"cover":5,"cover_refine":5,"share_video":5,"character":10,
 *              "fatigue_skip":5,"hire_director":10,"extra_slot":15,"voice_clone":5,"instrumental":5}}
 * - 화면별 직조회(api.get('/points/costs'))와 하드코딩 비용을 이 모듈로 모은다.
 * - 조회 실패·키 없음(구서버) → FALLBACK_POINT_COSTS(서버 상수와 동일 값)로 대체한다.
 *   ⭐ 확인 팝업은 비용을 못 받아도 폴백 값으로 반드시 띄운다(fail-closed — utils/starSpendConfirm).
 * - never throw: 호출부는 try/catch 없이 써도 된다(오류는 console.error로 원격 로거에 수집).
 */
export type PointCostKey =
  | 'lyrics'
  | 'compose'
  | 'cover'
  | 'cover_refine'
  | 'share_video'
  | 'character'
  | 'fatigue_skip'
  | 'hire_director'
  | 'extra_slot'
  | 'voice_clone'
  | 'instrumental';

/** 서버 POINT_COSTS 기준값(2026-09-25 실측) — 서버 조회 실패 시에만 쓰인다 */
export const FALLBACK_POINT_COSTS: Readonly<Record<PointCostKey, number>> = Object.freeze({
  lyrics: 5,
  compose: 15,
  cover: 5,
  cover_refine: 5,
  share_video: 5,
  character: 10,
  fatigue_skip: 5,
  hire_director: 10,
  extra_slot: 15,
  voice_clone: 5,
  instrumental: 5,
});

/** 캐시 유효 시간 — 단가는 서버 배포로만 바뀐다 */
const CACHE_TTL_MS = 10 * 60 * 1000;
/** 확인 팝업이 서버 응답을 기다리는 최대 시간 — 넘으면 폴백 값으로 확인(fail-closed) */
const DEFAULT_WAIT_MS = 2500;

type CostTable = Partial<Record<PointCostKey, number>>;

let _server: CostTable | null = null;
let _fetchedAt = 0;
let _inflight: Promise<CostTable | null> | null = null;

function sanitize(raw: any): CostTable {
  const out: CostTable = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const key of Object.keys(FALLBACK_POINT_COSTS) as PointCostKey[]) {
    const v = raw[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[key] = v;
  }
  return out;
}

/** 서버 단가 조회(캐시·동시 요청 합치기). 실패 시 null — 호출부는 폴백을 쓴다. */
export function fetchPointCosts(opts: { force?: boolean } = {}): Promise<CostTable | null> {
  const fresh = _server && Date.now() - _fetchedAt < CACHE_TTL_MS;
  if (fresh && !opts.force) return Promise.resolve(_server);
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const res = await api.get('/points/costs');
      const table = sanitize(res?.data?.costs);
      _server = table;
      _fetchedAt = Date.now();
      if (__DEV__) console.info('[PointCosts] /points/costs 수신', table);
      return table;
    } catch (err: any) {
      console.error('[PointCosts] /points/costs 조회 실패 — 폴백 단가 사용', { status: err?.response?.status ?? null });
      return _server; // 이전 캐시가 있으면 그대로(없으면 null)
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

/** 서버가 준 값인지 여부와 함께 반환 */
export function resolvePointCost(key: PointCostKey): { cost: number; fromServer: boolean } {
  const v = _server?.[key];
  if (typeof v === 'number') return { cost: v, fromServer: true };
  return { cost: FALLBACK_POINT_COSTS[key], fromServer: false };
}

/** 동기 조회 — 캐시가 있으면 서버 값, 없으면 폴백(라벨 표기용) */
export function getPointCostSync(key: PointCostKey): number {
  return resolvePointCost(key).cost;
}

/**
 * 비동기 조회 — 캐시가 없으면 최대 waitMs 동안 서버 값을 기다리고, 넘거나 실패하면 폴백.
 * 확인 팝업(fail-closed)이 이걸로 비용을 정한다.
 */
export async function getPointCost(
  key: PointCostKey,
  opts: { waitMs?: number } = {}
): Promise<{ cost: number; fromServer: boolean }> {
  const fresh = _server && Date.now() - _fetchedAt < CACHE_TTL_MS && typeof _server[key] === 'number';
  if (!fresh) {
    const waitMs = opts.waitMs ?? DEFAULT_WAIT_MS;
    let timer: ReturnType<typeof setTimeout> | null = null;
    await Promise.race([
      fetchPointCosts(),
      new Promise<null>((r) => { timer = setTimeout(() => r(null), waitMs); }),
    ]);
    if (timer) clearTimeout(timer);
  }
  return resolvePointCost(key);
}

/** 테스트 전용 — 캐시 초기화 */
export function __resetPointCostsForTest(): void {
  _server = null;
  _fetchedAt = 0;
  _inflight = null;
}
