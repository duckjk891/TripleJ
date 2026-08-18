// [TrackActionSheet] 곡 더보기(⋮) 액션 시트 — 재생 / 좋아요 / 재생목록에 추가 / 플레이리스트에 담기.
// 차트·검색 등 곡 목록 화면이 같은 메뉴·동작을 쓰도록 공용화(플레이리스트 담기 시트, 비회원 담기 안내 포함).
import { useState } from 'react';
import { Modal, View, TouchableOpacity, TextInput, Alert, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useLikesStore } from '../stores/likesStore';
import { usePlayerStore } from '../stores/playerStore';
import { AppText, Button } from './ui';
import { TrackCover, RowTrack } from './TrackRow';
import GuestQueueNoticeModal from './GuestQueueNoticeModal';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';

interface Props {
  track: RowTrack | null;          // null이면 닫힌 상태
  onClose: () => void;
  onPlay: (track: RowTrack) => void;
  /** 좋아요 토글 시 화면의 like_count를 낙관적으로 보정하고 싶을 때 */
  onLikeChanged?: (trackId: string, delta: number) => void;
}

export default function TrackActionSheet({ track, onClose, onPlay, onLikeChanged }: Props) {
  const navigation = useNavigation<any>();
  const user = useAuthStore((s) => s.user);
  const likedMap = useLikesStore((s) => s.liked);
  const toggleLikeStore = useLikesStore((s) => s.toggle);
  const playerStore = usePlayerStore();

  const [showPlaylistModal, setShowPlaylistModal] = useState(false);
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState('');
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [pendingQueueTrack, setPendingQueueTrack] = useState<RowTrack | null>(null);

  // 비로그인 → 로그인 화면으로 이동(Alert 다중버튼은 웹에서 미동작)
  const requireLogin = (): boolean => {
    if (!user) {
      if (__DEV__) console.info('[TrackActionSheet] 비로그인 액션 → 로그인 화면 이동');
      onClose();
      navigation.navigate('Settings');
      return false;
    }
    return true;
  };

  const toggleLike = (trackId: string) => {
    if (!requireLogin()) return;
    const wasLiked = !!useLikesStore.getState().liked[trackId];
    toggleLikeStore(trackId); // 낙관적 — 실패 시 스토어가 롤백
    onLikeChanged?.(trackId, wasLiked ? -1 : 1);
  };

  // 재생목록(큐) 추가 — 회원 전용 아님. 비회원 첫 담기에만 안내 팝업.
  const addToQueueNow = (t: RowTrack) => {
    const ok = playerStore.addToQueue(t);
    if (__DEV__) console.info('[TrackActionSheet] addToQueue', { id: t.id, ok });
    Alert.alert(ok ? '재생목록 추가' : '알림', ok ? '재생목록에 추가되었어요.' : '이미 재생목록에 있어요.');
  };

  const handleAddToQueue = (t: RowTrack) => {
    if (!user && !playerStore.guestNoticeAck) {
      if (__DEV__) console.info('[TrackActionSheet] 비회원 담기 → 안내 팝업', { id: t.id });
      setPendingQueueTrack(t);
      return;
    }
    addToQueueNow(t);
  };

  const handleAddToPlaylist = async (t: RowTrack) => {
    if (!requireLogin()) return;
    setSelectedTrackId(t.id);
    try {
      const res = await api.get('/playlists/');
      setPlaylists(res.data.playlists || res.data || []);
    } catch (err: any) {
      console.error('[TrackActionSheet] 플레이리스트 조회 실패', { status: err?.response?.status });
      setPlaylists([]);
    }
    setShowPlaylistModal(true);
  };

  const addToExistingPlaylist = async (playlistId: string) => {
    try {
      await api.post(`/playlists/${playlistId}/tracks`, { track_id: selectedTrackId });
      Alert.alert('완료', '플레이리스트에 추가되었습니다!');
    } catch (err: any) {
      console.error('[TrackActionSheet] 플레이리스트 추가 실패', { playlistId, status: err?.response?.status });
      Alert.alert('오류', err?.response?.data?.error || '추가에 실패했습니다.');
    }
    setShowPlaylistModal(false);
  };

  const createAndAddToPlaylist = async () => {
    const name = newPlaylistName.trim();
    if (!name) { Alert.alert('알림', '플레이리스트 이름을 입력해주세요.'); return; }
    try {
      const createRes = await api.post('/playlists/', { title: name });
      await api.post(`/playlists/${createRes.data.id}/tracks`, { track_id: selectedTrackId });
      Alert.alert('완료', `"${name}"에 추가되었습니다!`);
    } catch (err: any) {
      console.error('[TrackActionSheet] 플레이리스트 생성 실패', { status: err?.response?.status });
      Alert.alert('오류', err?.response?.data?.error || '생성에 실패했습니다.');
    }
    setNewPlaylistName('');
    setShowPlaylistModal(false);
  };

  return (
    <>
      {/* 곡 더보기(⋮) 액션 시트 */}
      <Modal visible={!!track} transparent animationType="slide" onRequestClose={onClose}>
        <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={onClose}>
          <View style={styles.sheet}>
            {track ? (
              <>
                <View style={styles.actionSheetHead}>
                  <TrackCover track={track} />
                  <View style={{ flex: 1, marginLeft: spacing.md }}>
                    <AppText variant="bodyStrong" numberOfLines={1}>{track.title}</AppText>
                    <AppText variant="footnote" tone="secondary" numberOfLines={1}>{track.artist_name || '알 수 없는 아티스트'}</AppText>
                  </View>
                </View>
                <TouchableOpacity style={styles.actionSheetItem} onPress={() => { const t = track; onClose(); onPlay(t); }}>
                  <Feather name="play" size={20} color={colors.text.secondary} />
                  <AppText variant="body">재생</AppText>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionSheetItem} onPress={() => toggleLike(track.id)}>
                  <Feather name="heart" size={20} color={likedMap[track.id] ? colors.accent.primary : colors.text.secondary} />
                  <AppText variant="body">{likedMap[track.id] ? '좋아요 취소' : '좋아요'}</AppText>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionSheetItem} onPress={() => { const t = track; onClose(); handleAddToQueue(t); }}>
                  <Feather name="plus" size={20} color={colors.text.secondary} />
                  <AppText variant="body">재생목록에 추가</AppText>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionSheetItem} onPress={() => { const t = track; onClose(); handleAddToPlaylist(t); }}>
                  <Feather name="bookmark" size={20} color={colors.text.secondary} />
                  <AppText variant="body">플레이리스트에 담기</AppText>
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 비회원 담기 안내 */}
      <GuestQueueNoticeModal
        visible={!!pendingQueueTrack}
        onLogin={() => { setPendingQueueTrack(null); navigation.navigate('Settings'); }}
        onContinue={() => {
          const t = pendingQueueTrack;
          setPendingQueueTrack(null);
          playerStore.setGuestNoticeAck(true);
          if (t) addToQueueNow(t);
        }}
        onClose={() => setPendingQueueTrack(null)}
      />

      {/* 플레이리스트 담기 바텀시트 */}
      <Modal visible={showPlaylistModal} transparent animationType="slide" onRequestClose={() => setShowPlaylistModal(false)}>
        <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setShowPlaylistModal(false)}>
          <View style={styles.sheet}>
            <AppText variant="title3" style={styles.sheetTitle}>플레이리스트에 담기</AppText>
            {playlists.length > 0 && (
              <View style={styles.sheetList}>
                {playlists.map((pl: any) => (
                  <TouchableOpacity key={pl.id} style={styles.sheetItem} onPress={() => addToExistingPlaylist(pl.id)}>
                    <AppText variant="body">{pl.title || pl.name}</AppText>
                    <AppText variant="caption" tone="muted">{pl.track_count ?? 0}곡</AppText>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <AppText variant="footnote" tone="secondary" style={styles.sheetLabel}>새 플레이리스트 만들기</AppText>
            <View style={styles.sheetCreateRow}>
              <TextInput
                style={styles.sheetInput}
                placeholder="플레이리스트 이름"
                placeholderTextColor={colors.text.muted}
                value={newPlaylistName}
                onChangeText={setNewPlaylistName}
              />
              <Button label="만들기" size="md" onPress={createAndAddToPlaylist} />
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg.surface1, borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl, padding: spacing.xl, maxHeight: '60%' },
  actionSheetHead: {
    flexDirection: 'row', alignItems: 'center',
    paddingBottom: spacing.md, marginBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  actionSheetItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  sheetTitle: { marginBottom: spacing.lg },
  sheetList: { marginBottom: spacing.lg },
  sheetItem: { paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle },
  sheetLabel: { marginBottom: spacing.sm },
  sheetCreateRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'stretch' },
  sheetInput: {
    flex: 1, backgroundColor: colors.bg.deepest, borderRadius: radius.md, padding: spacing.md,
    color: colors.text.primary, borderWidth: 1, borderColor: colors.border.subtle,
  },
});
