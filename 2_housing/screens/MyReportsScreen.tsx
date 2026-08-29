// [MyReports] 내 신고 내역 — GET /reports/my. 신고 접수 안내("설정 > 내 신고 내역")의 실제 목적지.
// v3.95(A-13): "블라인드된 내 콘텐츠" 탭 추가 — GET /reports/my-affected → 소명(AppealModal) 제출.
import { useState, useCallback } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { View, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../services/api';
import { AppText, EmptyState } from '../components/ui';
import AppealModal, { AffectedReport } from '../components/AppealModal';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';

const REASON_LABEL: Record<string, string> = {
  portrait: '초상권 침해', copyright: '저작권 침해', sexual: '성적·불쾌 콘텐츠', abuse: '욕설·괴롭힘', other: '기타',
};
const TYPE_LABEL: Record<string, string> = { track: '곡', feed: '피드', comment: '댓글', dm_message: '메시지' };
const STATUS_LABEL: Record<string, string> = {
  pending: '처리 대기', reviewing: '검토 중', actioned: '조치 완료', dismissed: '기각', resolved: '처리 완료',
};
// my-affected의 action/resolution — 서버 상태값(reports.py) 그대로 라벨링
const ACTION_LABEL: Record<string, string> = {
  blind: '블라인드', delete: '삭제', confirm_delete: '확정 삭제', restore: '복원',
};

const parseUtc = (iso: string) => new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z');

type TabKey = 'mine' | 'affected';

export default function MyReportsScreen() {
  // v3.73: 상단 공백 제거 — 고정 50 대신 기기 상태바 높이만큼만(웹 0)
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const [tab, setTab] = useState<TabKey>('mine');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // 블라인드된 내 콘텐츠(소명 대상) 목록
  const [affected, setAffected] = useState<AffectedReport[]>([]);
  const [affectedLoading, setAffectedLoading] = useState(true);
  const [appealTarget, setAppealTarget] = useState<AffectedReport | null>(null);

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

  const loadAffected = useCallback(async () => {
    if (__DEV__) console.info('[MyReports] my-affected 조회');
    try {
      const res = await api.get('/reports/my-affected');
      setAffected(res.data?.reports || []);
    } catch (err: any) {
      console.error('[MyReports] my-affected 조회 실패', { status: err?.response?.status });
    } finally {
      setAffectedLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); loadAffected(); }, [load, loadAffected]));

  const renderMine = ({ item }: { item: any }) => (
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
  );

  // 블라인드된 내 콘텐츠 행 — 탭하면 소명 모달(이미 제출한 건은 모달에서 안내만)
  const renderAffected = ({ item }: { item: AffectedReport }) => {
    const summary = item.target?.title || item.target?.text_excerpt
      || (item.target?.deleted ? '삭제된 콘텐츠' : '');
    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => setAppealTarget(item)}
        accessibilityLabel="소명하기"
      >
        <View style={{ flex: 1 }}>
          <AppText variant="footnote">
            [{TYPE_LABEL[item.target_type] || item.target_type}] {REASON_LABEL[item.reason_code] || item.reason_code}
          </AppText>
          {summary ? (
            <AppText variant="caption" tone="muted" numberOfLines={1}>{summary}</AppText>
          ) : null}
          <AppText variant="caption" tone="muted">
            {ACTION_LABEL[item.action] || item.action}
            {item.handled_at ? ` · ${parseUtc(item.handled_at).toLocaleDateString('ko-KR')}` : ''}
          </AppText>
        </View>
        <View style={[styles.statusChip, !item.has_appeal && styles.statusChipMuted]}>
          <AppText variant="caption" tone={item.has_appeal ? 'accent' : 'muted'}>
            {item.has_appeal ? '소명 제출됨' : '소명 가능'}
          </AppText>
        </View>
      </TouchableOpacity>
    );
  };

  const isAffected = tab === 'affected';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="뒤로가기" style={{ padding: 4 }}>
          <Feather name="arrow-left" size={22} color={colors.text.primary} />
        </TouchableOpacity>
        <AppText variant="title3" style={{ marginLeft: spacing.sm }}>내 신고 내역</AppText>
      </View>

      {/* 탭 — 내가 한 신고 / 블라인드된 내 콘텐츠(소명) */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tabBtn, !isAffected && styles.tabBtnActive]}
          onPress={() => setTab('mine')}
          accessibilityLabel="내가 한 신고"
        >
          <AppText variant="footnote" tone={!isAffected ? 'accent' : 'muted'}>내가 한 신고</AppText>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, isAffected && styles.tabBtnActive]}
          onPress={() => setTab('affected')}
          accessibilityLabel="블라인드된 내 콘텐츠"
        >
          <AppText variant="footnote" tone={isAffected ? 'accent' : 'muted'}>블라인드된 내 콘텐츠</AppText>
        </TouchableOpacity>
      </View>

      {isAffected ? (
        affectedLoading ? (
          <ActivityIndicator size="large" color={colors.accent.primary} style={{ marginTop: 60 }} />
        ) : affected.length === 0 ? (
          <EmptyState title="블라인드된 콘텐츠가 없어요" hint="신고로 비공개 처리된 내 콘텐츠와 소명 상태가 여기에 표시됩니다" />
        ) : (
          <FlatList
            data={affected}
            keyExtractor={(r, i) => String(r.report_id || i)}
            renderItem={renderAffected}
          />
        )
      ) : loading ? (
        <ActivityIndicator size="large" color={colors.accent.primary} style={{ marginTop: 60 }} />
      ) : items.length === 0 ? (
        <EmptyState title="접수한 신고가 없어요" hint="신고한 콘텐츠의 처리 결과가 여기에 표시됩니다" />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(r, i) => String(r.report_id || r.id || i)}
          renderItem={renderMine}
        />
      )}

      {/* 소명 제출 모달 — 제출 성공 시 목록 갱신(소명 제출됨 배지 반영) */}
      <AppealModal
        report={appealTarget}
        onClose={() => setAppealTarget(null)}
        onSubmitted={() => loadAffected()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  tabBtn: {
    flex: 1, alignItems: 'center', paddingVertical: spacing.md,
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabBtnActive: { borderBottomColor: colors.accent.primary },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  statusChip: {
    paddingHorizontal: spacing.md, paddingVertical: 4,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.accent.primary,
  },
  statusChipMuted: { borderColor: colors.border.subtle },
});
