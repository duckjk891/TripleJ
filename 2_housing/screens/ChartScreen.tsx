// [ChartScreen] Wave 0 리스킨 — 공용 컴포넌트(ui/) + 디자인 토큰만 사용. 기능/데이터 흐름 불변.
// 디자인: Spotify식 가로 칩 필터 + Material 3 리스트/카드 + PANN 황혼 토큰.
import { useState, useCallback, useLayoutEffect } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  StyleSheet, View, FlatList, TouchableOpacity, Image, ActivityIndicator,
  RefreshControl, Alert, Modal, TextInput, ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import api, { BACKEND_BASE_URL } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useLikesStore } from '../stores/likesStore';
import { usePlayerStore } from '../stores/playerStore';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { AppText, Tag, Button, EmptyState, ScreenLayout } from '../components/ui';

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

type ChartTab = 'top100' | 'weekly' | 'monthly' | 'new';

const TABS: { key: ChartTab; label: string; endpoint: string }[] = [
  { key: 'top100', label: 'TOP 100', endpoint: '/charts/top100' },
  { key: 'weekly', label: '주간', endpoint: '/charts/weekly' },
  { key: 'monthly', label: '월간', endpoint: '/charts/monthly' },
  { key: 'new', label: '신곡', endpoint: '/tracks/?sort=created_at&limit=100' },
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
  const [showPlaylistModal, setShowPlaylistModal] = useState(false);
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string>('');
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const likedMap = useLikesStore((s) => s.liked);
  const syncLikes = useLikesStore((s) => s.sync);
  const toggleLikeStore = useLikesStore((s) => s.toggle);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ChartTrack[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchSubmitted, setSearchSubmitted] = useState(false);
  const playerStore = usePlayerStore();

  const fetchChart = useCallback(async (tab: ChartTab) => {
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

  const toggleLike = (trackId: string) => {
    if (!requireLogin()) return;
    toggleLikeStore(trackId); // 백엔드 연동(낙관적) — 실패 시 스토어가 롤백
  };

  const handleAddToPlaylist = async (track: ChartTrack) => {
    if (!requireLogin()) return;
    setSelectedTrackId(track.id);
    try {
      const res = await api.get('/playlists/');
      setPlaylists(res.data.playlists || res.data || []);
    } catch (err: any) {
      console.error('[ChartScreen] 플레이리스트 조회 실패', { status: err?.response?.status });
      setPlaylists([]);
    }
    setShowPlaylistModal(true);
  };

  const addToExistingPlaylist = async (playlistId: string) => {
    try {
      await api.post(`/playlists/${playlistId}/tracks`, { track_id: selectedTrackId });
      Alert.alert('완료', '플레이리스트에 추가되었습니다!');
    } catch (err: any) {
      console.error('[ChartScreen] 플레이리스트 추가 실패', { playlistId, status: err?.response?.status });
      Alert.alert('오류', err?.response?.data?.error || '추가에 실패했습니다.');
    }
    setShowPlaylistModal(false);
  };

  const createAndAddToPlaylist = async () => {
    const name = newPlaylistName.trim();
    if (!name) { Alert.alert('알림', '플레이리스트 이름을 입력해주세요.'); return; }
    try {
      const createRes = await api.post('/playlists/', { title: name });
      await api.post(`/playlists/${createRes.data.id}/tracks`, { track_id: selectedTrackId });
      Alert.alert('완료', `"${name}"에 추가되었습니다!`);
    } catch (err: any) {
      console.error('[ChartScreen] 플레이리스트 생성 실패', { status: err?.response?.status });
      Alert.alert('오류', err?.response?.data?.error || '생성에 실패했습니다.');
    }
    setNewPlaylistName('');
    setShowPlaylistModal(false);
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
    const idx = tracks.findIndex((t) => t.id === track.id);
    playerStore.setQueue(tracks);
    playerStore.setCurrentIndex(idx >= 0 ? idx : 0);
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

  const renderTrack = ({ item, index }: { item: ChartTrack; index: number }) => {
    const rank = index + 1;
    const rankColor = RANK_COLORS[rank] || colors.text.muted;
    const isLiked = !!likedMap[item.id];
    const g = Array.isArray(item.genre) ? item.genre[0] : item.genre;

    return (
      <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => handleTrackPress(item)}>
        {activeTab === 'new'
          ? <View style={styles.newBadge}><AppText variant="caption" tone="primary">NEW</AppText></View>
          : <AppText variant="title3" center style={[styles.rank, { color: rankColor }]}>{rank}</AppText>}
        <Cover track={item} />
        <View style={styles.info}>
          <AppText variant="bodyStrong" numberOfLines={1}>{item.title}</AppText>
          <AppText variant="footnote" tone="secondary" numberOfLines={1} style={styles.artist}>
            {item.artist_name || '알 수 없는 아티스트'}
          </AppText>
          <View style={styles.statsRow}>
            {g ? <Tag label={String(g)} size="sm" /> : null}
            {item.play_count != null && <AppText variant="caption" tone="muted">{'▶'} {item.play_count.toLocaleString()}</AppText>}
            {item.like_count != null && <AppText variant="caption" tone="muted">{'♥'} {item.like_count.toLocaleString()}</AppText>}
          </View>
        </View>
        <TouchableOpacity style={styles.action} accessibilityLabel={isLiked ? '좋아요 취소' : '좋아요'} onPress={(e) => { e.stopPropagation(); toggleLike(item.id); }}>
          <AppText variant="subtitle" tone={isLiked ? 'accent' : 'muted'}>{isLiked ? '♥' : '♡'}</AppText>
        </TouchableOpacity>
        <TouchableOpacity style={styles.action} onPress={(e) => { e.stopPropagation(); handleAddToPlaylist(item); }}>
          <AppText variant="title3" tone="muted">+</AppText>
        </TouchableOpacity>
      </TouchableOpacity>
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

      {loading ? (
        <ActivityIndicator size="large" color={colors.accent.primary} style={styles.spinner} />
      ) : tracks.length > 0 ? (
        <FlatList
          data={tracks}
          keyExtractor={(item) => item.id}
          renderItem={renderTrack}
          contentContainerStyle={{ paddingBottom: playerStore.track ? 140 : 80 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh}
              tintColor={colors.accent.primary} colors={[colors.accent.primary]} />
          }
        />
      ) : (
        <EmptyState icon="📊" title="차트 데이터가 없습니다" hint="곡이 등록되면 차트가 표시됩니다" />
      )}

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

      {/* 플레이리스트 담기 바텀시트 */}
      <Modal visible={showPlaylistModal} transparent animationType="slide" onRequestClose={() => setShowPlaylistModal(false)}>
        <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setShowPlaylistModal(false)}>
          <View style={styles.sheet}>
            <AppText variant="title3" style={styles.sheetTitle}>플레이리스트에 담기</AppText>
            {playlists.length > 0 && (
              <View style={styles.sheetList}>
                {playlists.map((pl: any) => (
                  <TouchableOpacity key={pl.id} style={styles.sheetItem} onPress={() => addToExistingPlaylist(pl.id)}>
                    <AppText variant="body">{pl.title || pl.name}</AppText>
                    <AppText variant="caption" tone="muted">{pl.track_count ?? 0}곡</AppText>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <AppText variant="footnote" tone="secondary" style={styles.sheetLabel}>새 플레이리스트 만들기</AppText>
            <View style={styles.sheetCreateRow}>
              <TextInput
                style={styles.sheetInput}
                placeholder="플레이리스트 이름"
                placeholderTextColor={colors.text.muted}
                value={newPlaylistName}
                onChangeText={setNewPlaylistName}
              />
              <Button label="만들기" size="md" onPress={createAndAddToPlaylist} />
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  headerRight: { flexDirection: 'row', alignItems: 'center', marginRight: spacing.sm },
  headerBtn: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  chipBar: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle },
  chipRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  spinner: { marginTop: spacing.huge },
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
  artist: { marginTop: 2, marginBottom: spacing.xs },
  statsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  action: { width: 34, height: 34, justifyContent: 'center', alignItems: 'center' },
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
