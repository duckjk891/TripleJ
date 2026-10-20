// v3.384 [ATT] 앱 추적 투명성(ATT) 요청 — 애플 심사(10-20) "ATT 요청을 찾을 수 없음" 대응.
// 종전(v3.332): '광고 보고 휴식 줄이기'로 첫 광고를 불러올 때만 요청 → 광고를 안 열면 볼 수 없었고,
// 광고 SDK(MobileAds) 초기화는 앱 시작 직후 ATT 보다 먼저 일어났다.
//  · 이제: iOS, 로그인한 '어린이 아닌' 회원에게 로그인 직후 1회(가입 마무리 — 나이 확인 — 가 끝난 뒤). 로그인 창·가입 마무리 등
//    다른 팝업과 겹치지 않게 차례(ModalTurn)를 받아 띄운다.
//  · 비회원은 광고를 받지 않으므로(보상형 광고는 user_id 필수) 묻지 않는다. 어린이(서버 kids_restricted·age_group child·
//    만 14세 미만 보호자 동의 대상)는 묻지 않고 비맞춤 광고만(v3.332 규칙 유지).
//  · 광고 SDK 초기화는 ATT 응답 뒤(또는 '묻지 않음' 확정 뒤)로 미룬다 — whenTrackingSettled.
//  · OS 가 응답을 기억하므로 이미 답한 기기는 팝업 없이 바로 통과(앱 시작 시 primeTrackingStatus).
import { AppState, Platform } from 'react-native';
import { setRootModalOpen, waitModalTurn } from './modalTurn';

let att: any = null;
if (Platform.OS === 'ios') {
  try {
    att = require('expo-tracking-transparency');
  } catch {
    att = null; // Expo Go 등 — 묻지 않고 진행
  }
}

let settled = Platform.OS !== 'ios';
let resolveSettled: () => void = () => {};
const settledPromise: Promise<void> = settled
  ? Promise.resolve()
  : new Promise<void>((r) => {
      resolveSettled = r;
    });

function settle(reason: string) {
  if (settled) return;
  settled = true;
  console.info('[ATT] 광고 초기화 진행', { reason });
  resolveSettled();
}

/** 광고 SDK 초기화 전에 기다린다 — iOS 는 ATT 응답(또는 묻지 않음 확정) 뒤에 풀린다 */
export const whenTrackingSettled = (): Promise<void> => settledPromise;

/** 어린이 등 묻지 않는 경우 — 광고 초기화만 풀어 준다(비맞춤 광고) */
export function markTrackingNotNeeded(reason: string): void {
  settle(reason);
}

let asked = false;
let asking: Promise<void> | null = null;

/** 이번 실행에서 이미 물었거나(또는 기기가 이미 답한 상태) 더 물을 필요가 없는가 */
export const isTrackingAsked = (): boolean => asked || !att;

/** 앱 시작 1회 — 이미 답한 기기면 바로 통과(팝업 없음) */
export async function primeTrackingStatus(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  if (!att) {
    settle('unavailable');
    return;
  }
  try {
    const r = await att.getTrackingPermissionsAsync();
    if (r?.status && r.status !== 'undetermined') {
      asked = true;
      settle(`already_${r.status}`);
    }
  } catch (e) {
    console.warn('[ATT] 상태 조회 실패', { msg: String(e).slice(0, 120) });
  }
}

/** 앱이 활성(포그라운드) 상태가 될 때까지 — 비활성 중 요청하면 iOS 가 팝업 없이 거절로 돌려준다 */
function whenActive(): Promise<void> {
  if (AppState.currentState === 'active') return Promise.resolve();
  return new Promise<void>((resolve) => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        sub.remove();
        resolve();
      }
    });
  });
}

/**
 * ATT 1회 요청(이번 실행 동안 중복 없음). 끝나면 광고 초기화를 푼다.
 * @param waitTurn 로그인 직후처럼 다른 팝업과 겹칠 수 있으면 true(차례 대기). 광고 다이얼로그 안에서 부를 땐 false.
 */
export function requestTrackingOnce(src: string, opts: { waitTurn?: boolean } = {}): Promise<void> {
  if (Platform.OS !== 'ios') return Promise.resolve();
  if (isTrackingAsked()) {
    settle(att ? 'asked' : 'unavailable');
    return Promise.resolve();
  }
  if (asking) return asking;
  asking = (async () => {
    let holding = false;
    try {
      if (opts.waitTurn) {
        await waitModalTurn('att', 8).promise;
        setRootModalOpen('att', true); // 응답할 때까지 다른 자동 팝업은 대기
        holding = true;
      }
      await whenActive();
      const r = await att.requestTrackingPermissionsAsync();
      console.info('[ATT] 응답', { src, status: r?.status });
      // 팝업이 뜨지 못하고 undetermined 로 돌아오면 다음 기회(다음 로그인·광고 로드)에 다시 묻는다
      asked = r?.status !== 'undetermined';
    } catch (e) {
      asked = true;
      console.warn('[ATT] 요청 실패(광고는 비맞춤으로 계속)', { src, msg: String(e).slice(0, 120) });
    } finally {
      if (holding) setRootModalOpen('att', false);
      asking = null;
      settle(`asked_${src}`);
    }
  })();
  return asking;
}
