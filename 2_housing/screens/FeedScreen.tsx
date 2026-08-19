// [FeedScreen] 피드 타임라인 — /api/feeds/timeline (인스타형 혼합: is_public 최신 + 팔로잉 작성자 최상단).
// 비로그인은 피드 우선 노출 후, 스크롤/팔로워 클릭 시 로그인 CTA가 나타남(고정 아님).
import { useState, useCallback } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { View, FlatList, ActivityIndicator, RefreshControl, TouchableOpacity, Image, Dimensions, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import api, { BACKEND_BASE_URL } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { usePlayerStore } from '../stores/playerStore';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { AppText, Card, Avatar, EmptyState, ScreenLayout, Button } from '../components/ui';
import LoginPrompt from '../components/LoginPrompt';
import FeedCard from '../components/feed/FeedCard';

interface FeedTrack {
  id: string;
  title?: string;
  artist_name?: string;
  cover_image?: string;
  duration_sec?: number;
}
interface FeedBlock {
  type: string; // 'text' | 'track'
  text?: string;
  track_id?: string;
  track?: FeedTrack | null;
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
}

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
  // 비로그인: 스크롤/팔로워 클릭 시 나타나는 로그인 CTA (고정 아님)
  const [ctaVisible, setCtaVisible] = useState(false);

  const fetchFeed = useCallback(async () => {
    // 피드는 비로그인도 우선 노출(공개 타임라인). 스크롤/클릭 시 로그인 CTA를 띄운다.
    if (__DEV__) console.info('[FeedScreen] fetchFeed 호출');
    try {
      setLoading(true);
      const res = await api.get('/feeds/timeline');
      const data: FeedPost[] = Array.isArray(res.data)
        ? res.data
        : (res.data?.feeds || res.data?.items || res.data?.posts || []);
      if (__DEV__) console.info('[FeedScreen] fetchFeed 응답', { count: data.length });
      setPosts(data);
    } catch (err: any) {
      console.error('[FeedScreen] fetchFeed 실패', { status: err?.response?.status });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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

  const handlePlayTrack = (track: FeedTrack) => {
    if (!track?.id) return;
    if (__DEV__) console.info('[FeedScreen] play track', { id: track.id });
    const queue = allTracks();
    playerStore.setQueue(queue.length ? queue : [track]);
    navigation.navigate('Player', { track });
  };

  const goLogin = () => navigation.navigate('Settings');

  const renderTrackBlock = (track: FeedTrack, key: string) => {
    const uri = coverUri(track.cover_image);
    return (
      <TouchableOpacity key={key} style={styles.trackRow} activeOpacity={0.75} onPress={() => (user ? handlePlayTrack(track) : setCtaVisible(true))} accessibilityLabel={`재생 ${track.title || ''}`}>
        <View style={styles.trackCover}>
          {uri ? <Image source={{ uri }} style={styles.trackCoverImg} />
            : <AppText variant="title3" tone="muted">♪</AppText>}
          <View style={styles.playBadge}><Feather name="play" size={14} color={colors.text.inverse} /></View>
        </View>
        <View style={styles.trackMeta}>
          <AppText variant="bodyStrong" numberOfLines={1}>{track.title || '제목 없음'}</AppText>
          <AppText variant="caption" tone="muted" numberOfLines={1}>
            {track.artist_name || '아티스트'}{fmtDuration(track.duration_sec) ? ` · ${fmtDuration(track.duration_sec)}` : ''}
          </AppText>
        </View>
        <Feather name="play-circle" size={26} color={colors.accent.primary} />
      </TouchableOpacity>
    );
  };

  // 인스타/페북식 카드(FeedCard) — 좋아요 토글·댓글/답글·공유·⋯메뉴 포함. 본문 블록 렌더는 기존 로직 재사용.
  const requireLogin = (): boolean => {
    if (!user) { setCtaVisible(true); return false; }
    return true;
  };

  const renderPost = ({ item }: { item: FeedPost }) => {
    const author = item.author_nickname || item.author_name || item.nickname || '익명';
    const blocks = item.blocks || [];
    const textBlocks = blocks.filter((b) => b.type === 'text' && b.text);
    const trackBlocks = blocks.filter((b) => b.type === 'track' && b.track?.id);
    return (
      <FeedCard
        feed={item}
        requireLogin={requireLogin}
        onPressAuthor={() => {
          if (!user) { setCtaVisible(true); return; }
          if (item.author_id) navigation.navigate('UserChannel', { authorId: item.author_id, name: author });
        }}
        onDeleted={() => fetchFeed()}
        renderBlocks={() => (
          <View>
            {textBlocks.map((b, i) => (
              <AppText key={`t${i}`} variant="body" tone="secondary" style={styles.body}>{b.text}</AppText>
            ))}
            {trackBlocks.map((b, i) => renderTrackBlock(b.track as FeedTrack, `tr${i}`))}
          </View>
        )}
      />
    );
  };

  return (
    <ScreenLayout>
      {loading && posts.length === 0 ? (
        <ActivityIndicator size="large" color={colors.accent.primary} style={styles.spinner} />
      ) : posts.length > 0 ? (
        <FlatList
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
      ) : (
        <EmptyState
          icon="👥"
          title="아직 소식이 없어요"
          hint="마음에 드는 아티스트를 팔로우하면 소식이 여기 가장 먼저 떠요."
          action={<Button label="아티스트 둘러보기" onPress={() => navigation.navigate('Chart')} />}
        />
      )}

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
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  spinner: { marginTop: spacing.huge },
  list: { padding: spacing.lg, paddingBottom: 100 },
  card: { marginBottom: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center' },
  headText: { marginLeft: spacing.md, flex: 1 },
  title: { marginTop: spacing.md },
  body: { marginTop: spacing.sm },
  trackRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    marginTop: spacing.md, padding: spacing.sm,
    backgroundColor: colors.bg.deepest, borderRadius: radius.lg,
  },
  trackCover: {
    width: 52, height: 52, borderRadius: radius.md, overflow: 'hidden',
    backgroundColor: colors.bg.surface2, alignItems: 'center', justifyContent: 'center',
  },
  trackCoverImg: { width: '100%', height: '100%' },
  playBadge: {
    position: 'absolute', right: 2, bottom: 2,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: radius.pill, padding: 2,
  },
  trackMeta: { flex: 1 },
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
