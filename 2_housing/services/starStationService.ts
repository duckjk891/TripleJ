import api from './api';
import { usePointsStore } from '../stores/pointsStore';
import { showAlert } from '../utils/appAlert';

// v3.388 [StarStation] 별 충전소 — 서버 GET /api/star-station/status · POST /api/star-station/claim
// 시간 계산·지급은 서버가 한다(폰 시계 무관). 주기·금액은 응답의 cycle_seconds·reward 를 쓴다(앱 하드코딩 금지).
// 앱은 응답의 remaining_seconds 를 받은 순간의 내 시계 기준으로 줄여 가며 보여 주기만 한다.

export interface StarStationStatus {
  cycleSeconds: number;
  reward: number;
  startedAt: string;
  remainingSeconds: number;
  ready: boolean;
  /** remaining_seconds 를 받은 순간 + 남은 시간(내 시계 기준) — 진행 바·남은 시간 표시용 */
  readyAtLocal: number;
}

export interface StarStationClaimResult extends StarStationStatus {
  claimed: boolean;
  awarded: number;
  code: string;
  message: string;
  balance: number | null;
}

function toStatus(raw: any): StarStationStatus {
  const remaining = Math.max(0, Number(raw?.remaining_seconds) || 0);
  return {
    cycleSeconds: Number(raw?.cycle_seconds) || 0,
    reward: Number(raw?.reward) || 0,
    startedAt: String(raw?.started_at ?? ''),
    remainingSeconds: remaining,
    ready: !!raw?.ready,
    readyAtLocal: Date.now() + remaining * 1000,
  };
}

export async function getStarStationStatus(): Promise<StarStationStatus> {
  try {
    const { data } = await api.get('/star-station/status');
    const s = toStatus(data);
    if (__DEV__) console.info('[StarStation] status', { ready: s.ready, remaining: s.remainingSeconds });
    return s;
  } catch (err: any) {
    console.error('[StarStation] 상태 조회 실패', { status: err?.response?.status });
    throw err;
  }
}

export async function claimStarStation(): Promise<StarStationClaimResult> {
  console.info('[StarStation] 받기 요청');
  const { data } = await api.post('/star-station/claim');
  const result: StarStationClaimResult = {
    ...toStatus(data),
    claimed: !!data?.claimed,
    awarded: Number(data?.awarded) || 0,
    code: String(data?.code ?? ''),
    message: String(data?.message ?? ''),
    balance: typeof data?.balance === 'number' ? data.balance : null,
  };
  console.info('[StarStation] 받기 응답', { claimed: result.claimed, code: result.code, awarded: result.awarded });
  return result;
}

/** 받기 + 잔액 갱신 + 결과 안내(앱 내 다이얼로그). 실패하면 null. 별 안내 카드·자동 팝업 공용. */
export async function claimStarStationWithNotice(): Promise<StarStationClaimResult | null> {
  try {
    const r = await claimStarStation();
    if (r.balance !== null) usePointsStore.getState().setBalance(r.balance);
    void usePointsStore.getState().fetchBalance();
    if (r.claimed) {
      showAlert(`⭐ +${r.awarded}`, r.message || '별을 받았어요!');
    } else {
      showAlert(r.code === 'already_claimed' ? '이미 받은 별이에요' : '아직 만들어지는 중이에요', r.message);
    }
    return r;
  } catch (err: any) {
    console.error('[StarStation] 받기 실패', { status: err?.response?.status });
    showAlert('별을 받지 못했어요', err?.response?.data?.error || '잠시 후 다시 시도해 주세요.');
    return null;
  }
}

/** 7200 → '2시간', 5400 → '1시간 30분', 1800 → '30분' */
export function durationLabel(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}시간 ${m}분`;
  if (h) return `${h}시간`;
  return `${m}분`;
}
