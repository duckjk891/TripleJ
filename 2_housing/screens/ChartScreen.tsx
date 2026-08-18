// [ChartScreen] Wave 0 리스킨 — 공용 컴포넌트(ui/) + 디자인 토큰만 사용. 기능/데이터 흐름 불변.
// 디자인: Spotify식 가로 칩 필터 + Material 3 리스트/카드 + PANN 황혼 토큰.
import { useState, useCallback, useLayoutEffect } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  StyleSheet, View, FlatList, TouchableOpacity, Image, ActivityIndicator,
  RefreshControl, Alert, Modal, TextInput, ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import api, { BACKEND_BASE_URL } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useLikesStore } from '../stores/likesStore';
import { usePlayerStore } from '../stores/playerStore';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { AppText, Tag, Button, EmptyState, ScreenLayout } from '../components/ui';
import TrackRow, { trackRowStyles } from '../components/TrackRow';
import TrackActionSheet from '../components/TrackActionSheet';

interface ChartTrack {
  id: string;
  title: string;
  artist_name?: string;
  cover_image?: string;
  cover_image_url?: string;
  play_count?: number;
  like_count?: number;
  genre?: string | string[];
  mood?: string | string[];
  audio_url?: string;
  duration_sec?: number;
  lyrics?: string;
}

type ChartTab = 'top100' | 'weekly' | 'monthly' | 'new' | 'queue';

const TABS: { key: ChartTab; label: string; endpoint: string }[] = [
  { key: 'top100', label: 'TOP 100', endpoint: '/charts/top100' },
  { key: 'weekly', label: '주간', endpoint: '/charts/weekly' },
  { key: 'monthly', label: '월간', endpoint: '/charts/monthly' },
  { key: 'new', label: '신곡', endpoint: '/tracks/?sort=created_at&limit=100' },
  { key: 'queue', label: '내 재생목록', endpoint: '' }, // 로컬 큐(playerStore) — API 없음
];

const RANK_COLORS: Record<number, string> = {
  1: colors.accent.secondary,       // 금
  2: colors.text.secondary,         // 은(연보라)
  3: colors.accent.secondaryDim,    // 동
};

export default function ChartScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<ChartTab>('top100');
  const [tracks, setTracks] = useState<ChartTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionTrack, setActionTrack] = useState<ChartTrack | null>(null); // ⋮ 오버플로 메뉴 대상
  const likedMap = useLikesStore((s) => s.liked);
  const syncLikes = useLikesStore((s) => s.sync);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ChartTrack[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchSubmitted, setSearchSubmitted] = useState(false);
  const playerStore = usePlayerStore();

  const fetchChart = useCallback(async (tab: ChartTab) => {
    // '내 재생목록' 탭은 로컬 큐(playerStore)를 그대로 노출 — API 호출 없음
    if (tab === 'queue') {
      if (__DEV__) console.info('[ChartScreen] 내 재생목록 탭 — 로컬 큐 사용', { len: usePlayerStore.getState().queue.length });
      setLoading(false);
      return;
    }
    const endpoint = TABS.find((t) => t.key === tab)?.endpoint || '/charts/top100';
    if (__DEV__) console.info('[ChartScreen] fetchChart 호출', { tab, endpoint });
    try {
      setLoading(true);
      const res = await api.get(endpoint);
      const data = Array.isArray(res.data) ? res.data : (res.data.tracks || []);
      if (__DEV__) console.info('[ChartScreen] fetchChart 응답', { tab, count: data.length });
      if (!data.length) console.warn('[ChartScreen] 차트 비어있음', { tab });
      setTracks(data);
      // 로그인 상태면 보이는 곡들의 좋아요 여부 동기화
      if (useAuthStore.getState().user) syncLikes(data.map((t: ChartTrack) => t.id));
    } catch (err: any) {
      console.error('[ChartScreen] fetchChart 실패', { tab, endpoint, status: err?.response?.status });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchChart(activeTab); }, [activeTab]));

  // 헤더는 App.tsx 탭 공통(tabHeader): 좌 로고 + 우 마이페이지(user) 아이콘.
  // 검색은 별도 '검색' 탭(SearchScreen)으로 이동 — 여기 상단 🔍 제거.

  const handleRefresh = () => { setRefreshing(true); fetchChart(activeTab); };
  const handleTabPress = (tab: ChartTab) => { if (tab !== activeTab) setActiveTab(tab); };

  const requireLogin = (): boolean => {
    if (!user) {
      // 비로그인 → 로그인 화면으로 바로 이동 (Alert.alert 다중버튼은 웹에서 미동작 → 반응 없음 버그)
      if (__DEV__) console.info('[ChartScreen] 비로그인 액션 → 로그인 화면 이동');
      navigation.navigate('Settings');
      return false;
    }
    return true;
  };

  const handleSearch = async (q: string) => {
    const query = q.trim();
    if (!query) return;
    if (__DEV__) console.info('[ChartScreen] handleSearch', { q: query });
    setSearchLoading(true);
    setSearchSubmitted(true);
    try {
      const res = await api.get(`/tracks/search`, { params: { q: query, limit: 50 } });
      setSearchResults(res.data?.tracks || []);
    } catch (err: any) {
      console.error('[ChartScreen] 검색 실패', { q: query, status: err?.response?.status });
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  const closeSearchModal = () => {
    setShowSearchModal(false);
    setSearchQuery(''); setSearchResults([]); setSearchSubmitted(false);
  };

  const handleTrackPress = (track: ChartTrack) => {
    // 곡 클릭 → 재생목록(큐)에 추가(중복 방지) 후 그 곡 재생
    playerStore.addToQueue(track);
    const q = usePlayerStore.getState().queue;
    const idx = q.findIndex((t: any) => t.id === track.id);
    playerStore.setCurrentIndex(idx >= 0 ? idx : q.length - 1);
    if (__DEV__) console.info('[ChartScreen] 곡 클릭 → 큐 추가+재생', { id: track.id, queueLen: q.length });
    navigation.navigate('Player', { track });
  };

  const handleSearchTrackPress = (track: ChartTrack) => {
    const idx = searchResults.findIndex((t) => t.id === track.id);
    playerStore.setQueue(searchResults);
    playerStore.setCurrentIndex(idx >= 0 ? idx : 0);
    closeSearchModal();
    navigation.navigate('Player', { track });
  };

  const getCoverUri = (track: ChartTrack): string | null => {
    const img = track.cover_image || track.cover_image_url;
    if (!img) return null;
    return `${BACKEND_BASE_URL}/api/upload/cover-preview/${encodeURIComponent(img)}`;
  };

  const Cover = ({ track }: { track: ChartTrack }) => {
    const uri = getCoverUri(track);
    return (
      <View style={styles.cover}>
        {uri ? <Image source={{ uri }} style={styles.coverImg} />
          : <View style={styles.coverPlaceholder}><AppText variant="title2" tone="muted">{'♪'}</AppText></View>}
      </View>
    );
  };

  // 행 디자인은 공용 TrackRow (검색 등 다른 목록 화면과 동일) — 좌측 슬롯만 탭별로 다르다
  const renderTrack = ({ item, index }: { item: ChartTrack; index: number }) => {
    const rank = index + 1;
    const rankColor = RANK_COLORS[rank] || colors.text.muted;
    const left = activeTab === 'new'
      ? <View style={trackRowStyles.newBadge}><AppText variant="caption" tone="primary">NEW</AppText></View>
      : activeTab === 'queue'
      ? <AppText variant="bodyStrong" center style={trackRowStyles.rank} tone={index === playerStore.currentIndex ? 'accent' : 'muted'}>{index === playerStore.currentIndex ? '▶' : rank}</AppText>
      : <AppText variant="bodyStrong" center style={[trackRowStyles.rank, { color: rankColor }]}>{rank}</AppText>;

    return (
      <TrackRow
        track={item}
        left={left}
        liked={!!likedMap[item.id]}
        onPress={() => handleTrackPress(item)}
        onMore={() => setActionTrack(item)}
      />
    );
  };

  return (
    <ScreenLayout>
      {/* Spotify식 가로 칩 필터 */}
      <View style={styles.chipBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {TABS.map((tab) => (
            <Tag key={tab.key} label={tab.label} selected={activeTab === tab.key} onPress={() => handleTabPress(tab.key)} />
          ))}
        </ScrollView>
      </View>

      {(() => {
        const isQueue = activeTab === 'queue';
        // 내 재생목록은 회원 전용이 아님 — 비회원도 담은 곡을 그대로 볼 수 있고, 상단에 안내만 노출
        const data = isQueue ? playerStore.queue : tracks;
        if (loading) {
          return <ActivityIndicator size="large" color={colors.accent.primary} style={styles.spinner} />;
        }
        if (data.length > 0) {
          return (
            <>
              {/* 비회원 안내 — 게이트가 아니라 배너. 담은 곡은 그대로 보인다 */}
              {isQueue && !user ? (
                <TouchableOpacity style={styles.guestBanner} onPress={() => navigation.navigate('Settings')} activeOpacity={0.8}>
                  <AppText variant="caption" tone="secondary">
                    로그인하지 않으면 다음 접속 시 재생목록이 사라지고, 별(⭐)도 쌓이지 않아요.
                    별을 모으면 작업실에서 나만의 음악을 만들 수 있어요. <AppText variant="caption" tone="accent">로그인하기</AppText>
                  </AppText>
                </TouchableOpacity>
              ) : null}
              <FlatList
                data={data}
                keyExtractor={(item, i) => `${item.id}-${i}`}
                renderItem={renderTrack}
                contentContainerStyle={{ paddingBottom: playerStore.track ? 140 : 80 }}
                refreshControl={isQueue ? undefined :
                  <RefreshControl refreshing={refreshing} onRefresh={handleRefresh}
                    tintColor={colors.accent.primary} colors={[colors.accent.primary]} />
                }
              />
            </>
          );
        }
        return isQueue
          ? <EmptyState title="재생목록이 비어있어요" hint="차트나 검색에서 곡을 재생하면 여기에 쌓여요" />
          : <EmptyState icon="📊" title="차트 데이터가 없습니다" hint="곡이 등록되면 차트가 표시됩니다" />;
      })()}

      {!playerStore.track && (
        <TouchableOpacity style={styles.fab} onPress={() => navigation.navigate('MyMusic')} activeOpacity={0.85}>
          <AppText variant="headline" tone="primary" style={styles.fabIcon}>+</AppText>
        </TouchableOpacity>
      )}

      {/* 검색 모달 */}
      <Modal visible={showSearchModal} animationType="slide" onRequestClose={closeSearchModal}>
        <View style={styles.searchModal}>
          <View style={styles.searchHeader}>
            <TouchableOpacity onPress={closeSearchModal} style={styles.searchBack}>
              <AppText variant="title2">{'←'}</AppText>
            </TouchableOpacity>
            <TextInput
              style={styles.searchInput}
              placeholder="곡 제목, 아티스트, 태그 검색"
              placeholderTextColor={colors.text.muted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={() => handleSearch(searchQuery)}
              returnKeyType="search"
              autoFocus
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => { setSearchQuery(''); setSearchResults([]); setSearchSubmitted(false); }} style={styles.searchClear}>
                <AppText variant="callout" tone="secondary">{'✕'}</AppText>
              </TouchableOpacity>
            )}
          </View>
          {searchLoading ? (
            <ActivityIndicator size="large" color={colors.accent.primary} style={styles.spinner} />
          ) : searchResults.length > 0 ? (
            <FlatList
              data={searchResults}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.searchResult} activeOpacity={0.7} onPress={() => handleSearchTrackPress(item)}>
                  <Cover track={item} />
                  <View style={styles.info}>
                    <AppText variant="bodyStrong" numberOfLines={1}>{item.title}</AppText>
                    <AppText variant="footnote" tone="secondary" numberOfLines={1} style={styles.artist}>
                      {item.artist_name || '알 수 없는 아티스트'}
                    </AppText>
                  </View>
                </TouchableOpacity>
              )}
            />
          ) : searchSubmitted ? (
            <EmptyState icon="🔍" title="검색 결과가 없습니다" hint="다른 검색어로 시도해보세요" />
          ) : (
            <EmptyState icon="🎵" title="곡을 검색해보세요" hint="제목, 아티스트, 태그로 검색 가능" />
          )}
        </View>
      </Modal>

      {/* 곡 더보기(⋮) — 공용 액션 시트(재생/좋아요/재생목록/플레이리스트 + 비회원 담기 안내) */}
      <TrackActionSheet
        track={actionTrack}
        onClose={() => setActionTrack(null)}
        onPlay={(t) => handleTrackPress(t as ChartTrack)}
        onLikeChanged={(trackId, delta) => setTracks((prev) => prev.map((t) => t.id === trackId
          ? { ...t, like_count: Math.max(0, (t.like_count ?? 0) + delta) }
          : t))}
      />

    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  headerRight: { flexDirection: 'row', alignItems: 'center', marginRight: spacing.sm },
  headerBtn: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  chipBar: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle },
  chipRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  spinner: { marginTop: spacing.huge },
  guestBanner: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    backgroundColor: colors.bg.surface1,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  rank: { width: 32 },
  newBadge: {
    width: 32, height: 18, backgroundColor: colors.accent.primary, borderRadius: radius.sm,
    justifyContent: 'center', alignItems: 'center',
  },
  cover: { width: 48, height: 48, borderRadius: radius.md, overflow: 'hidden', marginHorizontal: spacing.md },
  coverImg: { width: 48, height: 48 },
  coverPlaceholder: { width: 48, height: 48, backgroundColor: colors.bg.surface1, justifyContent: 'center', alignItems: 'center' },
  info: { flex: 1, marginRight: spacing.sm },
  artist: { marginTop: 3 },
  statCol: { alignItems: 'flex-end', gap: 3, marginRight: spacing.xs, minWidth: 44 },
  statLine: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  action: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  // 곡 더보기(⋮) 액션 시트
  actionSheetHead: {
    flexDirection: 'row', alignItems: 'center',
    paddingBottom: spacing.md, marginBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  actionSheetItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  fab: {
    position: 'absolute', bottom: spacing.xl, right: spacing.xl, width: 56, height: 56, borderRadius: radius.pill,
    backgroundColor: colors.accent.primary, justifyContent: 'center', alignItems: 'center',
    shadowColor: colors.accent.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 8,
  },
  fabIcon: { marginTop: -2 },
  // search modal
  searchModal: { flex: 1, backgroundColor: colors.bg.deepest, paddingTop: 50 },
  searchHeader: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  searchBack: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  searchInput: {
    flex: 1, backgroundColor: colors.bg.surface1, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, color: colors.text.primary,
    fontSize: 14, marginHorizontal: spacing.xs,
  },
  searchClear: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  searchResult: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  // playlist sheet
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg.surface1, borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl, padding: spacing.xl, maxHeight: '60%' },
  sheetTitle: { marginBottom: spacing.lg },
  sheetList: { marginBottom: spacing.lg },
  sheetItem: { paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle },
  sheetLabel: { marginBottom: spacing.sm },
  sheetCreateRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'stretch' },
  sheetInput: {
    flex: 1, backgroundColor: colors.bg.deepest, borderRadius: radius.md, padding: spacing.md,
    color: colors.text.primary, borderWidth: 1, borderColor: colors.border.subtle,
  },
});
