// [UserChannelScreen] 유저(기획사) 채널 페이지 — MAIDOL ArtistDetailPage 이식.
// 프로필 + 통계(앨범/트랙/팔로워) + 팔로우 토글 + 탭(곡·앨범/피드/커뮤니티) — v3.49 MAIDOL 동일 구성.
// 계약: GET /artists/{id}, /follows/summary/{id}(+POST/DELETE), /artists/{id}/tracks, /artists/{id}/albums,
//       /albums/{album_id}(트랙 포함), /feeds/user/{id}?kind=feed|community
import { useState, useEffect, useCallback } from 'react';
import { useRoute, useNavigation } from '@react-navigation/native';
import { View, ScrollView, FlatList, Image, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import api, { BACKEND_BASE_URL } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { usePlayerStore } from '../stores/playerStore';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { AppText, Card, Avatar, Button, EmptyState } from '../components/ui';

const mediaUri = (obj?: string | null): string | null =>
  obj ? `${BACKEND_BASE_URL}/api/upload/cover-preview/${encodeURIComponent(obj)}` : null;
const fmtDuration = (s?: number) => (!s || s <= 0 ? '' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);

type Tab = 'music' | 'feed' | 'community';

export default function UserChannelScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { authorId, name } = route.params || {};
  const { user } = useAuthStore();
  const playerStore = usePlayerStore();

  const [profile, setProfile] = useState<any>(null);
  const [followerCount, setFollowerCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('music');
  const [tracks, setTracks] = useState<any[]>([]);
  const [albums, setAlbums] = useState<any[]>([]);
  const [feeds, setFeeds] = useState<any[]>([]);
  const [notices, setNotices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const isSelf = !!user && String(user.id) === String(authorId);

  useEffect(() => {
    let alive = true;
    if (__DEV__) console.info('[UserChannel] load', { authorId });
    (async () => {
      setLoading(true);
      try {
        const [pRes, sRes, tRes, aRes, fRes, cRes] = await Promise.allSettled([
          api.get(`/artists/${authorId}`),
          api.get(`/follows/summary/${authorId}`),
          api.get(`/artists/${authorId}/tracks`, { params: { limit: 30 } }),
          api.get(`/artists/${authorId}/albums`), // v3.49: 앨범 통계·목록
          api.get(`/feeds/user/${authorId}`, { params: { kind: 'feed', limit: 20 } }),
          api.get(`/feeds/user/${authorId}`, { params: { kind: 'community', limit: 20 } }),
        ]);
        if (!alive) return;
        if (pRes.status === 'fulfilled') setProfile(pRes.value.data);
        if (aRes.status === 'fulfilled') setAlbums(Array.isArray(aRes.value.data) ? aRes.value.data : (aRes.value.data?.albums || []));
        if (sRes.status === 'fulfilled') {
          setFollowerCount(sRes.value.data?.follower_count ?? 0);
          setIsFollowing(!!sRes.value.data?.is_following);
        }
        if (tRes.status === 'fulfilled') setTracks(Array.isArray(tRes.value.data) ? tRes.value.data : (tRes.value.data?.tracks || []));
        if (fRes.status === 'fulfilled') setFeeds(fRes.value.data?.feeds || []);
        if (cRes.status === 'fulfilled') setNotices(cRes.value.data?.feeds || []);
      } catch (err: any) {
        console.error('[UserChannel] load 실패', { status: err?.response?.status });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [authorId]);

  const toggleFollow = useCallback(async () => {
    if (!user) { navigation.navigate('Settings'); return; }
    if (followBusy || isSelf) return;
    setFollowBusy(true);
    const next = !isFollowing;
    if (__DEV__) console.info('[UserChannel] toggleFollow', { next });
    try {
      if (next) await api.post(`/follows/${authorId}`);
      else await api.delete(`/follows/${authorId}`);
      setIsFollowing(next);
      setFollowerCount((c) => Math.max(0, c + (next ? 1 : -1)));
    } catch (err: any) {
      console.error('[UserChannel] follow 실패', { status: err?.response?.status });
    } finally {
      setFollowBusy(false);
    }
  }, [user, followBusy, isSelf, isFollowing, authorId, navigation]);

  const playTrack = (track: any, queue: any[]) => {
    if (!track?.id) return;
    playerStore.setQueue(queue.length ? queue : [track]);
    navigation.navigate('Player', { track });
  };

  // v3.96(A-2): 앨범 탭 → 앨범 상세 화면으로 이동(열람 + 내 앨범이면 관리). 즉시재생은 상세의 '전체 재생'.
  const openAlbum = (album: any) => {
    if (__DEV__) console.info('[UserChannel] 앨범 열기 → AlbumDetail', { albumId: album.id });
    navigation.navigate('AlbumDetail', { albumId: String(album.id) });
  };

  // 앨범 cover_image는 '/api/...' 풀경로로 옴 — 절대 URL로 보정
  const albumCoverUri = (img?: string | null): string | null => {
    if (!img) return null;
    if (img.startsWith('http')) return img;
    if (img.startsWith('/')) return `${BACKEND_BASE_URL}${img}`;
    return mediaUri(img);
  };

  const displayName = profile?.name || name || '채널';

  const TrackRow = ({ item, queue }: { item: any; queue: any[] }) => {
    const uri = mediaUri(item.cover_image || item.cover_image_url);
    return (
      <TouchableOpacity style={styles.trackRow} activeOpacity={0.75} onPress={() => playTrack(item, queue)}>
        <View style={styles.trackCover}>
          {uri ? <Image source={{ uri }} style={styles.trackCoverImg} /> : <AppText variant="title3" tone="muted">♪</AppText>}
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="bodyStrong" numberOfLines={1}>{item.title || '제목 없음'}</AppText>
          <AppText variant="caption" tone="muted" numberOfLines={1}>
            ▶ {item.play_count ?? 0}{fmtDuration(item.duration_sec) ? ` · ${fmtDuration(item.duration_sec)}` : ''}
          </AppText>
        </View>
        <Feather name="play-circle" size={24} color={colors.accent.primary} />
      </TouchableOpacity>
    );
  };

  const FeedCard = ({ item, notice }: { item: any; notice?: boolean }) => {
    const blocks = item.blocks || [];
    const texts = blocks.filter((b: any) => b.type === 'text' && b.text);
    const trackBlocks = blocks.filter((b: any) => b.type === 'track' && b.track?.id);
    const queue = trackBlocks.map((b: any) => b.track);
    return (
      <Card variant="filled" style={styles.card}>
        {notice ? <AppText variant="caption" tone="accent" style={{ marginBottom: 4 }}>📢 공지</AppText> : null}
        {item.title ? <AppText variant="bodyLg">{item.title}</AppText> : null}
        {texts.map((b: any, i: number) => (
          <AppText key={i} variant="body" tone="secondary" style={{ marginTop: spacing.xs }}>{b.text}</AppText>
        ))}
        {trackBlocks.map((b: any, i: number) => <TrackRow key={`tk${i}`} item={b.track} queue={queue} />)}
        {item.created_at ? (
          <AppText variant="caption" tone="muted" style={{ marginTop: spacing.sm }}>
            {new Date(item.created_at).toLocaleDateString('ko-KR')}
          </AppText>
        ) : null}
      </Card>
    );
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={colors.accent.primary} /></View>;
  }

  // v3.49: MAIDOL 동일 탭명 — 곡·앨범 / 피드 / 커뮤니티
  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: 'music', label: '곡·앨범', count: tracks.length + albums.length },
    { key: 'feed', label: '피드', count: feeds.length },
    { key: 'community', label: '커뮤니티', count: notices.length },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 120 }}>
      {/* 헤더 */}
      <View style={styles.header}>
        <Avatar uri={mediaUri(profile?.image)} name={displayName} size={80} />
        <AppText variant="title2" style={{ marginTop: spacing.md }}>{displayName}</AppText>
        {profile?.bio ? <AppText variant="footnote" tone="secondary" center style={{ marginTop: 4 }}>{profile.bio}</AppText> : null}

        {/* v3.49: MAIDOL과 동일한 통계 3종 — 앨범 / 트랙 / 팔로워 */}
        <View style={styles.stats}>
          <View style={styles.stat}><AppText variant="title3" tone="accent">{albums.length}</AppText><AppText variant="caption" tone="muted">앨범</AppText></View>
          <View style={styles.statDivider} />
          <View style={styles.stat}><AppText variant="title3" tone="accent">{profile?.track_count ?? tracks.length}</AppText><AppText variant="caption" tone="muted">트랙</AppText></View>
          <View style={styles.statDivider} />
          <View style={styles.stat}><AppText variant="title3" tone="accent">{followerCount}</AppText><AppText variant="caption" tone="muted">팔로워</AppText></View>
        </View>

        {!isSelf ? (
          <View style={{ marginTop: spacing.md, alignSelf: 'stretch' }}>
            <Button
              label={isFollowing ? '팔로잉 ✓' : '+ 팔로우'}
              variant={isFollowing ? 'tonal' : 'filled'}
              fullWidth
              disabled={followBusy}
              onPress={toggleFollow}
            />
          </View>
        ) : null}
      </View>

      {/* 탭 */}
      <View style={styles.tabBar}>
        {TABS.map((t) => (
          <TouchableOpacity key={t.key} style={[styles.tab, tab === t.key && styles.tabActive]} onPress={() => setTab(t.key)}>
            <AppText variant="footnote" tone={tab === t.key ? 'accent' : 'muted'}>{t.label} {t.count}</AppText>
          </TouchableOpacity>
        ))}
      </View>

      {/* 탭 내용 */}
      <View style={styles.tabContent}>
        {tab === 'music' && (
          (tracks.length || albums.length) ? (
            <>
              {tracks.length ? (
                <>
                  <AppText variant="footnote" tone="secondary" style={styles.sectionLabel}>인기 트랙</AppText>
                  {tracks.map((t) => <TrackRow key={t.id} item={t} queue={tracks} />)}
                </>
              ) : null}
              {albums.length ? (
                <>
                  <AppText variant="footnote" tone="secondary" style={[styles.sectionLabel, tracks.length ? { marginTop: spacing.lg } : null]}>앨범</AppText>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.albumRow}>
                    {albums.map((a) => (
                      <TouchableOpacity key={a.id} style={styles.albumCard} activeOpacity={0.75}
                        onPress={() => openAlbum(a)} accessibilityLabel={`앨범 ${a.title}`}>
                        <View style={styles.albumCover}>
                          {albumCoverUri(a.cover_image)
                            ? <Image source={{ uri: albumCoverUri(a.cover_image)! }} style={styles.albumCoverImg} />
                            : <AppText variant="title2" tone="muted">♪</AppText>}
                        </View>
                        <AppText variant="footnote" numberOfLines={1} style={{ marginTop: 6 }}>{a.title}</AppText>
                        <AppText variant="caption" tone="muted">{a.track_count ?? 0}곡</AppText>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </>
              ) : null}
            </>
          ) : <EmptyState icon="🎵" title="아직 만든 음악이 없어요" />
        )}
        {tab === 'feed' && (
          feeds.length ? feeds.map((f, i) => <FeedCard key={f.id ?? i} item={f} />)
            : <EmptyState icon="📝" title="아직 작성한 피드가 없어요" />
        )}
        {tab === 'community' && (
          notices.length ? notices.map((f, i) => <FeedCard key={f.id ?? i} item={f} notice />)
            : <EmptyState icon="📢" title="아직 공지사항이 없어요" />
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg.deepest },
  header: { alignItems: 'center', padding: spacing.xl, paddingBottom: spacing.lg },
  stats: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg, gap: spacing.lg },
  stat: { alignItems: 'center', minWidth: 56 },
  statDivider: { width: 1, height: 28, backgroundColor: colors.border.subtle },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border.subtle },
  tab: { flex: 1, alignItems: 'center', paddingVertical: spacing.md, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: colors.accent.primary },
  tabContent: { padding: spacing.lg, gap: spacing.sm },
  card: { marginBottom: spacing.md },
  sectionLabel: { fontWeight: '700', letterSpacing: 0.3 },
  albumRow: { gap: spacing.md, paddingVertical: spacing.xs },
  albumCard: { width: 120 },
  albumCover: {
    width: 120, height: 120, borderRadius: radius.lg, overflow: 'hidden',
    backgroundColor: colors.bg.surface2, alignItems: 'center', justifyContent: 'center',
  },
  albumCoverImg: { width: '100%', height: '100%' },
  albumLoading: {
    ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  trackRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.sm, marginTop: spacing.xs,
  },
  trackCover: {
    width: 48, height: 48, borderRadius: radius.md, overflow: 'hidden',
    backgroundColor: colors.bg.surface2, alignItems: 'center', justifyContent: 'center',
  },
  trackCoverImg: { width: '100%', height: '100%' },
});
