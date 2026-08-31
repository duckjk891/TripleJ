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
import { AppText, EmptyState, Button, Tag } from '../components/ui';
import LoginPrompt from '../components/LoginPrompt';
import TrackRow from '../components/TrackRow';
import TrackActionSheet from '../components/TrackActionSheet';
import TrackShareDownloadSheet, { SheetMode } from '../components/TrackShareDownloadSheet';
// v3.96(A-2): 내 앨범 관리 — 앨범 탭 + 생성 모달, 상세/관리는 AlbumDetailScreen
import AlbumCreateModal from '../components/AlbumCreateModal';
import { Album, getMyAlbums, albumCoverUri } from '../services/albumService';
// v3.114: 내 채널(피드·커뮤니티) — MAIDOL 내 채널 구성 반영. FeedCard·이미지 블록(v3.111) 재사용
import FeedCard from '../components/feed/FeedCard';
import FeedImageBlock, { feedImageUri } from '../components/feed/FeedImageBlock';
import { playTrackNow } from '../services/playback';

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

// v3.115: 상위 탭 3개(곡·앨범/피드/커뮤니티 — UserChannel과 동일 탭명)로 재구성.
// 기존 작곡/앨범/작사 콘텐츠는 '곡·앨범' 안 하위 칩(곡/앨범/작사)으로 그대로 재배치.
type MyMusicTab = 'music' | 'feed' | 'community';
type MusicSubTab = 'tracks' | 'albums' | 'lyrics';

// v3.70과 짝(FeedScreen): 텍스트 블록의 [item]{JSON} 마커 → 아이템 카드. 파싱 실패 시 일반 텍스트 폴백.
interface FeedItemAttach { name?: string; category?: string; url?: string; img?: string }
function parseItemMarker(text?: string): FeedItemAttach | null {
  if (!text || !text.startsWith('[item]')) return null;
  try { return JSON.parse(text.slice(6)); } catch { return null; }
}

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
  const [activeTab, setActiveTab] = useState<MyMusicTab>('music');
  const [musicSub, setMusicSub] = useState<MusicSubTab>('tracks'); // v3.115: 곡·앨범 탭 하위 칩
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
  // v3.114: 내가 쓴 피드/커뮤니티 글
  const [feeds, setFeeds] = useState<any[]>([]);
  const [notices, setNotices] = useState<any[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedRefreshing, setFeedRefreshing] = useState(false);
  // v3.115: 프로필 팔로워/팔로잉 수 (null=미조회 — '-' 표시)
  const [followerCount, setFollowerCount] = useState<number | null>(null);
  const [followingCount, setFollowingCount] = useState<number | null>(null);

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

  // v3.114: 내가 쓴 피드·커뮤니티 글 — UserChannelScreen과 동일 계약 GET /feeds/user/{id}?kind=feed|community
  // (백엔드 v137: viewer==owner면 비공개 글도 포함해 내려온다)
  const fetchFeeds = useCallback(async (isRefresh = false) => {
    const uid = useAuthStore.getState().user?.id;
    if (!uid) return;
    if (isRefresh) setFeedRefreshing(true);
    else setFeedLoading(true);
    if (__DEV__) console.info('[MyMusic] fetchFeeds', { refresh: isRefresh });
    try {
      const [fRes, cRes] = await Promise.allSettled([
        api.get(`/feeds/user/${uid}`, { params: { kind: 'feed', limit: 50 } }),
        api.get(`/feeds/user/${uid}`, { params: { kind: 'community', limit: 50 } }),
      ]);
      if (fRes.status === 'fulfilled') setFeeds(fRes.value.data?.feeds || []);
      else console.error('[MyMusic] 피드 조회 실패', { status: (fRes.reason as any)?.response?.status });
      if (cRes.status === 'fulfilled') setNotices(cRes.value.data?.feeds || []);
      else console.error('[MyMusic] 커뮤니티 조회 실패', { status: (cRes.reason as any)?.response?.status });
    } finally {
      setFeedLoading(false);
      setFeedRefreshing(false);
    }
  }, []);

  // v3.115: 팔로워/팔로잉 수 — 백엔드 실측 계약:
  //  - 팔로워: GET /follows/summary/{내id} 의 follower_count (UserChannel이 타 유저에 쓰는 것과 동일 라우트)
  //  - 팔로잉: 전용 카운트 API 없음 → GET /follows/following?page=1&limit=1 의 total 활용
  const fetchFollowCounts = useCallback(async () => {
    const uid = useAuthStore.getState().user?.id;
    if (!uid) return;
    const [sRes, gRes] = await Promise.allSettled([
      api.get(`/follows/summary/${uid}`),
      api.get('/follows/following', { params: { page: 1, limit: 1 } }),
    ]);
    if (sRes.status === 'fulfilled') setFollowerCount(sRes.value.data?.follower_count ?? 0);
    else console.error('[MyMusic] 팔로워 수 조회 실패', { status: (sRes.reason as any)?.response?.status });
    if (gRes.status === 'fulfilled') setFollowingCount(gRes.value.data?.total ?? 0);
    else console.error('[MyMusic] 팔로잉 수 조회 실패', { status: (gRes.reason as any)?.response?.status });
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (user) {
        fetchTracks();
        fetchMyCharacter();
        fetchAlbums();
        fetchFeeds(); // FeedCompose에서 작성 후 goBack 복귀 시 focus로 재조회 → 목록 갱신
        fetchFollowCounts();
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

  // v3.114: 내가 쓴 피드/커뮤니티 카드 — 공용 FeedCard 재사용(좋아요·댓글·삭제 등 액션 그대로).
  // 블록 렌더는 FeedScreen 규칙(텍스트/이미지 v3.111/트랙/[item] 마커). 카드 여백 탭 시 상세(FeedDetail)로.
  const renderFeed = ({ item }: { item: any }) => {
    const blocks: any[] = item.blocks || [];
    const rawText = blocks.filter((b) => b.type === 'text' && b.text);
    const textBlocks = rawText.filter((b) => !parseItemMarker(b.text));
    const itemBlocks = rawText.map((b) => parseItemMarker(b.text)).filter(Boolean) as FeedItemAttach[];
    const trackBlocks = blocks.filter((b) => b.type === 'track' && b.track?.id);
    const imageBlocks = blocks.filter((b) => b.type === 'image' && (b.image_url || b.object_name));
    const queue = trackBlocks.map((b) => b.track);
    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => {
          if (__DEV__) console.info('[MyMusic] 피드 상세로', { feedId: item.id });
          navigation.getParent()?.navigate('FeedDetail', { feedId: String(item.id) });
        }}
        accessibilityLabel="피드 상세 보기"
      >
        <FeedCard
          feed={item}
          requireLogin={() => true}
          onDeleted={() => fetchFeeds(true)}
          onPressAuthor={() => navigation.getParent()?.navigate('UserChannel', { authorId: user.id, name: user.nickname })}
          renderBlocks={() => (
            <View>
              {textBlocks.map((b, i) => (
                <AppText key={`t${i}`} style={styles.feedBody}>{b.text}</AppText>
              ))}
              {imageBlocks.map((b, i) => {
                const uri = feedImageUri(b);
                return uri ? <FeedImageBlock key={`im${i}`} uri={uri} /> : null;
              })}
              {trackBlocks.map((b, i) => (
                <View key={`tr${i}`} style={styles.feedTrackWrap}>
                  <TrackRow
                    track={{ ...b.track, id: String(b.track.id) }}
                    liked={!!likedMap[String(b.track.id)]}
                    onPress={() => playTrackNow(b.track, queue)}
                  />
                </View>
              ))}
              {itemBlocks.map((it, i) => (
                <TouchableOpacity
                  key={`it${i}`}
                  style={styles.feedItemCard}
                  activeOpacity={it.url ? 0.7 : 1}
                  accessibilityLabel={`아이템 ${it.name || ''}`}
                  onPress={() => {
                    if (!it.url) return;
                    Linking.openURL(it.url).catch((err) =>
                      console.error('[MyMusic] 아이템 링크 실패', { message: err?.message }));
                  }}
                >
                  <Feather name="shopping-bag" size={16} color={colors.text.secondary} />
                  <View style={{ flex: 1 }}>
                    <AppText style={{ fontSize: 11, color: colors.accent.primary }}>{it.category || '아이템'}</AppText>
                    <AppText style={{ fontSize: 13, color: colors.text.secondary }} numberOfLines={2}>{it.name || ''}</AppText>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        />
      </TouchableOpacity>
    );
  };

  // 성장 지표 계산 — v3.115: 레벨(LV·다음 레벨까지) 표시 제거(대표 지시, 이 화면 한정), 앨범·팔로워·팔로잉 수 추가
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
            {/* v3.115: LV 배지 제거 — 레벨 표시는 마이페이지에서 뺀다(대표 지시) */}
          </View>
          {/* v3.115: 지표 5종 — 발매곡/앨범/재생/팔로워/팔로잉 (레벨 지표 제거). 5열이라 라벨은 짧게 */}
          <View style={styles.growthStatsRow}>
            <View style={styles.growthStat}>
              <AppText style={styles.growthStatValue}>{tracks.length}</AppText>
              <AppText style={styles.growthStatLabel}>발매곡</AppText>
            </View>
            <View style={styles.growthStatDivider} />
            <View style={styles.growthStat}>
              <AppText style={styles.growthStatValue}>{albums.length}</AppText>
              <AppText style={styles.growthStatLabel}>앨범</AppText>
            </View>
            <View style={styles.growthStatDivider} />
            <View style={styles.growthStat}>
              <AppText style={styles.growthStatValue}>{totalPlays.toLocaleString()}</AppText>
              <AppText style={styles.growthStatLabel}>재생</AppText>
            </View>
            <View style={styles.growthStatDivider} />
            <View style={styles.growthStat}>
              <AppText style={styles.growthStatValue}>{followerCount == null ? '-' : followerCount.toLocaleString()}</AppText>
              <AppText style={styles.growthStatLabel}>팔로워</AppText>
            </View>
            <View style={styles.growthStatDivider} />
            <View style={styles.growthStat}>
              <AppText style={styles.growthStatValue}>{followingCount == null ? '-' : followingCount.toLocaleString()}</AppText>
              <AppText style={styles.growthStatLabel}>팔로잉</AppText>
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

      {/* 탭 바 — v3.115: 상위 3탭(곡·앨범/피드/커뮤니티, UserChannel 탭명과 동일) */}
      <View style={styles.tabBar}>
        {([
          { key: 'music', label: '곡·앨범' },
          { key: 'feed', label: '피드' },
          { key: 'community', label: '커뮤니티' },
        ] as { key: MyMusicTab; label: string }[]).map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, activeTab === t.key && styles.tabActive]}
            onPress={() => setActiveTab(t.key)}
          >
            <AppText style={[styles.tabText, activeTab === t.key && styles.tabTextActive]} numberOfLines={1}>{t.label}</AppText>
          </TouchableOpacity>
        ))}
      </View>

      {/* v3.115: 곡·앨범 하위 칩(곡/앨범/작사) — 차트의 Tag 칩 필터 관행 재사용 */}
      {activeTab === 'music' && (
        <View style={styles.subTabRow}>
          {([
            { key: 'tracks', label: '곡' },
            { key: 'albums', label: '앨범' },
            { key: 'lyrics', label: '작사' },
          ] as { key: MusicSubTab; label: string }[]).map((s) => (
            <Tag key={s.key} label={s.label} selected={musicSub === s.key} onPress={() => setMusicSub(s.key)} />
          ))}
        </View>
      )}

      {/* 곡(작곡) — v3.115: '곡·앨범 > 곡' 하위 칩으로 재배치(콘텐츠는 기존 작곡 탭 그대로) */}
      {/* v3.114: '음원 파일 올리기' dashed 진입 버튼 제거 — 레퍼런스 업로드는 작곡 대화에 이미 있어
          마이페이지에 둘 성격이 아님(대표 지시). TrackUploadScreen·trackService·라우트는 보존(진입점만 제거). */}
      {activeTab === 'music' && musicSub === 'tracks' && (
        <View style={{ flex: 1 }}>
          {tracks.length === 0 ? (
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
          )}
        </View>
      )}

      {/* v3.114: 피드/커뮤니티 탭 — 내가 쓴 글(비공개 포함) + 당겨새로고침. 카드 탭 시 상세로 */}
      {/* v3.115: 상단 [새 피드 작성]/[새 공지 작성] — FeedCompose로(공지는 kind='community'), 복귀 시 focus 재조회로 갱신 */}
      {(activeTab === 'feed' || activeTab === 'community') && (
        <FlatList
          data={activeTab === 'feed' ? feeds : notices}
          keyExtractor={(it: any, i: number) => String(it.id ?? i)}
          renderItem={renderFeed}
          contentContainerStyle={[styles.feedList, hasMiniPlayer && { paddingBottom: 140 }]}
          refreshControl={
            <RefreshControl refreshing={feedRefreshing} onRefresh={() => fetchFeeds(true)} tintColor={colors.accent.primary} />
          }
          ListHeaderComponent={
            <TouchableOpacity
              style={styles.composeBtn}
              activeOpacity={0.8}
              accessibilityLabel={activeTab === 'feed' ? '새 피드 작성' : '새 공지 작성'}
              onPress={() => {
                const kind = activeTab === 'community' ? 'community' : 'feed';
                if (__DEV__) console.info('[MyMusic] 새 글 작성 진입', { kind });
                navigation.getParent()?.navigate('FeedCompose', kind === 'community' ? { kind } : undefined);
              }}
            >
              <Feather name="edit-3" size={16} color={colors.accent.primary} />
              <AppText style={styles.albumCreateText}>{activeTab === 'feed' ? '새 피드 작성' : '새 공지 작성'}</AppText>
            </TouchableOpacity>
          }
          ListEmptyComponent={
            feedLoading ? (
              <ActivityIndicator size="small" color={colors.accent.primary} style={{ marginTop: 24 }} />
            ) : activeTab === 'feed' ? (
              <EmptyState title="아직 작성한 피드가 없어요." hint="[새 피드 작성]으로 내 곡과 소식을 알려보세요!" />
            ) : (
              <EmptyState title="아직 커뮤니티 글이 없어요." hint="[새 공지 작성]으로 구독자에게 소식을 전해보세요!" />
            )
          }
        />
      )}

      {/* v3.96(A-2): 앨범 — 내 앨범 목록 + 새 앨범 만들기. 탭하면 앨범 상세(관리 포함)로 */}
      {/* v3.115: '커버 보관함' 진입 버튼 제거(대표 지시) — 커버는 앨범 상세(관리)에서 다시 만들 수 있어
          마이페이지 중복 진입점 정리. CoverLibraryScreen·CoverLibrary 라우트는 보존(앨범 관리 내 커버 선택 등에서 사용). */}
      {activeTab === 'music' && musicSub === 'albums' && (
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

      {/* 작사 — v3.115: '곡·앨범 > 작사' 하위 칩으로 재배치. DB에 저장된 트랙의 가사 + 현재 작업 중인 가사 */}
      {activeTab === 'music' && musicSub === 'lyrics' && (
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
    fontSize: 15, // v3.115: 상위 탭이 3개로 줄어 원래 크기 복원
    color: colors.text.muted,
    fontWeight: '600',
  },
  // v3.115: 곡·앨범 하위 칩(곡/앨범/작사) — 차트 chipRow 관행(가로 나열·gap 8)
  subTabRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  // v3.115: [새 피드 작성]/[새 공지 작성] — '새 앨범 만들기'와 동일한 dashed 버튼 관행
  composeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, marginBottom: 12, marginHorizontal: 4,
    borderWidth: 1, borderColor: colors.accent.primary, borderStyle: 'dashed' as any,
    borderRadius: 12,
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
  // v3.115: levelBadge* 스타일 제거(레벨 표시 삭제와 짝)
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
  // v3.114: 피드/커뮤니티 탭 — FeedScreen 리스트 여백(12) 관행. 트랙/아이템 블록은 인셋 배경
  feedList: { paddingHorizontal: 12, paddingBottom: 100 },
  feedBody: { marginTop: 8, fontSize: 14, lineHeight: 21, color: colors.text.secondary },
  feedTrackWrap: { marginTop: 10, backgroundColor: colors.bg.deepest, borderRadius: 12, overflow: 'hidden' },
  feedItemCard: {
    marginTop: 10, backgroundColor: colors.bg.deepest, borderRadius: 12,
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10,
  },
  lyricsSection: { paddingHorizontal: 20, marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: colors.text.primary, marginBottom: 10 },
  lyricsCard: { backgroundColor: colors.bg.surface1, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.border.subtle },
  lyricsTagRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  lyricsPreview: { color: colors.text.secondary, fontSize: 14, lineHeight: 22, marginBottom: 8 },
  lyricsHint: { color: colors.text.muted, fontSize: 12, fontStyle: 'italic' },
});
