import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { usePointsStore } from '../stores/pointsStore';
import { skipFatigue, skipFatigueBulk, getFatigueStatus, formatCooldown } from '../services/fatigueService';
import { newRequestId } from '../services/genJobs';
import { markStarSpendChain } from '../utils/starSpendConfirm';
import {
  planFatigueSkip,
  labelMinutes,
  remainAfter,
  clampSelection,
  classifyFatigueSkipError,
  statusFromErrorBody,
  FATIGUE_SKIP_UNIT_MINUTES,
  FATIGUE_SKIP_MAX_UNITS,
  type FatigueSkipErrorKind,
} from '../utils/fatigueSkipPlan';
import { isRewardedAdSupported, isRewardedSkipAdReady, preloadRewardedSkipAd } from '../hooks/useRewardedSkipAd';
import type { FatigueDirector, FatigueStatus, FatigueSkipResult } from '../types';

/**
 * v3.236 A3: 휴식 디렉터 ⭐ 단축 팝업(AppDialogHost 커스텀 본문 — utils/fatigueGate 가 띄운다).
 *
 * - 남은 시간 1초 감소 표시(기기 시계 무관 — 서버 상대 초 + 표시 시점 기준 경과).
 * - 30분 단위 −/+ 스테퍼 + [전부] 칩(D2), 기본 1칸(D3). 최대 = min(필요 칸, 보유 한도, 24).
 * - 이 팝업 자체가 ⭐ 확인(D7): 확정 버튼에 금액·시간, 본문에 보유 ⭐. 추가 확인 팝업 없음.
 * - 확정 1탭 = 요청 1회(busy 중 전 버튼·백드롭·뒤로가기 무시). 네트워크 오류 재시도는 같은 request_id.
 * - 성공 후 남으면 같은 팝업 갱신 + 확정 버튼 0.8초 잠금, 0 이면 닫고 onFinished(= "휴식 종료" 안내).
 * - 서버 404(구 서버 — skip-bulk 없음) → 레거시 1칸 모드(기존 /skip 단건)로 강등.
 * - 광고 보기는 fatigueGate 기존 흐름(팝업 닫고 시청 → SSV 폴링 → skip('ad') → 팝업 재표시)을 그대로 쓴다.
 */

export type FatigueSkipDialogHandle = {
  /** AppDialogHost 백드롭·뒤로가기 → 콘텐츠가 매 렌더 갱신 */
  onRequestClose?: () => void;
};

export type FatigueSkipDialogProps = {
  director: FatigueDirector;
  label: string;
  status: FatigueStatus | null;
  remainingSec: number;
  cancelText?: string;
  /** 이번 흐름에서 이미 단축에 쓴 ⭐(광고 경유 재표시 시 누적 유지) */
  initialSpentStars: number;
  /** 재표시 직후 안내 1줄(예: 광고 보고 30분 줄였어요) */
  initialNote?: string | null;
  /** 확정 버튼 잠금 해제 시각(AppDialogHost ctx.lockUntil) */
  lockUntil: number;
  /** 구 서버 감지 이력 — true 면 레거시 1칸 모드로 시작 */
  legacy: boolean;
  onLegacyDetected: () => void;
  handle: FatigueSkipDialogHandle;
  close: () => void;
  onCleared: () => void;
  onCancel?: () => void;
  onStatusUpdate?: (s: FatigueStatus) => void;
  /** 휴식이 0 으로 끝남(단축 성공) — 팝업은 이미 닫힘. 호출자가 "휴식 종료" 안내 후 onCleared */
  onFinished: (spentStars: number) => void;
  /** 광고 보기 — 팝업은 이미 닫힘. 호출자가 기존 광고 흐름 실행 후 재표시 */
  onWatchAd: (session: { status: FatigueStatus | null; remainingSec: number; spentStars: number }) => void;
};

const FALLBACK_COST: Record<FatigueDirector, number> = { composer: 5, lyricist: 2, image: 2, artist: 3, video: 2 };
/** v3.230 A5-5 과 동일 — 단축 직후 확정 버튼 잠금 */
const AFTER_SKIP_LOCK_MS = 800;

export default function FatigueSkipDialog(props: FatigueSkipDialogProps) {
  const { director, label, close } = props;
  const tag = `director=${director}`;
  const balance = usePointsStore((s) => s.balance);

  const [status, setStatus] = useState<FatigueStatus | null>(props.status);
  const [base, setBase] = useState(() => ({ sec: Math.max(0, Math.floor(props.remainingSec || 0)), at: Date.now() }));
  const [selected, setSelected] = useState(1);
  const [busy, setBusyState] = useState(false);
  const busyRef = useRef(false);
  const [legacy, setLegacy] = useState(!!props.legacy);
  const [note, setNote] = useState<string | null>(props.initialNote ?? null);
  const [error, setError] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);
  const [lockUntil, setLockUntil] = useState(props.lockUntil || 0);
  const [, setTick] = useState(0);
  const spentRef = useRef(Math.max(0, Number(props.initialSpentStars) || 0));
  /** 같은 선택 재시도용 request_id(선택·금액이 같을 때만 재사용) */
  const retryRef = useRef<{ rid: string; units: number; total: number } | null>(null);
  const mountedRef = useRef(true);

  const setBusy = (b: boolean) => {
    busyRef.current = b;
    setBusyState(b);
  };

  // 1초 카운트다운(표시 전용 — 경과는 Date.now 기준이라 타이머 지연이 누적되지 않음)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // 잠금 해제 시 버튼 표시 갱신
  useEffect(() => {
    const wait = lockUntil - Date.now();
    if (!(wait > 0)) return undefined;
    const t = setTimeout(() => setTick((n) => n + 1), wait + 10);
    return () => clearTimeout(t);
  }, [lockUntil]);

  // 열 때 1회: 상태 재조회(오래된 잔여·단가·광고권 보정 — 실패 시 전달값 유지) + 보유 ⭐ 미확인이면 조회
  useEffect(() => {
    mountedRef.current = true;
    console.info(`[FatigueSkip] open ${tag} remainSec=${base.sec} legacy=${legacy}`);
    if (usePointsStore.getState().balance == null) {
      usePointsStore.getState().fetchBalance().catch(() => undefined);
    }
    if (isRewardedAdSupported() && !isRewardedSkipAdReady()) preloadRewardedSkipAd();
    getFatigueStatus(director)
      .then((s) => {
        if (!mountedRef.current || busyRef.current || !s) return;
        setStatus(s);
        setBase({ sec: Math.max(0, Math.floor(Number(s.cooldown_remaining_sec) || 0)), at: Date.now() });
      })
      .catch((err: any) => {
        console.error(`[FatigueSkip] error ${tag} phase=open-status status=${err?.response?.status ?? 'network'}`);
      });
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const elapsed = Math.floor((Date.now() - base.at) / 1000);
  const remain = Math.max(0, base.sec - Math.max(0, elapsed));
  const unitCost = Math.max(0, Number(status?.skip_point_cost) || FALLBACK_COST[director]);
  const unitMinutes = Math.max(1, Number(status?.skip_minutes) || FATIGUE_SKIP_UNIT_MINUTES);
  const maxUnits = Math.max(1, Number(status?.skip_max_units) || FATIGUE_SKIP_MAX_UNITS);
  const plan = planFatigueSkip({ remainingSec: remain, unitCost, unitMinutes, balance, maxUnits });
  const maxSel = legacy ? Math.min(1, plan.maxSelectable) : plan.maxSelectable;
  const sel = clampSelection(selected, maxSel);
  const total = sel * unitCost;
  const ended = remain <= 0 && !busy;
  const adSkips = Math.max(0, Number(status?.skip_wait_count) || 0);
  const adSupported = isRewardedAdSupported();
  const adReady = adSupported && isRewardedSkipAdReady();
  const locked = lockUntil > Date.now();

  const changeSelection = (next: number) => {
    if (busyRef.current) return;
    const v = clampSelection(next, maxSel);
    if (v === sel) return;
    retryRef.current = null; // 선택 변경 → 다음 확정은 새 request_id
    setRetryable(false);
    setError(null);
    setSelected(v);
    if (__DEV__) console.info(`[FatigueSkip] plan ${tag} units=${v} total=${v * unitCost} max=${maxSel} needed=${plan.neededUnits}`);
  };

  /** 단축 성공 공통 처리 — 남으면 같은 팝업 갱신, 0 이면 닫고 onFinished */
  const applySuccess = (data: FatigueSkipResult, spentDelta: number, line: string) => {
    try {
      props.onStatusUpdate?.(data);
    } catch (err) {
      console.error(`[FatigueSkip] error ${tag} phase=onStatusUpdate`, err);
    }
    // v3.230 A5-4: 단축 직후 이어지는 ⭐ 확인 다이얼로그 잠금(연타가 생성 확인까지 새지 않게)
    markStarSpendChain();
    spentRef.current += Math.max(0, spentDelta);
    const left = Math.max(0, Math.floor(Number(data?.cooldown_remaining_sec) || 0));
    retryRef.current = null;
    if (left <= 0) {
      console.info(`[FatigueSkip] cleared ${tag} spent=${spentRef.current}`);
      busyRef.current = false;
      close();
      props.onFinished(spentRef.current);
      return;
    }
    if (!mountedRef.current) return;
    setStatus(data);
    setBase({ sec: left, at: Date.now() });
    const cumulative = spentRef.current > spentDelta && spentDelta > 0 ? ` (이번에 총 ⭐${spentRef.current})` : '';
    setNote(line + cumulative);
    setError(null);
    setRetryable(false);
    setSelected(1);
    setLockUntil(Date.now() + AFTER_SKIP_LOCK_MS);
    setBusy(false);
  };

  const finishCleared = (why: string) => {
    console.info(`[FatigueSkip] cleared ${tag} reason=${why} (무과금)`);
    busyRef.current = false;
    close();
    props.onCleared();
  };

  const refreshStatus = async () => {
    try {
      const s = await getFatigueStatus(director);
      if (!mountedRef.current || !s) return;
      setStatus(s);
      setBase({ sec: Math.max(0, Math.floor(Number(s.cooldown_remaining_sec) || 0)), at: Date.now() });
    } catch (err: any) {
      console.error(`[FatigueSkip] error ${tag} phase=refresh status=${err?.response?.status ?? 'network'}`);
    }
  };

  const failWith = (message: string, opts?: { retry?: boolean; lock?: boolean }) => {
    if (!mountedRef.current) return;
    setError(message);
    setRetryable(!!opts?.retry);
    if (opts?.lock) setLockUntil(Date.now() + AFTER_SKIP_LOCK_MS);
    setBusy(false);
  };

  /** 레거시(구 서버) — 기존 /skip ⭐ 단건 1칸 */
  const runLegacySkip = async () => {
    setBusy(true);
    setError(null);
    console.info(`[FatigueSkip] confirm ${tag} units=1 total=${unitCost} mode=legacy`);
    try {
      const data = await skipFatigue('points', director);
      usePointsStore.getState().fetchBalance().catch(() => undefined);
      console.info(`[FatigueSkip] result ${tag} units=1 total=${unitCost} mode=legacy remainSec=${data?.cooldown_remaining_sec}`);
      applySuccess(data, unitCost, `방금 ⭐${unitCost}로 ${labelMinutes(unitMinutes)} 줄였어요`);
    } catch (err: any) {
      const kind = classifyFatigueSkipError(err);
      console.error(`[FatigueSkip] error ${tag} units=1 mode=legacy kind=${kind} status=${err?.response?.status ?? 'network'}`);
      if (kind === 'cleared') return finishCleared('409');
      if (kind === 'insufficient') {
        await usePointsStore.getState().fetchBalance().catch(() => undefined);
        return failWith('⭐이 부족해요');
      }
      failWith('줄이지 못했어요 — 다시 시도해주세요');
    }
  };

  const handleBulkError = async (kind: FatigueSkipErrorKind, err: any, units: number) => {
    const data = err?.response?.data;
    const statusFromBody = statusFromErrorBody(data) as FatigueStatus | null;
    switch (kind) {
      case 'legacy':
        console.info(`[FatigueSkip] fallback-legacy ${tag} (skip-bulk 404 — 1칸 단건 모드)`);
        retryRef.current = null;
        props.onLegacyDetected();
        setLegacy(true);
        setSelected(1);
        if (units === 1) {
          // 확인한 금액·시간(⭐단가·30분)과 같으므로 그대로 단건 진행
          await runLegacySkip();
        } else {
          failWith(`지금은 한 번에 ${labelMinutes(unitMinutes)}씩 줄일 수 있어요 — 다시 눌러주세요`, { lock: true });
        }
        return;
      case 'cleared':
        retryRef.current = null;
        finishCleared('no_active_cooldown');
        return;
      case 'in_progress':
        // 같은 request_id 가 처리 중 — 같은 ID 로 다시 누르면 저장된 결과가 재생된다
        failWith('처리 중이에요 — 잠시 후 다시 눌러주세요', { retry: true });
        return;
      case 'cost_changed':
        retryRef.current = null;
        if (statusFromBody && mountedRef.current) {
          setStatus(statusFromBody);
          setBase({ sec: Math.max(0, Math.floor(Number(statusFromBody.cooldown_remaining_sec) || 0)), at: Date.now() });
        } else {
          await refreshStatus();
        }
        failWith('가격이 바뀌었어요 — 다시 확인해주세요', { lock: true });
        return;
      case 'insufficient':
        retryRef.current = null;
        if (typeof data?.balance === 'number') usePointsStore.getState().setBalance(data.balance);
        else await usePointsStore.getState().fetchBalance().catch(() => undefined);
        if (statusFromBody && mountedRef.current) {
          setStatus(statusFromBody);
          setBase({ sec: Math.max(0, Math.floor(Number(statusFromBody.cooldown_remaining_sec) || 0)), at: Date.now() });
        }
        failWith('⭐이 부족해요');
        return;
      case 'retryable':
        // 응답 유실 — 처리 여부 불명. 같은 선택으로 다시 누르면 같은 request_id(서버가 결과 재생)
        failWith('연결이 불안정해요 — 다시 시도해주세요', { retry: true });
        return;
      case 'server_error':
        // 서버가 실패로 결론(차감됐으면 환불) — 다음 시도는 새 request_id
        retryRef.current = null;
        usePointsStore.getState().fetchBalance().catch(() => undefined);
        failWith('줄이지 못했어요 — 다시 시도해주세요');
        return;
      default:
        retryRef.current = null;
        failWith('요청을 처리하지 못했어요 — 다시 시도해주세요');
    }
  };

  const confirm = async () => {
    if (busyRef.current) {
      console.info(`[FatigueSkip] confirm ignored ${tag} (busy)`);
      return;
    }
    if (lockUntil > Date.now()) {
      console.info(`[FatigueSkip] confirm ignored ${tag} (locked)`);
      return;
    }
    if (!plan.canAfford || sel < 1) return;
    if (legacy) {
      await runLegacySkip();
      return;
    }
    const units = sel;
    const expected = units * unitCost;
    const prev = retryRef.current;
    const rid = prev && prev.units === units && prev.total === expected ? prev.rid : newRequestId();
    retryRef.current = { rid, units, total: expected };
    setBusy(true);
    setError(null);
    console.info(`[FatigueSkip] confirm ${tag} units=${units} total=${expected} rid=${rid.slice(0, 8)}${prev && prev.rid === rid ? ' retry=same-rid' : ''}`);
    try {
      const data = await skipFatigueBulk({ director, units, requestId: rid, expectedTotal: expected, expectedUnitCost: unitCost });
      const spent = Number.isFinite(Number(data?.points_spent)) ? Number(data.points_spent) : expected;
      if (typeof data?.balance === 'number') usePointsStore.getState().setBalance(data.balance);
      else usePointsStore.getState().fetchBalance().catch(() => undefined);
      const minutesDone = Number(data?.skipped_minutes) || units * unitMinutes;
      console.info(
        `[FatigueSkip] result ${tag} units=${data?.units_applied ?? units} total=${spent} rid=${rid.slice(0, 8)} replayed=${!!data?.replayed} remainSec=${data?.cooldown_remaining_sec}`
      );
      applySuccess(data, spent, `방금 ⭐${spent}로 ${labelMinutes(minutesDone)} 줄였어요`);
    } catch (err: any) {
      const kind = classifyFatigueSkipError(err);
      console.error(
        `[FatigueSkip] error ${tag} units=${units} total=${expected} rid=${rid.slice(0, 8)} kind=${kind} status=${err?.response?.status ?? 'network'}`
      );
      await handleBulkError(kind, err, units);
    }
  };

  /** 광고권 1장 = 30분(D5 — 단건 유지, 팝업 안에서 처리) */
  const spendTicket = async () => {
    if (busyRef.current) return;
    setBusy(true);
    setError(null);
    console.info(`[FatigueSkip] confirm ${tag} method=ticket`);
    try {
      const data = await skipFatigue('ad', director);
      console.info(`[FatigueSkip] result ${tag} method=ticket remainSec=${data?.cooldown_remaining_sec}`);
      applySuccess(data, 0, `광고권으로 ${labelMinutes(unitMinutes)} 줄였어요`);
    } catch (err: any) {
      const kind = classifyFatigueSkipError(err);
      console.error(`[FatigueSkip] error ${tag} method=ticket kind=${kind} status=${err?.response?.status ?? 'network'}`);
      if (kind === 'cleared') return finishCleared('409');
      if (kind === 'no_tickets') {
        await refreshStatus();
        return failWith('사용할 수 있는 광고권이 없어요');
      }
      failWith('줄이지 못했어요 — 다시 시도해주세요');
    }
  };

  const watchAd = () => {
    if (busyRef.current) return;
    console.info(`[FatigueSkip] ad ${tag} ready=${adReady}`);
    close();
    props.onWatchAd({ status, remainingSec: remain, spentStars: spentRef.current });
  };

  const cancel = () => {
    if (busyRef.current) {
      console.info(`[FatigueSkip] close ignored ${tag} (busy)`);
      return;
    }
    close();
    props.onCancel?.();
  };

  const continueAfterEnd = () => {
    if (busyRef.current) return;
    finishCleared('countdown');
  };

  // AppDialogHost 백드롭·뒤로가기 — 바쁜 동안 무시, 휴식이 끝난 상태면 [계속]과 같게
  props.handle.onRequestClose = ended ? continueAfterEnd : cancel;

  if (ended) {
    return (
      <View>
        <Text style={styles.endTitle}>휴식이 끝났어요</Text>
        <Text style={styles.sub}>「{label} 디렉터」가 다시 준비됐어요.</Text>
        <View style={styles.btnCol}>
          <TouchableOpacity style={[styles.btn, styles.primaryBtn]} onPress={continueAfterEnd} activeOpacity={0.7}>
            <Text style={styles.primaryText}>계속</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const selMinutes = sel * unitMinutes;
  const finishesAll = sel >= plan.neededUnits;
  const primaryLabel = busy
    ? '줄이는 중…'
    : retryable
      ? `다시 시도 (⭐${total} · ${labelMinutes(selMinutes)})`
      : finishesAll
        ? `⭐${total} 사용하고 휴식 끝내기`
        : `⭐${total} 사용하고 ${labelMinutes(selMinutes)} 줄이기`;
  const balanceText = typeof balance === 'number' ? `보유 ⭐${balance}` : '보유 확인 중…';
  const showStepper = !legacy && plan.canAfford && maxSel >= 1;

  return (
    <View>
      <View style={styles.remainRow}>
        <Text style={styles.remainLabel}>남은 시간</Text>
        <Text style={styles.remainValue}>{formatCooldown(remain)}</Text>
      </View>
      <Text style={styles.sub}>
        전부 줄이려면 ⭐{plan.totalNeeded} · {balanceText}
      </Text>
      {!!note && <Text style={styles.note}>{note}</Text>}

      {!plan.canAfford ? (
        <Text style={styles.warn}>
          ⭐이 부족해요 ({labelMinutes(unitMinutes)}에 ⭐{unitCost})
        </Text>
      ) : showStepper ? (
        <View style={styles.stepperBlock}>
          <View style={styles.stepperRow}>
            <TouchableOpacity
              style={[styles.stepBtn, (sel <= 1 || busy) && styles.dim]}
              onPress={() => changeSelection(sel - 1)}
              disabled={sel <= 1 || busy}
              accessibilityRole="button"
              accessibilityLabel={`${labelMinutes(unitMinutes)} 덜 줄이기`}
            >
              <Text style={styles.stepText}>−</Text>
            </TouchableOpacity>
            <Text style={styles.selText}>
              {labelMinutes(selMinutes)} · ⭐{total}
            </Text>
            <TouchableOpacity
              style={[styles.stepBtn, (sel >= maxSel || busy) && styles.dim]}
              onPress={() => changeSelection(sel + 1)}
              disabled={sel >= maxSel || busy}
              accessibilityRole="button"
              accessibilityLabel={`${labelMinutes(unitMinutes)} 더 줄이기`}
            >
              <Text style={styles.stepText}>+</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chip, sel >= maxSel && styles.chipOn, busy && styles.dim]}
              onPress={() => changeSelection(maxSel)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={plan.limitedByBalance ? '보유 한도만큼 선택' : '전부 선택'}
            >
              <Text style={[styles.chipText, sel >= maxSel && styles.chipTextOn]}>
                {plan.limitedByBalance ? '보유 한도' : '전부'}
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.after}>
            {finishesAll ? '바로 끝나요' : `줄인 뒤 남은 시간 ${formatCooldown(remainAfter(remain, sel, unitMinutes))}`}
          </Text>
        </View>
      ) : null}

      {!!error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.btnCol}>
        {plan.canAfford && sel >= 1 && (
          <TouchableOpacity
            style={[styles.btn, styles.primaryBtn, (locked || busy) && styles.dim]}
            onPress={confirm}
            disabled={busy}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <Text style={styles.primaryText}>{primaryLabel}</Text>
          </TouchableOpacity>
        )}
        {adSupported && (
          <TouchableOpacity
            style={[styles.btn, styles.secondaryBtn, busy && styles.dim]}
            onPress={watchAd}
            disabled={busy}
            activeOpacity={0.7}
          >
            <Text style={styles.secondaryText}>{adReady ? `광고 보고 ${labelMinutes(unitMinutes)} 줄이기` : '광고 준비 중…'}</Text>
          </TouchableOpacity>
        )}
        {adSkips > 0 && (
          <TouchableOpacity
            style={[styles.btn, styles.secondaryBtn, busy && styles.dim]}
            onPress={spendTicket}
            disabled={busy}
            activeOpacity={0.7}
          >
            <Text style={styles.secondaryText}>
              광고권으로 {labelMinutes(unitMinutes)} 줄이기 ({adSkips}장)
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.btn, styles.cancelBtn, busy && styles.dim]}
          onPress={cancel}
          disabled={busy}
          activeOpacity={0.7}
        >
          <Text style={styles.cancelText}>{props.cancelText ?? '닫기'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  remainRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 },
  remainLabel: { fontSize: 13, color: colors.text.secondary },
  remainValue: { fontSize: 22, fontWeight: '700', color: colors.text.primary, fontVariant: ['tabular-nums'] },
  sub: { fontSize: 13, color: colors.text.secondary, lineHeight: 19, marginBottom: 12 },
  note: { fontSize: 12, color: colors.status.success, marginBottom: 10 },
  warn: { fontSize: 13, color: colors.status.warning, marginBottom: 14 },
  error: { fontSize: 12, color: colors.status.error, marginBottom: 10 },
  endTitle: { fontSize: 15, fontWeight: '700', color: colors.text.primary, marginBottom: 6 },
  stepperBlock: { marginBottom: 14 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.surface2,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  stepText: { fontSize: 20, fontWeight: '700', color: colors.text.primary },
  selText: { flex: 1, textAlign: 'center', fontSize: 14, fontWeight: '700', color: colors.text.primary },
  chip: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 22,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border.accent,
  },
  chipOn: { backgroundColor: colors.accent.primary },
  chipText: { fontSize: 13, fontWeight: '700', color: colors.accent.primaryGlow },
  chipTextOn: { color: colors.text.primary },
  after: { marginTop: 8, fontSize: 12, color: colors.text.muted, textAlign: 'center' },
  btnCol: { gap: 8 },
  btn: {
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10,
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
  },
  primaryBtn: { backgroundColor: colors.accent.primary },
  primaryText: { color: colors.text.primary, fontSize: 14, fontWeight: '700' },
  secondaryBtn: { backgroundColor: colors.bg.surface2, borderWidth: 1, borderColor: colors.border.default },
  secondaryText: { color: colors.text.primary, fontSize: 14, fontWeight: '600' },
  cancelBtn: { backgroundColor: colors.bg.surface2, borderWidth: 1, borderColor: colors.border.subtle },
  cancelText: { color: colors.text.secondary, fontSize: 14, fontWeight: '600' },
  dim: { opacity: 0.45 },
});
