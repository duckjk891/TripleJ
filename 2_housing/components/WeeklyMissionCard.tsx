// v3.293 [WeeklyMission] 이번 주 미션 카드 — 내 아티스트로 창작하면 ⭐ 보상(대표 확정 '주간 미션형').
// 별 안내 팝업·내 아티스트 화면에서 공용. 비로그인·조회 실패는 렌더하지 않는다(다른 UI 무영향).
import { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AppText } from './ui';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { useAuthStore } from '../stores/authStore';
import { getWeeklyMissions, WeeklyMissionStatus } from '../services/missionService';
import { CURRENCY_ICON } from '../constants/currency';

export default function WeeklyMissionCard({ onGo }: { onGo?: () => void }) {
  const user = useAuthStore((s) => s.user);
  const [status, setStatus] = useState<WeeklyMissionStatus | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setStatus(await getWeeklyMissions());
    } catch {
      setStatus(null);
    }
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  if (!user || !status || status.missions.length === 0) return null;
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <AppText variant="footnote" style={{ fontWeight: '700' }}>이번 주 미션</AppText>
        <AppText variant="caption" tone="muted">매주 월요일 0시 새로 시작</AppText>
      </View>
      {status.missions.map((m) => {
        const pct = m.target > 0 ? Math.min(1, m.count / m.target) : 0;
        return (
          <View key={m.key} style={styles.row}>
            <View style={{ flex: 1 }}>
              <AppText variant="caption" tone={m.rewarded ? 'muted' : 'primary'} numberOfLines={1}>{m.title}</AppText>
              <View style={styles.barBg}>
                <View style={[styles.barFill, { width: `${Math.round(pct * 100)}%` }]} />
              </View>
            </View>
            <View style={styles.right}>
              {m.rewarded ? (
                <AppText variant="caption" tone="accent" style={{ fontWeight: '700' }}>완료 ✓</AppText>
              ) : (
                <AppText variant="caption" tone="secondary">{m.count}/{m.target}</AppText>
              )}
              <AppText variant="caption" tone="accent">+{CURRENCY_ICON}{m.reward}</AppText>
            </View>
          </View>
        );
      })}
      {onGo ? (
        <TouchableOpacity style={styles.go} onPress={onGo} activeOpacity={0.7} accessibilityLabel="작업실로 가서 미션 하기">
          <AppText variant="caption" tone="accent">내 아티스트로 만들러 가기</AppText>
          <Feather name="chevron-right" size={14} color={colors.accent.primary} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.deepest, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border.subtle,
    paddingVertical: spacing.md, paddingHorizontal: spacing.lg, marginBottom: spacing.md, gap: spacing.sm,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  barBg: { height: 6, borderRadius: 3, backgroundColor: colors.bg.surface2, marginTop: 6, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.accent.primary },
  right: { alignItems: 'flex-end', minWidth: 52 },
  go: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 2 },
});
