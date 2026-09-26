import { createElement } from 'react';
import { showAlert, showCustomDialog } from './appAlert';
import {
  skipFatigue,
  getFatigueStatus,
  FATIGUE_DIRECTOR_LABELS,
} from '../services/fatigueService';
import { markStarSpendChain } from './starSpendConfirm';
import { FatigueDirector, FatigueStatus } from '../types';
import {
  isRewardedSkipAdReady,
  preloadRewardedSkipAd,
  showRewardedSkipAd,
} from '../hooks/useRewardedSkipAd';
import FatigueSkipDialog, { type FatigueSkipDialogHandle } from '../components/FatigueSkipDialog';
import { labelMinutes } from './fatigueSkipPlan';

/**
 * v3.94: 디렉터 휴식(쿨다운) 공용 다이얼로그 — MusicGeneration(게이트)·MusicLoading(429 레이스) 공유.
 * v3.118: 전 디렉터 일반화 — director 파라미터(기본 composer, v3.94 호출부 무수정) +
 *   문구 「{작곡|작사|커버|아티스트} 디렉터」.
 * - 광고권 보유(skip_wait_count>0) 시에만 광고권 단축 노출(1장 = 30분 — v3.236 D5 단건 유지)
 * - v3.208: 「광고 보고 {skip_minutes}분 줄이기」 — 보상형 광고 시청(SSV 배선). 흐름:
 *   시청 완료(EARNED_REWARD) → 구글 SSV 콜백이 서버에 skip_wait_count +1 적립(수 초~수십 초 지연)
 *   → status 폴링(2s x 15 = 최대 30s)으로 적립 확인 → 자동 skip(method:'ad') 1회 = 30분 단축.
 *   미지원 플랫폼(Expo Go/web)은 버튼 미노출, 로드 실패·중도 이탈·폴링 타임아웃은 안내 후 팝업 재표시.
 * - v3.230 A5-4: onCleared 뒤 생성 요청은 호출부가 ⭐ 확인(utils/starSpendConfirm)을 거친다 —
 *   단축 직후 확인 없는 자동 생성 연쇄 금지. 확인 다이얼로그도 잠금(markStarSpendChain)이 걸린다.
 * - v3.236(D1 — v3.230 D7 번복): 본문을 커스텀 팝업(components/FatigueSkipDialog)으로 교체.
 *   30분 단위 −/+ 스테퍼·[전부] 칩으로 원하는 만큼 한 번에 줄인다(서버 POST /fatigue/skip-bulk,
 *   request_id 멱등). 팝업 자체가 ⭐ 확인(D7 — 금액·보유 ⭐ 표시, 추가 확인 없음).
 *   남으면 같은 팝업 갱신 + 확정 버튼 0.8초 잠금, 0 이면 "휴식 종료" 안내 → onCleared.
 *   서버 404(구 서버)면 1칸 단건(/skip) 모드로 자동 강등. 호출부 16곳·옵션 시그니처 무변경.
 */
/** v3.230 A5-5(D7): 단축 직후 확정 버튼 잠금 시간 */
export const FATIGUE_RESHOW_LOCK_MS = 800;
/** v3.236: 최초 표시 잠금(starSpendConfirm DEFAULT_LOCK_MS 와 동일 — 직전 탭이 확정에 닿지 않게) */
export const FATIGUE_OPEN_LOCK_MS = 300;

/** v3.236: 구 서버(skip-bulk 404) 감지 이력 — 앱 실행 중 유지(다음 팝업부터 레거시로 시작) */
let _bulkUnsupported = false;
/** 테스트 전용 */
export function __resetFatigueSkipForTest(): void {
  _bulkUnsupported = false;
}

/** 휴식 종료 안내(단축으로 0 도달) → [확인] = onCleared */
function showRestEnded(label: string, spentStars: number, onCleared: () => void) {
  showAlert(
    '휴식 종료',
    `「${label} 디렉터」가 다시 준비됐어요! 이제 새 작업을 지시할 수 있어요.` +
      (spentStars > 0 ? `\n이번에 휴식 단축에 ⭐${spentStars} 사용했어요.` : ''),
    [{ text: '확인', onPress: onCleared }],
    { lockMs: FATIGUE_RESHOW_LOCK_MS }
  );
}

export function showFatigueCooldownDialog(opts: {
  status: FatigueStatus | null;
  remainingSec: number;
  /** v3.118: 대상 디렉터 (미지정=composer — 기존 작곡 호출부 무수정) */
  director?: FatigueDirector;
  /** 쿨다운이 해제됐을 때(스킵으로 0 도달 또는 서버 409=쿨다운 없음) 호출 */
  onCleared: () => void;
  /** 취소/닫기 시 호출 (미지정 시 다이얼로그만 닫힘) */
  onCancel?: () => void;
  /** 스킵 응답(status payload)으로 화면 상태 동기화 */
  onStatusUpdate?: (s: FatigueStatus) => void;
  cancelText?: string;
  /** v3.230 A5-5 내부용: 이번 다이얼로그 흐름에서 단축에 쓴 ⭐ 누적(재표시 시 전달) */
  spentStars?: number;
  /** v3.230 A5-5 내부용: 단축 직후 재표시 — 확정 버튼 0.8초 잠금 */
  reshownAfterSkip?: boolean;
  /** v3.236 내부용: 재표시 직후 안내 1줄(광고 단축 결과 등) */
  note?: string;
}): void {
  const { onCleared, onCancel, onStatusUpdate } = opts;
  const spentStars = Math.max(0, Number(opts.spentStars) || 0);
  const director: FatigueDirector = opts.director ?? 'composer';
  const label = FATIGUE_DIRECTOR_LABELS[director];
  const handle: FatigueSkipDialogHandle = {};

  showCustomDialog(
    `「${label} 디렉터」 휴식 중`,
    ({ close, lockUntil }) =>
      createElement(FatigueSkipDialog, {
        director,
        label,
        status: opts.status,
        remainingSec: opts.remainingSec,
        cancelText: opts.cancelText,
        initialSpentStars: spentStars,
        initialNote: opts.note ?? null,
        lockUntil,
        legacy: _bulkUnsupported,
        onLegacyDetected: () => {
          _bulkUnsupported = true;
        },
        handle,
        close,
        onCleared,
        onCancel,
        onStatusUpdate,
        onFinished: (spent: number) => showRestEnded(label, spent, onCleared),
        onWatchAd: (session) =>
          watchAdThenSkip({
            ...opts,
            status: session.status,
            remainingSec: session.remainingSec,
            spentStars: session.spentStars,
            note: undefined,
          }),
      }),
    {
      lockMs: opts.reshownAfterSkip ? FATIGUE_RESHOW_LOCK_MS : FATIGUE_OPEN_LOCK_MS,
      onRequestClose: () => handle.onRequestClose?.(),
    }
  );
}

type FatigueDialogOpts = Parameters<typeof showFatigueCooldownDialog>[0];

/**
 * v3.208: 광고 시청 → SSV 적립 폴링 → 자동 skip('ad') — 실패 시 팝업 재표시(기존 흐름 그대로).
 * v3.236: 팝업은 광고 시작 전에 닫힌다(전면 광고 위에 모달이 남지 않게 — 기존 showAlert 흐름과 동일).
 */
async function watchAdThenSkip(opts: FatigueDialogOpts): Promise<void> {
  const director: FatigueDirector = opts.director ?? 'composer';
  const label = FATIGUE_DIRECTOR_LABELS[director];
  const spentStars = Math.max(0, Number(opts.spentStars) || 0);
  const minutes = opts.status?.skip_minutes ?? 30;
  const reshow = () => showFatigueCooldownDialog(opts);

  // 광고권 1장 소비 = 30분 단축(서버 계약 무변경) → 남으면 팝업 재표시(잠금), 0 이면 휴식 종료
  const doAdSkip = async () => {
    try {
      const data = await skipFatigue('ad', director);
      opts.onStatusUpdate?.(data);
      // v3.230 A5-4: 단축 직후 이어지는 ⭐ 확인 다이얼로그도 잠금
      markStarSpendChain();
      const remain = Math.max(0, Math.floor(data?.cooldown_remaining_sec ?? 0));
      console.info(`[fatigue:${director}] 단축 완료`, { method: 'ad', remainSec: remain, spentStars });
      if (remain <= 0) {
        showRestEnded(label, spentStars, opts.onCleared);
      } else {
        showFatigueCooldownDialog({
          ...opts,
          status: data,
          remainingSec: remain,
          reshownAfterSkip: true,
          note: `광고 보고 ${labelMinutes(minutes)} 줄였어요`,
        });
      }
    } catch (err: any) {
      const st = err?.response?.status;
      const serverError = err?.response?.data?.error;
      console.error(`[fatigue:${director}] skip 실패:`, 'ad', st, serverError);
      if (st === 409) {
        // 활성 쿨다운 없음(무과금 — fatigue.py skip 409) — 이미 해제된 것
        opts.onCleared();
        return;
      }
      const message =
        st === 402
          ? '사용할 수 있는 광고권이 없어요.'
          : err?.response?.data?.message || serverError || '휴식 단축에 실패했습니다.';
      showAlert('단축 실패', message, [
        { text: '확인', onPress: reshow },
        { text: '닫기', style: 'cancel', onPress: opts.onCancel },
      ]);
    }
  };

  if (!isRewardedSkipAdReady()) {
    preloadRewardedSkipAd(); // 백그라운드 재로드 킥
    showAlert('광고 준비 중', '광고를 준비하고 있어요. 잠시 후 다시 시도해주세요.', [
      { text: '확인', onPress: reshow },
    ]);
    return;
  }
  const baseline = Math.max(0, Number(opts.status?.skip_wait_count) || 0); // 시청 전 보유 광고권 — 적립(+1) 확인 기준
  try {
    const result = await showRewardedSkipAd();
    if (result !== 'earned') {
      // 중도 이탈 — 보상 없음(서버 적립도 없음), 팝업으로 복귀
      showAlert('광고 시청 미완료', '광고를 끝까지 시청해야 휴식 시간을 단축할 수 있어요.', [
        { text: '확인', onPress: reshow },
      ]);
      return;
    }
  } catch (err) {
    console.error(`[AdReward] 광고 표시 실패 (${director}):`, err);
    showAlert(
      '광고 표시 실패',
      '광고를 불러오지 못했어요. 잠시 후 다시 시도하거나 다른 단축 방법을 이용해주세요.',
      [{ text: '확인', onPress: reshow }]
    );
    return;
  }
  // 시청 완료 — 구글 SSV 콜백(수 초~수십 초 지연)에 의한 skip_wait_count 적립을 폴링 확인
  if (__DEV__) console.info(`[AdReward] 시청 완료 — SSV 적립 폴링 시작 (baseline=${baseline})`);
  for (let i = 0; i < 15; i++) {
    await new Promise<void>((r) => setTimeout(r, 2000));
    try {
      const s = await getFatigueStatus(director);
      const count = Math.max(0, Number(s?.skip_wait_count) || 0);
      if (count > baseline) {
        if (__DEV__) console.info(`[AdReward] SSV 적립 확인(보유 ${count}장) — skip('ad') 자동 호출`);
        await doAdSkip(); // 서버 계약 무변경 — 광고권 1장 소비 = 30분 단축
        return;
      }
    } catch (err) {
      console.error('[AdReward] SSV 적립 확인 폴링 실패:', err);
    }
  }
  console.error('[AdReward] SSV 적립 확인 타임아웃(30s)');
  showAlert(
    '적립 확인 지연',
    '광고 보상 적립 확인이 지연되고 있어요. 잠시 후 다시 열어주세요 — 적립되면 광고권으로 표시됩니다.',
    [{ text: '확인', onPress: reshow }]
  );
}
