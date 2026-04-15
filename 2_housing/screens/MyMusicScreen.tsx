import { useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Image,
  ActivityIndicator,
  RefreshControl,
  Alert,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../stores/authStore';
import { useLyricsStore } from '../stores/lyricsStore';
import api from '../services/api';

interface Track {
  id: number;
  title: string;
  uploader_nickname: string;
  ai_model: string;
  genre: string[];
  mood: string[];
  audio_url: string;
  play_count: number;
  like_count: number;
  created_at: string;
  cover_image: string;
  is_public?: boolean;
  lyrics?: string;
}

type MyMusicTab = 'tracks' | 'lyrics';

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}.${m}.${d}`;
}

function getCoverUrl(coverImage: string): string {
  return `http://192.168.219.106:9001/api/upload/cover-preview/${encodeURIComponent(coverImage)}`;
}

export default function MyMusicScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const lyricsStore = useLyricsStore();
  const [activeTab, setActiveTab] = useState<MyMusicTab>('tracks');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchTracks = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const res = await api.get('/tracks/my', {
        params: { page: 1, limit: 20, sort: 'created_at' },
      });
      setTracks(res.data.tracks || []);
    } catch (e) {
      console.error('[MyMusic] fetch error', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (user) fetchTracks();
    }, [user])
  );

  const handleDeleteTrack = (trackId: string, title: string) => {
    Alert.alert(
      '곡 삭제',
      `"${title}"을(를) 삭제하시겠습니까?`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/tracks/${trackId}`);
              setTracks((prev) => prev.filter((t) => String(t.id) !== trackId));
            } catch {
              Alert.alert('오류', '삭제에 실패했습니다.');
            }
          },
        },
      ]
    );
  };

  const handlePublishToChart = (trackId: string, title: string) => {
    Alert.alert(
      '차트 업로드',
      `"${title}"을(를) 차트에 공개하시겠습니까?`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '업로드',
          onPress: async () => {
            try {
              await api.put(`/tracks/${trackId}`, { is_public: true });
              Alert.alert('완료', '차트에 업로드되었습니다!');
              fetchTracks(true);
            } catch {
              Alert.alert('오류', '업로드에 실패했습니다.');
            }
          },
        },
      ]
    );
  };

  if (!user) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyContainer}>
          <Text style={{ fontSize: 48, marginBottom: 16 }}>{'🎧'}</Text>
          <Text style={{ fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 12 }}>내가 만든 음악 보관함</Text>
          <Text style={{ fontSize: 15, color: '#999', textAlign: 'center', lineHeight: 24, marginBottom: 28 }}>
            {'AI로 만든 나만의 곡을\n한곳에서 관리하고 들을 수 있어요!'}
          </Text>
          <TouchableOpacity
            style={{ backgroundColor: '#e94560', borderRadius: 24, paddingVertical: 14, paddingHorizontal: 40 }}
            onPress={() => navigation.getParent()?.navigate('Settings')}
          >
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>로그인하고 시작하기</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (loading && tracks.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color="#e94560" />
        </View>
      </View>
    );
  }

  const renderTrack = ({ item }: { item: Track }) => (
    <TouchableOpacity
      style={styles.trackItem}
      activeOpacity={0.7}
      onPress={() => navigation.getParent()?.navigate('Player', { track: item })}
    >
      {/* 휴지통 삭제 버튼 - 오른쪽 상단 */}
      <TouchableOpacity
        style={{ position: 'absolute', top: 8, right: 8, zIndex: 1, padding: 4 }}
        onPress={(e) => {
          e.stopPropagation();
          handleDeleteTrack(String(item.id), item.title);
        }}
      >
        <Text style={{ fontSize: 16, color: '#666' }}>{'🗑'}</Text>
      </TouchableOpacity>
      {item.cover_image ? (
        <Image
          source={{ uri: getCoverUrl(item.cover_image) }}
          style={styles.coverImage}
        />
      ) : (
        <View style={[styles.coverImage, styles.coverPlaceholder]}>
          <Text style={styles.coverPlaceholderText}>♪</Text>
        </View>
      )}
      <View style={styles.trackInfo}>
        <Text style={styles.trackTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <View style={styles.tagsRow}>
          {(item.genre || []).slice(0, 2).map((g, i) => (
            <View key={`g-${i}`} style={styles.tag}>
              <Text style={styles.tagText}>{g}</Text>
            </View>
          ))}
          {(item.mood || []).slice(0, 2).map((m, i) => (
            <View key={`m-${i}`} style={[styles.tag, styles.moodTag]}>
              <Text style={styles.tagText}>{m}</Text>
            </View>
          ))}
        </View>
        <View style={styles.statsRow}>
          <Text style={styles.statText}>▶ {item.play_count ?? 0}</Text>
          <Text style={styles.statText}>♥ {item.like_count ?? 0}</Text>
          <Text style={styles.statText}>{formatDate(item.created_at)}</Text>
          {item.is_public ? (
            <Text style={{ fontSize: 11, color: '#27ae60', fontWeight: '600' }}>차트 스트리밍 중</Text>
          ) : (
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation();
                handlePublishToChart(String(item.id), item.title);
              }}
            >
              <Text style={{ fontSize: 11, color: '#e94560', fontWeight: '600' }}>차트 업로드</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* 유저 정보 */}
      <View style={styles.userInfo}>
        <Text style={styles.userText}>{user.nickname}님의 음악</Text>
      </View>

      {/* 탭 바 */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'tracks' && styles.tabActive]}
          onPress={() => setActiveTab('tracks')}
        >
          <Text style={[styles.tabText, activeTab === 'tracks' && styles.tabTextActive]}>작곡</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'lyrics' && styles.tabActive]}
          onPress={() => setActiveTab('lyrics')}
        >
          <Text style={[styles.tabText, activeTab === 'lyrics' && styles.tabTextActive]}>작사</Text>
        </TouchableOpacity>
      </View>

      {/* 작곡 탭 */}
      {activeTab === 'tracks' && (
        tracks.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>{'🎧'}</Text>
            <Text style={styles.emptyText}>아직 생성한 곡이 없어요.</Text>
            <Text style={styles.emptyHint}>작업실에서 곡을 만들어보세요!</Text>
          </View>
        ) : (
          <FlatList
            data={tracks}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderTrack}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => fetchTracks(true)}
                tintColor="#e94560"
              />
            }
          />
        )
      )}

      {/* 작사 탭 */}
      {activeTab === 'lyrics' && (
        lyricsStore.generatedLyrics ? (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 100 }}>
            {lyricsStore.generatedTitle ? (
              <View style={styles.lyricsCard}>
                <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#e94560', marginBottom: 8 }}>{lyricsStore.generatedTitle}</Text>
                <View style={styles.lyricsTagRow}>
                  {lyricsStore.genre ? <View style={styles.tag}><Text style={styles.tagText}>{lyricsStore.genre}</Text></View> : null}
                  {lyricsStore.mood ? <View style={[styles.tag, styles.moodTag]}><Text style={styles.tagText}>{lyricsStore.mood}</Text></View> : null}
                </View>
                <Text style={styles.lyricsPreview}>{lyricsStore.generatedLyrics}</Text>
                <Text style={styles.lyricsHint}>작곡하러 가려면 작업실에서 작곡 디렉터를 선택하세요</Text>
              </View>
            ) : (
              <View style={styles.lyricsCard}>
                <View style={styles.lyricsTagRow}>
                  {lyricsStore.genre ? <View style={styles.tag}><Text style={styles.tagText}>{lyricsStore.genre}</Text></View> : null}
                  {lyricsStore.mood ? <View style={[styles.tag, styles.moodTag]}><Text style={styles.tagText}>{lyricsStore.mood}</Text></View> : null}
                </View>
                <Text style={styles.lyricsPreview}>{lyricsStore.generatedLyrics}</Text>
                <Text style={styles.lyricsHint}>작곡하러 가려면 작업실에서 작곡 디렉터를 선택하세요</Text>
              </View>
            )}
          </ScrollView>
        ) : (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>{'📝'}</Text>
            <Text style={styles.emptyText}>아직 작사한 기록이 없어요.</Text>
            <Text style={styles.emptyHint}>작업실에서 작사 디렉터와 대화해보세요!</Text>
          </View>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a1a',
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
    marginBottom: 12,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#e94560',
  },
  tabText: {
    fontSize: 15,
    color: '#666',
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#e94560',
  },
  userInfo: {
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  userText: {
    fontSize: 16,
    color: '#e94560',
    fontWeight: '600',
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
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 100,
  },
  trackItem: {
    flexDirection: 'row',
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  coverImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
  },
  coverPlaceholder: {
    backgroundColor: '#2a2a3e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  coverPlaceholderText: {
    fontSize: 24,
    color: '#555',
  },
  trackInfo: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  trackTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 4,
  },
  tag: {
    backgroundColor: 'rgba(233, 69, 96, 0.2)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 4,
    marginBottom: 2,
  },
  moodTag: {
    backgroundColor: 'rgba(100, 100, 255, 0.2)',
  },
  tagText: {
    fontSize: 11,
    color: '#aaa',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  statText: {
    fontSize: 12,
    color: '#666',
  },
  lyricsSection: { paddingHorizontal: 20, marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#fff', marginBottom: 10 },
  lyricsCard: { backgroundColor: '#1a1a2e', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#333' },
  lyricsTagRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  lyricsPreview: { color: '#ccc', fontSize: 14, lineHeight: 22, marginBottom: 8 },
  lyricsHint: { color: '#666', fontSize: 12, fontStyle: 'italic' },
});
