// [FeedScreen] 피드 타임라인 — /api/feeds/timeline (인스타형 혼합: is_public 최신 + 팔로잉 작성자 최상단).
// 비로그인은 피드 우선 노출 후, 스크롤/팔로워 클릭 시 로그인 CTA가 나타남(고정 아님).
import { useState, useCallback, useEffect, useRef } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { View, FlatList, ActivityIndicator, RefreshControl, TouchableOpacity, Image, Dimensions, StyleSheet, Linking } from 'react-native';
import { Feather } from '@expo/vector-icons';
import api, { BACKEND_BASE_URL } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { usePlayerStore } from '../stores/playerStore';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { AppText, Card, Avatar, EmptyState, ScreenLayout, Button } from '../components/ui';
import LoginPrompt from '../components/LoginPrompt';
import FeedCard, { feedTheme } from '../components/feed/FeedCard';
import FeedImageBlock, { feedImageUri } from '../components/feed/FeedImageBlock';
import { playTrackNow } from '../services/playback';
import Fab from '../components/Fab';
import TrackRow, { RowTrack } from '../components/TrackRow';
import TrackActionSheet from '../components/TrackActionSheet';
import TutorialOverlay, { TutorialStep } from '../components/TutorialOverlay';
import { useLikesStore } from '../stores/likesStore';
// v3.207 ①: 코치마크 anchor — 글쓰기 Fab 스포트라이트(비로그인·Fab 숨김 시 미등록 → 카드 fallback)
import { registerAnchor, unregisterAnchor } from '../utils/tutorialAnchors';

// v3.204 ⑥: 첫 방문 튜토리얼 스텝 (모듈 상수)
// v3.207 ①: '내 곡 공유' 스텝에 글쓰기 Fab anchor
const TUTORIAL_STEPS: TutorialStep[] = [
  { title: '소식 둘러보기', desc: '피드에서 다른 기획사와 아티스트의 새 소식을 볼 수 있어요.' },
  { title: '내 곡 공유', desc: '오른쪽 아래 버튼으로 내 곡과 소식을 피드에 올려보세요.', anchorKey: 'feed-compose' },
  { title: '반응하기', desc: '마음에 드는 소식에는 좋아요와 댓글로 반응할 수 있어요.' },
];

// Fab(components/Fab.tsx)의 고정 지름 — anchor rect를 아이콘 중심에서 버튼 크기로 확장할 때 사용
const FAB_SIZE = 56;

interface FeedTrack {
  id: string;
  title?: string;
  artist_name?: string;
  cover_image?: string;
  duration_sec?: number;
  play_count?: number;   // v3.69: timeline엔 없음 — /tracks/{id} 병합으로 보강
  like_count?: number;
}
interface FeedBlock {
  type: string; // 'text' | 'track' | 'image'(v3.111)
  text?: string;
  track_id?: string;
  track?: FeedTrack | null;
  object_name?: string; // image 블록 — MinIO 오브젝트명
  image_url?: string;   // image 블록 — 서버 하이드레이션 URL(상대/절대)
}
interface FeedPost {
  id?: string | number;
  author_id?: string;
  author_nickname?: string;
  author_name?: string;
  nickname?: string;
  title?: string;
  blocks?: FeedBlock[];
  like_count?: number;
  comment_count?: number;
  created_at?: string;
  is_public?: boolean; // v3.210 ①: 비공개 칩·공개 전환(내 글 탭은 비공개 포함 응답)
  kind?: string;       // 'feed' | 'community'
}

// v3.210 ①: 상단 세그먼트 탭 — [전체]=기존 timeline, [내 피드]/[내 공지]=/feeds/user/{me}?kind=
// (서버 v137: viewer==owner면 비공개 글 포함 — MyMusicScreen fetchFeeds와 동일 계약)
type FeedTab = 'all' | 'mine' | 'notice';
const FEED_TABS: { key: FeedTab; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'mine', label: '내 피드' },
  { key: 'notice', label: '내 공지' },
];

// v3.70: 착장 아이템 첨부(공구 광고) — 서버 블록 화이트리스트가 text|track뿐이라
// 텍스트 블록에 [item]{JSON} 마커로 실어 보낸다(작성 화면과 짝). 파싱 실패 시 일반 텍스트로 폴백.
interface FeedItemAttach { name?: string; category?: string; url?: string; img?: string }
const parseItemMarker = (text?: string): FeedItemAttach | null => {
  if (!text || !text.startsWith('[item]')) return null;
  try { return JSON.parse(text.slice(6)); } catch { return null; }
};

const coverUri = (img?: string): string | null =>
  img ? `${BACKEND_BASE_URL}/api/upload/cover-preview/${encodeURIComponent(img)}` : null;

const fmtDuration = (sec?: number): string => {
  if (!sec || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

export default function FeedScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuthStore();
  const playerStore = usePlayerStore();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // v3.210 ①: 세그먼트 탭 — 비로그인은 [전체]만(탭바 숨김)
  const [tab, setTab] = useState<FeedTab>('all');
  // 비로그인: 스크롤/팔로워 클릭 시 나타나는 로그인 CTA (고정 아님)
  const [ctaVisible, setCtaVisible] = useState(false);
  // v3.69: 트랙 스탯(재생수·좋아요) 병합 캐시 + ⋮ 액션시트 대상
  const [trackStats, setTrackStats] = useState<Record<string, { play_count?: number; like_count?: number }>>({});
  const [actionTrack, setActionTrack] = useState<RowTrack | null>(null);
  const likedMap = useLikesStore((s) => s.liked);
  const syncLikes = useLikesStore((s) => s.sync);
  const nowId = usePlayerStore((s) => s.track?.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  // v3.207 ①: 글쓰기 Fab anchor — Fab은 ref를 내주지 않으므로(공용 컴포넌트 불변) 내부 아이콘을
  // 측정해 버튼 지름(56)으로 확장 등록한다. Fab이 숨는 조건(미니플레이어 표시)과 비로그인 땐 해제.
  const fabIconRef = useRef<View>(null);
  const fabHidden = usePlayerStore((s) => !!(s.track && s.sound)); // components/Fab.tsx 숨김 조건과 동일
  const registerFabAnchor = useCallback(() => {
    try {
      (fabIconRef.current as any)?.measureInWindow?.((x: number, y: number, w: number, h: number) => {
        if (!(w > 0) || !(h > 0)) return;
        registerAnchor('feed-compose', {
          x: x + w / 2 - FAB_SIZE / 2,
          y: y + h / 2 - FAB_SIZE / 2,
          width: FAB_SIZE,
          height: FAB_SIZE,
        });
      });
    } catch (err: any) {
      console.error('[Tutorial] feed-compose anchor 측정 실패', { message: err?.message });
    }
  }, []);
  useEffect(() => {
    if (!user || fabHidden) unregisterAnchor('feed-compose');
    return () => unregisterAnchor('feed-compose');
  }, [user, fabHidden]);

  // v3.210 ①: 로그아웃 시 내 글 탭에 남지 않도록 [전체]로 복귀
  useEffect(() => {
    if (!user && tab !== 'all') setTab('all');
  }, [user, tab]);

  const fetchFeed = useCallback(async () => {
    // 피드는 비로그인도 우선 노출(공개 타임라인). 스크롤/클릭 시 로그인 CTA를 띄운다.
    // v3.210 ①: [내 피드]/[내 공지]는 /feeds/user/{me}?kind= (MyMusicScreen fetchFeeds와 동일 계약)
    if (__DEV__) console.info('[Feed] fetchFeed 호출', { tab });
    try {
      setLoading(true);
      const uid = useAuthStore.getState().user?.id;
      const res = tab !== 'all' && uid
        ? await api.get(`/feeds/user/${uid}`, { params: { kind: tab === 'notice' ? 'community' : 'feed', limit: 50 } })
        : await api.get('/feeds/timeline');
      const data: FeedPost[] = Array.isArray(res.data)
        ? res.data
        : (res.data?.feeds || res.data?.items || res.data?.posts || []);
      if (__DEV__) console.info('[Feed] fetchFeed 응답', { tab, count: data.length });
      setPosts(data);
      // v3.69: timeline엔 재생수·좋아요가 없어 고유 트랙(최대 20곡)의 상세를 병합
      const ids = [...new Set(data.flatMap((p) => (p.blocks || [])
        .filter((b) => b.type === 'track' && b.track?.id).map((b) => String(b.track!.id))))].slice(0, 20);
      if (ids.length) {
        if (__DEV__) console.info('[FeedScreen] 트랙 스탯 병합', { count: ids.length });
        if (useAuthStore.getState().user) syncLikes(ids);
        const results = await Promise.allSettled(ids.map((id) => api.get(`/tracks/${id}`)));
        const next: Record<string, { play_count?: number; like_count?: number }> = {};
        results.forEach((r, i) => {
          if (r.status === 'fulfilled') next[ids[i]] = { play_count: r.value.data?.play_count, like_count: r.value.data?.like_count };
        });
        setTrackStats((prev) => ({ ...prev, ...next }));
      }
    } catch (err: any) {
      console.error('[Feed] fetchFeed 실패', { tab, status: err?.response?.status });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tab]);

  useFocusEffect(useCallback(() => { fetchFeed(); }, [fetchFeed]));

  // 피드 전체의 트랙을 큐로 모아두고, 탭한 트랙부터 재생
  const allTracks = useCallback((): FeedTrack[] => {
    const out: FeedTrack[] = [];
    for (const p of posts) {
      for (const b of p.blocks || []) {
        if (b.type === 'track' && b.track?.id) out.push(b.track);
      }
    }
    return out;
  }, [posts]);

  // v3.69: 피드 내 재생 토글 — 현재 곡이면 일시정지/재개, 아니면 그 곡부터 재생(화면 유지)
  const handleTrackTap = async (track: FeedTrack) => {
    if (!track?.id) return;
    const s = usePlayerStore.getState();
    if (String(s.track?.id) === String(track.id) && s.sound) {
      if (__DEV__) console.info('[FeedScreen] 트랙 토글', { id: track.id, pause: s.isPlaying });
      try {
        if (s.isPlaying) { await s.sound.pauseAsync(); s.setIsPlaying(false); }
        else { await s.sound.playAsync(); s.setIsPlaying(true); }
      } catch (err: any) {
        console.error('[FeedScreen] 토글 실패', { id: track.id, message: err?.message });
      }
      return;
    }
    if (__DEV__) console.info('[FeedScreen] play track inline', { id: track.id });
    playTrackNow(track, allTracks());
  };

  const goLogin = () => navigation.navigate('Settings');

  // v3.69: 트랙 블록 = 차트와 동일한 공용 TrackRow(커버·재생수·좋아요·⋮) + 재생 상태 표시
  const renderTrackBlock = (track: FeedTrack, key: string) => {
    const stats = trackStats[String(track.id)] || {};
    const rowTrack: RowTrack = { ...track, ...stats } as RowTrack;
    const isCurrent = String(nowId) === String(track.id);
    return (
      <View key={key} style={styles.trackBlockWrap}>
        {/* v3.72: 재생 상태 표시는 커버 배지 하나로 통일(왼쪽 중복 아이콘 제거) */}
        <TrackRow
          track={rowTrack}
          liked={!!likedMap[String(track.id)]}
          playBadge={isCurrent && isPlaying ? 'pause' : 'play'}
          onPress={() => (user ? handleTrackTap(track) : setCtaVisible(true))}
          onMore={() => (user ? setActionTrack(rowTrack) : setCtaVisible(true))}
        />
      </View>
    );
  };

  // 인스타/페북식 카드(FeedCard) — 좋아요 토글·댓글/답글·공유·⋯메뉴 포함. 본문 블록 렌더는 기존 로직 재사용.
  const requireLogin = (): boolean => {
    if (!user) { setCtaVisible(true); return false; }
    return true;
  };

  // v3.70: [item] 마커 → 아이템 카드(공구 광고). 링크 있으면 '자세히 보기'로 이동.
  const renderItemBlock = (it: FeedItemAttach, key: string) => (
    <TouchableOpacity
      key={key}
      style={styles.itemCard}
      activeOpacity={it.url ? 0.7 : 1}
      accessibilityLabel={`아이템 ${it.name || ''}`}
      onPress={() => {
        if (!it.url) return;
        if (__DEV__) console.info('[FeedScreen] 아이템 링크 열기', { name: it.name });
        Linking.openURL(it.url).catch((err) => console.error('[FeedScreen] 아이템 링크 실패', { url: it.url, message: err?.message }));
      }}
    >
      {it.img
        ? <Image source={{ uri: `${BACKEND_BASE_URL}/api/character/preview/${it.img}` }} style={styles.itemImg} />
        : <View style={[styles.itemImg, styles.itemImgEmpty]}><Feather name="shopping-bag" size={18} color={feedTheme.sub} /></View>}
      <View style={{ flex: 1 }}>
        <AppText variant="caption" tone="accent">{it.category || '아이템'}</AppText>
        <AppText variant="footnote" numberOfLines={2} style={{ color: feedTheme.sub }}>{it.name || ''}</AppText>
      </View>
      {it.url ? (
        <View style={styles.itemLink}>
          <AppText variant="caption" tone="accent">자세히 보기</AppText>
          <Feather name="external-link" size={12} color={colors.accent.primary} />
        </View>
      ) : null}
    </TouchableOpacity>
  );

  const renderPost = ({ item }: { item: FeedPost }) => {
    const author = item.author_nickname || item.author_name || item.nickname || '익명';
    const blocks = item.blocks || [];
    const rawText = blocks.filter((b) => b.type === 'text' && b.text);
    const textBlocks = rawText.filter((b) => !parseItemMarker(b.text));
    const itemBlocks = rawText.map((b) => parseItemMarker(b.text)).filter(Boolean) as FeedItemAttach[];
    const trackBlocks = blocks.filter((b) => b.type === 'track' && b.track?.id);
    // v3.111: 이미지 블록 — 가로폭 맞춤·비율 유지, 다중은 세로 나열
    const imageBlocks = blocks.filter((b) => b.type === 'image' && (b.image_url || b.object_name));
    return (
      <FeedCard
        feed={item}
        requireLogin={requireLogin}
        onPressAuthor={() => {
          if (!user) { setCtaVisible(true); return; }
          if (item.author_id) navigation.navigate('UserChannel', { authorId: item.author_id, name: author });
        }}
        onDeleted={() => fetchFeed()}
        // v3.210 ①: 공개 전환 후 목록 갱신([전체] 탭에서 비공개 전환 시 타임라인에서 빠짐)
        onUpdated={() => fetchFeed()}
        renderBlocks={() => (
          <View>
            {textBlocks.map((b, i) => (
              <AppText key={`t${i}`} variant="body" style={[styles.body, { color: feedTheme.sub }]}>{b.text}</AppText>
            ))}
            {imageBlocks.map((b, i) => {
              const uri = feedImageUri(b);
              return uri ? <FeedImageBlock key={`im${i}`} uri={uri} /> : null;
            })}
            {trackBlocks.map((b, i) => renderTrackBlock(b.track as FeedTrack, `tr${i}`))}
            {itemBlocks.map((it, i) => renderItemBlock(it, `it${i}`))}
          </View>
        )}
      />
    );
  };

  return (
    <ScreenLayout>
      {/* v3.210 ①: 세그먼트 탭 — MyMusicScreen tabBar 스타일 재사용. 비로그인은 [전체]만이라 탭바 숨김 */}
      {user ? (
        <View style={styles.tabBar}>
          {FEED_TABS.map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[styles.tab, tab === t.key && styles.tabActive]}
              onPress={() => {
                if (tab === t.key) return;
                if (__DEV__) console.info('[Feed] 탭 전환', { tab: t.key });
                setPosts([]);
                setTab(t.key);
              }}
              accessibilityLabel={`피드 탭 ${t.label}`}
            >
              <AppText style={[styles.tabText, tab === t.key && styles.tabTextActive]} numberOfLines={1}>{t.label}</AppText>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
      {loading && posts.length === 0 ? (
        <ActivityIndicator size="large" color={colors.accent.primary} style={styles.spinner} />
      ) : posts.length > 0 ? (
        <FlatList
          automaticallyAdjustKeyboardInsets
          keyboardShouldPersistTaps="handled"
          data={posts}
          keyExtractor={(it, i) => String(it.id ?? i)}
          renderItem={renderPost}
          // 비로그인: 글이 적어도 스크롤이 가능하도록 최소 높이 확보(스크롤 시 CTA 트리거)
          contentContainerStyle={[styles.list, !user && { minHeight: Dimensions.get('window').height + 140 }]}
          scrollEventThrottle={16}
          onScrollBeginDrag={() => { if (!user) setCtaVisible(true); }}
          onScroll={(e) => {
            // 비로그인: 스크롤 동작이 발생하면 로그인 CTA를 띄운다
            if (!user && !ctaVisible && e.nativeEvent.contentOffset.y > 10) {
              if (__DEV__) console.info('[FeedScreen] 스크롤 감지 → 로그인 CTA');
              setCtaVisible(true);
            }
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); fetchFeed(); }}
              tintColor={colors.accent.primary}
            />
          }
        />
      ) : !user ? (
        <View style={{ flex: 1 }} />
      ) : tab === 'mine' ? (
        // v3.210 ①: 내 글 탭 빈 상태 — MyMusicScreen 피드/커뮤니티 탭 문구 관행
        <EmptyState
          icon={<Feather name="edit-3" size={44} color={colors.text.muted} />}
          title="아직 작성한 피드가 없어요"
          hint="오른쪽 아래 버튼으로 내 곡과 소식을 알려보세요!"
        />
      ) : tab === 'notice' ? (
        <EmptyState
          icon={<Feather name="bell" size={44} color={colors.text.muted} />}
          title="아직 작성한 공지가 없어요"
          hint="오른쪽 아래 버튼으로 구독자에게 소식을 전해보세요!"
        />
      ) : (
        <EmptyState
          icon={<Feather name="users" size={44} color={colors.text.muted} />}
          title="아직 소식이 없어요"
          hint="마음에 드는 아티스트를 팔로우하면 소식이 여기 가장 먼저 떠요."
          action={<Button label="아티스트 둘러보기" onPress={() => navigation.navigate('Chart')} />}
        />
      )}

      {/* v3.69: ⋮ 액션 시트 — 차트와 동일(재생/좋아요/재생목록/플레이리스트) */}
      <TrackActionSheet
        track={actionTrack}
        onClose={() => setActionTrack(null)}
        onPlay={(t) => handleTrackTap(t as FeedTrack)}
        onLikeChanged={(trackId, delta) => setTrackStats((prev) => ({
          ...prev,
          [trackId]: { ...prev[trackId], like_count: Math.max(0, (prev[trackId]?.like_count ?? 0) + delta) },
        }))}
      />

      {/* v3.62 공용 Fab → v3.63: 재생 중에도 항상 노출(미니플레이어 위로 자동 상승) */}
      {/* v3.210 ①: [내 공지] 탭에서는 kind='community'로 작성 진입(MyMusicScreen 새 공지 작성 관행) */}
      {user ? (
        <Fab
          onPress={() => {
            const kind = tab === 'notice' ? 'community' : 'feed';
            if (__DEV__) console.info('[Feed] 작성 진입', { kind });
            navigation.navigate('FeedCompose', kind === 'community' ? { kind } : undefined);
          }}
          accessibilityLabel={tab === 'notice' ? '공지 작성' : '피드 작성'}
        >
          {/* v3.207 ①: 튜토리얼 anchor 측정용 래퍼 — collapsable={false}로 네이티브 뷰 보존 */}
          <View ref={fabIconRef} collapsable={false} onLayout={registerFabAnchor}>
            <Feather name="edit-3" size={22} color="#fff" />
          </View>
        </Fab>
      ) : null}

      {/* 비로그인: 스크롤/팔로워 클릭 시 뜨는 전체화면 로그인 오버레이 (작업실과 동일 — 까만 반투명 배경 + 중앙 텍스트) */}
      {!user && ctaVisible ? (
        <TouchableOpacity
          style={styles.loginOverlay}
          activeOpacity={1}
          onPress={() => setCtaVisible(false)}
        >
          <LoginPrompt
            desc={'로그인하면 팔로우한 아티스트와\n다른 사람들의 소식을 볼 수 있어요'}
            onPress={goLogin}
          />
        </TouchableOpacity>
      ) : null}

      {/* v3.204 ⑥: 첫 방문 튜토리얼 */}
      <TutorialOverlay screenKey="feed" steps={TUTORIAL_STEPS} />
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  spinner: { marginTop: spacing.huge },
  // v3.210 ①: 세그먼트 탭 — MyMusicScreen tabBar 관행(하단 보더 + 액센트 언더라인)
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.bg.surface1,
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
  // v3.49: 가로 패딩 16→12 + FeedCard 자체 margin 제거 — 카드가 화면을 거의 꽉 채우도록(이중 여백 해소)
  list: { paddingVertical: spacing.lg, paddingHorizontal: spacing.md, paddingBottom: 100 },
  card: { marginBottom: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center' },
  headText: { marginLeft: spacing.md, flex: 1 },
  title: { marginTop: spacing.md },
  body: { marginTop: spacing.sm },
  // v3.69: 트랙 블록 래퍼 — 카드 안 인셋 배경 위에 공용 TrackRow를 얹는다
  trackBlockWrap: {
    marginTop: spacing.md, backgroundColor: feedTheme.field,
    borderRadius: radius.lg, overflow: 'hidden',
  },
  // v3.70: 착장 아이템 카드(공구 광고) — 트랙 블록과 같은 인셋 배경
  itemCard: {
    marginTop: spacing.md, backgroundColor: feedTheme.field,
    borderRadius: radius.lg, flexDirection: 'row', alignItems: 'center',
    gap: spacing.md, padding: spacing.md,
  },
  itemImg: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.06)' },
  itemImgEmpty: { alignItems: 'center', justifyContent: 'center' },
  itemLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  footer: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.md },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  // 작업실(MapScreen) 로그인 오버레이와 동일 스펙 — 까만 반투명 전체화면 + 중앙 텍스트
  loginOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loginOverlayContent: { alignItems: 'center', paddingHorizontal: 40 },
  loginOverlayIcon: { fontSize: 48, marginBottom: 16 },
  loginOverlayTitle: { fontSize: 20, fontWeight: 'bold', color: colors.text.primary, marginBottom: 12 },
  loginOverlayDesc: { fontSize: 15, color: colors.text.secondary, textAlign: 'center', lineHeight: 24, marginBottom: 28 },
  loginOverlayButton: { backgroundColor: colors.accent.primary, borderRadius: 24, paddingVertical: 14, paddingHorizontal: 40 },
  loginOverlayButtonText: { color: colors.text.primary, fontSize: 16, fontWeight: 'bold' },
});
