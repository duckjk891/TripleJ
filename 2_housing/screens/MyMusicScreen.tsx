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
import { LinearGradient } from 'expo-linear-gradient';
import { useAuthStore } from '../stores/authStore';
import { useLyricsStore } from '../stores/lyricsStore';
import api, { BACKEND_BASE_URL } from '../services/api';
import { usePlayerStore } from '../stores/playerStore';
import { colors } from '../theme/colors';

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
  return `${BACKEND_BASE_URL}/api/upload/cover-preview/${encodeURIComponent(coverImage)}`;
}

export default function MyMusicScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const lyricsStore = useLyricsStore();
  const { track: playingTrack } = usePlayerStore();
  const hasMiniPlayer = !!playingTrack;
  const [activeTab, setActiveTab] = useState<MyMusicTab>('tracks');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedLyrics, setExpandedLyrics] = useState<Set<string>>(new Set());

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
          <Text style={{ fontSize: 20, fontWeight: 'bold', color: colors.text.primary, marginBottom: 12 }}>내가 만든 음악 보관함</Text>
          <Text style={{ fontSize: 15, color: colors.text.secondary, textAlign: 'center', lineHeight: 24, marginBottom: 28 }}>
            {'AI로 만든 나만의 곡을\n한곳에서 관리하고 들을 수 있어요!'}
          </Text>
          <TouchableOpacity
            style={{ backgroundColor: colors.accent.primary, borderRadius: 24, paddingVertical: 14, paddingHorizontal: 40 }}
            onPress={() => navigation.getParent()?.navigate('Settings')}
          >
            <Text style={{ color: colors.text.primary, fontSize: 16, fontWeight: 'bold' }}>로그인하고 시작하기</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (loading && tracks.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={colors.accent.primary} />
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
        <Text style={{ fontSize: 16, color: colors.text.muted }}>{'🗑'}</Text>
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
            <Text style={{ fontSize: 11, color: colors.status.success, fontWeight: '600' }}>차트 스트리밍 중</Text>
          ) : (
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation();
                handlePublishToChart(String(item.id), item.title);
              }}
            >
              <Text style={{ fontSize: 11, color: colors.accent.primary, fontWeight: '600' }}>차트 업로드</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );

  // 성장 지표 계산
  const level = Math.floor(tracks.length / 3) + 1;
  const tracksToNext = 3 - (tracks.length % 3);
  const totalPlays = tracks.reduce((sum, t) => sum + (t.play_count ?? 0), 0);
  const bestTrack = tracks.length > 0
    ? [...tracks].sort((a, b) => (b.play_count ?? 0) - (a.play_count ?? 0))[0]
    : null;
  const companyLabel = user.company_name || `${user.nickname} 엔터테인먼트`;
  const displayLabel = `${user.nickname}${user.display_title ? ' ' + user.display_title : ' 대표'}`;

  return (
    <View style={styles.container}>
      {/* 성장 카드 */}
      <View style={styles.growthWrap}>
        <LinearGradient
          colors={[...colors.gradient.twilight] as any}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.growthCard}
        >
          <View style={styles.growthHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.growthCompany} numberOfLines={1}>{companyLabel}</Text>
              <Text style={styles.growthName} numberOfLines={1}>{displayLabel}님</Text>
            </View>
            <View style={styles.levelBadge}>
              <Text style={styles.levelBadgeLabel}>LV.</Text>
              <Text style={styles.levelBadgeValue}>{level}</Text>
            </View>
          </View>
          <View style={styles.growthStatsRow}>
            <View style={styles.growthStat}>
              <Text style={styles.growthStatValue}>{tracks.length}</Text>
              <Text style={styles.growthStatLabel}>발매곡</Text>
            </View>
            <View style={styles.growthStatDivider} />
            <View style={styles.growthStat}>
              <Text style={styles.growthStatValue}>{totalPlays.toLocaleString()}</Text>
              <Text style={styles.growthStatLabel}>총 재생수</Text>
            </View>
            <View style={styles.growthStatDivider} />
            <View style={styles.growthStat}>
              <Text style={styles.growthStatValue}>{tracksToNext}</Text>
              <Text style={styles.growthStatLabel}>다음 레벨까지</Text>
            </View>
          </View>
          {bestTrack && (
            <View style={styles.bestTrackRow}>
              <Text style={styles.bestTrackLabel}>★ 베스트</Text>
              <Text style={styles.bestTrackTitle} numberOfLines={1}>{bestTrack.title}</Text>
              <Text style={styles.bestTrackPlay}>▶ {bestTrack.play_count ?? 0}</Text>
            </View>
          )}
        </LinearGradient>
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
            contentContainerStyle={[styles.listContent, hasMiniPlayer && { paddingBottom: 140 }]}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => fetchTracks(true)}
                tintColor={colors.accent.primary}
              />
            }
          />
        )
      )}

      {/* 작사 탭 - DB에 저장된 트랙의 가사 + 현재 작업 중인 가사 */}
      {activeTab === 'lyrics' && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 100 }}>
          {/* 현재 작업 중인 가사 - 완성된 곡이 없을 때만 표시 */}
          {lyricsStore.generatedLyrics && tracks.length === 0 ? (
            <TouchableOpacity
              style={styles.lyricsCard}
              activeOpacity={0.8}
              onPress={() => {
                setExpandedLyrics((prev) => {
                  const next = new Set(prev);
                  next.has('draft') ? next.delete('draft') : next.add('draft');
                  return next;
                });
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 11, color: colors.accent.primary, fontWeight: '600' }}>작업 중</Text>
                <Text style={{ fontSize: 12, color: colors.text.muted }}>{expandedLyrics.has('draft') ? '접기' : '펼치기'}</Text>
              </View>
              {lyricsStore.generatedTitle ? (
                <Text style={{ fontSize: 16, fontWeight: 'bold', color: colors.text.primary, marginTop: 6, marginBottom: 4 }}>{lyricsStore.generatedTitle}</Text>
              ) : null}
              <View style={styles.lyricsTagRow}>
                {lyricsStore.genre ? <View style={styles.tag}><Text style={styles.tagText}>{lyricsStore.genre}</Text></View> : null}
                {lyricsStore.mood ? <View style={[styles.tag, styles.moodTag]}><Text style={styles.tagText}>{lyricsStore.mood}</Text></View> : null}
              </View>
              <Text style={styles.lyricsPreview} numberOfLines={expandedLyrics.has('draft') ? undefined : 3}>{lyricsStore.generatedLyrics}</Text>
              {!expandedLyrics.has('draft') && <Text style={styles.lyricsHint}>탭하여 전체 가사 보기</Text>}
            </TouchableOpacity>
          ) : null}

          {/* DB에 저장된 트랙의 가사 (곡 완성된 것) */}
          {tracks.filter((t) => t.lyrics).map((track) => {
            const key = String(track.id);
            const isExpanded = expandedLyrics.has(key);
            return (
              <TouchableOpacity
                key={key}
                style={[styles.lyricsCard, { marginBottom: 12 }]}
                activeOpacity={0.8}
                onPress={() => {
                  setExpandedLyrics((prev) => {
                    const next = new Set(prev);
                    next.has(key) ? next.delete(key) : next.add(key);
                    return next;
                  });
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontSize: 16, fontWeight: 'bold', color: colors.text.primary }}>{track.title}</Text>
                  <Text style={{ fontSize: 12, color: colors.text.muted }}>{isExpanded ? '접기' : '펼치기'}</Text>
                </View>
                <View style={[styles.lyricsTagRow, { marginTop: 6 }]}>
                  {(track.genre || []).map((g, i) => (
                    <View key={`g-${i}`} style={styles.tag}><Text style={styles.tagText}>{g}</Text></View>
                  ))}
                  {(track.mood || []).map((m, i) => (
                    <View key={`m-${i}`} style={[styles.tag, styles.moodTag]}><Text style={styles.tagText}>{m}</Text></View>
                  ))}
                </View>
                <Text style={styles.lyricsPreview} numberOfLines={isExpanded ? undefined : 3}>{track.lyrics}</Text>
              </TouchableOpacity>
            );
          })}

          {/* 완성된 곡도 없고 작업 중도 없으면 빈 상태 */}
          {tracks.filter((t) => t.lyrics).length === 0 && !lyricsStore.generatedLyrics ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>{'📝'}</Text>
              <Text style={styles.emptyText}>아직 작사한 기록이 없어요.</Text>
              <Text style={styles.emptyHint}>작업실에서 작사 디렉터와 대화해보세요!</Text>
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.deepest,
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.bg.surface1,
    marginBottom: 12,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: colors.accent.primary,
  },
  tabText: {
    fontSize: 15,
    color: colors.text.muted,
    fontWeight: '600',
  },
  tabTextActive: {
    color: colors.accent.primary,
  },
  userInfo: {
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  userText: {
    fontSize: 16,
    color: colors.accent.primary,
    fontWeight: '600',
  },
  growthWrap: {
    paddingHorizontal: 16,
    paddingTop: 12,
    marginBottom: 12,
  },
  growthCard: {
    borderRadius: 16,
    padding: 16,
  },
  growthHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  growthCompany: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.75)',
    fontWeight: '600',
    marginBottom: 2,
  },
  growthName: {
    fontSize: 18,
    color: colors.text.primary,
    fontWeight: '700',
  },
  levelBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(13,8,32,0.4)',
    borderRadius: 12,
    minWidth: 56,
  },
  levelBadgeLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '600',
  },
  levelBadgeValue: {
    fontSize: 22,
    color: colors.text.primary,
    fontWeight: '800',
    lineHeight: 26,
  },
  growthStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(13,8,32,0.25)',
    borderRadius: 12,
    padding: 10,
  },
  growthStat: {
    flex: 1,
    alignItems: 'center',
  },
  growthStatDivider: {
    width: 1,
    height: 28,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  growthStatValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text.primary,
    marginBottom: 2,
  },
  growthStatLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.75)',
  },
  bestTrackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.15)',
    gap: 8,
  },
  bestTrackLabel: {
    fontSize: 11,
    color: colors.accent.secondary,
    fontWeight: '700',
  },
  bestTrackTitle: {
    flex: 1,
    fontSize: 13,
    color: colors.text.primary,
    fontWeight: '600',
  },
  bestTrackPlay: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.8)',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 100,
  },
  emptyIcon: {
    fontSize: 64,
    color: colors.border.subtle,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 16,
    color: colors.text.muted,
    marginBottom: 8,
  },
  emptyHint: {
    fontSize: 13,
    color: colors.border.default,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 100,
  },
  trackItem: {
    flexDirection: 'row',
    backgroundColor: colors.bg.surface1,
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
    // TODO: 테마화 검토 (커버 플레이스홀더 배경)
    backgroundColor: '#2a2a3e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  coverPlaceholderText: {
    fontSize: 24,
    color: colors.text.muted,
  },
  trackInfo: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  trackTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text.primary,
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
    color: colors.text.secondary,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  statText: {
    fontSize: 12,
    color: colors.text.muted,
  },
  lyricsSection: { paddingHorizontal: 20, marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: colors.text.primary, marginBottom: 10 },
  lyricsCard: { backgroundColor: colors.bg.surface1, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.border.subtle },
  lyricsTagRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  lyricsPreview: { color: colors.text.secondary, fontSize: 14, lineHeight: 22, marginBottom: 8 },
  lyricsHint: { color: colors.text.muted, fontSize: 12, fontStyle: 'italic' },
});
