// [FeedScreen] 피드 타임라인 — /api/feeds/timeline (인스타형 혼합: is_public 최신 + 팔로잉 작성자 최상단).
// 비로그인 시 노출 금지. 카드에 제목·본문·트랙(재생 가능) 인라인 렌더.
import { useState, useCallback } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { View, FlatList, ActivityIndicator, RefreshControl, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import api, { BACKEND_BASE_URL } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { usePlayerStore } from '../stores/playerStore';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { AppText, Card, Avatar, EmptyState, ScreenLayout, Button } from '../components/ui';

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

  const fetchFeed = useCallback(async () => {
    // 피드는 비로그인도 우선 노출(공개 타임라인). 로그인 유도는 하단 CTA로 처리.
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
      <TouchableOpacity key={key} style={styles.trackRow} activeOpacity={0.75} onPress={() => user && handlePlayTrack(track)} accessibilityLabel={`재생 ${track.title || ''}`}>
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

  const renderPost = ({ item }: { item: FeedPost }) => {
    const author = item.author_nickname || item.author_name || item.nickname || '익명';
    const blocks = item.blocks || [];
    const textBlocks = blocks.filter((b) => b.type === 'text' && b.text);
    const trackBlocks = blocks.filter((b) => b.type === 'track' && b.track?.id);
    const card = (
      <Card variant="filled" style={styles.card}>
        <TouchableOpacity
          style={styles.head}
          activeOpacity={0.7}
          onPress={() => {
            if (!user) return; // 비로그인: 하단 고정 CTA로 로그인 유도
            if (item.author_id) navigation.navigate('UserChannel', { authorId: item.author_id, name: author });
          }}
          accessibilityLabel={`${author} 채널`}
        >
          <Avatar name={author} size={36} />
          <View style={styles.headText}>
            <AppText variant="bodyStrong" numberOfLines={1}>{author}</AppText>
            {item.created_at ? (
              <AppText variant="caption" tone="muted">
                {new Date(item.created_at).toLocaleDateString('ko-KR')}
              </AppText>
            ) : null}
          </View>
          {item.author_id ? <Feather name="chevron-right" size={18} color={colors.text.muted} /> : null}
        </TouchableOpacity>

        {item.title ? <AppText variant="bodyLg" style={styles.title}>{item.title}</AppText> : null}
        {textBlocks.map((b, i) => (
          <AppText key={`t${i}`} variant="body" tone="secondary" style={styles.body}>{b.text}</AppText>
        ))}
        {trackBlocks.map((b, i) => renderTrackBlock(b.track as FeedTrack, `tr${i}`))}

        <View style={styles.footer}>
          <View style={styles.stat}><Feather name="heart" size={14} color={colors.text.muted} /><AppText variant="caption" tone="muted">{item.like_count ?? 0}</AppText></View>
          <View style={styles.stat}><Feather name="message-circle" size={14} color={colors.text.muted} /><AppText variant="caption" tone="muted">{item.comment_count ?? 0}</AppText></View>
        </View>
      </Card>
    );
    return card;
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
          contentContainerStyle={[styles.list, !user && { paddingBottom: 140 }]}
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

      {/* 비로그인: 하단 고정 로그인 CTA (스크롤/클릭 시 항상 노출) */}
      {!user ? (
        <View style={styles.stickyCta} pointerEvents="box-none">
          <View style={styles.stickyCtaInner}>
            <AppText variant="footnote" tone="secondary" center style={styles.stickyHint}>
              로그인하면 팔로우한 아티스트와{'\n'}다른 사람들의 소식을 더 볼 수 있어요
            </AppText>
            <Button label="로그인하고 시작하기" fullWidth onPress={goLogin} />
          </View>
        </View>
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
  stickyCta: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  stickyCtaInner: {
    padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md,
    backgroundColor: colors.bg.surface1,
    borderTopWidth: 1, borderTopColor: colors.border.subtle,
  },
  stickyHint: { lineHeight: 18 },
});
