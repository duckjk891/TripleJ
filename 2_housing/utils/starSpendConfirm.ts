import { showAlert } from './appAlert';
import { usePointsStore } from '../stores/pointsStore';
import { getPointCost, type PointCostKey } from '../services/pointCosts';

/**
 * v3.230 A5-1 [StarConfirm] ⭐ 차감 직전 공통 확인 — 모든 유료 요청은 이 확인을 1회 거친다(대표 결정 D6).
 *
 * - 비용: 화면이 가진 서버 실값(opts.cost) → 없으면 /points/costs 캐시 → 그래도 없으면 폴백 표.
 *   비용을 못 받아도 **반드시 확인을 띄운다**(fail-closed). 조회 대기 상한 2.5초.
 * - 버튼: [취소] / [⭐N 사용하기]. 백드롭·뒤로가기로 닫으면 취소(AppDialogHost 규칙 — cancel 버튼).
 * - "다시 묻지 않기" 없음(D6).
 * - 반환: true = 사용하기, false = 취소(또는 이미 다른 ⭐ 확인이 떠 있음 — 중복 호출).
 *   호출부는 false면 busy·단계를 되돌리고 요청을 보내지 않는다.
 * - 이 함수는 확인만 한다. 서버 차감·환불 여부를 단정하는 문구는 넣지 않는다(v3.228 X-K1).
 */
export type StarSpendConfirmOptions = {
  /** 로그 식별용 호출 위치(예: 'MusicGeneration') */
  source: string;
  /** 서버 단가 키 */
  costKey: PointCostKey;
  /** 무엇에 쓰는지 — 제목에 쓰인다(예: '곡 만들기') */
  action: string;
  /** 제목 직접 지정(선택 — 기본 `{action}에 ⭐N 사용할까요?`) */
  title?: string;
  /** 본문 첫 줄에 붙일 부가 설명(선택) */
  message?: string;
  /** 화면이 이미 받은 서버 실값(있으면 우선). null/undefined면 캐시·폴백 */
  cost?: number | null;
  /** 'fatigue-chain' = 휴식 단축으로 해제된 직후 재요청 확인(로딩 화면 재시도) */
  variant?: 'default' | 'fatigue-chain';
  /** 확인 버튼 문구(기본 `⭐N 사용하기`) — {cost} 치환 */
  confirmText?: string;
  cancelText?: string;
};

let _pending: string | null = null;
let _chainAt = 0;

/** 휴식 단축 직후 CHAIN_WINDOW_MS 안에 뜨는 ⭐ 확인은 버튼을 잠근다(연타가 생성 확인까지 새지 않게) */
const CHAIN_WINDOW_MS = 5000;
const CHAIN_LOCK_MS = 800;
/** 일반 확인도 직전 버튼 더블탭이 확인 버튼에 닿지 않게 짧게 잠근다 */
const DEFAULT_LOCK_MS = 300;

/** v3.230 A5-4: utils/fatigueGate가 단축 성공 직후 호출 — 이어지는 ⭐ 확인 잠금 */
export function markStarSpendChain(): void {
  _chainAt = Date.now();
}

/** 테스트 전용 */
export function __resetStarConfirmForTest(): void {
  _pending = null;
  _chainAt = 0;
}

export async function confirmStarSpend(opts: StarSpendConfirmOptions): Promise<boolean> {
  const tag = `${opts.source}:${opts.costKey}`;
  if (_pending) {
    // 연타·중복 진입 — 이미 떠 있는 확인이 결과를 결정한다(두 번째 호출은 요청하지 않음)
    console.info('[StarConfirm] 중복 호출 무시(확인 대기 중)', { tag, pending: _pending });
    return false;
  }
  _pending = tag;
  try {
    let cost: number;
    let costSource: 'screen' | 'server' | 'fallback';
    if (typeof opts.cost === 'number' && Number.isFinite(opts.cost) && opts.cost > 0) {
      cost = opts.cost;
      costSource = 'screen';
    } else {
      const points = usePointsStore.getState();
      const [resolved] = await Promise.all([
        getPointCost(opts.costKey),
        points.balance == null ? points.fetchBalance().catch(() => undefined) : Promise.resolve(),
      ]);
      cost = resolved.cost;
      costSource = resolved.fromServer ? 'server' : 'fallback';
    }
    // 잔액: 부족해 보이면 1회 재조회(적립 직후 캐시가 낡았을 수 있음) — 재조회 실패는 기존 값 유지
    let balance = usePointsStore.getState().balance;
    if (typeof balance === 'number' && balance < cost) {
      await usePointsStore.getState().fetchBalance().catch(() => undefined);
      balance = usePointsStore.getState().balance;
    }
    const isChain = opts.variant === 'fatigue-chain';
    const variantLog = isChain ? ` fatigue-chain site=${opts.source}` : '';
    const logBase = `action=${opts.action} key=${opts.costKey} cost=${cost} src=${costSource} balance=${balance ?? '?'}${variantLog}`;

    if (typeof balance === 'number' && balance < cost) {
      // 부족 — [사용하기] 대신 부족 안내(요청 0). 서버 402와 같은 안내 톤.
      console.info(`[StarConfirm] ${logBase} result=insufficient`);
      _pending = null;
      showAlert('별이 부족해요', `${opts.action}에는 ⭐${cost}이 필요해요.\n현재 보유: ⭐${balance}\n출석체크·앱 추천으로 스타를 모아보세요.`);
      return false;
    }

    const title = opts.title ?? (isChain ? '휴식이 끝났어요' : `${opts.action}에 ⭐${cost} 사용할까요?`);
    const lines: string[] = [];
    if (isChain) lines.push(`⭐${cost}을 사용해 이어서 만들까요?`);
    if (opts.message) lines.push(opts.message);
    lines.push(typeof balance === 'number' ? `사용 ⭐${cost} · 보유 ⭐${balance}` : `사용 ⭐${cost}`);
    const confirmText = (opts.confirmText ?? '⭐{cost} 사용하기').replace('{cost}', String(cost));
    const inChain = isChain || Date.now() - _chainAt < CHAIN_WINDOW_MS;
    const lockMs = inChain ? CHAIN_LOCK_MS : DEFAULT_LOCK_MS;
    if (costSource === 'fallback') console.info(`[StarConfirm] ${logBase} result=fallback(비용 미수신 — 폴백 단가로 확인)`);

    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        _pending = null;
        console.info(`[StarConfirm] ${logBase} result=${ok ? 'ok' : 'cancel'}`);
        resolve(ok);
      };
      showAlert(title, lines.join('\n'), [
        { text: opts.cancelText ?? '취소', style: 'cancel', onPress: () => done(false) },
        { text: confirmText, onPress: () => done(true) },
      ], { lockMs });
    });
  } catch (err: any) {
    // 비용 조회는 never-throw지만 방어 — 확인 없이 진행하지 않는다(fail-closed)
    console.error('[StarConfirm] 확인 준비 실패 — 요청 중단', { tag, message: err?.message });
    _pending = null;
    return false;
  }
}
