// [FeedDetail] 피드 단건 착지 — GET /feeds/{id} (MAIDOL FeedDetailPage 이식, 공유/딥링크 목적지). v3.95(A-21)
// 딥링크: aidol://feed/{id} · {BACKEND_BASE_URL}/feed/{id} → App.tsx linking 설정에서 이 화면으로 매핑.
// 렌더는 기존 FeedCard 재사용(좋아요·댓글·답글·신고·공유 상호작용 그대로).
// 블록 렌더(텍스트/트랙/[item] 마커)는 FeedScreen과 동일 규칙.
import { useState, useCallback } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { View, ScrollView, TouchableOpacity, Image, ActivityIndicator, StyleSheet, Linking } from 'react-native';
import { Feather } from '@expo/vector-icons';
import api, { BACKEND_BASE_URL } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { usePlayerStore } from '../stores/playerStore';
import { useLikesStore } from '../stores/likesStore';
import { showAlert } from '../utils/appAlert';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { AppText, EmptyState } from '../components/ui';
import FeedCard, { feedTheme } from '../components/feed/FeedCard';
import FeedImageBlock, { feedImageUri } from '../components/feed/FeedImageBlock';
import TrackRow, { RowTrack } from '../components/TrackRow';
import TrackActionSheet from '../components/TrackActionSheet';
import { playTrackNow } from '../services/playback';

interface FeedTrack {
  id: string;
  title?: string;
  artist_name?: string;
  cover_image?: string;
  duration_sec?: number;
  play_count?: number;
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

// v3.70과 짝: 텍스트 블록의 [item]{JSON} 마커 → 아이템 카드. 파싱 실패 시 일반 텍스트 폴백.
interface FeedItemAttach { name?: string; category?: string; url?: string; img?: string }
const parseItemMarker = (text?: string): FeedItemAttach | null => {
  if (!text || !text.startsWith('[item]')) return null;
  try { return JSON.parse(text.slice(6)); } catch { return null; }
};

export default function FeedDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const feedId = String(route.params?.feedId ?? '');
  const user = useAuthStore((s) => s.user);
  const [feed, setFeed] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [trackStats, setTrackStats] = useState<Record<string, { play_count?: number; like_count?: number }>>({});
  const [actionTrack, setActionTrack] = useState<RowTrack | null>(null);
  const likedMap = useLikesStore((s) => s.liked);
  const syncLikes = useLikesStore((s) => s.sync);
  const nowId = usePlayerStore((s) => s.track?.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const load = useCallback(async () => {
    if (!feedId) { setNotFound(true); setLoading(false); return; }
    if (__DEV__) console.info('[FeedDetail] getFeed 시작', { feedId });
    try {
      setLoading(true);
      const res = await api.get(`/feeds/${feedId}`);
      const data = res.data?.feed ?? res.data;
      setFeed(data);
      setNotFound(!data);
      // 트랙 블록 스탯(재생수·좋아요) 병합 — FeedScreen v3.69 관행
      const ids = [...new Set(((data?.blocks || []) as FeedBlock[])
        .filter((b) => b.type === 'track' && b.track?.id).map((b) => String(b.track!.id)))].slice(0, 20);
      if (ids.length) {
        if (useAuthStore.getState().user) syncLikes(ids);
        const results = await Promise.allSettled(ids.map((id) => api.get(`/tracks/${id}`)));
        const next: Record<string, { play_count?: number; like_count?: number }> = {};
        results.forEach((r, i) => {
          if (r.status === 'fulfilled') next[ids[i]] = { play_count: r.value.data?.play_count, like_count: r.value.data?.like_count };
        });
        setTrackStats((prev) => ({ ...prev, ...next }));
      }
    } catch (err: any) {
      console.error('[FeedDetail] getFeed 실패', { feedId, status: err?.response?.status });
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [feedId, syncLikes]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const requireLogin = (): boolean => {
    if (!user) {
      showAlert('로그인 필요', '로그인 후 이용할 수 있습니다.', [
        { text: '취소', style: 'cancel' },
        { text: '로그인', onPress: () => navigation.navigate('Settings') },
      ]);
      return false;
    }
    return true;
  };

  const feedTracks = (): FeedTrack[] =>
    ((feed?.blocks || []) as FeedBlock[]).filter((b) => b.type === 'track' && b.track?.id).map((b) => b.track as FeedTrack);

  // 재생 토글 — 현재 곡이면 일시정지/재개, 아니면 그 곡부터 재생(FeedScreen과 동일)
  const handleTrackTap = async (track: FeedTrack) => {
    if (!track?.id) return;
    const s = usePlayerStore.getState();
    if (String(s.track?.id) === String(track.id) && s.sound) {
      if (__DEV__) console.info('[FeedDetail] 트랙 토글', { id: track.id, pause: s.isPlaying });
      try {
        if (s.isPlaying) { await s.sound.pauseAsync(); s.setIsPlaying(false); }
        else { await s.sound.playAsync(); s.setIsPlaying(true); }
      } catch (err: any) {
        console.error('[FeedDetail] 토글 실패', { id: track.id, message: err?.message });
      }
      return;
    }
    if (__DEV__) console.info('[FeedDetail] play track inline', { id: track.id });
    playTrackNow(track, feedTracks());
  };

  const renderTrackBlock = (track: FeedTrack, key: string) => {
    const stats = trackStats[String(track.id)] || {};
    const rowTrack: RowTrack = { ...track, ...stats } as RowTrack;
    const isCurrent = String(nowId) === String(track.id);
    return (
      <View key={key} style={styles.trackBlockWrap}>
        <TrackRow
          track={rowTrack}
          liked={!!likedMap[String(track.id)]}
          playBadge={isCurrent && isPlaying ? 'pause' : 'play'}
          onPress={() => { if (requireLogin()) handleTrackTap(track); }}
          onMore={() => { if (requireLogin()) setActionTrack(rowTrack); }}
        />
      </View>
    );
  };

  const renderItemBlock = (it: FeedItemAttach, key: string) => (
    <TouchableOpacity
      key={key}
      style={styles.itemCard}
      activeOpacity={it.url ? 0.7 : 1}
      accessibilityLabel={`아이템 ${it.name || ''}`}
      onPress={() => {
        if (!it.url) return;
        if (__DEV__) console.info('[FeedDetail] 아이템 링크 열기', { name: it.name });
        Linking.openURL(it.url).catch((err) => console.error('[FeedDetail] 아이템 링크 실패', { url: it.url, message: err?.message }));
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

  const renderBlocks = () => {
    const blocks: FeedBlock[] = feed?.blocks || [];
    const rawText = blocks.filter((b) => b.type === 'text' && b.text);
    const textBlocks = rawText.filter((b) => !parseItemMarker(b.text));
    const itemBlocks = rawText.map((b) => parseItemMarker(b.text)).filter(Boolean) as FeedItemAttach[];
    const trackBlocks = blocks.filter((b) => b.type === 'track' && b.track?.id);
    // v3.111: 이미지 블록 — 가로폭 맞춤·비율 유지, 다중은 세로 나열 (FeedScreen과 동일 규칙)
    const imageBlocks = blocks.filter((b) => b.type === 'image' && (b.image_url || b.object_name));
    return (
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
    );
  };

  return (
    <View style={styles.container}>
      {loading ? (
        <ActivityIndicator size="large" color={colors.accent.primary} style={styles.spinner} />
      ) : notFound || !feed ? (
        <EmptyState title="피드를 찾을 수 없습니다" hint="삭제되었거나 비공개 처리된 글일 수 있어요" />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          <FeedCard
            feed={feed}
            requireLogin={requireLogin}
            onPressAuthor={() => {
              if (!requireLogin()) return;
              if (feed.author_id) {
                navigation.navigate('UserChannel', { authorId: feed.author_id, name: feed.author_nickname });
              }
            }}
            onDeleted={() => navigation.goBack()}
            renderBlocks={renderBlocks}
          />
        </ScrollView>
      )}

      {/* ⋮ 액션 시트 — 피드 탭과 동일(재생/좋아요/재생목록/플레이리스트) */}
      <TrackActionSheet
        track={actionTrack}
        onClose={() => setActionTrack(null)}
        onPlay={(t) => handleTrackTap(t as FeedTrack)}
        onLikeChanged={(trackId, delta) => setTrackStats((prev) => ({
          ...prev,
          [trackId]: { ...prev[trackId], like_count: Math.max(0, (prev[trackId]?.like_count ?? 0) + delta) },
        }))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  spinner: { marginTop: spacing.huge },
  list: { paddingVertical: spacing.lg, paddingHorizontal: spacing.md, paddingBottom: 120 },
  body: { marginTop: spacing.sm },
  trackBlockWrap: {
    marginTop: spacing.md, backgroundColor: feedTheme.field,
    borderRadius: radius.lg, overflow: 'hidden',
  },
  itemCard: {
    marginTop: spacing.md, backgroundColor: feedTheme.field,
    borderRadius: radius.lg, flexDirection: 'row', alignItems: 'center',
    gap: spacing.md, padding: spacing.md,
  },
  itemImg: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.06)' },
  itemImgEmpty: { alignItems: 'center', justifyContent: 'center' },
  itemLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
