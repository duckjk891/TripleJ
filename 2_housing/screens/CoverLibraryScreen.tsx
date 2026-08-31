// [CoverLibrary] v3.104(B-5): 커버 보관함 — 생성한 커버(cover_sessions)를 한곳에서 보고
// 삭제하거나 다른 곡에 재사용하는 화면 (계약: services/coverLibraryService.ts 헤더 참조).
// - 2열 그리드 + 페이지네이션(무한 스크롤) + 당겨서 새로고침
// - 카드 탭 → 앱 내 액션: [크게 보기] / [삭제](미사용만 — 사용 중이면 곡 제목 나열 안내)
//   / (선택 모드) [이 커버 사용] → coverLibraryStore.pickedCover에 쓰고 goBack (VoiceManage select 관행)
// - 진입: 마이뮤직 앨범 탭 "커버 보관함" / 선택 모드: TrackUpload·MusicResult에서 { select: true }
import { useState, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
  Modal,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { showAlert } from '../utils/appAlert';
import { colors } from '../theme/colors';
import { AppText, EmptyState } from '../components/ui';
import {
  CoverSession,
  getCoverSessions,
  deleteCoverSession,
  coverSessionImageUri,
} from '../services/coverLibraryService';
import { useCoverLibraryStore } from '../stores/coverLibraryStore';

const PAGE_LIMIT = 20;

export default function CoverLibraryScreen({ navigation, route }: any) {
  const selectMode = route?.params?.select === true;
  const [covers, setCovers] = useState<CoverSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [viewerCover, setViewerCover] = useState<CoverSession | null>(null); // 크게 보기 모달
  const pageRef = useRef(1);
  const totalPagesRef = useRef(1);
  const fetchingRef = useRef(false); // 동시 fetch 가드 (onEndReached 중복 호출 방지)

  const fetchPage = useCallback(async (page: number, mode: 'initial' | 'refresh' | 'more') => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    if (mode === 'refresh') setRefreshing(true);
    else if (mode === 'more') setLoadingMore(true);
    else setLoading(true);
    try {
      const res = await getCoverSessions(page, PAGE_LIMIT);
      pageRef.current = page;
      totalPagesRef.current = res.pagination?.totalPages ?? (res.covers.length < PAGE_LIMIT ? page : page + 1);
      setCovers((prev) => (mode === 'more' ? [...prev, ...res.covers] : res.covers));
      if (__DEV__) console.info('[CoverLibrary] fetch OK', { page, count: res.covers.length, mode });
    } catch (err: any) {
      console.error('[CoverLibrary] fetch 실패', { page, status: err?.response?.status, message: err?.message });
      if (mode !== 'more') setCovers([]);
      showAlert('오류', '커버 보관함을 불러오지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      fetchingRef.current = false;
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchPage(1, 'initial');
    }, [fetchPage])
  );

  const handleLoadMore = () => {
    if (fetchingRef.current || loading || refreshing) return;
    if (pageRef.current >= totalPagesRef.current) return;
    fetchPage(pageRef.current + 1, 'more');
  };

  // 선택 모드: store에 쓰고 goBack (VoiceManage select → voiceStore 관행)
  const handleUseCover = (c: CoverSession) => {
    if (__DEV__) console.info('[CoverLibrary] 커버 선택', { id: c.cover_session_id, obj: c.cover_object_name });
    useCoverLibraryStore.getState().setPickedCover({
      objectName: c.cover_object_name,
      imageUri: coverSessionImageUri(c),
      title: c.title,
    });
    navigation.goBack();
  };

  const doDelete = async (c: CoverSession) => {
    try {
      await deleteCoverSession(c.cover_session_id);
      if (__DEV__) console.info('[CoverLibrary] 삭제 완료', { id: c.cover_session_id });
      setCovers((prev) => prev.filter((x) => x.cover_session_id !== c.cover_session_id));
      showAlert('삭제 완료', '커버가 보관함에서 삭제되었어요.');
    } catch (err: any) {
      const status = err?.response?.status;
      console.warn('[CoverLibrary] 삭제 실패', { id: c.cover_session_id, status, data: err?.response?.data });
      if (status === 409) {
        // 사용 중 — 서버가 최신 연결 곡 목록을 반환 (클라 선체크 이후 연결됐을 수 있음)
        const linked = err?.response?.data?.linked_tracks;
        const names = (Array.isArray(linked) ? linked : [])
          .map((t: any) => `· ${t?.title ?? '(제목 없음)'}`)
          .join('\n');
        showAlert(
          '삭제할 수 없어요',
          `이 커버를 사용 중인 곡이 있어요.${names ? `\n\n${names}\n` : '\n'}\n곡에서 커버를 바꾸거나 곡을 정리한 뒤 다시 시도해주세요.`
        );
        fetchPage(1, 'refresh'); // 배지 최신화
      } else if (status === 404) {
        showAlert('안내', '이미 삭제된 커버예요.');
        setCovers((prev) => prev.filter((x) => x.cover_session_id !== c.cover_session_id));
      } else {
        showAlert('오류', '삭제에 실패했어요. 잠시 후 다시 시도해주세요.');
      }
    }
  };

  const handleDelete = (c: CoverSession) => {
    if (c.linked_tracks?.length) {
      // 클라 선체크: 사용 중이면 confirm 없이 곡 목록 안내 (서버 409와 동일 정책)
      const names = c.linked_tracks.map((t) => `· ${t.title ?? '(제목 없음)'}`).join('\n');
      showAlert(
        '삭제할 수 없어요',
        `이 커버를 사용 중인 곡이 있어요.\n\n${names}\n\n곡에서 커버를 바꾸거나 곡을 정리한 뒤 다시 시도해주세요.`
      );
      return;
    }
    showAlert(
      '커버 삭제',
      `"${c.title || '커버'}"를 보관함에서 완전히 삭제할까요?\n수정 이력을 포함해 모두 삭제되며 되돌릴 수 없어요.`,
      [
        { text: '취소', style: 'cancel' },
        { text: '삭제', style: 'destructive', onPress: () => doDelete(c) },
      ]
    );
  };

  // 카드 탭 → 앱 내 액션 팝업 (앱 팝업 정책: showAlert, 버튼 3개+ 세로 스택 지원)
  const handleCardPress = (c: CoverSession) => {
    const usedCount = c.linked_tracks?.length ?? 0;
    showAlert(
      c.title || '커버',
      usedCount > 0 ? `곡 ${usedCount}곡에서 사용 중이에요.` : '아직 어떤 곡에도 사용하지 않았어요.',
      [
        ...(selectMode ? [{ text: '이 커버 사용', onPress: () => handleUseCover(c) }] : []),
        { text: '크게 보기', onPress: () => setViewerCover(c) },
        { text: '삭제', style: 'destructive' as const, onPress: () => handleDelete(c) },
        { text: '닫기', style: 'cancel' as const },
      ]
    );
  };

  const renderCard = ({ item }: { item: CoverSession }) => {
    const usedCount = item.linked_tracks?.length ?? 0;
    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.8}
        onPress={() => handleCardPress(item)}
        accessibilityLabel={`커버 ${item.title || '커버'}`}
      >
        <View style={styles.cardImageWrap}>
          <Image source={{ uri: coverSessionImageUri(item) }} style={styles.cardImage} />
          {usedCount > 0 && (
            <View style={styles.usedBadge}>
              <AppText style={styles.usedBadgeText}>{`곡 ${usedCount}곡 사용 중`}</AppText>
            </View>
          )}
        </View>
        <AppText style={styles.cardTitle} numberOfLines={1}>{item.title || '커버'}</AppText>
        {item.history_count > 1 ? (
          <AppText style={styles.cardMeta}>{`버전 ${item.history_count}개`}</AppText>
        ) : null}
      </TouchableOpacity>
    );
  };

  if (loading && covers.length === 0) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={colors.accent.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {selectMode && (
        <View style={styles.selectHint}>
          <Feather name="info" size={14} color={colors.accent.primary} />
          <AppText style={styles.selectHintText}>커버를 탭한 뒤 "이 커버 사용"을 선택하세요.</AppText>
        </View>
      )}
      {covers.length === 0 ? (
        <EmptyState
          title="아직 보관한 커버가 없어요."
          hint="작업실에서 커버 이미지를 생성하면 여기에 모여요!"
        />
      ) : (
        <FlatList
          data={covers}
          keyExtractor={(item) => item.cover_session_id}
          renderItem={renderCard}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.listContent}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchPage(1, 'refresh')}
              tintColor={colors.accent.primary}
            />
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator size="small" color={colors.accent.primary} style={{ marginVertical: 16 }} />
            ) : null
          }
        />
      )}

      {/* 크게 보기 — 앱 내 전체 화면 모달 */}
      <Modal
        visible={!!viewerCover}
        transparent
        animationType="fade"
        onRequestClose={() => setViewerCover(null)}
      >
        <TouchableOpacity
          style={styles.viewerBackdrop}
          activeOpacity={1}
          onPress={() => setViewerCover(null)}
        >
          {viewerCover && (
            <View style={styles.viewerBody}>
              <Image source={{ uri: coverSessionImageUri(viewerCover) }} style={styles.viewerImage} />
              <AppText style={styles.viewerTitle} numberOfLines={2}>
                {viewerCover.title || '커버'}
              </AppText>
              {viewerCover.linked_tracks?.length ? (
                <AppText style={styles.viewerMeta}>
                  {`곡 ${viewerCover.linked_tracks.length}곡 사용 중`}
                </AppText>
              ) : null}
              <TouchableOpacity
                style={styles.viewerCloseBtn}
                onPress={() => setViewerCover(null)}
                accessibilityLabel="닫기"
              >
                <AppText style={styles.viewerCloseText}>닫기</AppText>
              </TouchableOpacity>
            </View>
          )}
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  center: { justifyContent: 'center', alignItems: 'center' },
  selectHint: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginHorizontal: 16, marginTop: 12, marginBottom: 4,
    backgroundColor: colors.bg.surface1, borderRadius: 10,
    borderWidth: 1, borderColor: colors.accent.primary,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  selectHintText: { flex: 1, fontSize: 12, color: colors.text.secondary },
  listContent: { padding: 16, paddingBottom: 100 },
  row: { gap: 12 },
  card: { flex: 1, marginBottom: 16, maxWidth: '48.5%' },
  cardImageWrap: {
    aspectRatio: 1, borderRadius: 12, overflow: 'hidden',
    backgroundColor: colors.bg.surface2,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  cardImage: { width: '100%', height: '100%' },
  usedBadge: {
    position: 'absolute', left: 6, bottom: 6,
    backgroundColor: 'rgba(13,8,32,0.75)', borderRadius: 8,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  usedBadgeText: { fontSize: 10, fontWeight: '700', color: colors.text.primary },
  cardTitle: { fontSize: 13, fontWeight: '600', color: colors.text.primary, marginTop: 6 },
  cardMeta: { fontSize: 11, color: colors.text.muted, marginTop: 2 },
  viewerBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  viewerBody: { alignItems: 'center', width: '100%' },
  viewerImage: {
    width: '100%', aspectRatio: 1, maxWidth: 480, borderRadius: 16,
    backgroundColor: colors.bg.surface2,
  },
  viewerTitle: { fontSize: 16, fontWeight: '700', color: colors.text.primary, marginTop: 16, textAlign: 'center' },
  viewerMeta: { fontSize: 12, color: colors.text.secondary, marginTop: 4 },
  viewerCloseBtn: {
    marginTop: 20, backgroundColor: colors.bg.surface1,
    borderWidth: 1, borderColor: colors.border.subtle,
    borderRadius: 20, paddingHorizontal: 28, paddingVertical: 10,
  },
  viewerCloseText: { fontSize: 14, fontWeight: '600', color: colors.text.primary },
});
