import { useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api, { BACKEND_BASE_URL } from '../services/api';
import { usePlayerStore } from '../stores/playerStore';
import { colors } from '../theme/colors';

interface UsedItem {
  name?: string;
  category?: string;
  image_object_name?: string;
}

interface CoverCharacter {
  name?: string;
  used_items?: UsedItem[];
}

interface Track {
  id: string;
  title: string;
  uploader_id?: string;
  uploader_nickname?: string;
  artist_name?: string;
  cover_image?: string;
  cover_image_url?: string;
  play_count?: number;
  like_count?: number;
  genre?: string[];
  mood?: string[];
  cover_character?: CoverCharacter | null;
}

function getCoverUrl(coverImage?: string): string | null {
  if (!coverImage) return null;
  return `${BACKEND_BASE_URL}/api/upload/cover-preview/${encodeURIComponent(coverImage)}`;
}

export default function AgencyProfileScreen({ route, navigation }: any) {
  const insets = useSafeAreaInsets();
  const hasMiniPlayer = !!usePlayerStore((s) => s.track);
  const { uploaderNickname, uploaderId } = route.params as {
    uploaderNickname: string;
    uploaderId?: string;
  };

  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 9004: list_tracks에 uploader 필터 없음 → search로 nickname 매칭
        const res = await api.get('/tracks/search', {
          params: { q: uploaderNickname, page: 1, limit: 50 },
        });
        if (cancelled) return;
        const all: Track[] = res.data?.tracks || [];
        // 검색은 title/tags/prompt/uploader_nickname 모두 OR라 정확 매칭만 필터
        // uploader_id가 있으면 그걸로, 없으면 nickname 그대로
        const filtered = all.filter((t) => {
          if (uploaderId) return t.uploader_id === uploaderId;
          return (t.uploader_nickname || t.artist_name) === uploaderNickname;
        });
        // 각 트랙의 cover_character는 search 응답엔 없을 수 있어 별도로 가져오면 비싸니 일단 list만 표시
        // (개별 곡 진입 시 PlayerScreen이 풀 트랙 가져오면서 cover_character 채움)
        setTracks(filtered);
      } catch (err) {
        console.warn('[AgencyProfile] 곡 조회 실패:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [uploaderNickname, uploaderId]);

  // 각 트랙의 cover_character.name을 모아 아티스트 명단 구성 (있을 때만)
  const artistNames = Array.from(
    new Set(
      tracks
        .map((t) => t.cover_character?.name)
        .filter((n): n is string => !!n && n.trim() !== ''),
    ),
  );

  const totalPlays = tracks.reduce((sum, t) => sum + (t.play_count ?? 0), 0);
  const totalLikes = tracks.reduce((sum, t) => sum + (t.like_count ?? 0), 0);

  const renderTrack = ({ item }: { item: Track }) => {
    const coverUri = getCoverUrl(item.cover_image || item.cover_image_url);
    return (
      <TouchableOpacity
        style={styles.trackItem}
        activeOpacity={0.7}
        onPress={() => navigation.navigate('Player', { track: item })}
      >
        {coverUri ? (
          <Image source={{ uri: coverUri }} style={styles.coverImg} />
        ) : (
          <View style={[styles.coverImg, styles.coverPh]}>
            <Text style={{ fontSize: 22, color: colors.text.muted }}>♪</Text>
          </View>
        )}
        <View style={{ flex: 1, marginLeft: 12, justifyContent: 'center' }}>
          <Text style={styles.trackTitle} numberOfLines={1}>{item.title}</Text>
          <View style={styles.tagsRow}>
            {(item.genre || []).slice(0, 2).map((g, i) => (
              <View key={`g-${i}`} style={styles.tag}><Text style={styles.tagText}>{g}</Text></View>
            ))}
            {(item.mood || []).slice(0, 2).map((m, i) => (
              <View key={`m-${i}`} style={[styles.tag, styles.moodTag]}><Text style={styles.tagText}>{m}</Text></View>
            ))}
          </View>
          <View style={styles.statsRow}>
            <Text style={styles.statText}>▶ {item.play_count ?? 0}</Text>
            <Text style={styles.statText}>♥ {item.like_count ?? 0}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{uploaderNickname}</Text>
        <View style={styles.backBtn} />
      </View>

      <FlatList
        data={tracks}
        keyExtractor={(item) => item.id}
        renderItem={renderTrack}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: 100 + insets.bottom + (hasMiniPlayer ? 70 : 0) },
        ]}
        ListHeaderComponent={
          <>
            <View style={styles.profileBox}>
              <Text style={styles.companyLabel}>{uploaderNickname} 엔터테인먼트</Text>
              <View style={styles.statsBox}>
                <View style={styles.statCol}>
                  <Text style={styles.statValue}>{tracks.length}</Text>
                  <Text style={styles.statLabel}>발매곡</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statCol}>
                  <Text style={styles.statValue}>{totalPlays.toLocaleString()}</Text>
                  <Text style={styles.statLabel}>총 재생수</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statCol}>
                  <Text style={styles.statValue}>{totalLikes.toLocaleString()}</Text>
                  <Text style={styles.statLabel}>총 좋아요</Text>
                </View>
              </View>
            </View>

            {artistNames.length > 0 && (
              <View style={styles.artistsBox}>
                <Text style={styles.sectionLabel}>소속 아티스트</Text>
                <View style={styles.artistChipsRow}>
                  {artistNames.map((n) => (
                    <View key={n} style={styles.artistChip}>
                      <Text style={styles.artistChipText}>🎤 {n}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            <Text style={styles.sectionLabel}>발매곡 ({tracks.length})</Text>
          </>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.emptyBox}>
              <ActivityIndicator size="large" color={colors.accent.primary} />
            </View>
          ) : (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>아직 발매한 곡이 없어요</Text>
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: colors.bg.surface1,
  },
  backBtn: {
    width: 40, height: 40, justifyContent: 'center', alignItems: 'center',
  },
  backBtnText: { color: colors.text.primary, fontSize: 26, fontWeight: '300' },
  headerTitle: { flex: 1, color: colors.text.primary, fontSize: 16, fontWeight: '700', textAlign: 'center' },

  listContent: { padding: 16, paddingBottom: 100 },

  profileBox: {
    padding: 16, marginBottom: 16, borderRadius: 14,
    backgroundColor: colors.bg.surface1,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  companyLabel: {
    fontSize: 18, fontWeight: '700', color: colors.accent.primary,
    marginBottom: 12, textAlign: 'center',
  },
  statsBox: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.bg.surface2, borderRadius: 10, padding: 10,
  },
  statCol: { flex: 1, alignItems: 'center' },
  statDivider: { width: 1, height: 28, backgroundColor: colors.border.subtle },
  statValue: { fontSize: 16, fontWeight: '700', color: colors.text.primary, marginBottom: 2 },
  statLabel: { fontSize: 11, color: colors.text.muted },

  artistsBox: {
    padding: 12, marginBottom: 16, borderRadius: 12,
    backgroundColor: colors.bg.surface1,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  artistChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  artistChip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12,
    backgroundColor: colors.bg.surface2,
    borderWidth: 1, borderColor: colors.accent.primary,
  },
  artistChipText: { fontSize: 12, color: colors.text.primary, fontWeight: '600' },

  sectionLabel: {
    fontSize: 12, fontWeight: '700', color: colors.text.secondary,
    marginBottom: 8, marginLeft: 2, letterSpacing: 0.3,
  },

  trackItem: {
    flexDirection: 'row', padding: 10, marginBottom: 8,
    backgroundColor: colors.bg.surface1, borderRadius: 12,
  },
  coverImg: { width: 56, height: 56, borderRadius: 8 },
  coverPh: { backgroundColor: colors.bg.surface2, justifyContent: 'center', alignItems: 'center' },
  trackTitle: { fontSize: 14, fontWeight: '700', color: colors.text.primary, marginBottom: 4 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
  tag: {
    backgroundColor: 'rgba(233, 69, 96, 0.2)',
    borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
    marginRight: 4, marginBottom: 2,
  },
  moodTag: { backgroundColor: 'rgba(100, 100, 255, 0.2)' },
  tagText: { fontSize: 11, color: colors.text.secondary },
  statsRow: { flexDirection: 'row', gap: 12 },
  statText: { fontSize: 11, color: colors.text.muted },

  emptyBox: { padding: 48, alignItems: 'center' },
  emptyText: { color: colors.text.muted, fontSize: 14 },
});
