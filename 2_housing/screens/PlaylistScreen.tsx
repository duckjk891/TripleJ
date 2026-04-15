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
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';

interface Playlist {
  id: string;
  name: string;
  title?: string;
  track_count?: number;
  description?: string;
  created_at?: string;
}

function getCoverUrl(img: string): string {
  return `http://192.168.219.106:9001/api/upload/cover-preview/${encodeURIComponent(img)}`;
}

export default function PlaylistScreen({ navigation }: any) {
  const { user } = useAuthStore();
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
      setPlaylists(res.data.playlists || res.data || []);
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

  const renderPlaylist = ({ item }: { item: Playlist }) => (
    <TouchableOpacity
      style={styles.playlistItem}
      activeOpacity={0.7}
      onPress={() => handlePlaylistPress(item)}
      onLongPress={() => handleDeletePlaylist(item)}
    >
      <View style={styles.playlistIcon}>
        <Text style={styles.playlistIconText}>{'♫'}</Text>
      </View>
      <View style={styles.playlistInfo}>
        <Text style={styles.playlistName} numberOfLines={1}>{item.name || item.title}</Text>
        {item.description ? (
          <Text style={styles.playlistDesc} numberOfLines={1}>{item.description}</Text>
        ) : null}
        <Text style={styles.playlistCount}>
          {item.track_count != null ? `${item.track_count}곡` : '0곡'}
        </Text>
      </View>
    </TouchableOpacity>
  );

  const renderTrack = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={styles.trackItem}
      activeOpacity={0.7}
      onPress={() => navigation.navigate('Player', { track: item })}
    >
      {item.cover_image || item.cover_image_url ? (
        <Image source={{ uri: getCoverUrl(item.cover_image || item.cover_image_url) }} style={styles.trackCover} />
      ) : (
        <View style={[styles.trackCover, { backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center' }]}>
          <Text style={{ fontSize: 20, color: '#444' }}>{'♪'}</Text>
        </View>
      )}
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: '#fff', marginBottom: 4 }} numberOfLines={1}>{item.title}</Text>
        <Text style={{ fontSize: 12, color: '#888' }}>{item.artist_name || item.uploader_nickname || 'AI'}</Text>
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
          <Text style={{ fontSize: 11, color: '#666' }}>{'▶'} {item.play_count ?? 0}</Text>
          <Text style={{ fontSize: 11, color: '#666' }}>{'♥'} {item.like_count ?? 0}</Text>
        </View>
      </View>
      <TouchableOpacity onPress={() => handleRemoveTrackFromPlaylist(String(item.id || item.track_id))} style={{ padding: 8 }}>
        <Text style={{ color: '#666', fontSize: 14 }}>{'✕'}</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {loading ? (
        <ActivityIndicator size="large" color="#e94560" style={{ marginTop: 40 }} />
      ) : !user ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.promoIcon}>{'♫'}</Text>
          <Text style={styles.promoTitle}>나만의 플레이리스트</Text>
          <Text style={styles.promoDesc}>
            {'좋아하는 곡을 모아서\n나만의 플레이리스트를 만들어보세요!'}
          </Text>
          <TouchableOpacity
            style={styles.loginButton}
            onPress={() => navigation.navigate('Settings')}
          >
            <Text style={styles.loginButtonText}>로그인하고 시작하기</Text>
          </TouchableOpacity>
        </View>
      ) : selectedPlaylist ? (
        // 플레이리스트 상세 - 곡 목록
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12 }}>
            <TouchableOpacity onPress={() => { setSelectedPlaylist(null); setPlaylistTracks([]); }}>
              <Text style={{ color: '#e94560', fontSize: 14 }}>{'← 목록으로'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setRenameText(selectedPlaylist.name || selectedPlaylist.title || ''); setShowRenameModal(true); }}>
              <Text style={{ color: '#888', fontSize: 13 }}>이름 변경</Text>
            </TouchableOpacity>
          </View>
          <Text style={{ paddingHorizontal: 20, fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 12 }}>{selectedPlaylist.name || selectedPlaylist.title}</Text>
          <Text style={{ paddingHorizontal: 20, fontSize: 12, color: '#666', marginBottom: 12 }}>{playlistTracks.length}곡 · 길게 눌러서 삭제</Text>
          {loadingTracks ? (
            <ActivityIndicator size="large" color="#e94560" style={{ marginTop: 20 }} />
          ) : playlistTracks.length > 0 ? (
            <FlatList
              data={playlistTracks}
              keyExtractor={(item) => String(item.id || item.track_id)}
              renderItem={renderTrack}
              contentContainerStyle={{ paddingBottom: 80 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#e94560" />}
            />
          ) : (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>이 플레이리스트에 곡이 없어요</Text>
            </View>
          )}
        </View>
      ) : playlists.length > 0 ? (
        <FlatList
          data={playlists}
          keyExtractor={(item) => item.id}
          renderItem={renderPlaylist}
          contentContainerStyle={{ paddingBottom: 80 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#e94560" colors={['#e94560']} />}
        />
      ) : (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>{'♫'}</Text>
          <Text style={styles.emptyText}>담은 곡이 없습니다</Text>
          <Text style={styles.emptyHint}>차트에서 곡을 담아보세요!</Text>
        </View>
      )}
      {/* 이름 변경 모달 */}
      <Modal visible={showRenameModal} transparent animationType="fade" onRequestClose={() => setShowRenameModal(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' }} activeOpacity={1} onPress={() => setShowRenameModal(false)}>
          <View style={{ backgroundColor: '#1a1a2e', borderRadius: 16, padding: 20, width: '80%' }}>
            <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#fff', marginBottom: 12 }}>플레이리스트 이름 변경</Text>
            <TextInput
              style={{ backgroundColor: '#0a0a1a', borderRadius: 10, padding: 12, color: '#fff', borderWidth: 1, borderColor: '#333', marginBottom: 16 }}
              value={renameText}
              onChangeText={setRenameText}
              placeholder="새 이름"
              placeholderTextColor="#555"
              autoFocus
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity style={{ flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 10, backgroundColor: '#333' }} onPress={() => setShowRenameModal(false)}>
                <Text style={{ color: '#aaa' }}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 10, backgroundColor: '#e94560' }} onPress={handleRenamePlaylist}>
                <Text style={{ color: '#fff', fontWeight: 'bold' }}>변경</Text>
              </TouchableOpacity>
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
    backgroundColor: '#0a0a1a',
  },
  playlistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  playlistIcon: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  playlistIconText: {
    fontSize: 22,
    color: '#e94560',
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
    borderBottomColor: '#1a1a2e',
  },
  trackCover: {
    width: 48,
    height: 48,
    borderRadius: 8,
  },
  playlistName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 2,
  },
  playlistDesc: {
    fontSize: 13,
    color: '#888',
    marginBottom: 2,
  },
  playlistCount: {
    fontSize: 12,
    color: '#666',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 100,
  },
  emptyIcon: {
    fontSize: 64,
    color: '#333',
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    marginBottom: 8,
  },
  emptyHint: {
    fontSize: 13,
    color: '#444',
  },
  promoIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  promoTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
  },
  promoDesc: {
    fontSize: 15,
    color: '#999',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 28,
  },
  loginButton: {
    backgroundColor: '#e94560',
    borderRadius: 24,
    paddingVertical: 14,
    paddingHorizontal: 40,
  },
  loginButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
