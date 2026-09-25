import { showAlert } from './appAlert';
import {
  skipFatigue,
  getFatigueStatus,
  formatCooldown,
  FATIGUE_DIRECTOR_LABELS,
} from '../services/fatigueService';
import { usePointsStore } from '../stores/pointsStore';
import { markStarSpendChain } from './starSpendConfirm';
import { FatigueDirector, FatigueStatus } from '../types';
import {
  isRewardedAdSupported,
  isRewardedSkipAdReady,
  preloadRewardedSkipAd,
  showRewardedSkipAd,
} from '../hooks/useRewardedSkipAd';

/**
 * v3.94: 디렉터 휴식(쿨다운) 공용 다이얼로그 — MusicGeneration(게이트)·MusicLoading(429 레이스) 공유.
 * v3.118: 전 디렉터 일반화 — director 파라미터(기본 composer, v3.94 호출부 무수정) +
 *   문구 「{작곡|작사|커버|아티스트} 디렉터」가 쉬는 중이에요 (대표 방침).
 * MAIDOL StudioTab2 피로 패널의 스킵 흐름을 앱 내 다이얼로그(showAlert)로 이식:
 * - ⭐{skip_point_cost}로 {skip_minutes}분 단축 (반복 가능 — v220 디렉터별 차등 비용은 status 실값 표기)
 * - 광고권 보유(skip_wait_count>0) 시에만 광고권 단축 노출
 * - v3.208: 「광고 보고 {skip_minutes}분 단축」 — 보상형 광고 시청(SSV 배선). 흐름:
 *   시청 완료(EARNED_REWARD) → 구글 SSV 콜백이 서버에 skip_wait_count +1 적립(수 초~수십 초 지연)
 *   → status 폴링(2s x 15 = 최대 30s)으로 적립 확인 → 자동 skip(method:'ad') 1회 = 30분 단축.
 *   서버 계약 무변경. 미지원 플랫폼(Expo Go/web)은 버튼 미노출, 로드 실패·중도 이탈·폴링
 *   타임아웃은 안내 후 기존 ⭐/광고권 경로로 폴백(이중 차감 없음).
 * - 스킵 후에도 남으면 갱신된 남은 시간으로 재안내, 0 도달 시 onCleared 호출
 * - v3.230 A5-5(D7): 단축 직후 재표시 다이얼로그는 0.8초간 단축 버튼 잠금(같은 위치 연타 흡수) +
 *   본문에 "이번에 단축에 ⭐N 사용" 누적 표시. 일괄 단축 버튼은 두지 않는다.
 * - v3.230 A5-4: onCleared 뒤 생성 요청은 호출부가 ⭐ 확인(utils/starSpendConfirm)을 거친다 —
 *   단축 직후 확인 없는 자동 생성 연쇄 금지. 확인 다이얼로그도 잠금(markStarSpendChain)이 걸린다.
 */
/** v3.230 A5-5(D7): 단축 직후 재표시 다이얼로그 버튼 잠금 시간 */
export const FATIGUE_RESHOW_LOCK_MS = 800;

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
  /** v3.230 A5-5 내부용: 단축 직후 재표시 — 버튼 0.8초 잠금 */
  reshownAfterSkip?: boolean;
}): void {
  const { status, remainingSec, onCleared, onCancel, onStatusUpdate, cancelText } = opts;
  const spentStars = Math.max(0, Number(opts.spentStars) || 0);
  const director: FatigueDirector = opts.director ?? 'composer';
  const label = FATIGUE_DIRECTOR_LABELS[director];
  // v3.118: ⭐비용은 status 실값(디렉터별 차등 — v220). 폴백은 서버 계약 기본값.
  // v3.214 ⑨: video ⭐2 (share_video 5의 1/3 반올림 — 서버 SKIP_POINT_COSTS 동일 규칙)
  const fallbackCost = { composer: 5, lyricist: 2, image: 2, artist: 3, video: 2 }[director];
  const cost = status?.skip_point_cost ?? fallbackCost;
  const minutes = status?.skip_minutes ?? 30;
  const adSkips = Math.max(0, Number(status?.skip_wait_count) || 0);

  // 사다리 안내 — 서버 ladder({"1":2,"2":4,"3":8,"4+":12}) 우선, 없으면 계약 기본값
  const ladder =
    status?.ladder && Object.keys(status.ladder).length > 0
      ? status.ladder
      : { '1': 2, '2': 4, '3': 8, '4+': 12 };
  const ladderText = Object.entries(ladder)
    .map(([count, hours]) => `${count}개 ${hours}시간`)
    .join(' · ');

  const doSkip = async (method: 'points' | 'ad') => {
    try {
      const data = await skipFatigue(method, director);
      onStatusUpdate?.(data);
      if (method === 'points') usePointsStore.getState().fetchBalance(); // ⭐ 차감 반영
      // v3.230 A5-4: 단축 직후 이어지는 ⭐ 확인 다이얼로그도 잠금(연타가 생성 확인까지 새지 않게)
      markStarSpendChain();
      const spentNow = spentStars + (method === 'points' ? cost : 0);
      const remain = Math.max(0, Math.floor(data?.cooldown_remaining_sec ?? 0));
      console.info(`[fatigue:${director}] 단축 완료`, { method, remainSec: remain, spentStars: spentNow });
      if (remain <= 0) {
        showAlert(
          '휴식 종료',
          `「${label} 디렉터」가 다시 준비됐어요! 이제 새 작업을 지시할 수 있어요.` +
            (spentNow > 0 ? `\n이번에 휴식 단축에 ⭐${spentNow} 사용했어요.` : ''),
          [{ text: '확인', onPress: onCleared }],
          { lockMs: FATIGUE_RESHOW_LOCK_MS }
        );
      } else {
        // 아직 쿨다운 잔여 — 갱신된 남은 시간으로 재안내(반복 스킵 가능, 0.8초 잠금·누적 표시)
        showFatigueCooldownDialog({ ...opts, status: data, remainingSec: remain, spentStars: spentNow, reshownAfterSkip: true });
      }
    } catch (err: any) {
      const st = err?.response?.status;
      const serverError = err?.response?.data?.error;
      console.error(`[fatigue:${director}] skip 실패:`, method, st, serverError);
      if (st === 409) {
        // 활성 쿨다운 없음(무과금 — fatigue.py skip 409) — 이미 해제된 것
        onCleared();
        return;
      }
      const message =
        st === 402
          ? serverError === 'no_skip_tickets'
            ? '사용할 수 있는 광고권이 없어요.'
            : `별이 부족해요. 쿨다운 단축에는 ⭐${cost}개가 필요합니다.`
          : err?.response?.data?.message || serverError || '쿨다운 단축에 실패했습니다.';
      showAlert('단축 실패', message, [
        { text: '확인', onPress: () => showFatigueCooldownDialog(opts) },
        { text: '닫기', style: 'cancel', onPress: onCancel },
      ]);
    }
  };

  // v3.208: 다이얼로그 재표시 헬퍼 — 폴백 안내 후 기존 옵션(⭐/광고권)으로 복귀
  const reshow = () => showFatigueCooldownDialog(opts);

  // v3.208: 광고 시청 → SSV 적립 폴링 → 자동 skip('ad') — 실패 시 기존 경로 폴백
  const watchAdThenSkip = async () => {
    if (!isRewardedSkipAdReady()) {
      preloadRewardedSkipAd(); // 백그라운드 재로드 킥
      showAlert('광고 준비 중', '광고를 준비하고 있어요. 잠시 후 다시 시도해주세요.', [
        { text: '확인', onPress: reshow },
      ]);
      return;
    }
    const baseline = adSkips; // 시청 전 보유 광고권 — 적립(+1) 확인 기준
    try {
      const result = await showRewardedSkipAd();
      if (result !== 'earned') {
        // 중도 이탈 — 보상 없음(서버 적립도 없음), 기존 다이얼로그로 복귀
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
          doSkip('ad'); // 서버 계약 무변경 — 광고권 1장 소비 = 30분 단축
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
  };

  const buttons = [
    { text: cancelText ?? '취소', style: 'cancel' as const, onPress: onCancel },
    { text: `⭐${cost}로 ${minutes}분 단축`, onPress: () => { doSkip('points'); } },
  ];
  if (adSkips > 0) {
    buttons.push({
      text: `광고권으로 ${minutes}분 단축 (보유 ${adSkips}장)`,
      onPress: () => { doSkip('ad'); },
    });
  }
  // v3.208: 광고권 0장이어도 노출(미지원 플랫폼 제외). 준비 전엔 「광고 준비 중…」으로 표기하고
  // 누르면 재로드 킥 + 안내 후 재표시(다이얼로그 버튼에 disabled 개념이 없어 라벨로 상태 전달).
  if (isRewardedAdSupported()) {
    const adReady = isRewardedSkipAdReady();
    if (!adReady) preloadRewardedSkipAd(); // 다이얼로그 표시 시점 pre-load — 클릭 시 즉시 show
    buttons.push({
      text: adReady ? `광고 보고 ${minutes}분 단축` : '광고 준비 중…',
      onPress: () => { watchAdThenSkip(); },
    });
  }

  const completedLine =
    typeof status?.today_completed === 'number'
      ? `\n오늘 완성 ${status.today_completed}개 — 완성할 때마다 휴식이 길어져요 (${ladderText} · 매일 자정 리셋).`
      : '';
  // v3.230 A5-5: 이번 흐름 누적 사용 표시
  const spentLine = spentStars > 0 ? `\n이번에 단축에 ⭐${spentStars} 사용` : '';
  showAlert(
    '디렉터 휴식 중',
    `「${label} 디렉터」가 쉬는 중이에요 — 남은 시간 ${formatCooldown(remainingSec)}\n` +
      `⭐${cost}로 ${minutes}분 단축할 수 있어요${spentLine}${completedLine}`,
    buttons,
    opts.reshownAfterSkip ? { lockMs: FATIGUE_RESHOW_LOCK_MS } : undefined
  );
}
