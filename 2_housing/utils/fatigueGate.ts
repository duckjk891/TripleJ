import { showAlert } from './appAlert';
import { skipFatigue, formatCooldown } from '../services/fatigueService';
import { usePointsStore } from '../stores/pointsStore';
import { FatigueStatus } from '../types';

/**
 * v3.94: 디렉터 휴식(쿨다운) 공용 다이얼로그 — MusicGeneration(게이트)·MusicLoading(429 레이스) 공유.
 * MAIDOL StudioTab2 피로 패널의 스킵 흐름을 앱 내 다이얼로그(showAlert)로 이식:
 * - ⭐{skip_point_cost}로 {skip_minutes}분 단축 (반복 가능)
 * - 광고권 보유(skip_wait_count>0) 시에만 광고권 단축 노출 — 신규 광고 시청 배선은 미포함(SSV 미연동)
 * - 스킵 후에도 남으면 갱신된 남은 시간으로 재안내, 0 도달 시 onCleared 호출
 */
export function showFatigueCooldownDialog(opts: {
  status: FatigueStatus | null;
  remainingSec: number;
  /** 쿨다운이 해제됐을 때(스킵으로 0 도달 또는 서버 409=쿨다운 없음) 호출 */
  onCleared: () => void;
  /** 취소/닫기 시 호출 (미지정 시 다이얼로그만 닫힘) */
  onCancel?: () => void;
  /** 스킵 응답(status payload)으로 화면 상태 동기화 */
  onStatusUpdate?: (s: FatigueStatus) => void;
  cancelText?: string;
}): void {
  const { status, remainingSec, onCleared, onCancel, onStatusUpdate, cancelText } = opts;
  const cost = status?.skip_point_cost ?? 5;
  const minutes = status?.skip_minutes ?? 30;
  const adSkips = Math.max(0, Number(status?.skip_wait_count) || 0);

  // 사다리 안내 — 서버 ladder({"1":2,"2":4,"3":8,"4+":12}) 우선, 없으면 계약 기본값
  const ladder =
    status?.ladder && Object.keys(status.ladder).length > 0
      ? status.ladder
      : { '1': 2, '2': 4, '3': 8, '4+': 12 };
  const ladderText = Object.entries(ladder)
    .map(([count, hours]) => `${count}곡 ${hours}시간`)
    .join(' · ');

  const doSkip = async (method: 'points' | 'ad') => {
    try {
      const data = await skipFatigue(method);
      onStatusUpdate?.(data);
      if (method === 'points') usePointsStore.getState().fetchBalance(); // ⭐ 차감 반영
      const remain = Math.max(0, Math.floor(data?.cooldown_remaining_sec ?? 0));
      if (remain <= 0) {
        showAlert('휴식 종료', '디렉터가 다시 준비됐어요! 이제 작곡을 지시할 수 있어요.', [
          { text: '확인', onPress: onCleared },
        ]);
      } else {
        // 아직 쿨다운 잔여 — 갱신된 남은 시간으로 재안내(반복 스킵 가능)
        showFatigueCooldownDialog({ ...opts, status: data, remainingSec: remain });
      }
    } catch (err: any) {
      const st = err?.response?.status;
      const serverError = err?.response?.data?.error;
      console.error('[fatigue] skip 실패:', method, st, serverError);
      if (st === 409) {
        // 활성 쿨다운 없음(무과금 — fatigue.py:87) — 이미 해제된 것
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

  const completedLine =
    typeof status?.today_completed === 'number' ? `오늘 완성 ${status.today_completed}곡 — ` : '';
  showAlert(
    '디렉터 휴식 중',
    `${completedLine}남은 휴식 ${formatCooldown(remainingSec)}\n` +
      `곡이 완성될 때마다 휴식이 길어져요 (${ladderText} · 매일 자정 리셋).\n` +
      `휴식이 끝나면 새 작곡을 지시할 수 있어요.`,
    buttons
  );
}
