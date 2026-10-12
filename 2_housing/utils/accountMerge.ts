// v3.352 [AccountMerge] 통합 화면 열기 상태(전역) — 본인확인 결과 merge_candidate 면 rid 로 연다.
// 화면은 components/auth/AccountMergeHost(App 루트). 끝나면 onDone(결과) 호출.
import { create } from 'zustand';

export type MergeOutcome = 'merged' | 'declined' | 'closed';

interface MergeState {
  rid: string | null;
  onDone: ((o: MergeOutcome) => void) | null;
  open: (rid: string, onDone?: (o: MergeOutcome) => void) => void;
  finish: (o: MergeOutcome) => void;
}

export const useAccountMergeStore = create<MergeState>((set, get) => ({
  rid: null,
  onDone: null,
  open: (rid, onDone) => {
    console.info('[AccountMerge] 통합 화면 열기', { rid: rid.slice(0, 8) });
    set({ rid, onDone: onDone || null });
  },
  finish: (o) => {
    const cb = get().onDone;
    set({ rid: null, onDone: null });
    console.info('[AccountMerge] 통합 화면 닫힘', { outcome: o });
    try { cb?.(o); } catch (err: any) { console.error('[AccountMerge] onDone 오류', { message: err?.message }); }
  },
}));

/** 통합 화면을 열고 끝날 때까지 기다린다 */
export function openAccountMerge(rid: string): Promise<MergeOutcome> {
  return new Promise((resolve) => useAccountMergeStore.getState().open(rid, resolve));
}

/** 로그인 방식 표시 이름(순수) */
export function loginMethodLabel(m: string): string {
  return ({ google: '구글', kakao: '카카오', naver: '네이버', apple: '애플', email: '이메일' } as Record<string, string>)[m] || m;
}

/** 통합 불가 사유 안내(순수) */
export function blockedReasonText(r: string | null | undefined): string | null {
  switch (r) {
    case 'jobs_running': return '만들고 있는 곡이나 아티스트가 있어요. 만들기가 끝난 뒤 다시 본인인증하면 합칠 수 있어요.';
    case 'two_crews': return '두 계정 모두 크루장이에요. 한쪽 크루의 운영자를 다른 멤버에게 넘긴 뒤 다시 본인인증해 주세요.';
    case 'account_restricted': return '이용이 제한된 계정이 있어 지금은 합칠 수 없어요. 고객센터(maidol_official@lotusai.co.kr)로 문의해 주세요.';
    case 'special_account': return '운영 계정은 합칠 수 없어요. 고객센터(maidol_official@lotusai.co.kr)로 문의해 주세요.';
    default: return null;
  }
}
