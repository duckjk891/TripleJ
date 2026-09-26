// [TrackActionSheet] 곡 더보기(⋮) 액션 시트 — 재생 / 좋아요 / 재생목록에 추가 / 플레이리스트에 담기.
// 차트·검색 등 곡 목록 화면이 같은 메뉴·동작을 쓰도록 공용화(플레이리스트 담기 시트, 비회원 담기 안내 포함).
// v3.235 B2(D6): 공용 기본 항목 '공유하기' — 차트·마이페이지·검색·플레이리스트·피드 ⋯ 공통, 비로그인·어린이 포함 노출.
import { useState } from 'react';
import { ScrollView, Modal, View, TouchableOpacity, StyleSheet } from 'react-native';
import { showAlert } from '../utils/appAlert';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useLikesStore } from '../stores/likesStore';
import { usePlayerStore } from '../stores/playerStore';
import { AppText } from './ui';
import { TrackCover, RowTrack } from './TrackRow';
import GuestQueueNoticeModal from './GuestQueueNoticeModal';
import { shareTrack, ShareOutcome } from '../utils/trackShare';
import PlaylistPickerSheet from './PlaylistPickerSheet';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';

/** 화면별 추가 메뉴 항목(플레이리스트에서 제거, 공유, 다운로드 등) */
export interface ExtraAction {
  icon: any;                 // Feather 아이콘 이름
  label: string;
  onPress: (track: RowTrack) => void;
  danger?: boolean;          // 삭제 등 위험 동작(빨간색)
}

interface Props {
  track: RowTrack | null;          // null이면 닫힌 상태
  onClose: () => void;
  onPlay: (track: RowTrack) => void;
  /** 좋아요 토글 시 화면의 like_count를 낙관적으로 보정하고 싶을 때 */
  onLikeChanged?: (trackId: string, delta: number) => void;
  /** 기본 항목 아래에 붙는 화면 고유 항목 */
  extraItems?: ExtraAction[];
  /** v3.235 B2: '공유하기' 노출(기본 true) */
  shareable?: boolean;
  /** v3.235 B2: 내 곡 목록(마이페이지) — 비공개 곡 공개 전환 후 공유·내 곡 문구. 생략 시 uploader_id 로 판정 */
  shareOwn?: boolean;
  /** v3.235 B2: 공유 흐름 종료(결과 포함) */
  onShared?: (trackId: string, outcome: ShareOutcome) => void;
  /** v3.235 B2: 비공개 → 공개 전환 성공 직후(목록 '차트 스트리밍 중' 갱신용) */
  onSharePublished?: (trackId: string) => void;
}

export default function TrackActionSheet({
  track, onClose, onPlay, onLikeChanged, extraItems,
  shareable = true, shareOwn, onShared, onSharePublished,
}: Props) {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets(); // v3.196: Modal은 별도 window라 루트 안전영역 패딩 미상속 → 시트에 직접 보강
  const user = useAuthStore((s) => s.user);
  const likedMap = useLikesStore((s) => s.liked);
  const toggleLikeStore = useLikesStore((s) => s.toggle);
  const playerStore = usePlayerStore();

  const [playlistTarget, setPlaylistTarget] = useState<string | null>(null); // 플레이리스트에 담을 곡 id
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
    showAlert(ok ? '재생목록 추가' : '알림', ok ? '재생목록에 추가되었어요.' : '이미 재생목록에 있어요.');
  };

  const handleAddToQueue = (t: RowTrack) => {
    if (!user && !playerStore.guestNoticeAck) {
      if (__DEV__) console.info('[TrackActionSheet] 비회원 담기 → 안내 팝업', { id: t.id });
      setPendingQueueTrack(t);
      return;
    }
    addToQueueNow(t);
  };

  const handleAddToPlaylist = (t: RowTrack) => {
    if (!requireLogin()) return;
    setPlaylistTarget(t.id);
  };

  // v3.235 B2: 공유 — 로그인 게이트 없음(D10). 웹 사용자 활성화 유지를 위해 탭 핸들러 안에서 동기 호출.
  const handleShare = (t: RowTrack) => {
    const anyT = t as any;
    const isOwn = shareOwn ?? (!!user && anyT?.uploader_id != null && String(anyT.uploader_id) === String(user.id));
    shareTrack(anyT, { isOwn, src: 'TrackActionSheet', onPublished: onSharePublished, onDone: onShared })
      .catch((err: any) => console.error('[TrackShare] fail — sheet', { message: err?.message }));
  };

  return (
    <>
      {/* 곡 더보기(⋮) 액션 시트 */}
      <Modal visible={!!track} transparent animationType="slide" onRequestClose={onClose}>
        <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={onClose}>
          {/* v3.196: Modal은 루트 인셋 미상속 → 하단 제스처 바만큼 paddingBottom 보강(v3.191 queueSheet 패턴) */}
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.xl }]}>
            {track ? (
              <>
                <View style={styles.actionSheetHead}>
                  <TrackCover track={track} />
                  <View style={{ flex: 1, marginLeft: spacing.md }}>
                    <AppText variant="bodyStrong" numberOfLines={1}>{track.title}</AppText>
                    <AppText variant="footnote" tone="secondary" numberOfLines={1}>{track.artist_name || '알 수 없는 아티스트'}</AppText>
                  </View>
                </View>
                {/* v3.218 ②: 항목 증가(차트 토글 등)로 maxHeight 초과 시 하단이 잘리던 문제 —
                    목록을 ScrollView 로 감싸 넘치면 스크롤(Android·iOS 공통). */}
                <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
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
                {shareable ? (
                  <TouchableOpacity style={styles.actionSheetItem} onPress={() => { const t = track; onClose(); handleShare(t); }}>
                    <Feather name="share-2" size={20} color={colors.text.secondary} />
                    <AppText variant="body">공유하기</AppText>
                  </TouchableOpacity>
                ) : null}
                {/* 화면 고유 항목 (제거·공유·다운로드·삭제 등) */}
                {(extraItems || []).map((ex) => (
                  <TouchableOpacity
                    key={ex.label}
                    style={styles.actionSheetItem}
                    onPress={() => { const t = track; onClose(); ex.onPress(t); }}
                  >
                    <Feather name={ex.icon} size={20} color={ex.danger ? colors.status.error : colors.text.secondary} />
                    <AppText variant="body" style={ex.danger ? { color: colors.status.error } : undefined}>{ex.label}</AppText>
                  </TouchableOpacity>
                ))}
                </ScrollView>
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

      {/* 플레이리스트 담기 — 공용 시트 */}
      <PlaylistPickerSheet
        visible={!!playlistTarget}
        trackIds={playlistTarget ? [playlistTarget] : []}
        onClose={() => setPlaylistTarget(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg.surface1, borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl, padding: spacing.xl, maxHeight: '78%' },
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
