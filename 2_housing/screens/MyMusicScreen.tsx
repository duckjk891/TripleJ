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
  ScrollView,
  Share,
  Linking,
} from 'react-native';
import { showAlert } from '../utils/appAlert';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuthStore } from '../stores/authStore';
import { useLyricsStore } from '../stores/lyricsStore';
import { useCharacterTaskStore } from '../stores/characterTaskStore';
import { useLikesStore } from '../stores/likesStore';
import api, { BACKEND_BASE_URL } from '../services/api';
import { usePlayerStore } from '../stores/playerStore';
import { colors } from '../theme/colors';
import { AppText, EmptyState, Button } from '../components/ui';
import LoginPrompt from '../components/LoginPrompt';
import TrackRow from '../components/TrackRow';
import TrackActionSheet from '../components/TrackActionSheet';
import TrackShareDownloadSheet, { SheetMode } from '../components/TrackShareDownloadSheet';
// v3.96(A-2): 내 앨범 관리 — 앨범 탭 + 생성 모달, 상세/관리는 AlbumDetailScreen
import AlbumCreateModal from '../components/AlbumCreateModal';
import { Album, getMyAlbums, albumCoverUri } from '../services/albumService';

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

type MyMusicTab = 'tracks' | 'albums' | 'lyrics';

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
  const [actionTrack, setActionTrack] = useState<Track | null>(null); // ⋮ 더보기 대상
  const likedMap = useLikesStore((s) => s.liked);
  const syncLikes = useLikesStore((s) => s.sync);
  const [sdTrack, setSdTrack] = useState<Track | null>(null);   // 공유/다운로드 선택지 대상
  const [sdMode, setSdMode] = useState<SheetMode>('share');
  const [myCharacter, setMyCharacter] = useState<{ preview_url: string; sheet_object_name: string } | null>(null);
  // v3.96(A-2): 내 앨범 탭
  const [albums, setAlbums] = useState<Album[]>([]);
  const [albumsLoading, setAlbumsLoading] = useState(false);
  const [showAlbumCreate, setShowAlbumCreate] = useState(false);

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
      const list = res.data.tracks || [];
      setTracks(list);
      if (list.length) syncLikes(list.map((t: Track) => String(t.id)));
    } catch (e) {
      console.error('[MyMusic] fetch error', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const fetchMyCharacter = useCallback(async () => {
    try {
      const res = await api.get('/character/me');
      const ch = res.data?.character;
      console.log('[MyMusic] /character/me response:', JSON.stringify(res.data));
      if (ch?.sheet_object_name) {
        // presigned URL은 internal host를 가리킬 수 있어 모바일에서 안 열림 → 항상 백엔드 proxy 사용
        // cache-buster: RN Image 캐시 우회 (옷 저장 후 옛 이미지 표시 방지)
        const url = `${BACKEND_BASE_URL}/api/character/preview/${ch.sheet_object_name}?t=${Date.now()}`;
        setMyCharacter({ preview_url: url, sheet_object_name: ch.sheet_object_name });
      } else {
        setMyCharacter(null);
      }
    } catch (err: any) {
      console.warn('[MyMusic] fetchMyCharacter error:', err?.response?.status, err?.message);
      setMyCharacter(null);
    }
  }, []);

  // v3.96(A-2): 내 앨범 목록 (GET /albums/my — 비공개 포함)
  const fetchAlbums = useCallback(async () => {
    setAlbumsLoading(true);
    try {
      const res = await getMyAlbums(1, 50);
      setAlbums(res.albums);
    } catch (err: any) {
      console.error('[MyMusic] fetchAlbums 실패', { status: err?.response?.status });
    } finally {
      setAlbumsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (user) {
        fetchTracks();
        fetchMyCharacter();
        fetchAlbums();
      }
    }, [user])
  );

  const handleOpenArtist = () => {
    // 신선한 데이터로 hydrate되도록 store 초기화 후 Studio 탭 → ArtistResult 진입
    useCharacterTaskStore.getState().clearResult();
    navigation.navigate('Studio', { screen: 'ArtistResult' });
  };

  const handleCreateArtist = () => {
    navigation.navigate('Studio', { screen: 'ArtistInput' });
  };

  const handleDeleteTrack = (trackId: string, title: string) => {
    showAlert(
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
              showAlert('오류', '삭제에 실패했습니다.');
            }
          },
        },
      ]
    );
  };

  const handlePublishToChart = (trackId: string, title: string) => {
    showAlert(
      '차트 업로드',
      `"${title}"을(를) 차트에 공개하시겠습니까?`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '업로드',
          onPress: async () => {
            try {
              await api.put(`/tracks/${trackId}`, { is_public: true });
              showAlert('완료', '차트에 업로드되었습니다!');
              fetchTracks(true);
            } catch {
              showAlert('오류', '업로드에 실패했습니다.');
            }
          },
        },
      ]
    );
  };

  // 내 곡 공유 (내가 만든 곡만 노출되는 화면이므로 소유권 체크 불필요)
  const handleShareTrack = async (track: Track) => {
    const link = `${BACKEND_BASE_URL}/track/${track.id}`;
    if (__DEV__) console.info('[MyMusic] share', { id: track.id });
    try {
      await Share.share({ message: `AIDOL에서 내가 만든 곡 "${track.title}" 들어보세요!\n베타 테스트 기간 가입 시 스타 50 추가 증정!\n${link}` });
    } catch (err: any) {
      console.error('[MyMusic] share 실패', { message: err?.message });
    }
  };

  // 내 곡 다운로드 — presigned URL 받아 열기(웹=다운로드/새탭, 네이티브=브라우저 저장)
  const handleDownloadTrack = async (track: Track) => {
    if (__DEV__) console.info('[MyMusic] download 호출', { id: track.id });
    try {
      const { data } = await api.post(`/tracks/download/${track.id}`);
      const url = data?.download_url;
      if (!url) { showAlert('오류', '다운로드 링크를 가져오지 못했어요.'); return; }
      await Linking.openURL(url);
    } catch (err: any) {
      console.error('[MyMusic] download 실패', { status: err?.response?.status });
      showAlert('오류', '다운로드에 실패했어요. 잠시 후 다시 시도해 주세요.');
    }
  };

  if (!user) {
    // 로그인 CTA는 피드/검색/플레이리스트/작업실과 동일하게 공통 LoginPrompt + 세로 중앙 정렬
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <LoginPrompt
          title="내가 만든 음악 보관함"
          desc={'AI로 만든 나만의 곡을\n한곳에서 관리하고 들을 수 있어요!'}
          onPress={() => navigation.getParent()?.navigate('Settings')}
        />
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

  // 행 디자인은 차트·검색·플레이리스트와 동일한 공용 TrackRow (좌측 순번은 비움).
  // 내 곡 고유 기능(공유·다운로드·차트 업로드·삭제)은 ⋮ 메뉴로 옮겨 보존한다.
  const renderTrack = ({ item }: { item: Track }) => (
    <TrackRow
      track={{ ...item, id: String(item.id) }}
      liked={!!likedMap[String(item.id)]}
      onPress={() => navigation.getParent()?.navigate('Player', { track: item })}
      onMore={() => setActionTrack(item)}
      footer={
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 3, alignItems: 'center' }}>
          {[...(item.genre || []).slice(0, 2), ...(item.mood || []).slice(0, 1)].map((t, i) => (
            <View key={i} style={{ backgroundColor: colors.bg.surface2, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
              <AppText style={{ fontSize: 10, color: colors.text.secondary }}>{t}</AppText>
            </View>
          ))}
          {item.is_public ? (
            <AppText style={{ fontSize: 10, color: colors.status.success, fontWeight: '600' }}>차트 스트리밍 중</AppText>
          ) : null}
        </View>
      }
    />
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
              <AppText style={styles.growthCompany} numberOfLines={1}>{companyLabel}</AppText>
              <AppText style={styles.growthName} numberOfLines={1}>{displayLabel}님</AppText>
            </View>
            <View style={styles.levelBadge}>
              <AppText style={styles.levelBadgeLabel}>LV.</AppText>
              <AppText style={styles.levelBadgeValue}>{level}</AppText>
            </View>
          </View>
          <View style={styles.growthStatsRow}>
            <View style={styles.growthStat}>
              <AppText style={styles.growthStatValue}>{tracks.length}</AppText>
              <AppText style={styles.growthStatLabel}>발매곡</AppText>
            </View>
            <View style={styles.growthStatDivider} />
            <View style={styles.growthStat}>
              <AppText style={styles.growthStatValue}>{totalPlays.toLocaleString()}</AppText>
              <AppText style={styles.growthStatLabel}>총 재생수</AppText>
            </View>
            <View style={styles.growthStatDivider} />
            <View style={styles.growthStat}>
              <AppText style={styles.growthStatValue}>{tracksToNext}</AppText>
              <AppText style={styles.growthStatLabel}>다음 레벨까지</AppText>
            </View>
          </View>
          {bestTrack && (
            <View style={styles.bestTrackRow}>
              <AppText style={styles.bestTrackLabel}>★ 베스트</AppText>
              <AppText style={styles.bestTrackTitle} numberOfLines={1}>{bestTrack.title}</AppText>
              <AppText style={styles.bestTrackPlay}>▶ {bestTrack.play_count ?? 0}</AppText>
            </View>
          )}
        </LinearGradient>
      </View>

      {/* 내 아티스트 카드 */}
      <View style={styles.artistSection}>
        <AppText style={styles.artistSectionLabel}>내 아티스트</AppText>
        {myCharacter ? (
          <TouchableOpacity style={styles.artistCard} activeOpacity={0.85} onPress={handleOpenArtist}>
            <Image
              source={{ uri: myCharacter.preview_url }}
              style={styles.artistCardImage}
            />
            <View style={styles.artistCardBody}>
              <AppText style={styles.artistCardTitle}>나의 아티스트</AppText>
              <AppText style={styles.artistCardHint}>탭하여 자세히 보기 · 코디/미세조정</AppText>
            </View>
            <AppText style={styles.artistCardArrow}>{'›'}</AppText>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.artistEmpty} activeOpacity={0.85} onPress={handleCreateArtist}>
            <View style={{ flex: 1 }}>
              <AppText style={styles.artistEmptyTitle}>아직 만든 아티스트가 없어요</AppText>
              <AppText style={styles.artistEmptyHint}>아티스트 디렉터에서 만들어보세요</AppText>
            </View>
            <AppText style={styles.artistEmptyButton}>만들러 가기</AppText>
          </TouchableOpacity>
        )}
      </View>

      {/* 탭 바 */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'tracks' && styles.tabActive]}
          onPress={() => setActiveTab('tracks')}
        >
          <AppText style={[styles.tabText, activeTab === 'tracks' && styles.tabTextActive]}>작곡</AppText>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'albums' && styles.tabActive]}
          onPress={() => setActiveTab('albums')}
        >
          <AppText style={[styles.tabText, activeTab === 'albums' && styles.tabTextActive]}>앨범</AppText>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'lyrics' && styles.tabActive]}
          onPress={() => setActiveTab('lyrics')}
        >
          <AppText style={[styles.tabText, activeTab === 'lyrics' && styles.tabTextActive]}>작사</AppText>
        </TouchableOpacity>
      </View>

      {/* 작곡 탭 */}
      {activeTab === 'tracks' && (
        tracks.length === 0 ? (
          <EmptyState title="아직 생성한 곡이 없어요." hint="작업실에서 곡을 만들어보세요!" />
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

      {/* v3.96(A-2): 앨범 탭 — 내 앨범 목록 + 새 앨범 만들기. 탭하면 앨범 상세(관리 포함)로 */}
      {activeTab === 'albums' && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: hasMiniPlayer ? 140 : 100 }}>
          <TouchableOpacity style={styles.albumCreateBtn} activeOpacity={0.8} onPress={() => setShowAlbumCreate(true)}>
            <Feather name="plus" size={16} color={colors.accent.primary} />
            <AppText style={styles.albumCreateText}>새 앨범 만들기</AppText>
          </TouchableOpacity>
          {albumsLoading && albums.length === 0 ? (
            <ActivityIndicator size="small" color={colors.accent.primary} style={{ marginTop: 24 }} />
          ) : albums.length === 0 ? (
            <EmptyState title="아직 만든 앨범이 없어요." hint="발매한 곡들을 묶어 앨범으로 소개해보세요!" />
          ) : (
            albums.map((a) => (
              <TouchableOpacity
                key={a.id} style={styles.albumRow} activeOpacity={0.75}
                onPress={() => navigation.getParent()?.navigate('AlbumDetail', { albumId: String(a.id) })}
                accessibilityLabel={`앨범 ${a.title}`}
              >
                <View style={styles.albumRowCover}>
                  {albumCoverUri(a.cover_image)
                    ? <Image source={{ uri: albumCoverUri(a.cover_image)! }} style={styles.albumRowCoverImg} />
                    : <AppText style={{ fontSize: 20, color: colors.text.muted }}>♪</AppText>}
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <AppText style={styles.albumRowTitle} numberOfLines={1}>{a.title}</AppText>
                  <AppText style={styles.albumRowMeta}>
                    {`${a.track_count ?? 0}곡${a.is_public === false ? ' · 비공개' : ''}`}
                  </AppText>
                </View>
                <Feather name="chevron-right" size={18} color={colors.text.muted} />
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
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
                <AppText style={{ fontSize: 11, color: colors.accent.primary, fontWeight: '600' }}>작업 중</AppText>
                <AppText style={{ fontSize: 12, color: colors.text.muted }}>{expandedLyrics.has('draft') ? '접기' : '펼치기'}</AppText>
              </View>
              {lyricsStore.generatedTitle ? (
                <AppText style={{ fontSize: 16, fontWeight: 'bold', color: colors.text.primary, marginTop: 6, marginBottom: 4 }}>{lyricsStore.generatedTitle}</AppText>
              ) : null}
              <View style={styles.lyricsTagRow}>
                {lyricsStore.genre ? <View style={styles.tag}><AppText style={styles.tagText}>{lyricsStore.genre}</AppText></View> : null}
                {lyricsStore.mood ? <View style={[styles.tag, styles.moodTag]}><AppText style={styles.tagText}>{lyricsStore.mood}</AppText></View> : null}
              </View>
              <AppText style={styles.lyricsPreview} numberOfLines={expandedLyrics.has('draft') ? undefined : 3}>{lyricsStore.generatedLyrics}</AppText>
              {!expandedLyrics.has('draft') && <AppText style={styles.lyricsHint}>탭하여 전체 가사 보기</AppText>}
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
                  <AppText style={{ fontSize: 16, fontWeight: 'bold', color: colors.text.primary }}>{track.title}</AppText>
                  <AppText style={{ fontSize: 12, color: colors.text.muted }}>{isExpanded ? '접기' : '펼치기'}</AppText>
                </View>
                <View style={[styles.lyricsTagRow, { marginTop: 6 }]}>
                  {(track.genre || []).map((g, i) => (
                    <View key={`g-${i}`} style={styles.tag}><AppText style={styles.tagText}>{g}</AppText></View>
                  ))}
                  {(track.mood || []).map((m, i) => (
                    <View key={`m-${i}`} style={[styles.tag, styles.moodTag]}><AppText style={styles.tagText}>{m}</AppText></View>
                  ))}
                </View>
                <AppText style={styles.lyricsPreview} numberOfLines={isExpanded ? undefined : 3}>{track.lyrics}</AppText>
              </TouchableOpacity>
            );
          })}

          {/* 완성된 곡도 없고 작업 중도 없으면 빈 상태 */}
          {tracks.filter((t) => t.lyrics).length === 0 && !lyricsStore.generatedLyrics ? (
            <EmptyState title="아직 작사한 기록이 없어요." hint="작업실에서 작사 디렉터와 대화해보세요!" />
          ) : null}
        </ScrollView>
      )}

      {/* v3.96(A-2): 앨범 생성 모달 — 생성 성공 시 목록 갱신 + 상세로 이동 */}
      <AlbumCreateModal
        visible={showAlbumCreate}
        onClose={() => setShowAlbumCreate(false)}
        onCreated={(album) => {
          fetchAlbums();
          navigation.getParent()?.navigate('AlbumDetail', { albumId: String(album.id) });
        }}
      />

      {/* 공유·다운로드 선택지 (쇼츠/릴스/틱톡·화질별 영상·mp3) */}
      <TrackShareDownloadSheet
        visible={!!sdTrack}
        mode={sdMode}
        track={sdTrack ? { id: sdTrack.id, title: sdTrack.title } : null}
        onClose={() => setSdTrack(null)}
      />

      {/* 곡 더보기(⋮) — 공용 시트 + 내 곡 고유 기능(공유·다운로드·차트 업로드·삭제) */}
      <TrackActionSheet
        track={actionTrack ? { ...actionTrack, id: String(actionTrack.id) } : null}
        onClose={() => setActionTrack(null)}
        onPlay={(t) => navigation.getParent()?.navigate('Player', { track: t })}
        onLikeChanged={(trackId, delta) => setTracks((prev) => prev.map((t) =>
          String(t.id) === trackId ? { ...t, like_count: Math.max(0, (t.like_count ?? 0) + delta) } : t))}
        extraItems={actionTrack ? [
          { icon: 'share-2', label: '공유', onPress: () => { setSdMode('share'); setSdTrack(actionTrack); } },
          { icon: 'download', label: '다운로드', onPress: () => { setSdMode('download'); setSdTrack(actionTrack); } },
          ...(actionTrack.is_public
            ? []
            : [{ icon: 'upload-cloud' as const, label: '차트에 업로드', onPress: () => handlePublishToChart(String(actionTrack.id), actionTrack.title) }]),
          { icon: 'trash-2', label: '삭제', danger: true, onPress: () => handleDeleteTrack(String(actionTrack.id), actionTrack.title) },
        ] : undefined}
      />
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
  artistSection: {
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  artistSectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text.secondary,
    marginBottom: 8,
    marginLeft: 2,
  },
  artistCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.surface1,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.accent.primary,
  },
  artistCardImage: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: colors.bg.surface2,
    marginRight: 12,
  },
  artistCardBody: {
    flex: 1,
  },
  artistCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text.primary,
    marginBottom: 2,
  },
  artistCardHint: {
    fontSize: 11,
    color: colors.text.muted,
  },
  artistCardArrow: {
    fontSize: 28,
    color: colors.text.muted,
    marginLeft: 8,
  },
  artistEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.surface1,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderStyle: 'dashed' as any,
  },
  artistEmptyIcon: {
    fontSize: 28,
    marginRight: 12,
  },
  artistEmptyTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text.primary,
    marginBottom: 2,
  },
  artistEmptyHint: {
    fontSize: 11,
    color: colors.text.muted,
  },
  artistEmptyButton: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.accent.primary,
    marginLeft: 8,
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
    // 행(TrackRow)이 자체 좌우 패딩을 가지므로 여기선 넣지 않는다(플레이리스트·차트와 동일 정렬)
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
    backgroundColor: colors.bg.surface2,
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
    backgroundColor: 'rgba(168, 85, 247, 0.18)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 4,
    marginBottom: 2,
  },
  moodTag: {
    backgroundColor: 'rgba(251, 191, 36, 0.15)',
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
  ownActionsRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  ownActionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 5, paddingHorizontal: 10,
    backgroundColor: colors.bg.surface2, borderRadius: 8,
  },
  ownActionText: { fontSize: 12, color: colors.text.secondary, fontWeight: '600' },
  // v3.96(A-2): 앨범 탭
  albumCreateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, marginBottom: 12,
    borderWidth: 1, borderColor: colors.accent.primary, borderStyle: 'dashed' as any,
    borderRadius: 12,
  },
  albumCreateText: { fontSize: 13, fontWeight: '700', color: colors.accent.primary },
  albumRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.bg.surface1, borderRadius: 12, padding: 12, marginBottom: 10,
  },
  albumRowCover: {
    width: 56, height: 56, borderRadius: 8, overflow: 'hidden',
    backgroundColor: colors.bg.surface2, justifyContent: 'center', alignItems: 'center',
  },
  albumRowCoverImg: { width: 56, height: 56 },
  albumRowTitle: { fontSize: 15, fontWeight: '600', color: colors.text.primary, marginBottom: 3 },
  albumRowMeta: { fontSize: 12, color: colors.text.muted },
  lyricsSection: { paddingHorizontal: 20, marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: colors.text.primary, marginBottom: 10 },
  lyricsCard: { backgroundColor: colors.bg.surface1, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.border.subtle },
  lyricsTagRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  lyricsPreview: { color: colors.text.secondary, fontSize: 14, lineHeight: 22, marginBottom: 8 },
  lyricsHint: { color: colors.text.muted, fontSize: 12, fontStyle: 'italic' },
});
