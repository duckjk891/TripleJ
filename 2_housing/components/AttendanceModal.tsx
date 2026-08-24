// [AttendanceModal] 출석체크 — MAIDOL AttendanceCard 이식(10일 사이클 캘린더 + 체크인 + 토스트).
// 백엔드 계약: GET /attendance/status → {checked_today, cycle_day, cumulative_count, today_reward, calendar:[{day,reward,claimed}], balance}
//             POST /attendance/check-in → {awarded, cycle_day, already, balance}
import { useState, useEffect, useCallback } from 'react';
import { Modal, View, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import api from '../services/api';
import { useUiStore } from '../stores/uiStore';
import { usePointsStore } from '../stores/pointsStore';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { AppText, Button } from './ui';

interface Cell { day: number; reward: number; claimed: boolean }
interface Status {
  checked_today?: boolean;
  cycle_day?: number;
  cumulative_count?: number;
  today_reward?: number;
  calendar?: Cell[];
  balance?: number;
}

export default function AttendanceModal() {
  const open = useUiStore((s) => s.attendanceOpen);
  const close = useUiStore((s) => s.closeAttendance);
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [toast, setToast] = useState('');
  const [notice, setNotice] = useState('');

  const loadStatus = useCallback(async () => {
    if (__DEV__) console.info('[AttendanceModal] getAttendanceStatus');
    try {
      const { data } = await api.get('/attendance/status');
      setStatus(data);
      if (typeof data?.balance === 'number') usePointsStore.getState().setBalance(data.balance); // 별 배지 동기화
      return data as Status;
    } catch (err: any) {
      console.error('[AttendanceModal] status 실패', { status: err?.response?.status });
      setError('출석 현황을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
      return null;
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true); setError(''); setNotice(''); setToast('');
    loadStatus().finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, loadStatus]);

  const checkedToday = !!status?.checked_today;
  const cycleDay = status?.cycle_day ?? 1;
  const calendar = status?.calendar || [];

  const handleCheckIn = useCallback(async () => {
    if (claiming || checkedToday) return;
    setClaiming(true); setNotice('');
    if (__DEV__) console.info('[AttendanceModal] check-in start');
    try {
      const { data } = await api.post('/attendance/check-in');
      if (typeof data?.balance === 'number') usePointsStore.getState().setBalance(data.balance); // 체크인 즉시 별 배지 갱신
      if (data?.already) {
        setNotice('이미 오늘 출석했어요 ✅');
      } else if (data?.awarded > 0) {
        setToast(`🎉 ${data.cycle_day}일차 출석! ⭐ +${data.awarded}`);
        setTimeout(() => setToast(''), 2600);
      }
      await loadStatus();
    } catch (err: any) {
      console.error('[AttendanceModal] check-in 실패', { status: err?.response?.status });
      setError('출석체크에 실패했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setClaiming(false);
    }
  }, [claiming, checkedToday, loadStatus]);

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={close}>
        <TouchableOpacity style={styles.modal} activeOpacity={1} onPress={() => {}}>
          <View style={styles.head}>
            <AppText variant="title2">⭐ 출석체크</AppText>
            <TouchableOpacity onPress={close} accessibilityLabel="닫기">
              <AppText variant="title3" tone="muted">✕</AppText>
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.state}><ActivityIndicator color={colors.accent.primary} /></View>
          ) : error ? (
            <View style={styles.state}>
              <AppText tone="secondary" center>{error}</AppText>
              <View style={{ marginTop: spacing.md }}>
                <Button label="다시 시도" variant="tonal" onPress={() => { setError(''); setLoading(true); loadStatus().finally(() => setLoading(false)); }} />
              </View>
            </View>
          ) : (
            <>
              <View style={styles.summary}>
                <AppText variant="footnote" tone="secondary">
                  누적 출석 <AppText variant="footnote" tone="accent">{status?.cumulative_count ?? 0}</AppText>일
                </AppText>
                <AppText variant="footnote" tone="muted">
                  이번 사이클 {checkedToday ? cycleDay : Math.max(0, cycleDay - 1)}/10
                </AppText>
              </View>

              <View style={styles.grid}>
                {calendar.map((c) => {
                  const isNext = !checkedToday && c.day === cycleDay;
                  const isBonus = c.day === 5 || c.day === 10;
                  return (
                    <View
                      key={c.day}
                      style={[styles.cell, c.claimed && styles.cellClaimed, isNext && styles.cellNext, isBonus && styles.cellBonus]}
                    >
                      <AppText variant="caption" tone="muted">{c.day}일차</AppText>
                      <AppText variant="footnote" tone={isBonus ? 'accent' : 'primary'}>⭐{c.reward}</AppText>
                      <AppText variant="body">{c.claimed ? '✅' : isNext ? '🎁' : '🔒'}</AppText>
                    </View>
                  );
                })}
              </View>

              {notice ? <AppText variant="footnote" tone="accent" center style={styles.notice}>{notice}</AppText> : null}

              <View style={styles.claimWrap}>
                <Button
                  label={checkedToday
                    ? '오늘 출석 완료 ✅'
                    : claiming
                      ? '처리 중…'
                      : `⭐ 오늘 출석하고 스타 받기${status?.today_reward ? ` (⭐${status.today_reward})` : ''}`}
                  fullWidth
                  disabled={checkedToday || claiming}
                  onPress={handleCheckIn}
                />
              </View>
            </>
          )}

          {toast ? <View style={styles.toast}><AppText tone="primary" center>{toast}</AppText></View> : null}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  modal: { width: '100%', maxWidth: 380, backgroundColor: colors.bg.surface1, borderRadius: radius.xxl, padding: spacing.xl },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  state: { paddingVertical: spacing.xxl, alignItems: 'center' },
  summary: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center' },
  cell: {
    width: 60, paddingVertical: spacing.sm, alignItems: 'center', gap: 2,
    backgroundColor: colors.bg.deepest, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  cellClaimed: { borderColor: colors.status.success, opacity: 0.6 },
  cellNext: { borderColor: colors.accent.primary, backgroundColor: colors.bg.surface2 },
  cellBonus: { borderColor: colors.accent.secondary },
  notice: { marginTop: spacing.sm },
  claimWrap: { marginTop: spacing.lg },
  toast: {
    marginTop: spacing.md, backgroundColor: colors.accent.primaryDim,
    borderRadius: radius.pill, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg,
  },
});
