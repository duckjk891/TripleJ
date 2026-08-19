// [MyReports] 내 신고 내역 — GET /reports/my. 신고 접수 안내("설정 > 내 신고 내역")의 실제 목적지.
import { useState, useCallback } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { View, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import api from '../services/api';
import { AppText, EmptyState } from '../components/ui';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';

const REASON_LABEL: Record<string, string> = {
  portrait: '초상권 침해', copyright: '저작권 침해', sexual: '성적·불쾌 콘텐츠', abuse: '욕설·괴롭힘', other: '기타',
};
const TYPE_LABEL: Record<string, string> = { track: '곡', feed: '피드', comment: '댓글', dm_message: '메시지' };
const STATUS_LABEL: Record<string, string> = {
  pending: '처리 대기', reviewing: '검토 중', actioned: '조치 완료', dismissed: '기각', resolved: '처리 완료',
};

const parseUtc = (iso: string) => new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z');

export default function MyReportsScreen() {
  const navigation = useNavigation<any>();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (__DEV__) console.info('[MyReports] 목록 조회');
    try {
      const res = await api.get('/reports/my', { params: { limit: 50 } });
      setItems(res.data?.reports || []);
    } catch (err: any) {
      console.error('[MyReports] 조회 실패', { status: err?.response?.status });
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="뒤로가기" style={{ padding: 4 }}>
          <Feather name="arrow-left" size={22} color={colors.text.primary} />
        </TouchableOpacity>
        <AppText variant="title3" style={{ marginLeft: spacing.sm }}>내 신고 내역</AppText>
      </View>
      {loading ? (
        <ActivityIndicator size="large" color={colors.accent.primary} style={{ marginTop: 60 }} />
      ) : items.length === 0 ? (
        <EmptyState title="접수한 신고가 없어요" hint="신고한 콘텐츠의 처리 결과가 여기에 표시됩니다" />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(r, i) => String(r.report_id || r.id || i)}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <AppText variant="footnote">
                  [{TYPE_LABEL[item.target_type] || item.target_type}] {REASON_LABEL[item.reason_code] || item.reason_code}
                </AppText>
                {item.target_summary ? (
                  <AppText variant="caption" tone="muted" numberOfLines={1}>{item.target_summary}</AppText>
                ) : null}
                {item.created_at ? (
                  <AppText variant="caption" tone="muted">{parseUtc(item.created_at).toLocaleDateString('ko-KR')}</AppText>
                ) : null}
              </View>
              <View style={styles.statusChip}>
                <AppText variant="caption" tone="accent">{STATUS_LABEL[item.status] || item.status || '접수됨'}</AppText>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest, paddingTop: 50 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  statusChip: {
    paddingHorizontal: spacing.md, paddingVertical: 4,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.accent.primary,
  },
});
