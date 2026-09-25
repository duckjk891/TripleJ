// v3.230 A7-3 [StarHistory] 스타(⭐) 내역 — 서버 GET /points/history(기존 API) 최근 100건.
// 화면 규격 = NotificationsScreen(네이티브 스택 헤더 '스타 내역' · 본문 목록 · 당겨서 새로고침 · EmptyState)과
// 같은 계열. 상단 보유 잔액 박스는 StarGuideModal balanceBox 와 같은 모양.
import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { View, FlatList, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AppText, Button, EmptyState } from '../components/ui';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { CURRENCY, CURRENCY_ICON } from '../constants/currency';
import { usePointsStore } from '../stores/pointsStore';
import { useAuthStore } from '../stores/authStore';
import { getPointsHistory, type PointEvent } from '../services/pointsHistoryService';
import { formatStarAmount, formatStarTime, labelForPointAction } from '../utils/starHistory';

const HISTORY_LIMIT = 100;

const KIND_ICON: Record<string, any> = { earn: 'plus-circle', use: 'minus-circle', refund: 'rotate-ccw' };

export default function StarHistoryScreen() {
  const isLoggedIn = useAuthStore((s) => !!s.user);
  const balance = usePointsStore((s) => s.balance);
  const fetchBalance = usePointsStore((s) => s.fetchBalance);
  const [items, setItems] = useState<PointEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    console.info('[StarHistory] 목록 조회 시작');
    try {
      const list = await getPointsHistory(HISTORY_LIMIT);
      setItems(list);
      setFailed(false);
      console.info('[StarHistory] 목록 조회 완료', { n: list.length });
    } catch (err: any) {
      console.error('[StarHistory] 목록 조회 실패', { status: err?.response?.status, message: err?.message });
      setFailed(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    fetchBalance();
  }, [fetchBalance]);

  useFocusEffect(useCallback(() => {
    if (!isLoggedIn) { setLoading(false); return; }
    load();
  }, [isLoggedIn, load]));

  const renderItem = ({ item }: { item: PointEvent }) => {
    const { label, kind } = labelForPointAction(item.action, item.amount);
    const positive = item.amount > 0;
    return (
      <View style={styles.row}>
        <View style={styles.iconWrap}>
          <Feather name={KIND_ICON[kind] || 'star'} size={16} color={positive ? colors.accent.primary : colors.text.secondary} />
        </View>
        <View style={{ flex: 1, marginHorizontal: spacing.md }}>
          <AppText variant="body" numberOfLines={1}>{label}</AppText>
          <AppText variant="caption" tone="muted">{formatStarTime(item.created_at)}</AppText>
        </View>
        <AppText variant="bodyStrong" tone={positive ? 'accent' : 'secondary'}>
          {`${CURRENCY_ICON} ${formatStarAmount(item.amount)}`}
        </AppText>
      </View>
    );
  };

  const header = (
    <View style={styles.balanceBox}>
      <AppText variant="footnote" tone="secondary">보유 {CURRENCY}</AppText>
      <AppText variant="title1" tone="accent">{CURRENCY_ICON} {balance ?? 0}</AppText>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* 타이틀·뒤로가기는 네이티브 헤더(App.tsx stackHeader) — 본문 헤더 없음 */}
      {!isLoggedIn ? (
        <EmptyState icon={<Feather name="star" size={44} color={colors.text.muted} />} title="로그인하면 스타 내역을 볼 수 있어요" />
      ) : loading ? (
        <ActivityIndicator size="large" color={colors.accent.primary} style={{ marginTop: 60 }} />
      ) : failed && items.length === 0 ? (
        <EmptyState
          icon={<Feather name="alert-circle" size={44} color={colors.text.muted} />}
          title="스타 내역을 불러오지 못했어요"
          hint="잠시 후 다시 시도해주세요"
          action={<Button label="다시 시도" onPress={() => { setLoading(true); load(); }} />}
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(e, i) => `${e.action}-${e.created_at ?? ''}-${i}`}
          renderItem={renderItem}
          ListHeaderComponent={header}
          ListEmptyComponent={<EmptyState title="아직 스타 내역이 없어요" hint="스타를 받거나 쓰면 여기에 표시됩니다" />}
          ListFooterComponent={items.length >= HISTORY_LIMIT
            ? <AppText variant="caption" tone="muted" center style={styles.footer}>최근 {HISTORY_LIMIT}건까지 보여드려요</AppText>
            : null}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent.primary} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  balanceBox: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.bg.surface1, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border.accent,
    paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
    marginHorizontal: spacing.lg, marginTop: spacing.md, marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  iconWrap: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.bg.surface2,
    justifyContent: 'center', alignItems: 'center',
  },
  footer: { paddingVertical: spacing.lg },
});
