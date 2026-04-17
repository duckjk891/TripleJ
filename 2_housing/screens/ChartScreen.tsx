import { useState, useCallback, useLayoutEffect } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { usePlayerStore } from '../stores/playerStore';

interface ChartTrack {
  id: string;
  title: string;
  artist_name?: string;
  cover_image?: string;
  cover_image_url?: string;
  play_count?: number;
  like_count?: number;
  genre?: string;
  mood?: string;
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
  1: '#FFD700',
  2: '#C0C0C0',
  3: '#CD7F32',
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
  const [likedTracks, setLikedTracks] = useState<Set<string>>(new Set());
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ChartTrack[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchSubmitted, setSearchSubmitted] = useState(false);

  const fetchChart = useCallback(async (tab: ChartTab) => {
    const endpoint = TABS.find((t) => t.key === tab)?.endpoint || '/charts/top100';
    try {
      setLoading(true);
      const res = await api.get(endpoint);
      const data = Array.isArray(res.data) ? res.data : (res.data.tracks || []);
      setTracks(data);
    } catch {
      // Backend not available
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // 탭 전환 시 + 포커스 시 항상 새로고침
  useFocusEffect(
    useCallback(() => {
      fetchChart(activeTab);
    }, [activeTab])
  );

  // 상단바에 검색 아이콘 + 설정 아이콘 배치 (검색이 설정 왼쪽)
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 8 }}>
          <TouchableOpacity
            onPress={() => setShowSearchModal(true)}
            style={{ paddingHorizontal: 10, paddingVertical: 6 }}
          >
            <Text style={{ fontSize: 18, color: '#fff' }}>{'🔍'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => navigation.navigate('Settings' as never)}
            style={{ paddingHorizontal: 8, paddingVertical: 6 }}
          >
            <Text style={{ fontSize: 22, color: '#fff' }}>{'⋮'}</Text>
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchChart(activeTab);
  };

  const handleTabPress = (tab: ChartTab) => {
    if (tab !== activeTab) {
      setActiveTab(tab);
    }
  };

  const requireLogin = (): boolean => {
    if (!user) {
      Alert.alert(
        '로그인 필요',
        '이 기능을 사용하려면 로그인이 필요해요.',
        [
          { text: '취소', style: 'cancel' },
          { text: '로그인', onPress: () => navigation.navigate('Settings') },
        ]
      );
      return false;
    }
    return true;
  };

  const toggleLike = (trackId: string) => {
    if (!requireLogin()) return;
    setLikedTracks((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) {
        next.delete(trackId);
      } else {
        next.add(trackId);
      }
      return next;
    });
  };

  const handleAddToPlaylist = async (track: ChartTrack) => {
    if (!requireLogin()) return;
    setSelectedTrackId(track.id);
    try {
      const res = await api.get('/playlists/');
      setPlaylists(res.data.playlists || res.data || []);
    } catch {
      setPlaylists([]);
    }
    setShowPlaylistModal(true);
  };

  const addToExistingPlaylist = async (playlistId: string) => {
    try {
      await api.post(`/playlists/${playlistId}/tracks`, { track_id: selectedTrackId });
      Alert.alert('완료', '플레이리스트에 추가되었습니다!');
    } catch (err: any) {
      Alert.alert('오류', err?.response?.data?.error || '추가에 실패했습니다.');
    }
    setShowPlaylistModal(false);
  };

  const createAndAddToPlaylist = async () => {
    const name = newPlaylistName.trim();
    if (!name) {
      Alert.alert('알림', '플레이리스트 이름을 입력해주세요.');
      return;
    }
    try {
      const createRes = await api.post('/playlists/', { title: name });
      await api.post(`/playlists/${createRes.data.id}/tracks`, { track_id: selectedTrackId });
      Alert.alert('완료', `"${name}"에 추가되었습니다!`);
    } catch (err: any) {
      Alert.alert('오류', err?.response?.data?.error || '생성에 실패했습니다.');
    }
    setNewPlaylistName('');
    setShowPlaylistModal(false);
  };

  const handleSearch = async (q: string) => {
    const query = q.trim();
    if (!query) return;
    setSearchLoading(true);
    setSearchSubmitted(true);
    try {
      const res = await api.get(`/tracks/search`, { params: { q: query, limit: 50 } });
      const data = res.data?.tracks || [];
      setSearchResults(data);
    } catch {
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  const closeSearchModal = () => {
    setShowSearchModal(false);
    setSearchQuery('');
    setSearchResults([]);
    setSearchSubmitted(false);
  };

  const playerStore = usePlayerStore();

  const handleTrackPress = (track: ChartTrack) => {
    // 차트 목록을 queue로 설정
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
    return `http://192.168.219.106:9003/api/upload/cover-preview/${encodeURIComponent(img)}`;
  };

  const renderTrack = ({ item, index }: { item: ChartTrack; index: number }) => {
    const rank = index + 1;
    const rankColor = RANK_COLORS[rank] || '#888';
    const coverUri = getCoverUri(item);
    const isLiked = likedTracks.has(item.id);
    const isNewTab = activeTab === 'new';

    return (
      <TouchableOpacity
        style={styles.trackItem}
        activeOpacity={0.7}
        onPress={() => handleTrackPress(item)}
      >
        {isNewTab ? (
          <View style={styles.newBadge}>
            <Text style={styles.newBadgeText}>NEW</Text>
          </View>
        ) : (
          <Text style={[styles.rankNumber, { color: rankColor }]}>{rank}</Text>
        )}

        <View style={styles.coverContainer}>
          {coverUri ? (
            <Image
              source={{ uri: coverUri }}
              style={styles.coverImage}
              defaultSource={undefined}
              onError={() => {}}
            />
          ) : (
            <View style={styles.coverPlaceholder}>
              <Text style={styles.coverPlaceholderIcon}>{'♪'}</Text>
            </View>
          )}
        </View>

        <View style={styles.trackInfo}>
          <Text style={styles.trackTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.trackArtist} numberOfLines={1}>
            {item.artist_name || '알 수 없는 아티스트'}
          </Text>
          <View style={styles.statsRow}>
            {item.play_count != null && (
              <Text style={styles.statText}>{'▶'} {item.play_count.toLocaleString()}</Text>
            )}
            {item.like_count != null && (
              <Text style={styles.statText}>{'♥'} {item.like_count.toLocaleString()}</Text>
            )}
          </View>
        </View>

        <TouchableOpacity
          style={styles.actionButton}
          onPress={(e) => {
            e.stopPropagation();
            toggleLike(item.id);
          }}
        >
          <Text style={[styles.likeIcon, isLiked && styles.likeIconActive]}>
            {isLiked ? '♥' : '♡'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionButton}
          onPress={(e) => {
            e.stopPropagation();
            handleAddToPlaylist(item);
          }}
        >
          <Text style={styles.addIcon}>+</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Tab bar */}
      <View style={styles.tabBar}>
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tabItem, activeTab === tab.key && styles.tabItemActive]}
            onPress={() => handleTabPress(tab.key)}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabLabel, activeTab === tab.key && styles.tabLabelActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#e94560" style={{ marginTop: 40 }} />
      ) : tracks.length > 0 ? (
        <FlatList
          data={tracks}
          keyExtractor={(item) => item.id}
          renderItem={renderTrack}
          contentContainerStyle={{ paddingBottom: playerStore.track ? 140 : 80 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="#e94560"
              colors={['#e94560']}
            />
          }
        />
      ) : (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>{'📊'}</Text>
          <Text style={styles.emptyText}>차트 데이터가 없습니다</Text>
          <Text style={styles.emptyHint}>곡이 등록되면 차트가 표시됩니다</Text>
        </View>
      )}

      {/* FAB button - 미니 플레이어 활성화 시 숨김 */}
      {!playerStore.track && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => navigation.navigate('MyMusic')}
          activeOpacity={0.8}
        >
          <Text style={styles.fabText}>+</Text>
        </TouchableOpacity>
      )}
      {/* 검색 모달 (전체 트랙 검색) */}
      <Modal visible={showSearchModal} animationType="slide" onRequestClose={closeSearchModal}>
        <View style={styles.searchModalContainer}>
          {/* 검색 헤더 */}
          <View style={styles.searchHeader}>
            <TouchableOpacity onPress={closeSearchModal} style={styles.searchBackButton}>
              <Text style={styles.searchBackIcon}>{'←'}</Text>
            </TouchableOpacity>
            <TextInput
              style={styles.searchInput}
              placeholder="곡 제목, 아티스트, 태그 검색"
              placeholderTextColor="#666"
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={() => handleSearch(searchQuery)}
              returnKeyType="search"
              autoFocus
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => {
                  setSearchQuery('');
                  setSearchResults([]);
                  setSearchSubmitted(false);
                }}
                style={styles.searchClearButton}
              >
                <Text style={styles.searchClearIcon}>{'✕'}</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* 결과 영역 */}
          {searchLoading ? (
            <ActivityIndicator size="large" color="#e94560" style={{ marginTop: 40 }} />
          ) : searchResults.length > 0 ? (
            <FlatList
              data={searchResults}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => {
                const coverUri = getCoverUri(item);
                return (
                  <TouchableOpacity
                    style={styles.searchResultItem}
                    activeOpacity={0.7}
                    onPress={() => handleSearchTrackPress(item)}
                  >
                    <View style={styles.coverContainer}>
                      {coverUri ? (
                        <Image source={{ uri: coverUri }} style={styles.coverImage} />
                      ) : (
                        <View style={styles.coverPlaceholder}>
                          <Text style={styles.coverPlaceholderIcon}>{'♪'}</Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.trackInfo}>
                      <Text style={styles.trackTitle} numberOfLines={1}>{item.title}</Text>
                      <Text style={styles.trackArtist} numberOfLines={1}>
                        {item.artist_name || '알 수 없는 아티스트'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
              keyboardShouldPersistTaps="handled"
            />
          ) : searchSubmitted ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>{'🔍'}</Text>
              <Text style={styles.emptyText}>검색 결과가 없습니다</Text>
              <Text style={styles.emptyHint}>다른 검색어로 시도해보세요</Text>
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>{'🎵'}</Text>
              <Text style={styles.emptyText}>곡을 검색해보세요</Text>
              <Text style={styles.emptyHint}>제목, 아티스트, 태그로 검색 가능</Text>
            </View>
          )}
        </View>
      </Modal>

      {/* 플레이리스트 선택 모달 */}
      <Modal visible={showPlaylistModal} transparent animationType="slide" onRequestClose={() => setShowPlaylistModal(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }} activeOpacity={1} onPress={() => setShowPlaylistModal(false)}>
          <View style={{ backgroundColor: '#1a1a2e', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '60%' }}>
            <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#fff', marginBottom: 16 }}>플레이리스트에 담기</Text>

            {playlists.length > 0 && (
              <View style={{ marginBottom: 16 }}>
                {playlists.map((pl: any) => (
                  <TouchableOpacity
                    key={pl.id}
                    style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#333' }}
                    onPress={() => addToExistingPlaylist(pl.id)}
                  >
                    <Text style={{ color: '#fff', fontSize: 15 }}>{pl.title || pl.name}</Text>
                    <Text style={{ color: '#666', fontSize: 12 }}>{pl.track_count ?? 0}곡</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <Text style={{ color: '#999', fontSize: 13, marginBottom: 8 }}>새 플레이리스트 만들기</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                style={{ flex: 1, backgroundColor: '#0a0a1a', borderRadius: 10, padding: 12, color: '#fff', borderWidth: 1, borderColor: '#333' }}
                placeholder="플레이리스트 이름"
                placeholderTextColor="#555"
                value={newPlaylistName}
                onChangeText={setNewPlaylistName}
              />
              <TouchableOpacity
                style={{ backgroundColor: '#e94560', borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' }}
                onPress={createAndAddToPlaylist}
              >
                <Text style={{ color: '#fff', fontWeight: 'bold' }}>만들기</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a1a',
  },
  searchModalContainer: {
    flex: 1,
    backgroundColor: '#0a0a1a',
    paddingTop: 50,
  },
  searchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  searchBackButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchBackIcon: {
    fontSize: 24,
    color: '#fff',
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 14,
    marginHorizontal: 4,
  },
  searchClearButton: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchClearIcon: {
    fontSize: 16,
    color: '#888',
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
    paddingHorizontal: 8,
  },
  tabItem: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive: {
    borderBottomColor: '#e94560',
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  tabLabelActive: {
    color: '#e94560',
  },
  trackItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  rankNumber: {
    width: 32,
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  newBadge: {
    width: 32,
    height: 18,
    backgroundColor: '#e94560',
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  newBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  coverContainer: {
    width: 48,
    height: 48,
    borderRadius: 8,
    overflow: 'hidden',
    marginRight: 12,
  },
  coverImage: {
    width: 48,
    height: 48,
  },
  coverPlaceholder: {
    width: 48,
    height: 48,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  coverPlaceholderIcon: {
    fontSize: 22,
    color: '#444',
  },
  trackInfo: {
    flex: 1,
    marginRight: 8,
  },
  trackTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 2,
  },
  trackArtist: {
    fontSize: 13,
    color: '#888',
    marginBottom: 4,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  statText: {
    fontSize: 11,
    color: '#666',
  },
  actionButton: {
    width: 34,
    height: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },
  likeIcon: {
    fontSize: 20,
    color: '#555',
  },
  likeIconActive: {
    color: '#e94560',
  },
  addIcon: {
    fontSize: 22,
    color: '#555',
    fontWeight: '300',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 100,
  },
  emptyIcon: {
    fontSize: 64,
    color: '#333',
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    marginBottom: 8,
  },
  emptyHint: {
    fontSize: 13,
    color: '#444',
  },
  fab: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#e94560',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#e94560',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  fabText: {
    fontSize: 28,
    color: '#fff',
    fontWeight: '300',
    marginTop: -2,
  },
});
