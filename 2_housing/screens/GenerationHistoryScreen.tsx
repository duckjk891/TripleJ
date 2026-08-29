import { useCallback, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../components/ui';
import { showAlert } from '../utils/appAlert';
import { colors } from '../theme/colors';
import { useMusicStore } from '../stores/musicStore';
import { useLyricsStore } from '../stores/lyricsStore';
import {
  listGenerations,
  deleteGeneration,
  generationStreamUrl,
  isGenerationInProgress,
} from '../services/musicService';
import { vcStatusLabel } from '../services/voiceConvertService';
import { GenerationItem } from '../types';

// ── v3.93 생성 이력 화면 ─────────────────────────────────────────────────────
// MAIDOL StudioTab2의 생성 이력(진행중/완료/실패 목록·삭제·이어보기) 이식.
// 계약(backend_9004 generate.py): GET /generate/ (page/limit/status, created_at desc)
//   → { generations, pagination } / DELETE /generate/{id} (상태 무관 허용).
// 진행중 탭 → MusicLoading(resumeGenerationId)로 폴링 재개,
// 완료 탭 → MusicResult(트랙 확정 여부에 따라 variant 비교 or 재생),
// 실패 탭 → 실패 사유 팝업(⭐는 백엔드가 실패 시 자동 환불 — generate.py:122).

type Props = NativeStackScreenProps<any, 'GenerationHistory'>;

const PAGE_LIMIT = 20;

function formatDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const mm = (d.getMonth() + 1).toString().padStart(2, '0');
  const dd = d.getDate().toString().padStart(2, '0');
  const hh = d.getHours().toString().padStart(2, '0');
  const mi = d.getMinutes().toString().padStart(2, '0');
  return `${d.getFullYear()}.${mm}.${dd} ${hh}:${mi}`;
}

function statusLabel(g: GenerationItem): string {
  if (isGenerationInProgress(g)) return '생성중';
  if (g.status === 'completed') return g.result_track_id ? '발매됨' : '완료';
  if (g.status === 'failed') return '실패';
  return g.status;
}

// v3.98(A-8): Kits 음성 변환 진입 라벨 — 변환 이력이 있으면 현재 상태를 보여준다
// (상태 흐름은 voice_convert.py/kits_service.py: pending→converting→awaiting_merge→merging→completed/failed)
function vcActionLabel(g: GenerationItem): string {
  const s = g.voice_conversion_status;
  if (!s || s === 'failed') return '내 목소리로 변환';
  const label = vcStatusLabel(s);
  return label ? `내 목소리: ${label}` : '내 목소리로 변환';
}

export default function GenerationHistoryScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<GenerationItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const loadedOnceRef = useRef(false); // useFocusEffect 콜백의 stale closure 방지

  const fetchPage = useCallback(async (nextPage: number, mode: 'initial' | 'refresh' | 'more') => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    if (mode === 'more') setLoadingMore(true);
    try {
      console.log('[GenHistory] 목록 조회:', JSON.stringify({ nextPage, mode }));
      const res = await listGenerations(nextPage, PAGE_LIMIT);
      const list = Array.isArray(res?.generations) ? res.generations : [];
      setItems((prev) => (nextPage === 1 ? list : [...prev, ...list]));
      setPage(nextPage);
      setTotalPages(res?.pagination?.totalPages ?? 1);
    } catch (err: any) {
      console.error('[GenHistory] 목록 조회 실패:', err?.response?.status, err?.response?.data?.error || err?.message);
      if (err?.response?.status === 401) {
        showAlert('로그인 필요', '생성 이력은 로그인 후 확인할 수 있어요.');
      } else {
        showAlert('오류', '생성 이력을 불러오지 못했어요. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
      setLoadedOnce(true);
      loadedOnceRef.current = true;
    }
  }, []);

  // 진입/복귀 시 갱신 (MusicLoading·MusicResult에서 돌아오면 상태가 변해 있음)
  useFocusEffect(
    useCallback(() => {
      fetchPage(1, loadedOnceRef.current ? 'refresh' : 'initial');
    }, [fetchPage])
  );

  const handleLoadMore = () => {
    if (loading || refreshing || loadingMore) return;
    if (page >= totalPages) return;
    fetchPage(page + 1, 'more');
  };

  // 작곡 흐름 store 하이드레이션 — LyricsBookScreen.handleCompose 관행:
  // MusicLoading/MusicResult가 musicStore·lyricsStore에서 제목/가사/메타를 직접 읽는다.
  const hydrateStores = (gen: GenerationItem) => {
    const music = useMusicStore.getState();
    const lyrics = useLyricsStore.getState();
    music.setSelectedModel('suno'); // 서버 생성 이력은 suno 경로만 존재 (generate.py:171)
    music.setGenerationId(gen.id);
    music.setSavedTrackId(gen.result_track_id || null);
    music.setLyrics(gen.lyrics || '');
    music.setGenre(gen.genre || '');
    music.setMood(gen.mood || '');
    lyrics.setGeneratedTitle(gen.title || '');
    lyrics.setGeneratedLyrics(gen.lyrics || '');
    if (gen.status === 'completed') {
      music.setStatus('completed');
      music.setError(null);
      music.setResultUrl(generationStreamUrl(gen.id, 0));
    } else if (gen.status === 'failed') {
      music.setStatus('failed');
      music.setError(gen.error_message || '음악 생성에 실패했습니다.');
      music.setResultUrl(null);
    } else {
      music.setStatus('processing');
      music.setError(null);
      music.setResultUrl(null);
    }
    music.setIsLoading(isGenerationInProgress(gen));
  };

  const handlePress = (gen: GenerationItem) => {
    console.log('[GenHistory] 항목 탭:', JSON.stringify({ id: gen.id, status: gen.status, track: gen.result_track_id }));
    if (isGenerationInProgress(gen)) {
      // 진행중 → MusicLoading 폴링 재개 모드
      hydrateStores(gen);
      navigation.navigate('MusicLoading', { resumeGenerationId: gen.id });
      return;
    }
    if (gen.status === 'completed') {
      // 완료 → 결과 화면 (트랙 미확정이면 MusicResult가 variant 비교 카드를 띄움)
      hydrateStores(gen);
      navigation.navigate('MusicResult', { alreadySaved: !!gen.result_track_id });
      return;
    }
    if (gen.status === 'failed') {
      showAlert(
        '생성 실패',
        `${gen.error_message || '알 수 없는 오류로 생성에 실패했어요.'}\n\n사용한 ⭐는 자동으로 환불되었어요.`,
        [
          { text: '닫기', style: 'cancel' },
          { text: '기록 삭제', style: 'destructive', onPress: () => doDelete(gen) },
        ]
      );
    }
  };

  const doDelete = async (gen: GenerationItem) => {
    try {
      await deleteGeneration(gen.id);
      setItems((prev) => prev.filter((g) => g.id !== gen.id));
    } catch (err: any) {
      console.error('[GenHistory] 삭제 실패:', err?.response?.status, err?.response?.data?.error || err?.message);
      showAlert('삭제 실패', err?.response?.data?.error || '기록 삭제에 실패했어요.');
    }
  };

  const handleDelete = (gen: GenerationItem) => {
    const title = gen.title || '제목 없음';
    const warn = isGenerationInProgress(gen)
      ? '\n(생성이 진행 중이어도 기록은 삭제돼요)'
      : '';
    showAlert('기록 삭제', `"${title}" 생성 기록을 삭제할까요?${warn}`, [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => doDelete(gen) },
    ]);
  };

  const renderItem = ({ item }: { item: GenerationItem }) => {
    const inProgress = isGenerationInProgress(item);
    const failed = item.status === 'failed';
    return (
      <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={() => handlePress(item)}>
        <View style={styles.cardTopRow}>
          <View
            style={[
              styles.badge,
              inProgress && styles.badgeProgress,
              failed && styles.badgeFailed,
              !inProgress && !failed && styles.badgeDone,
            ]}
          >
            {inProgress && (
              <ActivityIndicator size={10} color={colors.accent.primary} style={{ marginRight: 4 }} />
            )}
            <AppText
              style={[
                styles.badgeText,
                inProgress && { color: colors.accent.primary },
                failed && { color: colors.status.error },
              ]}
            >
              {statusLabel(item)}
              {inProgress && typeof item.progress === 'number' && item.progress > 0
                ? ` ${Math.round(item.progress)}%`
                : ''}
            </AppText>
          </View>
          <AppText style={styles.cardTitle} numberOfLines={1}>
            {item.title || '제목 없음'}
          </AppText>
          <TouchableOpacity
            style={styles.deleteBtn}
            onPress={() => handleDelete(item)}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Feather name="trash-2" size={13} color={colors.text.primary} />
          </TouchableOpacity>
        </View>
        {(item.genre || item.mood) && (
          <AppText style={styles.cardMeta} numberOfLines={1}>
            {[item.genre, item.mood].filter(Boolean).join(' · ')}
          </AppText>
        )}
        <View style={styles.cardBottomRow}>
          <AppText style={styles.cardDate}>{formatDate(item.created_at)}</AppText>
          <AppText style={styles.cardAction}>
            {inProgress ? '이어보기' : item.status === 'completed' ? '결과 보기' : '자세히'}
          </AppText>
        </View>
        {/* v3.98(A-8): Kits 음성 변환 진입 — 완료된 생성만 (voice_convert.py:108 completed 필수) */}
        {item.status === 'completed' && (
          <TouchableOpacity
            style={styles.vcBtn}
            onPress={() => {
              console.log('[GenHistory] 음성 변환 진입:', JSON.stringify({ id: item.id, vc: item.voice_conversion_status || null }));
              navigation.navigate('VoiceConvert', { generationId: item.id });
            }}
            hitSlop={{ top: 4, bottom: 4 }}
          >
            <Feather name="mic" size={12} color={colors.accent.primary} />
            <AppText style={styles.vcBtnText}>{vcActionLabel(item)}</AppText>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* 헤더 (StudioStack headerShown:false → 화면 내부 헤더, LyricsBook/VoiceManage 관행) */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <AppText style={styles.backBtnText}>‹</AppText>
        </TouchableOpacity>
        <AppText style={styles.headerTitle}>생성 이력</AppText>
        <View style={styles.backBtn} />
      </View>

      {loading && !loadedOnce ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={colors.accent.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(g) => g.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchPage(1, 'refresh')}
              tintColor={colors.accent.primary}
            />
          }
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            loadedOnce ? (
              <View style={styles.emptyBox}>
                <AppText style={styles.emptyTitle}>아직 생성 이력이 없어요</AppText>
                <AppText style={styles.emptyText}>
                  작곡 디렉터와 곡을 만들면 여기에 쌓여요.{'\n'}
                  진행 중인 생성도 여기서 이어볼 수 있어요.
                </AppText>
              </View>
            ) : null
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator size="small" color={colors.accent.primary} style={{ marginVertical: 12 }} />
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.bg.surface1,
  },
  backBtn: { width: 44, paddingHorizontal: 12, paddingVertical: 4 },
  backBtnText: { fontSize: 26, color: colors.text.primary, fontWeight: '300' },
  headerTitle: { fontSize: 16, fontWeight: '700', color: colors.text.primary },

  centerBox: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  emptyBox: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    marginTop: 24,
  },
  emptyTitle: { color: colors.text.primary, fontSize: 15, fontWeight: '700', marginBottom: 8 },
  emptyText: { color: colors.text.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },

  card: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: colors.bg.surface2,
  },
  badgeProgress: {
    borderWidth: 1,
    borderColor: colors.accent.primary,
    backgroundColor: 'transparent',
  },
  badgeDone: {
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  badgeFailed: {
    borderWidth: 1,
    borderColor: colors.status.error,
    backgroundColor: 'transparent',
  },
  badgeText: { fontSize: 11, fontWeight: '700', color: colors.text.secondary },
  cardTitle: { flex: 1, color: colors.text.primary, fontSize: 15, fontWeight: '700' },
  deleteBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.bg.surface2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardMeta: { color: colors.accent.primary, fontSize: 11, fontWeight: '600', marginTop: 6 },
  cardBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  cardDate: { color: colors.text.muted, fontSize: 11 },
  cardAction: { color: colors.text.secondary, fontSize: 12, fontWeight: '600' },
  // v3.98(A-8): 음성 변환 진입 버튼
  vcBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.accent.primary,
  },
  vcBtnText: { color: colors.accent.primary, fontSize: 12, fontWeight: '700' },
});
