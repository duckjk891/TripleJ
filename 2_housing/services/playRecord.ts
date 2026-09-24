// v3.229 [PlayRecord]: 재생 기록(POST /charts/record-play) 단일 지점 — 곡 재생 세션당 정확히 1회.
//
// 종전(v3.192): PlayerScreen 인스턴스의 useRef(recordedTrackRef)로 "트랙당 1회"를 판정했다.
// 실측된 중복/오기록 원인:
//  (1) 플레이어를 닫았다 미니플레이어로 다시 열면 PlayerScreen이 새로 마운트돼 ref가 null로 초기화되고,
//      기존 사운드에 새 인스턴스 콜백이 재부착된다 → 이미 70%를 넘긴 같은 재생이 즉시 한 번 더 기록.
//  (2) 곡 종료(didJustFinish) 처리에서 store.track을 다음 곡으로 먼저 바꾼 뒤 이전 사운드가 늦게 보내는
//      꼬리 상태(position≈duration)가 store.track(다음 곡) 기준으로 판정돼, 다음 곡이 재생 전 기록될 수 있음.
//  (역방향) 같은 곡 반복(repeat one)·끝난 곡 다시 재생은 ref가 같은 id라 기록 누락.
//
// 규칙(모듈 전역 — 화면 마운트와 무관):
//  · 세션 = (트랙 id, 한 번의 재생 시작). 트랙 id가 바뀌거나, 직전 세션이 곡 끝(didJustFinish)으로 닫힌 뒤
//    같은 곡이 다시 앞부분부터 재생되면 새 세션.
//  · 세션은 "무장(armed)"돼야 기록 자격이 생긴다 — 이전 사운드의 꼬리 상태(높은 위치)가 새 세션에서
//    곧바로 기록되는 것을 차단. 무장 조건(둘 중 하나):
//      ① 70% 미만 위치 관측(정상 재생은 첫 상태가 0 근처라 즉시 무장)
//      ② 관측 공백 후 재개 — 세션 시작 후 TAIL_WINDOW_MS가 지났고, 세션 첫 관측 위치와 다른 위치가
//         새로 보고됨(= 이번 재생이 실제로 진행 중). 꼬리 상태는 전환 직후 짧은 창에 몰리고 같은 위치를
//         반복하므로 여기서 걸러진다(앱 백그라운드·웹 탭 복귀 등 공백 후 70% 이후 첫 관측도 누락 없음).
//    v3.229 이관: 호출처는 services/playback.ts의 전역 store 구독 단일 지점(플레이어 화면 무관).
//  · 무장된 세션이 70%에 도달(시크 포함 — MAIDOL 위치 기반 규칙 유지)하면 1회 기록, 이후 같은 세션은 무시.
//  · 일시정지·재개·시크·앱 복귀 재동기화·프리로드 스왑·콜백 재부착·같은 곡 재로드(복구)는 세션을 바꾸지 않는다.
import api from './api';
import { usePointsStore } from '../stores/pointsStore';

export const PLAY_RECORD_RATIO = 0.7;

/** 전환 직후 이전 사운드 꼬리 상태를 무시하는 창(ms) — 이후 새 위치 보고는 실제 재생으로 간주(무장 ②) */
export const TAIL_WINDOW_MS = 3000;

type PlaySession = {
  trackId: string;
  armed: boolean;
  recorded: boolean;
  ended: boolean;
  seq: number;
  startedAt: number;
  /** 세션 첫 관측 위치 — 무장 ②에서 "새 위치 보고" 판정 기준(꼬리/정지 상태 반복 차단) */
  firstPos: number | null;
};

let session: PlaySession | null = null;
let seqCounter = 0;
let clock: () => number = () => Date.now();

/** 테스트 전용 — 시계 주입(Node 하네스) */
export function __setPlayRecordClockForTest(fn: (() => number) | null): void {
  clock = fn || (() => Date.now());
}

function beginSession(trackId: string, reason: string): PlaySession {
  seqCounter += 1;
  session = {
    trackId, armed: false, recorded: false, ended: false, seq: seqCounter,
    startedAt: clock(), firstPos: null,
  };
  if (__DEV__) console.info('[PlayRecord] 세션 시작', { trackId, seq: seqCounter, reason });
  return session;
}

/**
 * 재생 상태 콜백마다 호출 — 70% 도달 시 세션당 1회 record-play.
 * @param trackId 현재 재생 곡 id(store.track 기준)
 * @param positionMillis 현재 위치
 * @param durationMillis 보정된 곡 길이(effectiveDuration)
 * @param src 호출 경로(로그용)
 */
export function notePlayProgress(
  trackId: string | number | null | undefined,
  positionMillis: number,
  durationMillis: number,
  src: string
): void {
  if (trackId == null || trackId === '') return;
  const tid = String(trackId);
  const pos = positionMillis || 0;

  // 트랙 변경 = 새 세션 — 길이를 아직 모르는 로드 직후(duration 0)에도 시작 시각·첫 위치를 잡는다
  // (그래야 로드 후 관측 공백 뒤 첫 보고가 70% 이후여도 무장 ②로 이번 재생을 놓치지 않는다).
  let s = session;
  if (!s || s.trackId !== tid) {
    s = beginSession(tid, !s ? 'first' : 'track-change');
    s.firstPos = pos;
  }
  if (!durationMillis || durationMillis <= 0) return;
  const threshold = durationMillis * PLAY_RECORD_RATIO;

  if (s.ended) {
    // 끝난 곡의 꼬리 상태(높은 위치)는 무시 — 앞부분부터 다시 재생될 때만 새 세션(반복 재생)
    if (pos >= threshold) return;
    s = beginSession(tid, 'replay');
    s.firstPos = pos;
  }

  if (!s.armed) {
    if (pos < threshold) {
      s.armed = true; // 무장 ①
    } else if (clock() - s.startedAt >= TAIL_WINDOW_MS && pos !== s.firstPos) {
      s.armed = true; // 무장 ② — 관측 공백 후 재개(이번 재생이 실제로 진행 중)
      if (__DEV__) console.info('[PlayRecord] 공백 후 재개 무장', { trackId: tid, seq: s.seq, src });
    } else {
      return; // 전환 직후 70% 이상 첫 관측 — 이전 사운드 꼬리로 간주, 기록 보류
    }
  }
  if (s.recorded || pos < threshold) return;

  s.recorded = true;
  const seq = s.seq;
  console.info('[PlayRecord] record-play', { trackId: tid, seq, src });
  api.post('/charts/record-play', { track_id: tid })
    .then(() => { usePointsStore.getState().fetchBalance(); }) // 별 배지 갱신
    .catch((err: any) => console.error('[PlayRecord] record-play 실패', { trackId: tid, seq, status: err?.response?.status }));
}

/** 곡 끝(didJustFinish) — 현재 세션을 닫는다. 같은 곡이 다시 처음부터 재생되면 새 세션으로 1회 더 기록. */
export function endPlaySession(trackId: string | number | null | undefined, src: string): void {
  if (trackId == null || !session || session.trackId !== String(trackId)) return;
  if (session.ended) return;
  session.ended = true;
  if (__DEV__) console.info('[PlayRecord] 세션 종료(곡 끝)', { trackId: session.trackId, seq: session.seq, recorded: session.recorded, src });
}
