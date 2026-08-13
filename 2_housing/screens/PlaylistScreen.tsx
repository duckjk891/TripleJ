import { useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Image,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import api, { BACKEND_BASE_URL } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { usePlayerStore } from '../stores/playerStore';
import { colors } from '../theme/colors';
import { AppText, EmptyState, Button } from '../components/ui';

interface Playlist {
  id: string;
  name: string;
  title?: string;
  track_count?: number;
  description?: string;
  created_at?: string;
  cover_images?: string[]; // 내부 상위 4곡 커버 (프론트에서 부가 로드)
}

function getCoverUrl(img: string): string {
  return `${BACKEND_BASE_URL}/api/upload/cover-preview/${encodeURIComponent(img)}`;
}

export default function PlaylistScreen({ navigation }: any) {
  const { user } = useAuthStore();
  const { track: playingTrack } = usePlayerStore();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [playlistTracks, setPlaylistTracks] = useState<any[]>([]);
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameText, setRenameText] = useState('');

  const fetchPlaylists = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await api.get('/playlists/');
      const raw: Playlist[] = res.data.playlists || res.data || [];
      setPlaylists(raw); // 기본 목록 먼저 렌더
      // 각 플레이리스트의 상위 4곡 커버 병렬 로드 (실패해도 카드는 유지)
      const enriched = await Promise.all(
        raw.map(async (p) => {
          try {
            const detail = await api.get(`/playlists/${p.id}`);
            const tracks: any[] = detail.data.tracks || [];
            const cover_images = tracks
              .map((t: any) => t.cover_image || t.cover_image_url)
              .filter(Boolean)
              .slice(0, 4);
            return { ...p, cover_images };
          } catch {
            return { ...p, cover_images: [] };
          }
        })
      );
      setPlaylists(enriched);
    } catch {
      // Backend not available
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      if (user) fetchPlaylists();
    }, [user])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    if (selectedPlaylist) {
      fetchPlaylistTracks(selectedPlaylist.id);
    } else {
      fetchPlaylists();
    }
  };

  const fetchPlaylistTracks = async (playlistId: string) => {
    setLoadingTracks(true);
    try {
      const res = await api.get(`/playlists/${playlistId}`);
      setPlaylistTracks(res.data.tracks || []);
    } catch {
      setPlaylistTracks([]);
    } finally {
      setLoadingTracks(false);
      setRefreshing(false);
    }
  };

  const handleDeletePlaylist = (playlist: Playlist) => {
    Alert.alert('플레이리스트 삭제', `"${playlist.name || playlist.title}"을(를) 삭제하시겠습니까?`, [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: async () => {
        try {
          await api.delete(`/playlists/${playlist.id}`);
          setPlaylists((prev) => prev.filter((p) => p.id !== playlist.id));
        } catch { Alert.alert('오류', '삭제에 실패했습니다.'); }
      }},
    ]);
  };

  const handleRenamePlaylist = async () => {
    if (!selectedPlaylist || !renameText.trim()) return;
    try {
      await api.put(`/playlists/${selectedPlaylist.id}`, { title: renameText.trim() });
      setSelectedPlaylist({ ...selectedPlaylist, name: renameText.trim(), title: renameText.trim() });
      setPlaylists((prev) => prev.map((p) => p.id === selectedPlaylist.id ? { ...p, name: renameText.trim(), title: renameText.trim() } : p));
      setShowRenameModal(false);
    } catch { Alert.alert('오류', '이름 변경에 실패했습니다.'); }
  };

  const handleRemoveTrackFromPlaylist = (trackId: string) => {
    if (!selectedPlaylist) return;
    Alert.alert('곡 삭제', '이 곡을 플레이리스트에서 제거하시겠습니까?', [
      { text: '취소', style: 'cancel' },
      { text: '제거', style: 'destructive', onPress: async () => {
        try {
          await api.delete(`/playlists/${selectedPlaylist.id}/tracks/${trackId}`);
          setPlaylistTracks((prev) => prev.filter((t: any) => String(t.id || t.track_id) !== trackId));
        } catch { Alert.alert('오류', '제거에 실패했습니다.'); }
      }},
    ]);
  };

  const handlePlaylistPress = (playlist: Playlist) => {
    setSelectedPlaylist(playlist);
    fetchPlaylistTracks(playlist.id);
  };

  const renderPlaylist = ({ item }: { item: Playlist }) => {
    const covers = item.cover_images || [];
    const hasCovers = covers.length > 0;
    return (
      <TouchableOpacity
        style={styles.playlistItem}
        activeOpacity={0.7}
        onPress={() => handlePlaylistPress(item)}
        onLongPress={() => handleDeletePlaylist(item)}
      >
        {hasCovers ? (
          <View style={styles.playlistMosaic}>
            {[0, 1, 2, 3].map((i) => {
              const c = covers[i];
              return (
                <View key={i} style={styles.mosaicCell}>
                  {c ? (
                    <Image source={{ uri: getCoverUrl(c) }} style={styles.mosaicImg} />
                  ) : (
                    <View style={[styles.mosaicImg, { backgroundColor: colors.bg.surface2 }]} />
                  )}
                </View>
              );
            })}
          </View>
        ) : (
          <View style={styles.playlistIcon}>
            <AppText style={styles.playlistIconText}>{'♫'}</AppText>
          </View>
        )}
        <View style={styles.playlistInfo}>
          <AppText style={styles.playlistName} numberOfLines={1}>{item.name || item.title}</AppText>
          {item.description ? (
            <AppText style={styles.playlistDesc} numberOfLines={1}>{item.description}</AppText>
          ) : null}
          <AppText style={styles.playlistCount}>
            {item.track_count != null ? `${item.track_count}곡` : `${covers.length}곡`}
          </AppText>
        </View>
      </TouchableOpacity>
    );
  };

  const renderTrack = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={styles.trackItem}
      activeOpacity={0.7}
      onPress={() => {
        // 플레이리스트 곡 목록을 queue로 설정
        const idx = playlistTracks.findIndex((t: any) => (t.id || t.track_id) === (item.id || item.track_id));
        usePlayerStore.getState().setQueue(playlistTracks);
        usePlayerStore.getState().setCurrentIndex(idx >= 0 ? idx : 0);
        navigation.navigate('Player', { track: item });
      }}
    >
      {item.cover_image || item.cover_image_url ? (
        <Image source={{ uri: getCoverUrl(item.cover_image || item.cover_image_url) }} style={styles.trackCover} />
      ) : (
        <View style={[styles.trackCover, { backgroundColor: colors.bg.surface1, justifyContent: 'center', alignItems: 'center' }]}>
          <AppText style={{ fontSize: 20, color: colors.border.default }}>{'♪'}</AppText>
        </View>
      )}
      <View style={{ flex: 1, marginLeft: 12 }}>
        <AppText style={{ fontSize: 15, fontWeight: '600', color: colors.text.primary, marginBottom: 4 }} numberOfLines={1}>{item.title}</AppText>
        <AppText style={{ fontSize: 12, color: colors.text.secondary }}>{item.artist_name || item.uploader_nickname || 'AI'}</AppText>
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
          <AppText style={{ fontSize: 11, color: colors.text.muted }}>{'▶'} {item.play_count ?? 0}</AppText>
          <AppText style={{ fontSize: 11, color: colors.text.muted }}>{'♥'} {item.like_count ?? 0}</AppText>
        </View>
      </View>
      <TouchableOpacity onPress={() => handleRemoveTrackFromPlaylist(String(item.id || item.track_id))} style={{ padding: 8 }}>
        <AppText style={{ color: colors.text.muted, fontSize: 14 }}>{'✕'}</AppText>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {loading ? (
        <ActivityIndicator size="large" color={colors.accent.primary} style={{ marginTop: 40 }} />
      ) : !user ? (
        <EmptyState
          icon="♫"
          title="나만의 플레이리스트"
          hint={'좋아하는 곡을 모아서\n나만의 플레이리스트를 만들어보세요!'}
          action={<Button label="로그인하고 시작하기" onPress={() => navigation.navigate('Settings')} />}
        />
      ) : selectedPlaylist ? (
        // 플레이리스트 상세 - 곡 목록
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12 }}>
            <TouchableOpacity onPress={() => { setSelectedPlaylist(null); setPlaylistTracks([]); }}>
              <AppText style={{ color: colors.accent.primary, fontSize: 14 }}>{'← 목록으로'}</AppText>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setRenameText(selectedPlaylist.name || selectedPlaylist.title || ''); setShowRenameModal(true); }}>
              <AppText style={{ color: colors.text.secondary, fontSize: 13 }}>이름 변경</AppText>
            </TouchableOpacity>
          </View>
          <AppText style={{ paddingHorizontal: 20, fontSize: 20, fontWeight: 'bold', color: colors.text.primary, marginBottom: 12 }}>{selectedPlaylist.name || selectedPlaylist.title}</AppText>
          <AppText style={{ paddingHorizontal: 20, fontSize: 12, color: colors.text.muted, marginBottom: 12 }}>{playlistTracks.length}곡 · 길게 눌러서 삭제</AppText>
          {loadingTracks ? (
            <ActivityIndicator size="large" color={colors.accent.primary} style={{ marginTop: 20 }} />
          ) : playlistTracks.length > 0 ? (
            <FlatList
              data={playlistTracks}
              keyExtractor={(item) => String(item.id || item.track_id)}
              renderItem={renderTrack}
              contentContainerStyle={{ paddingBottom: playingTrack ? 140 : 80 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent.primary} />}
            />
          ) : (
            <EmptyState title="이 플레이리스트에 곡이 없어요" />
          )}
        </View>
      ) : playlists.length > 0 ? (
        <FlatList
          data={playlists}
          keyExtractor={(item) => item.id}
          renderItem={renderPlaylist}
          contentContainerStyle={{ paddingBottom: playingTrack ? 140 : 80 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent.primary} colors={[colors.accent.primary]} />}
        />
      ) : (
        <EmptyState icon="♫" title="담은 곡이 없습니다" hint="차트에서 곡을 담아보세요!" />
      )}
      {/* 이름 변경 모달 */}
      <Modal visible={showRenameModal} transparent animationType="fade" onRequestClose={() => setShowRenameModal(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' }} activeOpacity={1} onPress={() => setShowRenameModal(false)}>
          <View style={{ backgroundColor: colors.bg.surface1, borderRadius: 16, padding: 20, width: '80%' }}>
            <AppText style={{ fontSize: 16, fontWeight: 'bold', color: colors.text.primary, marginBottom: 12 }}>플레이리스트 이름 변경</AppText>
            <TextInput
              style={{ backgroundColor: colors.bg.deepest, borderRadius: 10, padding: 12, color: colors.text.primary, borderWidth: 1, borderColor: colors.border.subtle, marginBottom: 16 }}
              value={renameText}
              onChangeText={setRenameText}
              placeholder="새 이름"
              placeholderTextColor={colors.text.muted}
              autoFocus
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Button label="취소" variant="tonal" fullWidth onPress={() => setShowRenameModal(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="변경" fullWidth onPress={handleRenamePlaylist} />
              </View>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.deepest,
  },
  playlistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.bg.surface1,
  },
  playlistIcon: {
    width: 52,
    height: 52,
    borderRadius: 8,
    backgroundColor: colors.bg.surface1,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  playlistIconText: {
    fontSize: 22,
    color: colors.accent.primary,
  },
  playlistMosaic: {
    width: 52,
    height: 52,
    borderRadius: 8,
    overflow: 'hidden',
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginRight: 14,
    backgroundColor: colors.bg.surface1,
  },
  mosaicCell: {
    width: '50%',
    height: '50%',
  },
  mosaicImg: {
    width: '100%',
    height: '100%',
  },
  playlistInfo: {
    flex: 1,
  },
  trackItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.bg.surface1,
  },
  trackCover: {
    width: 48,
    height: 48,
    borderRadius: 8,
  },
  playlistName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text.primary,
    marginBottom: 2,
  },
  playlistDesc: {
    fontSize: 13,
    color: colors.text.secondary,
    marginBottom: 2,
  },
  playlistCount: {
    fontSize: 12,
    color: colors.text.muted,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 100,
  },
  emptyIcon: {
    fontSize: 64,
    color: colors.border.subtle,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 16,
    color: colors.text.muted,
    marginBottom: 8,
  },
  emptyHint: {
    fontSize: 13,
    color: colors.border.default,
  },
  promoIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  promoTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text.primary,
    marginBottom: 12,
  },
  promoDesc: {
    fontSize: 15,
    color: colors.text.secondary,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 28,
  },
  loginButton: {
    backgroundColor: colors.accent.primary,
    borderRadius: 24,
    paddingVertical: 14,
    paddingHorizontal: 40,
  },
  loginButtonText: {
    color: colors.text.primary,
    fontSize: 16,
    fontWeight: 'bold',
  },
});
