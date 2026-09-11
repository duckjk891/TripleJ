// [UserChannelScreen] 유저(기획사) 채널 페이지 — MAIDOL ArtistDetailPage 이식.
// 프로필 + 통계(앨범/트랙/팔로워) + 팔로우 토글 + 탭(곡·앨범/아티스트/피드/커뮤니티).
// v3.159(대표): 탭 UI를 마이페이지(MyMusicScreen)와 통일 — 공용 TrackRow(마퀴)·FeedCard·
//   앨범 행·탭바·작성 버튼(dashed) 동일. 아티스트 탭 신설(GET /artists/{id}/characters).
//   이모지 아이콘 전부 제거. 작성 버튼은 마이페이지 [새 피드 작성]/[새 공지 작성]과 동일 UI·동작.
// 계약: GET /artists/{id}, /follows/summary/{id}(+POST/DELETE), /artists/{id}/tracks, /artists/{id}/albums,
//       /artists/{id}/characters(v237), /feeds/user/{id}?kind=feed|community
import { useState, useEffect, useCallback } from 'react';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import { View, ScrollView, Image, TouchableOpacity, ActivityIndicator, StyleSheet, Linking } from 'react-native';
import { Feather } from '@expo/vector-icons';
import api, { BACKEND_BASE_URL } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { usePlayerStore } from '../stores/playerStore';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { AppText, Avatar, Button, EmptyState, Tag } from '../components/ui';
import TrackRow from '../components/TrackRow';
import FeedCard from '../components/feed/FeedCard';
import FeedImageBlock, { feedImageUri } from '../components/feed/FeedImageBlock';

const mediaUri = (obj?: string | null): string | null =>
  obj ? `${BACKEND_BASE_URL}/api/upload/cover-preview/${encodeURIComponent(obj)}` : null;

// MyMusicScreen과 동일 — 텍스트 블록의 [item]{JSON} 마커 → 아이템 카드 (파싱 실패 시 일반 텍스트)
interface FeedItemAttach { name?: string; category?: string; url?: string; img?: string }
function parseItemMarker(text?: string): FeedItemAttach | null {
  if (!text || !text.startsWith('[item]')) return null;
  try { return JSON.parse(text.slice(6)); } catch { return null; }
}

type Tab = 'music' | 'artists' | 'feed' | 'community';
type MusicSub = 'tracks' | 'albums';

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
  const [musicSub, setMusicSub] = useState<MusicSub>('tracks');
  const [tracks, setTracks] = useState<any[]>([]);
  const [albums, setAlbums] = useState<any[]>([]);
  const [characters, setCharacters] = useState<any[]>([]);
  const [feeds, setFeeds] = useState<any[]>([]);
  const [notices, setNotices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const isSelf = !!user && String(user.id) === String(authorId);

  const fetchFeeds = useCallback(async () => {
    try {
      const [fRes, cRes] = await Promise.allSettled([
        api.get(`/feeds/user/${authorId}`, { params: { kind: 'feed', limit: 20 } }),
        api.get(`/feeds/user/${authorId}`, { params: { kind: 'community', limit: 20 } }),
      ]);
      if (fRes.status === 'fulfilled') setFeeds(fRes.value.data?.feeds || []);
      if (cRes.status === 'fulfilled') setNotices(cRes.value.data?.feeds || []);
    } catch (err: any) {
      console.error('[UserChannel] feeds 재조회 실패', { status: err?.response?.status });
    }
  }, [authorId]);

  useEffect(() => {
    let alive = true;
    if (__DEV__) console.info('[UserChannel] load', { authorId });
    (async () => {
      setLoading(true);
      try {
        const [pRes, sRes, tRes, aRes, chRes, fRes, cRes] = await Promise.allSettled([
          api.get(`/artists/${authorId}`),
          api.get(`/follows/summary/${authorId}`),
          api.get(`/artists/${authorId}/tracks`, { params: { limit: 30 } }),
          api.get(`/artists/${authorId}/albums`), // v3.49: 앨범 통계·목록
          api.get(`/artists/${authorId}/characters`), // v3.159: 아티스트 탭
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
        if (chRes.status === 'fulfilled') setCharacters(chRes.value.data?.characters || []);
        else console.warn('[UserChannel] characters 조회 실패(탭은 빈 상태로 표시)');
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

  // v3.159: 작성(FeedCompose) 다녀온 뒤 focus 복귀 시 피드/공지 재조회 — 마이페이지 관행 동일
  useFocusEffect(
    useCallback(() => {
      if (!loading) fetchFeeds();
    }, [loading, fetchFeeds])
  );

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

  // v3.96(A-2): 앨범 → 앨범 상세 화면(열람 + 내 앨범이면 관리)
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

  // v3.159: 피드/커뮤니티 카드 — 마이페이지(MyMusicScreen renderFeed)와 동일한 공용 FeedCard +
  // 블록 렌더(텍스트/이미지/트랙/[item] 마커). 카드 탭 시 상세(FeedDetail)로.
  const renderFeed = (item: any) => {
    const blocks: any[] = item.blocks || [];
    const rawText = blocks.filter((b) => b.type === 'text' && b.text);
    const textBlocks = rawText.filter((b) => !parseItemMarker(b.text));
    const itemBlocks = rawText.map((b) => parseItemMarker(b.text)).filter(Boolean) as FeedItemAttach[];
    const trackBlocks = blocks.filter((b) => b.type === 'track' && b.track?.id);
    const imageBlocks = blocks.filter((b) => b.type === 'image' && (b.image_url || b.object_name));
    const queue = trackBlocks.map((b) => b.track);
    return (
      <TouchableOpacity
        key={String(item.id)}
        activeOpacity={0.9}
        onPress={() => {
          if (__DEV__) console.info('[UserChannel] 피드 상세로', { feedId: item.id });
          navigation.navigate('FeedDetail', { feedId: String(item.id) });
        }}
        accessibilityLabel="피드 상세 보기"
      >
        <FeedCard
          feed={item}
          requireLogin={() => !!user}
          onDeleted={fetchFeeds}
          onPressAuthor={() => {}}
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
                    onPress={() => playTrack(b.track, queue)}
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
                      console.error('[UserChannel] 아이템 링크 실패', { message: err?.message }));
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

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={colors.accent.primary} /></View>;
  }

  // v3.159: 마이페이지와 동일한 탭 구성 + 아티스트 탭 신설 (카운트 뱃지 제거 — 마이페이지 관행)
  const TABS: { key: Tab; label: string }[] = [
    { key: 'music', label: '곡·앨범' },
    { key: 'artists', label: '아티스트' },
    { key: 'feed', label: '피드' },
    { key: 'community', label: '커뮤니티' },
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

      {/* 탭 바 — v3.159: 마이페이지와 동일 스타일 */}
      <View style={styles.tabBar}>
        {TABS.map((t) => (
          <TouchableOpacity key={t.key} style={[styles.tab, tab === t.key && styles.tabActive]} onPress={() => setTab(t.key)}>
            <AppText style={[styles.tabText, tab === t.key && styles.tabTextActive]} numberOfLines={1}>{t.label}</AppText>
          </TouchableOpacity>
        ))}
      </View>

      {/* 곡·앨범 — v3.159: 마이페이지처럼 하위 칩(곡/앨범) + 공용 TrackRow·앨범 행 */}
      {tab === 'music' && (
        <View style={styles.subTabRow}>
          {([
            { key: 'tracks', label: '곡' },
            { key: 'albums', label: '앨범' },
          ] as { key: MusicSub; label: string }[]).map((s) => (
            <Tag key={s.key} label={s.label} selected={musicSub === s.key} onPress={() => setMusicSub(s.key)} />
          ))}
        </View>
      )}
      {tab === 'music' && musicSub === 'tracks' && (
        <View style={styles.tabContent}>
          {tracks.length ? (
            tracks.map((t) => (
              <TrackRow
                key={String(t.id)}
                track={{ ...t, id: String(t.id) }}
                onPress={() => playTrack(t, tracks)}
              />
            ))
          ) : <EmptyState title="아직 발매한 곡이 없어요." />}
        </View>
      )}
      {tab === 'music' && musicSub === 'albums' && (
        <View style={styles.tabContent}>
          {albums.length ? (
            albums.map((a) => (
              <TouchableOpacity
                key={String(a.id)} style={styles.albumRow} activeOpacity={0.75}
                onPress={() => openAlbum(a)} accessibilityLabel={`앨범 ${a.title}`}
              >
                <View style={styles.albumRowCover}>
                  {albumCoverUri(a.cover_image)
                    ? <Image source={{ uri: albumCoverUri(a.cover_image)! }} style={styles.albumRowCoverImg} />
                    : <AppText style={{ fontSize: 20, color: colors.text.muted }}>♪</AppText>}
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <AppText style={styles.albumRowTitle} numberOfLines={1}>{a.title}</AppText>
                  <AppText style={styles.albumRowMeta}>{`${a.track_count ?? 0}곡`}</AppText>
                </View>
                <Feather name="chevron-right" size={18} color={colors.text.muted} />
              </TouchableOpacity>
            ))
          ) : <EmptyState title="아직 만든 앨범이 없어요." />}
        </View>
      )}

      {/* 아티스트 — v3.159 신설: 이 기획사의 아티스트(캐릭터) 공개 목록 */}
      {tab === 'artists' && (
        <View style={styles.tabContent}>
          {characters.length ? (
            characters.map((c, i) => {
              const img = c.sheet_preview_path ? `${BACKEND_BASE_URL}${c.sheet_preview_path}` : null;
              return (
                <View key={c.character_id || i} style={styles.albumRow}>
                  <View style={styles.artistCover}>
                    {img
                      ? <Image source={{ uri: img }} style={styles.artistCoverImg} />
                      : <Feather name="user" size={22} color={colors.text.muted} />}
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <AppText style={styles.albumRowTitle} numberOfLines={1}>{c.name || '이름 없음'}</AppText>
                    <AppText style={styles.albumRowMeta}>{c.kind === 'virtual' ? '가상 아티스트' : '아티스트'}</AppText>
                  </View>
                </View>
              );
            })
          ) : <EmptyState title="아직 공개된 아티스트가 없어요." />}
        </View>
      )}

      {/* 피드/커뮤니티 — v3.159: 마이페이지와 동일한 작성 버튼(dashed)·FeedCard */}
      {(tab === 'feed' || tab === 'community') && (
        <View style={styles.feedList}>
          {isSelf ? (
            <TouchableOpacity
              style={styles.composeBtn}
              activeOpacity={0.8}
              accessibilityLabel={tab === 'feed' ? '새 피드 작성' : '새 공지 작성'}
              onPress={() => {
                const kind = tab === 'community' ? 'community' : 'feed';
                if (__DEV__) console.info('[UserChannel] 새 글 작성 진입', { kind });
                navigation.navigate('FeedCompose', kind === 'community' ? { kind } : undefined);
              }}
            >
              <Feather name="edit-3" size={16} color={colors.accent.primary} />
              <AppText style={styles.composeText}>{tab === 'feed' ? '새 피드 작성' : '새 공지 작성'}</AppText>
            </TouchableOpacity>
          ) : null}
          {tab === 'feed' && (
            feeds.length ? feeds.map(renderFeed)
              : <EmptyState title="아직 작성한 피드가 없어요." />
          )}
          {tab === 'community' && (
            notices.length ? notices.map(renderFeed)
              : <EmptyState title="아직 커뮤니티 글이 없어요." />
          )}
        </View>
      )}
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
  // v3.159: 탭바 — MyMusicScreen과 동일 스타일
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.bg.surface1, marginBottom: 12 },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: colors.accent.primary },
  tabText: { fontSize: 15, color: colors.text.muted, fontWeight: '600' },
  tabTextActive: { color: colors.accent.primary },
  subTabRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 12 },
  tabContent: { paddingHorizontal: 16 },
  // v3.159: [새 피드 작성]/[새 공지 작성] — MyMusicScreen composeBtn과 동일(dashed)
  composeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, marginBottom: 12, marginHorizontal: 4,
    borderWidth: 1, borderColor: colors.accent.primary, borderStyle: 'dashed' as any,
    borderRadius: 12,
  },
  composeText: { fontSize: 13, fontWeight: '700', color: colors.accent.primary },
  // v3.159: 앨범 행 — MyMusicScreen albumRow와 동일
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
  // v3.159: 아티스트 카드 — 시트는 세로 비율이라 원형 크롭
  artistCover: {
    width: 56, height: 56, borderRadius: 28, overflow: 'hidden',
    backgroundColor: colors.bg.surface2, justifyContent: 'center', alignItems: 'center',
  },
  artistCoverImg: { width: 56, height: 56, resizeMode: 'cover' },
  // v3.159: 피드 리스트/블록 — MyMusicScreen 관행
  feedList: { paddingHorizontal: 12, paddingBottom: 40 },
  feedBody: { marginTop: 8, fontSize: 14, lineHeight: 21, color: colors.text.secondary },
  feedTrackWrap: { marginTop: 10, backgroundColor: colors.bg.deepest, borderRadius: 12, overflow: 'hidden' },
  feedItemCard: {
    marginTop: 10, backgroundColor: colors.bg.deepest, borderRadius: 12,
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10,
  },
});
