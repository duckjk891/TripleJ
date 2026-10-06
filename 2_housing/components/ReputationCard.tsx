// v3.297 [Reputation] 피드백 온도 + 배지 — 내 페이지·다른 사람 채널 공용(조회 실패 시 렌더 안 함)
import { useEffect, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AppText } from './ui';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { getReputation, Reputation } from '../services/reputationService';
import { showAlert } from '../utils/appAlert';

const TEMP_EXPLAIN =
  '피드백 온도는 36.5°에서 시작해요.\n' +
  '• 다른 사람 곡·글에 댓글을 남기면 올라가요.\n' +
  '• 좋아요로 응원해도 조금씩 올라가요.\n' +
  '• 신고가 인정되면 내려가요.\n' +
  '따뜻한 피드백이 좋은 창작 커뮤니티를 만들어요.';

function tempColor(t: number): string {
  if (t >= 45) return '#ff7a59';
  if (t >= 38) return colors.accent.primary;
  if (t >= 30) return colors.text.secondary;
  return '#5b8def';
}

export default function ReputationCard({ userId, style }: { userId?: string | null; style?: any }) {
  const [rep, setRep] = useState<Reputation | null>(null);

  useEffect(() => {
    let alive = true;
    if (!userId) return;
    getReputation(String(userId))
      .then((r) => { if (alive) setRep(r); })
      .catch(() => { if (alive) setRep(null); });
    return () => { alive = false; };
  }, [userId]);

  if (!userId || !rep) return null;
  const pct = Math.max(0, Math.min(1, rep.temperature / 99));
  const color = tempColor(rep.temperature);
  return (
    <View style={[styles.card, style]}>
      <TouchableOpacity
        style={styles.tempRow}
        activeOpacity={0.7}
        onPress={() => showAlert(`피드백 온도 ${rep.temperature.toFixed(1)}°`, TEMP_EXPLAIN)}
        accessibilityLabel={`피드백 온도 ${rep.temperature.toFixed(1)}도, 설명 보기`}
      >
        <AppText variant="caption" tone="secondary">피드백 온도</AppText>
        <Feather name="help-circle" size={12} color={colors.text.muted} />
        <View style={{ flex: 1 }} />
        <AppText variant="bodyStrong" style={{ color }}>{`${rep.temperature.toFixed(1)}°`}</AppText>
      </TouchableOpacity>
      <View style={styles.barBg}>
        <View style={[styles.barFill, { width: `${Math.round(pct * 100)}%`, backgroundColor: color }]} />
      </View>
      {rep.badges.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.badgeRow}>
          {rep.badges.map((b) => (
            <TouchableOpacity
              key={b.key}
              style={styles.badge}
              activeOpacity={0.7}
              onPress={() => showAlert(b.label, b.desc)}
              accessibilityLabel={`배지 ${b.label}`}
            >
              <Feather name={(b.icon as any) || 'award'} size={12} color={colors.accent.primary} />
              <AppText variant="caption" tone="accent">{b.label}</AppText>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : (
        <AppText variant="caption" tone="muted" style={{ marginTop: spacing.sm }}>
          곡을 발매하고 댓글로 소통하면 배지를 받을 수 있어요.
        </AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.surface1, borderRadius: radius.lg,
    paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
  },
  tempRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  barBg: { height: 6, borderRadius: 3, backgroundColor: colors.bg.surface2, marginTop: spacing.sm, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  badgeRow: { gap: spacing.sm, paddingTop: spacing.md },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.md, paddingVertical: 4,
    borderRadius: 999, borderWidth: 1, borderColor: colors.accent.primary,
  },
});
