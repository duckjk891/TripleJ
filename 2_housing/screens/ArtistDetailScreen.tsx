import { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  Linking,
  FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import api, { BACKEND_BASE_URL } from '../services/api';
import { usePlayerStore } from '../stores/playerStore';
import { colors } from '../theme/colors';

interface Artist {
  id: string;
  name: string;
  image?: string | null;
  bio?: string | null;
  track_count?: number;
  total_plays?: number;
  total_likes?: number;
  created_at?: string | null;
}

interface Track {
  id: string;
  title: string;
  cover_image?: string;
  cover_image_url?: string;
  play_count?: number;
  like_count?: number;
}

interface AdItem {
  id: string;
  title?: string;
  category?: string;
  image_url?: string;
  link_url?: string;
  brand?: string;
  price?: number;
}

const CATEGORY_ICON: Record<string, string> = {
  '상의': '👕', '하의': '👖', '신발': '👟', '장소': '📍',
};

function getProfileImage(image?: string | null): string | null {
  if (!image) return null;
  if (image.startsWith('http')) return image;
  return `${BACKEND_BASE_URL}/${image.replace(/^\//, '')}`;
}

function getCoverUrl(img?: string): string | null {
  if (!img) return null;
  return `${BACKEND_BASE_URL}/api/upload/cover-preview/${encodeURIComponent(img)}`;
}

function getAdImage(item: AdItem): string | null {
  if (!item.image_url) return null;
  if (item.image_url.startsWith('http')) return item.image_url;
  // business 라우트의 이미지 프록시 사용
  return `${BACKEND_BASE_URL}/api/business/items/image/${item.image_url.replace(/^\//, '')}`;
}

export default function ArtistDetailScreen({ route, navigation }: any) {
  const insets = useSafeAreaInsets();
  const playerStore = usePlayerStore();
  const { artistId, artistName } = route.params || {};

  const [artist, setArtist] = useState<Artist | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [ads, setAds] = useState<AdItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const [artistRes, tracksRes, adsRes] = await Promise.all([
        api.get(`/artists/${artistId}`),
        api.get(`/artists/${artistId}/tracks`, { params: { limit: 30 } }),
        api.get(`/business/ads/active`),
      ]);
      setArtist(artistRes.data);
      setTracks(Array.isArray(tracksRes.data) ? tracksRes.data : (tracksRes.data?.tracks || []));
      // 이 아티스트의 광고만 필터 (advertiser_id 또는 user_id 매칭)
      const allAds = adsRes.data?.items || [];
      const filtered = allAds.filter((a: any) => a.user_id === artistId);
      setAds(filtered);
    } catch (err) {
      console.warn('[ArtistDetail] fetch error', err);
    } finally {
      setLoading(false);
    }
  }, [artistId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleTrackPress = (track: Track) => {
    const idx = tracks.findIndex((t) => t.id === track.id);
    playerStore.setQueue(tracks);
    playerStore.setCurrentIndex(idx >= 0 ? idx : 0);
    navigation.navigate('Player', { track });
  };

  const handleAdClick = async (item: AdItem) => {
    try {
      api.post(`/business/ads/${item.id}/click`).catch(() => {});
    } catch {}
    if (item.link_url) {
      const url = item.link_url.startsWith('http') ? item.link_url : `https://${item.link_url}`;
      Linking.openURL(url).catch(() => {});
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={colors.accent.primary} />
      </View>
    );
  }

  const profileImg = getProfileImage(artist?.image);

  return (
    <View style={styles.container}>
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 + insets.bottom + (playerStore.track ? 70 : 0) }}
      >
        {/* 헤더: 그라데이션 + 프로필 */}
        <LinearGradient
          colors={[colors.gradient.twilight[0], colors.bg.surface2, colors.bg.deepest]}
          locations={[0, 0.6, 1]}
          style={[styles.heroBg, { paddingTop: insets.top + 12 }]}
        >
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backText}>{'←'}</Text>
          </TouchableOpacity>
          <View style={styles.profileSection}>
            {profileImg ? (
              <Image source={{ uri: profileImg }} style={styles.profileImage} />
            ) : (
              <View style={[styles.profileImage, styles.profilePlaceholder]}>
                <Text style={styles.profilePlaceholderText}>
                  {artist?.name?.[0] || artistName?.[0] || '♪'}
                </Text>
              </View>
            )}
            <Text style={styles.profileName}>{artist?.name || artistName || '알 수 없음'}</Text>
            {artist?.bio ? <Text style={styles.bioText}>{artist.bio}</Text> : null}

            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{artist?.track_count ?? 0}</Text>
                <Text style={styles.statLabel}>곡</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{(artist?.total_plays ?? 0).toLocaleString()}</Text>
                <Text style={styles.statLabel}>재생</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{(artist?.total_likes ?? 0).toLocaleString()}</Text>
                <Text style={styles.statLabel}>좋아요</Text>
              </View>
            </View>
          </View>
        </LinearGradient>

        {/* 트랙 목록 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🎵 곡</Text>
          {tracks.length === 0 ? (
            <Text style={styles.emptyText}>등록된 곡이 없어요</Text>
          ) : (
            tracks.map((t, idx) => {
              const cover = getCoverUrl(t.cover_image || t.cover_image_url);
              return (
                <TouchableOpacity key={t.id} style={styles.trackRow} onPress={() => handleTrackPress(t)}>
                  <Text style={styles.trackRank}>{idx + 1}</Text>
                  {cover ? (
                    <Image source={{ uri: cover }} style={styles.trackCover} />
                  ) : (
                    <View style={[styles.trackCover, styles.trackCoverPlaceholder]}>
                      <Text style={{ color: colors.text.muted, fontSize: 18 }}>♪</Text>
                    </View>
                  )}
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.trackTitle} numberOfLines={1}>{t.title}</Text>
                    <Text style={styles.trackMeta}>
                      ▶ {(t.play_count ?? 0).toLocaleString()} · ♥ {(t.like_count ?? 0).toLocaleString()}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </View>

        {/* 착용/협찬 제품 섹션 */}
        {ads.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>💼 이 아티스트의 아이템</Text>
            <FlatList
              horizontal
              data={ads}
              keyExtractor={(item) => item.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 12 }}
              renderItem={({ item }) => {
                const img = getAdImage(item);
                const icon = CATEGORY_ICON[item.category || ''] || '🛍';
                return (
                  <TouchableOpacity style={styles.adCard} onPress={() => handleAdClick(item)}>
                    {img ? (
                      <Image source={{ uri: img }} style={styles.adImage} />
                    ) : (
                      <View style={[styles.adImage, styles.adImagePlaceholder]}>
                        <Text style={{ fontSize: 36 }}>{icon}</Text>
                      </View>
                    )}
                    <Text style={styles.adCategory}>{icon} {item.category}</Text>
                    <Text style={styles.adTitle} numberOfLines={2}>{item.title || '아이템'}</Text>
                    {item.brand ? <Text style={styles.adBrand}>{item.brand}</Text> : null}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        )}

        <View style={{ height: 60 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  heroBg: { paddingHorizontal: 16, paddingBottom: 24 },
  backBtn: { width: 40, height: 40, justifyContent: 'center' },
  backText: { fontSize: 24, color: colors.text.primary },
  profileSection: { alignItems: 'center', marginTop: 8 },
  profileImage: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: colors.accent.primary,
  },
  profilePlaceholder: {
    backgroundColor: colors.bg.surface2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profilePlaceholderText: {
    fontSize: 48,
    color: colors.accent.primary,
    fontWeight: 'bold',
  },
  profileName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.text.primary,
    marginTop: 16,
  },
  bioText: {
    fontSize: 13,
    color: colors.text.secondary,
    marginTop: 6,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  statsRow: { flexDirection: 'row', marginTop: 16, gap: 24 },
  statBox: { alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: 'bold', color: colors.text.primary },
  statLabel: { fontSize: 11, color: colors.text.secondary, marginTop: 2 },
  section: { paddingTop: 20 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text.primary,
    marginBottom: 10,
    paddingHorizontal: 16,
  },
  emptyText: { fontSize: 13, color: colors.text.muted, paddingHorizontal: 16 },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  trackRank: {
    width: 24,
    fontSize: 14,
    color: colors.text.muted,
    fontWeight: '600',
    textAlign: 'center',
  },
  trackCover: { width: 44, height: 44, borderRadius: 6, marginLeft: 8 },
  trackCoverPlaceholder: {
    backgroundColor: colors.bg.surface1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  trackTitle: { fontSize: 14, color: colors.text.primary, fontWeight: '600' },
  trackMeta: { fontSize: 11, color: colors.text.secondary, marginTop: 3 },
  adCard: {
    width: 130,
    marginRight: 12,
    backgroundColor: colors.bg.surface1,
    borderRadius: 12,
    padding: 8,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  adImage: { width: '100%', aspectRatio: 1, borderRadius: 8, marginBottom: 6 },
  adImagePlaceholder: {
    backgroundColor: colors.bg.surface2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  adCategory: { fontSize: 11, color: colors.accent.primary, fontWeight: '600', marginBottom: 2 },
  adTitle: { fontSize: 12, color: colors.text.primary, fontWeight: '600', minHeight: 32 },
  adBrand: { fontSize: 10, color: colors.text.secondary, marginTop: 2 },
});
