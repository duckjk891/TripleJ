// [ChartScreen] Wave 0 리스킨 — 공용 컴포넌트(ui/) + 디자인 토큰만 사용. 기능/데이터 흐름 불변.
// 디자인: Spotify식 가로 칩 필터 + Material 3 리스트/카드 + PANN 황혼 토큰.
import { useState, useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  StyleSheet, View, FlatList, TouchableOpacity, Image, ActivityIndicator,
  RefreshControl, Modal, TextInput, ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api, { BACKEND_BASE_URL } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useLikesStore } from '../stores/likesStore';
import { usePlayerStore } from '../stores/playerStore';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { AppText, Tag, Button, EmptyState, ScreenLayout } from '../components/ui';
import TrackRow, { trackRowStyles } from '../components/TrackRow';
import Fab from '../components/Fab';
import TrackActionSheet from '../components/TrackActionSheet';
import TutorialOverlay, { TutorialStep } from '../components/TutorialOverlay';
// v3.213: 차트 탭 스트립(chipBar) anchor — 스트립 컨테이너 영역 단위 등록
import { measureAndRegister, unregisterAnchor } from '../utils/tutorialAnchors';
// v3.96(A-20): 홈(차트) 최신 앨범 가로 섹션 — GET /albums/latest, 탭 시 앨범 상세로
import { Album, getLatestAlbums, albumCoverUri } from '../services/albumService';

// v3.204 ⑥ → v3.213: 사용자 확정 문안 2스텝 — 비로그인 시에만 노출(enabled=!user)
const TUTORIAL_STEPS: TutorialStep[] = [
  { title: '신곡·차트 탭', desc: '최신 발매된 곡이나 인기곡을 탭하여 확인해보세요.', anchorKey: 'chart-tabs' },
  { title: '곡 더보기', desc: '클릭하여 재생목록에 추가하거나 플레이리스트에 담아보세요.', anchorKey: 'chart-row-more' },
];

// v3.213: 상단바 튜토리얼 6스텝 — 차트 화면 호스트, 로그인 시에만(enabled=!!user).
// anchor는 차트 탭 헤더의 HomeHeaderActions(registerTutorialAnchors)가 등록.
// 문안 = 사용자 원문(맞춤법 교정 2건 반영: "확인할"/"연락할" 띄어쓰기·"메시지").
const TOPBAR_TUTORIAL_STEPS: TutorialStep[] = [
  { title: '⭐ 스타', desc: '클릭하여 잔여 스타(⭐)와 스타 받는 방법을 확인할 수 있어요.', anchorKey: 'topbar-star' },
  { title: '출석체크', desc: '클릭하여 출석체크하고 스타(⭐)를 받아보세요.', anchorKey: 'topbar-attendance' },
  { title: '추천', desc: '클릭하여 친구에게 초대링크를 보내고 스타(⭐)를 받아보세요.', anchorKey: 'topbar-invite' },
  { title: '알림', desc: '클릭하여 새 피드나 공지를 확인해보세요.', anchorKey: 'topbar-noti' },
  { title: 'DM', desc: '클릭하여 나에게 온 메시지나 요청을 확인하고 다른 사용자 또는 관리자에게 연락할 수 있어요.', anchorKey: 'topbar-dm' },
  { title: '마이페이지', desc: '내 기획사를 관리할 수 있는 페이지로 이동할 수 있어요.', anchorKey: 'topbar-mypage' },
];

// v3.207 ②: 신곡 탭 발매일 footer — created_at 상대 표기(서버 무수정, 필드 없으면 미표기)
const formatReleasedAgo = (iso?: string): string | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const diffDay = Math.floor((Date.now() - t) / 86400000);
  if (diffDay <= 0) return '오늘 발매';
  if (diffDay < 7) return `${diffDay}일 전 발매`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}주 전 발매`;
  const d = new Date(t);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} 발매`;
};

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
  // v3.106: 트랙→앨범 역참조 필드 — 2026-08 실측 기준 서버 미제공(charts/tracks _serialize_track에 없음).
  // 백엔드가 album_id를 내려주면 handleTrackPress의 앨범 분기가 그대로 동작한다.
  album_id?: string;
  // v3.207 ②: 신곡 탭 발매일 footer용 — /tracks/?sort=created_at 응답에 포함(차트 탭엔 없어도 무해)
  created_at?: string;
}

type ChartTab = 'top100' | 'daily' | 'weekly' | 'monthly' | 'new' | 'queue';

// v3.207 ②: 신곡 포커스 — 신곡 탭을 맨 앞으로(기본 탭), TOP 100은 2번째로 존치
const TABS: { key: ChartTab; label: string; endpoint: string }[] = [
  { key: 'new', label: '신곡', endpoint: '/tracks/?sort=created_at&limit=100' },
  { key: 'top100', label: 'TOP 100', endpoint: '/charts/top100' },
  // v3.97(B-3): 일간 차트 — backend charts.py VALID_CHART_TYPES('daily') / MAIDOL ChartPage 탭과 동일 순서(일간→주간→월간)
  { key: 'daily', label: '일간', endpoint: '/charts/daily' },
  { key: 'weekly', label: '주간', endpoint: '/charts/weekly' },
  { key: 'monthly', label: '월간', endpoint: '/charts/monthly' },
  { key: 'queue', label: '내 재생목록', endpoint: '' }, // 로컬 큐(playerStore) — API 없음
];

const RANK_COLORS: Record<number, string> = {
  1: colors.accent.secondary,       // 금
  2: colors.text.secondary,         // 은(연보라)
  3: colors.accent.secondaryDim,    // 동
};

export default function ChartScreen() {
  // v3.73: 상단 공백 제거 — 고정 50 대신 기기 상태바 높이만큼만(웹 0)
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<ChartTab>('new'); // v3.207 ②: 기본 탭 = 신곡
  const [tracks, setTracks] = useState<ChartTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionTrack, setActionTrack] = useState<ChartTrack | null>(null); // ⋮ 오버플로 메뉴 대상
  const [latestAlbums, setLatestAlbums] = useState<Album[]>([]); // v3.96(A-20)→v3.106: 신곡 탭 상단 최신 앨범
  const likedMap = useLikesStore((s) => s.liked);
  const syncLikes = useLikesStore((s) => s.sync);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ChartTrack[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchSubmitted, setSearchSubmitted] = useState(false);
  const playerStore = usePlayerStore();
  // v3.213: 차트 탭 스트립 anchor — chipBar 컨테이너 전체 영역(가로 스크롤 무관)
  const chipBarRef = useRef<View>(null);
  useEffect(() => () => unregisterAnchor('chart-tabs'), []);

  const fetchChart = useCallback(async (tab: ChartTab) => {
    // '내 재생목록' 탭은 로컬 큐(playerStore)를 그대로 노출 — API 호출 없음
    if (tab === 'queue') {
      if (__DEV__) console.info('[ChartScreen] 내 재생목록 탭 — 로컬 큐 사용', { len: usePlayerStore.getState().queue.length });
      setLoading(false);
      return;
    }
    // v3.207 ②: 폴백 endpoint도 신곡 기준으로 통일 (기본 탭 전환과 정합)
    const endpoint = TABS.find((t) => t.key === tab)?.endpoint || '/tracks/?sort=created_at&limit=100';
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

  // v3.96(A-20)→v3.106: 최신 앨범 섹션을 신곡 탭으로 이동 — 실패해도 차트는 그대로(섹션만 미노출)
  const fetchLatestAlbums = useCallback(async () => {
    try {
      const list = await getLatestAlbums(10);
      if (__DEV__) console.info('[ChartScreen] 최신 앨범 로드', { count: list.length });
      setLatestAlbums(list);
    } catch (err: any) {
      console.error('[ChartScreen] 최신 앨범 로드 실패', { status: err?.response?.status });
      setLatestAlbums([]);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    fetchChart(activeTab);
    if (activeTab === 'new') fetchLatestAlbums(); // v3.106: 최신 앨범 섹션 = 신곡 탭
  }, [activeTab]));

  // 헤더는 App.tsx 탭 공통(tabHeader): 좌 로고 + 우 마이페이지(user) 아이콘.
  // 검색은 별도 '검색' 탭(SearchScreen)으로 이동 — 여기 상단 🔍 제거.

  const handleRefresh = () => {
    setRefreshing(true);
    fetchChart(activeTab);
    if (activeTab === 'new') fetchLatestAlbums(); // v3.106: 신곡 탭 새로고침 시 최신 앨범도 갱신
  };
  const handleTabPress = (tab: ChartTab) => { if (tab !== activeTab) setActiveTab(tab); };

  const requireLogin = (): boolean => {
    if (!user) {
      // 비로그인 → 로그인 화면으로 바로 이동 (시스템 Alert 다중버튼은 웹에서 미동작 → 반응 없음 버그)
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
    // v3.106: 앨범 소속 곡은 AlbumDetail로 보내 앨범의 다른 곡도 담아 듣게 한다 — 백엔드 준비 대기 골격.
    // TODO(백엔드 요청): 2026-08 실측 기준 트랙 응답(GET /api/charts/*, /api/tracks/*)에 album_id가 없고,
    //   GET /api/albums/ 에 track_id 조회 파라미터도 없어 트랙→앨범 역참조가 불가능하다.
    //   백엔드가 트랙 응답에 album_id(또는 GET /albums?track_id=)를 추가하면 아래 분기가 활성화된다.
    if (track.album_id) {
      if (__DEV__) console.info('[ChartScreen] [AlbumNav] 앨범 소속 곡 탭 → AlbumDetail', { trackId: track.id, albumId: track.album_id });
      // v3.220 ①: AlbumDetail = 탭 형제(숨김 탭) — from 명시로 origin 복귀(매 진입 전체 파라미터 전달)
      navigation.navigate('AlbumDetail', { albumId: String(track.album_id), from: 'Chart' });
      return;
    }
    // 곡 클릭 → 재생목록(큐)에 추가(중복 방지) 후 그 곡 재생
    playerStore.addToQueue(track);
    const q = usePlayerStore.getState().queue;
    const idx = q.findIndex((t: any) => String(t?.id) === String(track.id)); // v3.223 O-1 정규화(addToQueue와 동일 판정)
    playerStore.setCurrentIndex(idx >= 0 ? idx : q.length - 1);
    if (__DEV__) console.info('[ChartScreen] 곡 클릭 → 큐 추가+재생', { id: track.id, queueLen: q.length });
    navigation.navigate('Player', { track });
  };

  const handleSearchTrackPress = (track: ChartTrack) => {
    // v3.223 ①: 검색 결과 탭 = append(차트 곡 탭 :218-224 관행 1:1) — searchResults 통째
    // setQueue 교체 제거(로그인 재생목록 보존 — 교체는 플레이리스트 재생만).
    playerStore.addToQueue(track);
    const q = usePlayerStore.getState().queue;
    const idx = q.findIndex((t: any) => String(t?.id) === String(track.id)); // v3.223 O-1 정규화
    playerStore.setCurrentIndex(idx >= 0 ? idx : q.length - 1);
    if (__DEV__) console.info('[ChartScreen] 검색 곡 탭 → 큐 추가+재생', { id: track.id, queueLen: q.length });
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
          : <View style={styles.coverPlaceholder}><Feather name="music" size={20} color={colors.text.muted} /></View>}
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
      ? (index === playerStore.currentIndex
        ? <View style={[trackRowStyles.rank, { alignItems: 'center' }]}><Feather name="play" size={14} color={colors.accent.primary} /></View>
        : <AppText variant="bodyStrong" center style={trackRowStyles.rank} tone="muted">{rank}</AppText>)
      : <AppText variant="bodyStrong" center style={[trackRowStyles.rank, { color: rankColor }]}>{rank}</AppText>;

    // v3.207 ②: 신곡 탭 발매일 footer (created_at 상대 표기 — 필드 없으면 미표기)
    const releasedText = activeTab === 'new' ? formatReleasedAgo(item.created_at) : null;
    return (
      <TrackRow
        track={item}
        left={left}
        liked={!!likedMap[item.id]}
        onPress={() => handleTrackPress(item)}
        onMore={() => setActionTrack(item)}
        footer={releasedText
          ? <AppText variant="caption" tone="muted" style={styles.releasedFooter}>{releasedText}</AppText>
          : undefined}
        // v3.207 ①: 튜토리얼 '곡 담기' 스포트라이트 — 첫 행 ⋮만 anchor 등록
        moreAnchorKey={index === 0 ? 'chart-row-more' : undefined}
      />
    );
  };

  return (
    <ScreenLayout>
      {/* Spotify식 가로 칩 필터 — v3.213: 탭 스트립 전체가 튜토리얼 anchor */}
      <View
        ref={chipBarRef}
        collapsable={false}
        onLayout={() => measureAndRegister('chart-tabs', chipBarRef.current)}
        style={styles.chipBar}
      >
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
        // v3.96(A-20)→v3.106: 신곡 탭 상단 최신 앨범 가로 섹션 — 채널 앨범 카드와 동일 스타일
        const latestAlbumsHeader = (!isQueue && activeTab === 'new' && latestAlbums.length > 0) ? (
          <View style={styles.albumSection}>
            <AppText variant="footnote" tone="secondary" style={styles.albumSectionLabel}>최신 앨범</AppText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.albumScrollRow}>
              {latestAlbums.map((a) => (
                <TouchableOpacity
                  key={a.id} style={styles.albumCard} activeOpacity={0.75}
                  onPress={() => {
                    if (__DEV__) console.info('[ChartScreen] [AlbumNav] 최신 앨범 탭 → AlbumDetail', { albumId: a.id });
                    // v3.220 ①: 탭 형제 navigate — from 명시로 ← 복귀 지점 고정
                    navigation.navigate('AlbumDetail', { albumId: String(a.id), from: 'Chart' });
                  }}
                  accessibilityLabel={`앨범 ${a.title}`}
                >
                  <View style={styles.albumCover}>
                    {albumCoverUri(a.cover_image)
                      ? <Image source={{ uri: albumCoverUri(a.cover_image)! }} style={styles.albumCoverImg} />
                      : <Feather name="music" size={20} color={colors.text.muted} />}
                  </View>
                  <AppText variant="footnote" numberOfLines={1} style={{ marginTop: 6 }}>{a.title}</AppText>
                  <AppText variant="caption" tone="muted" numberOfLines={1}>
                    {[a.artist_name, `${a.track_count ?? 0}곡`].filter(Boolean).join(' · ')}
                  </AppText>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        ) : null;
        if (data.length > 0) {
          return (
            <>
              {/* 비회원 안내 — 게이트가 아니라 배너. 담은 곡은 그대로 보인다 */}
              {isQueue && !user ? (
                <TouchableOpacity style={styles.guestBanner} onPress={() => navigation.navigate('Settings')} activeOpacity={0.8}>
                  <AppText variant="caption" tone="secondary">
                    로그인하지 않으면 다음 접속 시 재생목록이 사라지고, 스타(⭐)도 쌓이지 않아요.
                    스타를 모으면 작업실에서 나만의 음악을 만들 수 있어요. <AppText variant="caption" tone="accent">로그인하기</AppText>
                  </AppText>
                </TouchableOpacity>
              ) : null}
              <FlatList
                data={data}
                keyExtractor={(item, i) => `${item.id}-${i}`}
                renderItem={renderTrack}
                ListHeaderComponent={latestAlbumsHeader}
                contentContainerStyle={{ paddingBottom: playerStore.track ? 140 : 80 }}
                refreshControl={isQueue ? undefined :
                  <RefreshControl refreshing={refreshing} onRefresh={handleRefresh}
                    tintColor={colors.accent.primary} colors={[colors.accent.primary]} />
                }
              />
            </>
          );
        }
        // v3.207 ②: 빈 상태 문구 — 기본 진입 탭(신곡) 기준 분기
        return isQueue
          ? <EmptyState title="재생목록이 비어있어요" hint="차트나 검색에서 곡을 재생하면 여기에 쌓여요" />
          : activeTab === 'new'
          ? <EmptyState icon={<Feather name="music" size={44} color={colors.text.muted} />} title="아직 신곡이 없습니다" hint="새 곡이 발매되면 여기에 가장 먼저 표시됩니다" />
          : <EmptyState icon={<Feather name="bar-chart-2" size={44} color={colors.text.muted} />} title="차트 데이터가 없습니다" hint="곡이 등록되면 차트가 표시됩니다" />;
      })()}

      {/* v3.63: 재생 중에도 항상 노출 — Fab이 스스로 미니플레이어 위로 올라감 */}
      <Fab onPress={() => navigation.navigate('MyMusic')} accessibilityLabel="곡 추가">
        <AppText variant="headline" tone="primary" style={styles.fabIcon}>+</AppText>
      </Fab>

      {/* 검색 모달 */}
      <Modal visible={showSearchModal} animationType="slide" onRequestClose={closeSearchModal}>
        <View style={[styles.searchModal, { paddingTop: insets.top }]}>
          <View style={styles.searchHeader}>
            <TouchableOpacity onPress={closeSearchModal} style={styles.searchBack}>
              <Feather name="arrow-left" size={22} color={colors.text.primary} />
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
                <Feather name="x" size={18} color={colors.text.secondary} />
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
              contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }} // v3.196: 마지막 행 제스처 바 가림 방지
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
            <EmptyState icon={<Feather name="search" size={44} color={colors.text.muted} />} title="검색 결과가 없습니다" hint="다른 검색어로 시도해보세요" />
          ) : (
            <EmptyState icon={<Feather name="music" size={44} color={colors.text.muted} />} title="곡을 검색해보세요" hint="제목, 아티스트, 태그로 검색 가능" />
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

      {/* v3.204 ⑥ → v3.213: 차트 튜토리얼(비로그인) + 상단바 튜토리얼(로그인) —
          게이트가 상호 배타라 한 화면에서 두 오버레이가 동시에 뜨는 경우는 없다 */}
      <TutorialOverlay screenKey="chart" steps={TUTORIAL_STEPS} enabled={!user} />
      <TutorialOverlay screenKey="topbar" steps={TOPBAR_TUTORIAL_STEPS} enabled={!!user} />
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  headerRight: { flexDirection: 'row', alignItems: 'center', marginRight: spacing.sm },
  headerBtn: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  chipBar: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle },
  chipRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  spinner: { marginTop: spacing.huge },
  // v3.96(A-20): 최신 앨범 섹션 — UserChannelScreen 앨범 카드와 동일 규격(120px)
  albumSection: {
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  albumSectionLabel: { fontWeight: '700', letterSpacing: 0.3, marginBottom: spacing.sm },
  albumScrollRow: { gap: spacing.md, paddingVertical: spacing.xs },
  albumCard: { width: 120 },
  albumCover: {
    width: 120, height: 120, borderRadius: radius.lg, overflow: 'hidden',
    backgroundColor: colors.bg.surface1, alignItems: 'center', justifyContent: 'center',
  },
  albumCoverImg: { width: '100%', height: '100%' },
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
  releasedFooter: { marginTop: 3 }, // v3.207 ②: 신곡 탭 발매일 footer
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
  fabIcon: { marginTop: -2 },
  // search modal
  searchModal: { flex: 1, backgroundColor: colors.bg.deepest },
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
  // v3.196: 미사용 playlist sheet 스타일 삭제(TrackActionSheet 공용화 후 잔존 죽은 코드)
});
