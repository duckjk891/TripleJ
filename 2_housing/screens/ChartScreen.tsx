// [ChartScreen] Wave 0 리스킨 — 공용 컴포넌트(ui/) + 디자인 토큰만 사용. 기능/데이터 흐름 불변.
// 디자인: Spotify식 가로 칩 필터 + Material 3 리스트/카드 + PANN 황혼 토큰.
import { useState, useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  StyleSheet, View, FlatList, TouchableOpacity, Image, ActivityIndicator,
  RefreshControl, ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import api from '../services/api';
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
import { showAlert } from '../utils/appAlert';
import { chartCriteriaText, isChartCriteriaTab } from '../utils/chartCriteria';
// v3.260 [MakeLike]: '이 곡 느낌으로 만들기' 차트 노출 — ⋯시트 항목과 같은 공용 흐름(utils/makeLike) 재사용
import { startMakeLikeFlow } from '../utils/makeLike';

// v3.204 ⑥ → v3.213: 사용자 확정 문안 2스텝 — 비로그인 시에만 노출(enabled=!user)
const TUTORIAL_STEPS: TutorialStep[] = [
  { title: '신곡·차트 탭', desc: '최신 발매된 곡이나 인기곡을 탭하여 확인해보세요.', anchorKey: 'chart-tabs' },
  { title: '곡 더보기', desc: '클릭하여 재생목록에 추가하거나 플레이리스트에 담아보세요.', anchorKey: 'chart-row-more' },
  // v3.274 [41]: 등급 설명 — anchor 없는 카드형(첫 접속 1회, 피드백3 요청 문안)
  { title: '아티스트 등급', desc: '아티스트는 연습생 → 신인 → 루키 → 라이징 → 아이돌 순으로 성장해요.\n각 등급 안에서는 5단계에서 시작해 1단계가 정점이에요. (예: 연습생 5 → 연습생 1 → 신인 5)' },
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
  // v3.274 [41]: 등급 설명 — 로그인 첫 진입 사용자도 동일 안내(카드형)
  { title: '아티스트 등급', desc: '아티스트는 연습생 → 신인 → 루키 → 라이징 → 아이돌 순으로 성장해요.\n각 등급 안에서는 5단계에서 시작해 1단계가 정점이에요. (예: 연습생 5 → 연습생 1 → 신인 5)' },
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
  // v3.243 Phase1a: 휴면 검색 모달 상태 제거 — 검색은 상단 검색바 → 숨김 'Search' 탭(SearchScreen)으로 일원화
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
    // v3.267 [추천 이어듣기](대표 지시 + 피드백2 [34]): 차트에서 곡을 "직접 고른" 순간은
    // 그 곡 중심의 감상 시작 — ① 잔존 셔플 해제(다음 곡이 랜덤으로 튀던 [34] 근본 원인),
    // ② 관련곡 5곡을 선택곡 바로 뒤에 삽입해 다음 곡부터 추천이 흐르게 한다.
    // 큐 소진 시엔 기존 v3.91 이어듣기(1곡씩)가 체인을 계속 잇는다. 실패 무해(fire-and-forget).
    if (usePlayerStore.getState().shuffle) {
      usePlayerStore.getState().toggleShuffle();
      if (__DEV__) console.info('[ChartScreen] [추천] 잔존 셔플 해제 — 선택곡 기준 추천 순차 재생');
    }
    seedRelatedIntoQueue(track);
    navigation.navigate('Player', { track });
  };

  // v3.267 [추천 이어듣기]: 선택곡 관련곡을 큐의 선택곡 뒤에 심는다(무인증 API·중복 자동 제거).
  const seedRelatedIntoQueue = async (track: ChartTrack) => {
    try {
      const st = usePlayerStore.getState();
      // v3.271 [RelatedVariety]: 큐 + 최근 재생 이력 합산 exclude
      const excludeIds = Array.from(new Set([
        ...st.queue.map((t: any) => String(t?.id)).filter(Boolean),
        ...((st.recentlyPlayedIds as string[]) || []),
      ]));
      const res = await api.get(`/tracks/${track.id}/related`, {
        params: { limit: 5, exclude: excludeIds.join(',') },
      });
      const rel: any[] = Array.isArray(res.data?.tracks) ? res.data.tracks : [];
      if (!rel.length) {
        if (__DEV__) console.info('[ChartScreen] [추천] 관련곡 없음', { id: track.id });
        return;
      }
      const now = usePlayerStore.getState();
      const anchor = now.queue.findIndex((t: any) => String(t?.id) === String(track.id));
      const inserted = now.insertIntoQueueAfter(anchor, rel);
      console.info('[ChartScreen] [추천] 관련곡 삽입', {
        id: track.id, source: res.data?.source, fetched: rel.length, inserted,
      });
    } catch (err: any) {
      console.error('[ChartScreen] [추천] 관련곡 조회 실패(무해)', { id: track.id, status: err?.response?.status });
    }
  };

  // v3.260 [MakeLike]: 차트 행 인라인 칩 탭 — CEO "점 세개 말고 차트에 보였으면".
  // 로그인 게이트는 시트 관행과 동일(호출측 담당), 이후 흐름은 startMakeLikeFlow 공용(중복 구현 금지).
  const handleMakeLike = (track: ChartTrack) => {
    if (!requireLogin()) return;
    if (__DEV__) console.info('[MakeLike] 차트 행 칩 탭', { id: track.id, tab: activeTab });
    startMakeLikeFlow(navigation, track);
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

    // v3.260 [MakeLike]: 차트 메인 리스트(신곡·TOP100·일간·주간·월간) 행에만 인라인 칩 노출 —
    // '내 재생목록' 탭·미니 차트 변형·앨범 섹션은 미적용(범위 한정). 행 우측(통계+⋮)은 공용 TrackRow
    // 소관이라 footer 슬롯에 배치 — 행 탭(재생)과 터치 영역이 겹치지 않고 hitSlop만 소폭 확장.
    const makeLikeChip = activeTab !== 'queue' ? (
      <TouchableOpacity
        style={styles.makeLikeChip}
        onPress={() => handleMakeLike(item)}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        accessibilityRole="button"
        accessibilityLabel={`'${item.title}' 느낌으로 만들기`}
      >
        <Feather name="feather" size={13} color={colors.accent.primary} />
        <AppText variant="caption" tone="secondary">이 곡 느낌</AppText>
      </TouchableOpacity>
    ) : null;
    const footer = makeLikeChip ? (
      <View style={styles.footerRow}>
        {makeLikeChip}
        {releasedText ? <AppText variant="caption" tone="muted">{releasedText}</AppText> : null}
      </View>
    ) : (releasedText
      ? <AppText variant="caption" tone="muted" style={styles.releasedFooter}>{releasedText}</AppText>
      : undefined);
    return (
      <TrackRow
        track={item}
        left={left}
        liked={!!likedMap[item.id]}
        onPress={() => handleTrackPress(item)}
        onMore={() => setActionTrack(item)}
        footer={footer}
        // v3.207 ①: 튜토리얼 '곡 담기' 스포트라이트 — 첫 행 ⋮만 anchor 등록
        moreAnchorKey={index === 0 ? 'chart-row-more' : undefined}
      />
    );
  };

  return (
    <ScreenLayout>
      {/* v3.243 Phase1a: 차트 상단 고정 검색 진입 — 검색 탭이 커뮤니티로 바뀌면서
          검색은 이 바 → 숨김 'Search' 탭(SearchScreen — 비로그인 게이트·느낌칩은 화면 내부 소관) */}
      <TouchableOpacity
        style={styles.searchEntry}
        activeOpacity={0.7}
        onPress={() => {
          if (__DEV__) console.info('[ChartScreen] 상단 검색바 탭 → Search(숨김 탭) 이동');
          navigation.navigate('Search');
        }}
        accessibilityRole="button"
        accessibilityLabel="곡·아티스트 검색"
      >
        <Feather name="search" size={16} color={colors.text.muted} />
        <AppText variant="body" tone="muted">곡·아티스트 검색</AppText>
      </TouchableOpacity>

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

      {/* v3.230 A6: 차트 기준 안내(TOP100·일간·주간·월간) — 앱 내 팝업 */}
      {isChartCriteriaTab(activeTab) ? (
        <View style={styles.criteriaBar}>
          <TouchableOpacity
            style={styles.criteriaBtn}
            onPress={() => {
              console.info('[Chart] 차트 기준 안내 열기', { tab: activeTab });
              const { title, message } = chartCriteriaText(activeTab);
              showAlert(title, message);
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="차트 기준 안내"
          >
            <Feather name="info" size={13} color={colors.text.muted} />
            <AppText variant="caption" tone="muted">차트 기준</AppText>
          </TouchableOpacity>
        </View>
      ) : null}

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
  // v3.230 A6: 차트 기준 안내 진입(우측 작은 텍스트 버튼)
  criteriaBar: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  criteriaBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2 },
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
  releasedFooter: { marginTop: 3 }, // v3.207 ②: 신곡 탭 발매일 footer
  // v3.260 [MakeLike]: 차트 행 인라인 칩 — criteriaBtn(Feather 13 + caption) 소형 텍스트 버튼 규격 준수,
  // 배경 pill 로 탭 가능함을 시각화. 발매일 footer(신곡 탭)와 한 줄 병치.
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  makeLikeChip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill,
    backgroundColor: colors.bg.surface1,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border.subtle,
  },
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
  // v3.243 Phase1a: 검색 모달 스타일 삭제(휴면 죽은 코드 — 검색은 숨김 'Search' 탭으로 일원화)
  // v3.243 Phase1a: 차트 상단 고정 검색 진입 바 — 비활성 검색 인풋 모양(탭 시 Search 탭 이동)
  searchEntry: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.lg, marginTop: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    backgroundColor: colors.bg.surface1, borderRadius: radius.md,
  },
  // v3.196: 미사용 playlist sheet 스타일 삭제(TrackActionSheet 공용화 후 잔존 죽은 코드)
});
