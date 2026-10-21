// v3.388 [StarStation] 별 제작소 카드(대표 명명 10-21, 코드 키는 star_station 유지) — 별 안내 팝업 안. 서버 시각 기준 진행 바·남은 시간, 다 차면 받기 버튼.
// 주기·금액 문구는 서버 응답값(cycle_seconds·reward). 비로그인·조회 실패는 렌더하지 않는다(다른 UI 무영향).
import { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppText, Button } from './ui';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { useAuthStore } from '../stores/authStore';
import { CURRENCY_ICON } from '../constants/currency';
import {
  StarStationStatus,
  getStarStationStatus,
  claimStarStationWithNotice,
  durationLabel,
} from '../services/starStationService';

export default function StarStationCard() {
  const user = useAuthStore((s) => s.user);
  const [status, setStatus] = useState<StarStationStatus | null>(null);
  const [now, setNow] = useState(Date.now());
  const [claiming, setClaiming] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setStatus(await getStarStationStatus());
    } catch {
      setStatus(null);
    }
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const remainingMs = status ? Math.max(0, status.readyAtLocal - now) : 0;
  const ready = !!status && (status.ready || remainingMs <= 0);

  // 차는 동안만 1초마다 다시 그림
  useEffect(() => {
    if (!status || ready) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [status, ready]);

  const handleClaim = async () => {
    if (claiming) return;
    setClaiming(true);
    const r = await claimStarStationWithNotice();
    if (r) {
      setStatus(r);
      setNow(Date.now());
    }
    setClaiming(false);
  };

  if (!user || !status || !status.cycleSeconds) return null;
  const pct = ready ? 1 : Math.min(1, Math.max(0, 1 - remainingMs / 1000 / status.cycleSeconds));
  return (
    <View style={[styles.card, ready && styles.cardReady]}>
      <View style={styles.head}>
        <View style={styles.title}>
          <MaterialCommunityIcons name="star-shooting-outline" size={18} color={colors.accent.primary} />
          <AppText variant="footnote" style={{ fontWeight: '700' }}>스타 제작소</AppText>
        </View>
        <AppText variant="caption" tone="muted">
          {durationLabel(status.cycleSeconds)}마다 {CURRENCY_ICON}{status.reward}
        </AppText>
      </View>
      <View style={styles.barBg}>
        <View style={[styles.barFill, { width: `${Math.round(pct * 100)}%` }]} />
      </View>
      {ready ? (
        <>
          <AppText variant="caption" tone="accent">스타가 다 만들어졌어요!</AppText>
          <Button
            label={claiming ? '받는 중…' : `${status.reward}${CURRENCY_ICON} 받기`}
            size="sm"
            fullWidth
            disabled={claiming}
            onPress={handleClaim}
            accessibilityLabel={`스타 ${status.reward}개 받기`}
          />
        </>
      ) : (
        <AppText variant="caption" tone="secondary">
          다 만들어지기까지 {durationLabel(remainingMs / 1000)} 남았어요
        </AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.deepest, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border.subtle,
    paddingVertical: spacing.md, paddingHorizontal: spacing.lg, marginBottom: spacing.md, gap: spacing.sm,
  },
  cardReady: { borderColor: colors.border.accent },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  barBg: { height: 8, borderRadius: 4, backgroundColor: colors.bg.surface2, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4, backgroundColor: colors.accent.primary },
});
