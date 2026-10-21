// [FeedScreen] 일기장(v3.389 — 피드 탭을 싸이월드식 일기장으로, 대표 확정 10-21).
// [전체] /api/feeds/timeline · [내 일기] /api/feeds/diary/month 달력 · [공지] /api/feeds/notices(그대로).
// 비로그인은 [전체]·[공지] 우선 노출 후, 스크롤/팔로워 클릭 시 로그인 CTA가 나타남(고정 아님).
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
import { useIsChild, useKidsPermission } from '../utils/kidsMode';
import DiaryCalendar from '../components/diary/DiaryCalendar'; // v3.389 [Diary]
import { DIARY_REWARD, DIARY_MIN_CHARS, kstToday, shiftMonth, fmtDiaryDateLong, backdateOptions } from '../utils/diary';

// v3.204 ⑥ → v3.213: 사용자 확정 문안 1스텝(Fab) — 로그인 시에만 노출(enabled=!!user)
// v3.389 [Diary]: 일기장 문구
const TUTORIAL_STEPS: TutorialStep[] = [
  { title: '일기 쓰기', desc: '눌러서 오늘의 일기를 써 보세요. 50자 이상 쓰면 하루 한 번 별을 받아요. 다른 사람들의 일기와 공지도 볼 수 있어요.', anchorKey: 'feed-compose' },
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
  diary_date?: string; // v3.389 [Diary] 'YYYY-MM-DD'
  mood?: string | null;
  visibility?: string;
}

// v3.389 [Diary] GET /feeds/diary/month 응답
interface DiaryMonth {
  month: string;
  today: string;
  days: Record<string, { count: number; mood?: string | null }>;
  streak: number;
  stars_this_month: number;
}

// v3.210 ①: 상단 세그먼트 탭 → v3.307(대표 10-08) [전체]·[내 글]·[공지]
//  [전체] = 공식 계정 제외 사용자 피드·공지(timeline?exclude_official=true)
//  [내 글] = 내 피드+내 공지(/feeds/user/{me}?kind=all — 비공개 포함)
//  [공지] = maidol_official 공식 계정 글(/feeds/notices) — 비로그인도 열람
type FeedTab = 'all' | 'mine' | 'notice';
// v3.389 [Diary]: [내 글] → [내 일기](달력). 채널 공지(kind=community)는 마이페이지에서 그대로(대표 결정 ③A)
const FEED_TABS: { key: FeedTab; label: string; guest: boolean }[] = [
  { key: 'all', label: '전체', guest: true },
  { key: 'mine', label: '내 일기', guest: false },
  { key: 'notice', label: '공지', guest: true },
];

// v3.70: 착장 아이템 첨부(공구 광고) — 서버 블록 화이트리스트가 text|track뿐이라
// 텍스트 블록에 [item]{JSON} 마커로 실어 보낸다(작성 화면과 짝). 파싱 실패 시 일반 텍스트로 폴백.
interface FeedItemAttach { name?: string; category?: string; url?: string; img?: string }
const parseItemMarker = (text?: string): FeedItemAttach | null => {
  if (!text || !text.startsWith('[item]')) return null;
  try { return JSON.parse(text.slice(6)); } catch { return null; }
};

const coverUri = (img?: string): string | null =>
  img ? `${BACKEND_BASE_URL}/api/upload/cover-preview/${encodeURIComponent(img)}?w=320` : null;

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
  // v3.232 K8(B4·D2): 어린이 — 보호자 허용 없으면 글쓰기 진입 숨김, 아이템 카드 구매 링크 비활성. 성인·age_group 없음 = false
  const isChild = useIsChild();
  const canFeedWrite = useKidsPermission('feed_write');
  const feedWriteBlocked = isChild && !canFeedWrite;
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // v3.210 ①: 세그먼트 탭 — 비로그인은 [전체]만(탭바 숨김)
  const [tab, setTab] = useState<FeedTab>('all');
  // v3.307: 공식 계정 id(공지 응답 동봉) — 공식 계정으로 로그인했을 때만 [공지] 탭 작성 버튼
  const [officialId, setOfficialId] = useState<string | null>(null);
  const isOfficial = !!user && !!officialId && String(user.id) === officialId;
  // 비로그인: 스크롤/팔로워 클릭 시 나타나는 로그인 CTA (고정 아님)
  const [ctaVisible, setCtaVisible] = useState(false);
  // v3.389 [Diary]: 오늘 보상 상태(null = 모름/구서버 → 안내 띠 숨김) · [내 일기] 달력
  const [rewardedToday, setRewardedToday] = useState<boolean | null>(null);
  const [month, setMonth] = useState<string>(() => kstToday().slice(0, 7));
  const [monthData, setMonthData] = useState<DiaryMonth | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
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
    if (!user || fabHidden || feedWriteBlocked) unregisterAnchor('feed-compose');
    return () => unregisterAnchor('feed-compose');
  }, [user, fabHidden, feedWriteBlocked]);

  // v3.210 ①: 로그아웃 시 내 글 탭에 남지 않도록 [전체]로 복귀
  useEffect(() => {
    if (!user && tab === 'mine') setTab('all');
  }, [user, tab]);

  const fetchFeed = useCallback(async () => {
    // 피드는 비로그인도 우선 노출(공개 타임라인). 스크롤/클릭 시 로그인 CTA를 띄운다.
    // v3.210 ①: [내 피드]/[내 공지]는 /feeds/user/{me}?kind= (MyMusicScreen fetchFeeds와 동일 계약)
    if (__DEV__) console.info('[Feed] fetchFeed 호출', { tab });
    try {
      setLoading(true);
      const uid = useAuthStore.getState().user?.id;
      // v3.389 [Diary]: 오늘 보상 상태 — 실패(구서버 404 등)면 안내 띠 숨김
      if (uid && tab !== 'notice') {
        api.get('/feeds/diary/status')
          .then((r) => setRewardedToday(!!r.data?.rewarded_today))
          .catch(() => setRewardedToday(null));
      }
      let data: FeedPost[] | null = null;
      if (tab === 'mine' && uid) {
        // v3.389 [Diary]: [내 일기] = 한 달 달력. 구서버(엔드포인트 없음)는 예전 내 글 목록으로 폴백
        try {
          const mres = await api.get('/feeds/diary/month', { params: { month } });
          const md = mres.data as DiaryMonth & { feeds?: FeedPost[] };
          setMonthData(md);
          data = md.feeds || [];
          if (__DEV__) console.info('[Diary] 달력 응답', { month, feeds: data.length, streak: md.streak });
        } catch (err: any) {
          console.error('[Diary] 달력 조회 실패 → 목록 폴백', { month, status: err?.response?.status });
          setMonthData(null);
        }
      }
      if (data === null) {
        const res = tab === 'mine' && uid
          ? await api.get(`/feeds/user/${uid}`, { params: { kind: 'feed', limit: 50 } })
          : tab === 'notice'
          ? await api.get('/feeds/notices', { params: { limit: 50 } })
          : await api.get('/feeds/timeline', { params: { exclude_official: true, limit: 30 } });
        if (tab === 'notice' && res.data?.official_id) setOfficialId(String(res.data.official_id));
        data = Array.isArray(res.data)
          ? res.data
          : (res.data?.feeds || res.data?.items || res.data?.posts || []);
      }
      if (!data) data = [];
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
  }, [tab, month]);

  useFocusEffect(useCallback(() => { fetchFeed(); }, [fetchFeed]));

  // v3.389 [Diary]: [내 일기] 선택한 날의 일기만(선택 없으면 그 달 전체)
  const visiblePosts = tab === 'mine' && monthData && selectedDay
    ? posts.filter((p) => p.diary_date === selectedDay)
    : posts;
  const canWriteOn = (ymd: string | null) => !!ymd && backdateOptions().some((o) => o.ymd === ymd);
  const openCompose = (diaryDate?: string) => {
    if (__DEV__) console.info('[Diary] 쓰기 진입', { diaryDate });
    navigation.navigate('FeedCompose', diaryDate && diaryDate !== kstToday() ? { diaryDate } : undefined);
  };

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
    // v3.223 ①: 곡 단위 탭 = append(기본) — 화면 리스트로 큐를 교체하지 않는다(재생목록 보존)
    playTrackNow(track);
  };

  const goLogin = () => navigation.navigate('Settings');

  // v3.69: 트랙 블록 = 차트와 동일한 공용 TrackRow(커버·재생수·좋아요·⋮) + 재생 상태 표시
  const renderTrackBlock = (track: FeedTrack, key: string, bgmLabel = false) => {
    const stats = trackStats[String(track.id)] || {};
    const rowTrack: RowTrack = { ...track, ...stats } as RowTrack;
    const isCurrent = String(nowId) === String(track.id);
    return (
      <View key={key} style={styles.trackBlockWrap}>
        {/* v3.389 [Diary]: 일기에 붙인 곡 = 오늘의 BGM */}
        {bgmLabel ? <AppText variant="caption" style={styles.bgmLabel}>오늘의 BGM</AppText> : null}
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
  // v3.232 K8(D2): 어린이는 링크 없는 카드처럼(탭 무반응·'자세히 보기' 숨김) — 카드·이미지는 유지
  const renderItemBlock = (it: FeedItemAttach, key: string) => (
    <TouchableOpacity
      key={key}
      style={styles.itemCard}
      activeOpacity={it.url && !isChild ? 0.7 : 1}
      accessibilityLabel={`아이템 ${it.name || ''}`}
      onPress={() => {
        if (!it.url || isChild) return;
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
      {it.url && !isChild ? (
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
    // v3.389 [Diary]: 일기(kind='feed', 서버가 diary_date 내려줄 때) — 글은 공책 종이, 곡은 '오늘의 BGM'
    const isDiary = tab !== 'notice' && (item.kind || 'feed') === 'feed' && !!item.diary_date;
    return (
      <FeedCard
        feed={item}
        hideDiaryHead={tab === 'notice'}
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
            {isDiary && textBlocks.length ? (
              <View style={styles.paper}>
                {textBlocks.map((b, i) => (
                  <AppText key={`t${i}`} variant="body" style={styles.paperText}>{b.text}</AppText>
                ))}
              </View>
            ) : textBlocks.map((b, i) => (
              <AppText key={`t${i}`} variant="body" style={[styles.body, { color: feedTheme.sub }]}>{b.text}</AppText>
            ))}
            {imageBlocks.map((b, i) => {
              const uri = feedImageUri(b);
              return uri ? <FeedImageBlock key={`im${i}`} uri={uri} /> : null;
            })}
            {trackBlocks.map((b, i) => renderTrackBlock(b.track as FeedTrack, `tr${i}`, isDiary && i === 0))}
            {itemBlocks.map((it, i) => renderItemBlock(it, `it${i}`))}
          </View>
        )}
      />
    );
  };

  // v3.389 [Diary]: 목록 머리 — 오늘 보상 안내 띠([전체]·[내 일기]) + [내 일기] 달력·날짜 제목
  const showReward = !!user && !feedWriteBlocked && tab !== 'notice' && rewardedToday !== null;
  const mineCount = visiblePosts.length;
  const listHeader = showReward || (tab === 'mine' && monthData) ? (
    <View style={styles.listHeader}>
      {showReward ? (
        rewardedToday ? (
          <View style={[styles.reward, styles.rewardDone]}>
            <AppText variant="footnote" tone="secondary" style={{ flex: 1 }}>오늘 일기 별 ⭐{DIARY_REWARD}을 받았어요. 내일 또 써 주세요!</AppText>
          </View>
        ) : (
          <TouchableOpacity style={styles.reward} activeOpacity={0.8} onPress={() => openCompose()} accessibilityLabel="오늘 일기 쓰기">
            <View style={{ flex: 1 }}>
              <AppText variant="footnote" tone="secondary">오늘 일기 쓰면 <AppText variant="footnote" style={styles.rewardStar}>+{DIARY_REWARD}⭐</AppText></AppText>
              <AppText variant="caption" tone="muted">{DIARY_MIN_CHARS}자 이상이면 받아요</AppText>
            </View>
            <View style={styles.rewardBtn}><AppText variant="caption" style={{ color: '#fff', fontWeight: '700' }}>쓰러 가기</AppText></View>
          </TouchableOpacity>
        )
      ) : null}
      {tab === 'mine' && monthData ? (
        <>
          <DiaryCalendar
            month={month}
            today={monthData.today || kstToday()}
            days={monthData.days || {}}
            selected={selectedDay}
            streak={monthData.streak || 0}
            stars={monthData.stars_this_month || 0}
            nickname={user?.nickname}
            avatarUri={user?.profile_image ? `${BACKEND_BASE_URL}/api/auth/profile-image/${user.profile_image}` : null}
            onSelect={(ymd) => setSelectedDay((prev) => (prev === ymd ? null : ymd))}
            onMonthChange={(delta) => { setSelectedDay(null); setPosts([]); setMonth((m) => shiftMonth(m, delta)); }}
          />
          <View style={styles.dayHead}>
            <AppText variant="bodyStrong">{selectedDay ? `${fmtDiaryDateLong(selectedDay)} 일기` : `이번 달 일기 ${mineCount}편`}</AppText>
            {selectedDay ? (
              <TouchableOpacity onPress={() => setSelectedDay(null)} accessibilityLabel="이번 달 전체 보기">
                <AppText variant="footnote" tone="accent">이번 달 전체</AppText>
              </TouchableOpacity>
            ) : null}
          </View>
        </>
      ) : null}
    </View>
  ) : null;

  return (
    <ScreenLayout>
      {/* v3.210 ①: 세그먼트 탭 — MyMusicScreen tabBar 스타일 재사용. v3.307: 비로그인은 [전체]·[공지] */}
      {(
        <View style={styles.tabBar}>
          {FEED_TABS.filter((t) => user || t.guest).map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[styles.tab, tab === t.key && styles.tabActive]}
              onPress={() => {
                if (tab === t.key) return;
                if (__DEV__) console.info('[Feed] 탭 전환', { tab: t.key });
                setPosts([]);
                setTab(t.key);
              }}
              accessibilityLabel={`일기장 탭 ${t.label}`}
            >
              <AppText style={[styles.tabText, tab === t.key && styles.tabTextActive]} numberOfLines={1}>{t.label}</AppText>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {loading && posts.length === 0 && !(tab === 'mine' && monthData) ? (
        <ActivityIndicator size="large" color={colors.accent.primary} style={styles.spinner} />
      ) : posts.length > 0 || (tab === 'mine' && monthData) || (tab === 'all' && showReward) ? (
        <FlatList
          automaticallyAdjustKeyboardInsets
          keyboardShouldPersistTaps="handled"
          data={visiblePosts}
          keyExtractor={(it, i) => String(it.id ?? i)}
          renderItem={renderPost}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={tab === 'mine' && loading ? (
            <ActivityIndicator size="small" color={colors.accent.primary} style={{ marginTop: spacing.xl }} />
          ) : tab === 'all' ? (
            // v3.389 [Diary]: [전체]가 비어도 오늘 보상 안내 띠는 보이도록(목록 머리) — 빈 안내는 아래로
            <EmptyState
              icon={<Feather name="book-open" size={44} color={colors.text.muted} />}
              title="아직 일기가 없어요"
              hint="오늘의 첫 일기를 써 보세요. 팔로우한 사람의 일기도 여기 떠요."
            />
          ) : tab === 'mine' ? (
            // v3.389 [Diary]: 고른 날/이번 달에 일기가 없을 때 — 최근 7일이면 그 날짜로 바로 쓰기
            <View style={styles.dayEmpty}>
              <AppText tone="muted" center>{selectedDay ? '이 날은 일기가 없어요.' : '이번 달 일기가 아직 없어요.'}</AppText>
              {!feedWriteBlocked && (selectedDay ? canWriteOn(selectedDay) : true) ? (
                <Button
                  label={selectedDay && selectedDay !== kstToday() ? '이 날 일기 쓰기' : '오늘 일기 쓰기'}
                  variant="tonal"
                  onPress={() => openCompose(selectedDay || undefined)}
                />
              ) : null}
            </View>
          ) : null}
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
      ) : !user && tab !== 'notice' ? (
        <View style={{ flex: 1 }} />
      ) : tab === 'mine' ? (
        // v3.210 ①: 내 글 탭 빈 상태 → v3.389 [Diary]: 내 일기(달력 조회 실패 폴백일 때만 여기로)
        <EmptyState
          icon={<Feather name="book-open" size={44} color={colors.text.muted} />}
          title="아직 쓴 일기가 없어요"
          hint="오른쪽 아래 버튼으로 오늘의 일기를 써 보세요."
        />
      ) : tab === 'notice' ? (
        <EmptyState
          icon={<Feather name="bell" size={44} color={colors.text.muted} />}
          title="아직 공지가 없어요"
          hint="MAIDOL 공식 소식이 올라오면 여기서 볼 수 있어요."
        />
      ) : (
        <EmptyState
          icon={<Feather name="book-open" size={44} color={colors.text.muted} />}
          title="아직 일기가 없어요"
          hint="오늘의 첫 일기를 써 보세요. 팔로우한 사람의 일기도 여기 떠요."
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
      {/* v3.232 K8(B4): 어린이(보호자 허용 없음)는 글쓰기 Fab 숨김 */}
      {/* v3.307: [공지] 탭은 공식 계정만 작성(공지 글) — 일반 사용자는 Fab 숨김 */}
      {user && !feedWriteBlocked && (tab !== 'notice' || isOfficial) ? (
        <Fab
          onPress={() => {
            if (tab === 'notice') {
              if (__DEV__) console.info('[Feed] 작성 진입', { kind: 'community' });
              navigation.navigate('FeedCompose', { kind: 'community' });
              return;
            }
            // v3.389 [Diary]: [내 일기]에서 최근 7일 날짜를 골라 두었으면 그 날짜로
            openCompose(tab === 'mine' && canWriteOn(selectedDay) ? selectedDay! : undefined);
          }}
          accessibilityLabel={tab === 'notice' ? '공지 작성' : '일기 쓰기'}
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
            desc={'로그인하면 다른 사람들의 일기와\n팔로우한 아티스트 소식을 볼 수 있어요'}
            onPress={goLogin}
          />
        </TouchableOpacity>
      ) : null}

      {/* v3.204 ⑥ → v3.213: 피드 튜토리얼 — 로그인 시에만(Fab 렌더 조건과 정합) */}
      <TutorialOverlay screenKey="feed" steps={TUTORIAL_STEPS} enabled={!!user && !feedWriteBlocked} />
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
  // v3.389 [Diary] 목록 머리·보상 띠·공책 종이·달력 아래 날짜 제목
  listHeader: { gap: spacing.md, marginBottom: spacing.md },
  reward: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.lg,
    backgroundColor: 'rgba(251,191,36,0.10)', borderWidth: 1, borderColor: 'rgba(251,191,36,0.35)',
  },
  rewardDone: { backgroundColor: colors.bg.surface1, borderColor: colors.border.subtle },
  rewardStar: { color: colors.accent.secondary, fontWeight: '700' },
  rewardBtn: { backgroundColor: colors.accent.primary, borderRadius: 999, paddingVertical: 6, paddingHorizontal: spacing.md },
  dayHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
  dayEmpty: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxl },
  paper: {
    marginTop: spacing.sm, backgroundColor: '#f6f1ff', borderRadius: radius.md,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md, gap: spacing.xs,
  },
  paperText: { color: colors.bg.surface2, lineHeight: 24 },
  bgmLabel: { color: colors.accent.secondary, fontWeight: '700', paddingHorizontal: spacing.md, paddingTop: spacing.sm },
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
