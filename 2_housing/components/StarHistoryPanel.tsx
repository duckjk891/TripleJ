// v3.307 [StarHistory] 스타 내역 — ⭐ 안내 팝업 안에서 보여주는 패널(대표 10-08: 새 페이지 대신 팝업 안 + 이전 버튼).
// 데이터·라벨은 StarHistoryScreen 과 동일(GET /points/history 최근 100건, utils/starHistory).
import { useEffect, useState } from 'react';
import { View, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AppText, Button } from './ui';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { CURRENCY_ICON } from '../constants/currency';
import { usePointsStore } from '../stores/pointsStore';
import { getPointsHistory, type PointEvent } from '../services/pointsHistoryService';
import { formatStarAmount, formatStarTime, labelForPointAction } from '../utils/starHistory';

const HISTORY_LIMIT = 100;
const KIND_ICON: Record<string, any> = { earn: 'plus-circle', use: 'minus-circle', refund: 'rotate-ccw' };

export default function StarHistoryPanel({ maxHeight }: { maxHeight: number }) {
  const fetchBalance = usePointsStore((s) => s.fetchBalance);
  const [items, setItems] = useState<PointEvent[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = async () => {
    setFailed(false);
    setItems(null);
    console.info('[StarHistory] 팝업 내역 조회 시작');
    try {
      const list = await getPointsHistory(HISTORY_LIMIT);
      setItems(list);
      console.info('[StarHistory] 팝업 내역 조회 완료', { n: list.length });
    } catch (err: any) {
      console.error('[StarHistory] 팝업 내역 조회 실패', { status: err?.response?.status, message: err?.message });
      setFailed(true);
      setItems([]);
    }
    fetchBalance();
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (items === null) return <ActivityIndicator color={colors.accent.primary} style={{ marginVertical: spacing.xxl }} />;
  if (failed) {
    return (
      <View style={styles.center}>
        <AppText variant="footnote" tone="secondary">스타 내역을 불러오지 못했어요</AppText>
        <Button label="다시 시도" size="sm" variant="tonal" onPress={load} />
      </View>
    );
  }
  if (!items.length) {
    return (
      <View style={styles.center}>
        <AppText variant="footnote" tone="secondary">아직 스타 내역이 없어요</AppText>
        <AppText variant="caption" tone="muted">스타를 받거나 쓰면 여기에 표시돼요</AppText>
      </View>
    );
  }
  return (
    <ScrollView style={{ maxHeight, flexGrow: 0 }} showsVerticalScrollIndicator={false}>
      {items.map((item, i) => {
        const { label, kind } = labelForPointAction(item.action, item.amount);
        const positive = item.amount > 0;
        return (
          <View key={`${item.action}-${item.created_at ?? ''}-${i}`} style={styles.row}>
            <View style={styles.iconWrap}>
              <Feather name={KIND_ICON[kind] || 'star'} size={14} color={positive ? colors.accent.primary : colors.text.secondary} />
            </View>
            <View style={{ flex: 1, marginHorizontal: spacing.sm }}>
              <AppText variant="footnote" numberOfLines={1}>{label}</AppText>
              <AppText variant="caption" tone="muted">{formatStarTime(item.created_at)}</AppText>
            </View>
            <AppText variant="footnote" tone={positive ? 'accent' : 'secondary'}>{`${CURRENCY_ICON} ${formatStarAmount(item.amount)}`}</AppText>
          </View>
        );
      })}
      {items.length >= HISTORY_LIMIT ? (
        <AppText variant="caption" tone="muted" center style={{ paddingVertical: spacing.md }}>최근 {HISTORY_LIMIT}건까지 보여드려요</AppText>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl },
  row: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  iconWrap: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.bg.surface2, justifyContent: 'center', alignItems: 'center' },
});
