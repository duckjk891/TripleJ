// v3.359 [Governance] 창작 기록 보기 — 곡별 창작 리포트(저작권 등록 근거: 사람의 지시·편집·선택 기록 + 위변조 검증).
// GET /sessions/by-track/{trackId}/report (곡 주인만) → { chain_ok, human_summary, timeline[], lyrics_versions[], follow_ups[] }
// 진입: 마이뮤직 곡 ⋮ 「창작 기록 보기」. 기록 도입(v3.200) 전 곡·직접 업로드 곡은 서버 404 → 안내.
import { useCallback, useEffect, useState } from 'react';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../services/api';
import { AppText } from '../components/ui';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { creationEventLabel, directionLines, fmtKstDateTime, summaryLines } from '../utils/creationReport';

export default function CreationReportScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const trackId = String(route.params?.trackId || '');
  const title = String(route.params?.title || '');
  const [rep, setRep] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [openLyrics, setOpenLyrics] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      console.info('[CreationReport] 조회', { trackId });
      const res = await api.get(`/sessions/by-track/${encodeURIComponent(trackId)}/report`);
      setRep(res.data);
    } catch (err: any) {
      console.error('[CreationReport] 조회 실패', { trackId, status: err?.response?.status });
      setError(err?.response?.status === 404
        ? (err?.response?.data?.error || '이 곡에는 창작 기록이 없어요.')
        : '창작 기록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  }, [trackId]);

  useEffect(() => { void load(); }, [load]);

  const directions = (rep?.timeline || []).filter((e: any) => e.type === 'DIRECTION');
  const followUps: any[] = rep?.follow_ups || [];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="뒤로가기" style={{ padding: 4 }}>
          <Feather name="arrow-left" size={22} color={colors.text.primary} />
        </TouchableOpacity>
        <AppText variant="title3" style={{ marginLeft: spacing.sm, flex: 1 }} numberOfLines={1}>
          {title ? `창작 기록 · ${title}` : '창작 기록'}
        </AppText>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent.primary} style={{ marginTop: spacing.xxl }} />
      ) : error ? (
        <View style={styles.center}>
          <AppText variant="footnote" tone="secondary" center>{error}</AppText>
        </View>
      ) : rep ? (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl, gap: spacing.md }}>
          {/* 위변조 검증 */}
          <View style={[styles.card, styles.row]}>
            <Feather name={rep.chain_ok ? 'shield' : 'alert-triangle'} size={18} color={rep.chain_ok ? colors.accent.primary : colors.status.error} />
            <View style={{ flex: 1 }}>
              <AppText variant="bodyStrong">{rep.chain_ok ? '기록이 변경되지 않았어요' : '기록 검증에 실패했어요'}</AppText>
              <AppText variant="caption" tone="muted">
                모든 기록은 순서대로 이어진 해시로 묶여 있어 중간에 고치면 검증이 깨져요.
              </AppText>
            </View>
          </View>

          {/* 사람의 개입 요약 */}
          <View style={styles.card}>
            <AppText variant="bodyStrong" style={{ marginBottom: spacing.xs }}>사람이 한 일</AppText>
            {summaryLines(rep.human_summary).map((l) => (
              <AppText key={l} variant="footnote" tone="secondary" style={styles.line}>· {l}</AppText>
            ))}
          </View>

          {/* 창작 지시 */}
          {directions.length || followUps.length ? (
            <View style={styles.card}>
              <AppText variant="bodyStrong" style={{ marginBottom: spacing.xs }}>창작 지시</AppText>
              {directions.map((e: any) => (
                <View key={`d${e.seq}`} style={styles.block}>
                  <AppText variant="caption" tone="accent">{creationEventLabel(e)} · {fmtKstDateTime(e.at)}</AppText>
                  {directionLines(e.detail).map((l) => <AppText key={l} variant="caption" tone="secondary">{l}</AppText>)}
                </View>
              ))}
              {followUps.flatMap((f) => (f.directions || []).map((e: any) => (
                <View key={`f${f.session_id}-${e.seq}`} style={styles.block}>
                  <AppText variant="caption" tone="accent">{creationEventLabel(e)}(발매 후) · {fmtKstDateTime(e.at)}</AppText>
                  {directionLines(e.detail).map((l) => <AppText key={l} variant="caption" tone="secondary">{l}</AppText>)}
                </View>
              )))}
            </View>
          ) : null}

          {/* 가사 버전 */}
          {(rep.lyrics_versions || []).length ? (
            <View style={styles.card}>
              <AppText variant="bodyStrong" style={{ marginBottom: spacing.xs }}>가사 버전</AppText>
              {(rep.lyrics_versions || []).map((v: any, i: number) => (
                <View key={`v${i}`} style={styles.block}>
                  <TouchableOpacity onPress={() => setOpenLyrics(openLyrics === i ? null : i)} accessibilityLabel={`가사 버전 ${i + 1} ${openLyrics === i ? '접기' : '보기'}`}>
                    <AppText variant="caption" tone="accent">
                      {i + 1}. {v.source === 'user_edit' ? '직접 수정' : 'AI 초안'} · {fmtKstDateTime(v.at)} {openLyrics === i ? '▲' : '▼'}
                    </AppText>
                  </TouchableOpacity>
                  {openLyrics === i ? <AppText variant="caption" tone="secondary" style={{ marginTop: 4 }}>{v.text}</AppText> : null}
                </View>
              ))}
            </View>
          ) : null}

          {/* 전체 타임라인 */}
          <View style={styles.card}>
            <AppText variant="bodyStrong" style={{ marginBottom: spacing.xs }}>{`전체 기록 ${(rep.timeline || []).length}건`}</AppText>
            {(rep.timeline || []).map((e: any) => (
              <AppText key={`t${e.seq}`} variant="caption" tone="muted" style={styles.line}>
                {e.seq}. {fmtKstDateTime(e.at)} · {creationEventLabel(e)}
              </AppText>
            ))}
          </View>
          <AppText variant="caption" tone="muted" center>
            이 기록은 저작권 등록·분쟁 때 창작 과정을 보여 주는 근거로 쓸 수 있어요.
          </AppText>
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  center: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xl },
  card: { backgroundColor: colors.bg.surface1, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border.subtle },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  block: { marginTop: spacing.sm },
  line: { marginTop: 2 },
});
