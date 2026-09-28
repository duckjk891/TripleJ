// [ClubHomeScreen] v3.245 커뮤니티 Phase 1b — 클럽 홈: 상단 정보(멤버 수·소개·가입/탈퇴) +
// 탭 3개 게시판|플레이리스트|정보 (UserChannelScreen 탭 관행 — fontSize 15/600 + 액센트 언더라인).
// 게시판: 기존 FeedCard 재사용 + before 커서 무한스크롤(GET /feeds/club/{id}) — 공개 읽기, 글쓰기는 멤버만.
// 플레이리스트: 클럽 공유 플리(GET /clubs/{id}/playlists) — 곡 목록 탭 시 재생은 큐 교체(PlaylistScreen.playTrack 관행).
// 서버 미배포(404/네트워크) → 전 탭 안내 상태로 강등(크래시 금지). 팝업은 전부 앱 내 다이얼로그(showAlert).
import { useCallback, useEffect, useState } from 'react';
import {
  View, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl,
  StyleSheet, Modal, TextInput, KeyboardAvoidingView,
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { AppText, Button, EmptyState, ScreenLayout } from '../components/ui';
import LoginPrompt from '../components/LoginPrompt';
import FeedCard from '../components/feed/FeedCard';
import FeedImageBlock, { feedImageUri } from '../components/feed/FeedImageBlock';
import TrackRow from '../components/TrackRow';
import { showAlert } from '../utils/appAlert';
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { usePlayerStore } from '../stores/playerStore';
import { useIsChild, useKidsPermission } from '../utils/kidsMode';
import {
  Club, ClubPlaylist, getClub, getClubErrorCode, joinClub, leaveClub,
  listClubFeeds, listClubPlaylists, createClubPlaylist,
} from '../services/clubService';

type ClubTab = 'board' | 'playlists' | 'info';
const BOARD_LIMIT = 20;

const TABS: { key: ClubTab; label: string }[] = [
  { key: 'board', label: '게시판' },
  { key: 'playlists', label: '플레이리스트' },
  { key: 'info', label: '정보' },
];

const fmtDate = (iso?: string): string | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};

export default function ClubHomeScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { clubId, name } = route.params || {};
  const { user } = useAuthStore();
  const playerStore = usePlayerStore();
  // 어린이 — 보호자 허용 없으면 글쓰기 숨김(FeedScreen 관행). 이미지 게이트는 FeedCompose 기존 로직.
  const isChild = useIsChild();
  const canFeedWrite = useKidsPermission('feed_write');
  const feedWriteBlocked = isChild && !canFeedWrite;

  const [detail, setDetail] = useState<Club | null>(null);
  const [detailFailed, setDetailFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<ClubTab>('board');
  const [joinBusy, setJoinBusy] = useState(false);
  const [ctaVisible, setCtaVisible] = useState(false); // 비로그인 액션 → 로그인 오버레이

  // 게시판
  const [feeds, setFeeds] = useState<any[]>([]);
  const [boardFailed, setBoardFailed] = useState(false);
  const [boardBefore, setBoardBefore] = useState<string | null>(null);
  const [boardMore, setBoardMore] = useState(false);

  // 플레이리스트(클럽 공유) — 탭하면 곡 목록 서브뷰(PlaylistScreen 관행)
  const [playlists, setPlaylists] = useState<ClubPlaylist[]>([]);
  const [plFailed, setPlFailed] = useState(false);
  const [selectedPl, setSelectedPl] = useState<ClubPlaylist | null>(null);
  const [plTracks, setPlTracks] = useState<any[]>([]);
  const [plTracksLoading, setPlTracksLoading] = useState(false);
  const [showPlCreate, setShowPlCreate] = useState(false);
  const [plName, setPlName] = useState('');
  const [plBusy, setPlBusy] = useState(false);

  const isMember = !!detail?.is_member || detail?.role === 'owner' || detail?.role === 'member';
  const isOwner = detail?.role === 'owner' || (!!user && !!detail?.owner_id && String(detail.owner_id) === String(user.id));

  // 헤더 타이틀 — 상세 로드 후 실제 클럽명으로 (App.tsx 숨김 탭 기본값은 route param)
  useEffect(() => {
    if (!detail?.name) return;
    navigation.setOptions({ headerTitle: () => <AppText variant="subtitle">{detail.name}</AppText> });
  }, [detail?.name, navigation]);

  const fetchDetail = useCallback(async () => {
    try {
      const d = await getClub(String(clubId));
      setDetail(d);
      setDetailFailed(false);
    } catch (err: any) {
      console.error('[Club] 상세 조회 실패', { clubId, status: err?.response?.status });
      setDetailFailed(true);
    }
  }, [clubId]);

  const fetchBoard = useCallback(async () => {
    try {
      const page = await listClubFeeds(String(clubId), { limit: BOARD_LIMIT });
      setFeeds(page.feeds);
      setBoardBefore(page.next_before);
      setBoardFailed(false);
    } catch (err: any) {
      console.error('[Club] 게시판 조회 실패', { clubId, status: err?.response?.status });
      setFeeds([]);
      setBoardBefore(null);
      setBoardFailed(true);
    }
  }, [clubId]);

  const fetchPlaylists = useCallback(async () => {
    try {
      const list = await listClubPlaylists(String(clubId));
      setPlaylists(list);
      setPlFailed(false);
    } catch (err: any) {
      console.error('[Club] 클럽 플리 조회 실패', { clubId, status: err?.response?.status });
      setPlaylists([]);
      setPlFailed(true);
    }
  }, [clubId]);

  const fetchAll = useCallback(async () => {
    if (__DEV__) console.info('[Club] ClubHome fetchAll', { clubId });
    setLoading(true);
    await Promise.allSettled([fetchDetail(), fetchBoard(), fetchPlaylists()]);
    setLoading(false);
    setRefreshing(false);
  }, [fetchDetail, fetchBoard, fetchPlaylists]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // 글 작성(FeedCompose) 복귀 시 게시판 재조회 — UserChannel focus 관행
  useFocusEffect(useCallback(() => {
    if (!loading) fetchBoard();
  }, [loading, fetchBoard]));

  const handleBoardMore = useCallback(async () => {
    if (tab !== 'board' || !boardBefore || boardMore) return;
    setBoardMore(true);
    if (__DEV__) console.info('[Club] 게시판 loadMore', { before: boardBefore });
    try {
      const page = await listClubFeeds(String(clubId), { limit: BOARD_LIMIT, before: boardBefore });
      setFeeds((prev) => {
        const seen = new Set(prev.map((f) => String(f.id)));
        return [...prev, ...page.feeds.filter((f) => !seen.has(String(f.id)))];
      });
      setBoardBefore(page.next_before);
    } catch (err: any) {
      console.error('[Club] 게시판 loadMore 실패', { status: err?.response?.status });
      setBoardBefore(null);
    } finally {
      setBoardMore(false);
    }
  }, [tab, boardBefore, boardMore, clubId]);

  const requireLogin = (): boolean => {
    if (!user) { setCtaVisible(true); return false; }
    return true;
  };

  const handleJoin = async () => {
    if (!requireLogin() || joinBusy) return;
    setJoinBusy(true);
    try {
      await joinClub(String(clubId));
      console.info('[Club] 가입 성공', { clubId });
      setDetail((d) => d ? { ...d, is_member: true, role: d.role === 'owner' ? d.role : 'member', member_count: (d.member_count ?? 0) + 1 } : d);
    } catch (err: any) {
      console.error('[Club] 가입 실패', { clubId, status: err?.response?.status, code: getClubErrorCode(err) });
      showAlert('오류', '클럽에 가입하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setJoinBusy(false);
    }
  };

  const doLeave = async () => {
    setJoinBusy(true);
    try {
      await leaveClub(String(clubId));
      console.info('[Club] 탈퇴 성공', { clubId });
      setDetail((d) => d ? { ...d, is_member: false, role: null, member_count: Math.max(0, (d.member_count ?? 1) - 1) } : d);
    } catch (err: any) {
      const code = getClubErrorCode(err);
      console.error('[Club] 탈퇴 실패', { clubId, status: err?.response?.status, code });
      if (code === 'owner_cannot_leave') showAlert('알림', '운영자는 클럽을 탈퇴할 수 없어요.');
      else showAlert('오류', '탈퇴하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setJoinBusy(false);
    }
  };

  const handleMembershipPress = () => {
    if (!requireLogin() || joinBusy) return;
    if (isOwner) {
      // 계약: owner leave → 400 'owner_cannot_leave'. 서버 왕복 없이 같은 안내.
      showAlert('알림', '운영자는 클럽을 탈퇴할 수 없어요.');
      return;
    }
    if (isMember) {
      showAlert('클럽 탈퇴', `"${detail?.name ?? '클럽'}"에서 탈퇴할까요?`, [
        { text: '취소', style: 'cancel' },
        { text: '탈퇴', style: 'destructive', onPress: doLeave },
      ]);
      return;
    }
    handleJoin();
  };

  // 멤버만 글쓰기 — 비멤버 탭 시 가입 유도 다이얼로그
  const handleComposePress = () => {
    if (!requireLogin()) return;
    if (!isMember) {
      showAlert('클럽 가입', '클럽 멤버만 글을 쓸 수 있어요. 지금 가입할까요?', [
        { text: '취소', style: 'cancel' },
        { text: '가입하기', onPress: handleJoin },
      ]);
      return;
    }
    if (__DEV__) console.info('[Club] 클럽 글쓰기 진입', { clubId });
    navigation.navigate('FeedCompose', { kind: 'club', clubId: String(clubId) });
  };

  // 클럽 플리 재생 — 플레이리스트 재생 = 큐 교체(PlaylistScreen.playTrack :201-208 관행 그대로)
  const playTrack = (item: any) => {
    const idx = plTracks.findIndex((t: any) => (t.id || t.track_id) === (item.id || item.track_id));
    usePlayerStore.getState().setQueue(plTracks);
    usePlayerStore.getState().setCurrentIndex(idx >= 0 ? idx : 0);
    if (__DEV__) console.info('[Club] 클럽 플리 재생(큐 교체)', { playIndex: idx >= 0 ? idx : 0, len: plTracks.length });
    navigation.navigate('Player', { track: item });
  };

  const openPlaylist = async (pl: ClubPlaylist) => {
    if (__DEV__) console.info('[Club] 클럽 플리 열기', { playlistId: pl.id });
    setSelectedPl(pl);
    setPlTracksLoading(true);
    try {
      const res = await api.get(`/playlists/${pl.id}`);
      setPlTracks(res.data?.tracks || []);
    } catch (err: any) {
      console.error('[Club] 클럽 플리 곡 조회 실패', { playlistId: pl.id, status: err?.response?.status });
      setPlTracks([]);
    } finally {
      setPlTracksLoading(false);
    }
  };

  const handleCreatePlaylist = async () => {
    const title = plName.trim();
    if (!title) { showAlert('알림', '플레이리스트 이름을 입력해주세요.'); return; }
    if (plBusy) return;
    setPlBusy(true);
    try {
      await createClubPlaylist(String(clubId), title);
      console.info('[Club] 클럽 플리 생성 성공', { clubId });
      setPlName('');
      setShowPlCreate(false);
      fetchPlaylists();
    } catch (err: any) {
      console.error('[Club] 클럽 플리 생성 실패', { clubId, status: err?.response?.status });
      showAlert('오류', '플레이리스트를 만들지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setPlBusy(false);
    }
  };

  // ── 게시판 카드 — UserChannel renderFeed 관행(FeedCard + 텍스트/이미지/트랙 블록) ──
  const renderFeed = ({ item }: { item: any }) => {
    const blocks: any[] = item.blocks || [];
    const textBlocks = blocks.filter((b) => b.type === 'text' && b.text);
    const imageBlocks = blocks.filter((b) => b.type === 'image' && (b.image_url || b.object_name));
    const trackBlocks = blocks.filter((b) => b.type === 'track' && b.track?.id);
    return (
      <View style={styles.feedWrap}>
        <FeedCard
          feed={item}
          requireLogin={requireLogin}
          onDeleted={fetchBoard}
          onUpdated={fetchBoard}
          onPressAuthor={() => {
            if (!requireLogin()) return;
            if (item.author_id) navigation.navigate('UserChannel', { authorId: item.author_id, name: item.author_nickname });
          }}
          renderBlocks={() => (
            <View>
              {textBlocks.map((b: any, i: number) => (
                <AppText key={`t${i}`} variant="body" style={styles.feedBody}>{b.text}</AppText>
              ))}
              {imageBlocks.map((b: any, i: number) => {
                const uri = feedImageUri(b);
                return uri ? <FeedImageBlock key={`im${i}`} uri={uri} /> : null;
              })}
              {trackBlocks.map((b: any, i: number) => (
                <View key={`tr${i}`} style={styles.feedTrackWrap}>
                  <TrackRow
                    track={{ ...b.track, id: String(b.track.id) }}
                    onPress={() => {
                      // 곡 단위 탭 = append 관행(FeedScreen v3.223 ①)
                      playerStore.addToQueue(b.track);
                      const q = usePlayerStore.getState().queue;
                      const idx = q.findIndex((t: any) => String(t?.id) === String(b.track.id));
                      playerStore.setCurrentIndex(idx >= 0 ? idx : q.length - 1);
                      navigation.navigate('Player', { track: b.track });
                    }}
                  />
                </View>
              ))}
            </View>
          )}
        />
      </View>
    );
  };

  const renderPlaylistRow = ({ item }: { item: ClubPlaylist }) => (
    <TouchableOpacity style={styles.plRow} activeOpacity={0.75} onPress={() => openPlaylist(item)} accessibilityLabel={`클럽 플레이리스트 ${item.title || item.name}`}>
      <View style={styles.plIcon}>
        <Feather name="music" size={18} color={colors.accent.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="callout" numberOfLines={1}>{item.title || item.name}</AppText>
        <AppText variant="caption" tone="muted" style={{ marginTop: 2 }}>{`${item.track_count ?? 0}곡`}</AppText>
      </View>
      <Feather name="chevron-right" size={18} color={colors.text.muted} />
    </TouchableOpacity>
  );

  const renderTrackRow = ({ item }: { item: any }) => (
    <TrackRow
      track={{ ...item, id: String(item.id || item.track_id) }}
      onPress={() => playTrack(item)}
    />
  );

  // ── 상단 정보 + 탭바(FlatList 헤더) ──
  const header = (
    <View>
      <View style={styles.infoBox}>
        <View style={styles.infoTopRow}>
          <View style={{ flex: 1 }}>
            <AppText variant="subtitle" numberOfLines={1}>{detail?.name ?? name ?? '클럽'}</AppText>
            <View style={styles.metaRow}>
              <Feather name="users" size={12} color={colors.text.muted} />
              <AppText variant="caption" tone="muted">{`멤버 ${detail?.member_count ?? 0}명`}</AppText>
              {isOwner ? <AppText variant="caption" tone="accent">내가 운영</AppText>
                : isMember ? <AppText variant="caption" tone="accent">가입됨</AppText> : null}
            </View>
          </View>
          <Button
            label={isOwner ? '운영자' : isMember ? '탈퇴' : '가입하기'}
            variant={isMember ? 'tonal' : 'filled'}
            size="sm"
            disabled={joinBusy}
            onPress={handleMembershipPress}
          />
        </View>
        {detail?.description ? (
          <AppText variant="body" tone="secondary" style={{ marginTop: spacing.sm }} numberOfLines={3}>
            {detail.description}
          </AppText>
        ) : null}
      </View>

      {/* 탭바 — UserChannelScreen/MyMusicScreen 관행 동일 */}
      <View style={styles.tabBar}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, tab === t.key && styles.tabActive]}
            onPress={() => {
              if (tab === t.key) return;
              if (__DEV__) console.info('[Club] 탭 전환', { tab: t.key });
              setTab(t.key);
              setSelectedPl(null);
            }}
            accessibilityLabel={`클럽 탭 ${t.label}`}
          >
            <AppText style={[styles.tabText, tab === t.key && styles.tabTextActive]} numberOfLines={1}>{t.label}</AppText>
          </TouchableOpacity>
        ))}
      </View>

      {/* 게시판: 멤버만 글쓰기(dashed — UserChannel composeBtn 관행). 어린이 미허용은 숨김 */}
      {tab === 'board' && !feedWriteBlocked ? (
        <TouchableOpacity style={styles.composeBtn} activeOpacity={0.8} onPress={handleComposePress} accessibilityLabel="클럽 글쓰기">
          <Feather name="edit-3" size={16} color={colors.accent.primary} />
          <AppText style={styles.composeText}>클럽 글쓰기</AppText>
        </TouchableOpacity>
      ) : null}

      {/* 플레이리스트: 곡 목록 서브뷰 헤더(목록으로) 또는 멤버용 만들기 버튼 */}
      {tab === 'playlists' ? (
        selectedPl ? (
          <View style={styles.plSubHead}>
            <TouchableOpacity
              onPress={() => { setSelectedPl(null); setPlTracks([]); }}
              style={styles.plBackBtn}
              accessibilityLabel="플레이리스트 목록으로"
            >
              <Feather name="arrow-left" size={16} color={colors.accent.primary} />
              <AppText variant="bodyLg" tone="accent">목록으로</AppText>
            </TouchableOpacity>
            <AppText variant="title3" style={{ marginTop: spacing.sm }} numberOfLines={1}>{selectedPl.title || selectedPl.name}</AppText>
            <AppText variant="caption" tone="muted" style={{ marginTop: 2 }}>{`${plTracks.length}곡 · 클럽 멤버가 함께 채워요`}</AppText>
          </View>
        ) : isMember ? (
          <TouchableOpacity style={styles.composeBtn} activeOpacity={0.8} onPress={() => setShowPlCreate(true)} accessibilityLabel="클럽 플레이리스트 만들기">
            <Feather name="plus" size={16} color={colors.accent.primary} />
            <AppText style={styles.composeText}>플레이리스트 만들기</AppText>
          </TouchableOpacity>
        ) : null
      ) : null}
    </View>
  );

  // ── 정보 탭 본문(소개·개설일·운영자) ──
  const infoContent = (
    <View style={styles.infoTab}>
      <AppText variant="footnote" tone="secondary" style={styles.infoLabel}>소개</AppText>
      <AppText variant="body" tone="secondary" style={styles.infoValue}>
        {detail?.description || '아직 소개가 없어요.'}
      </AppText>
      <AppText variant="footnote" tone="secondary" style={styles.infoLabel}>개설일</AppText>
      <AppText variant="body" tone="secondary" style={styles.infoValue}>
        {fmtDate(detail?.created_at) || '정보 없음'}
      </AppText>
      <AppText variant="footnote" tone="secondary" style={styles.infoLabel}>운영자</AppText>
      <AppText variant="body" tone="secondary" style={styles.infoValue}>
        {(detail as any)?.owner_nickname || (isOwner ? (user as any)?.nickname || '나' : '클럽 운영자')}
      </AppText>
    </View>
  );

  if (loading) {
    return (
      <ScreenLayout>
        <ActivityIndicator size="large" color={colors.accent.primary} style={{ marginTop: spacing.huge }} />
      </ScreenLayout>
    );
  }

  // 상세 자체가 실패(서버 미배포 등) — 화면 전체 안내 + 재시도
  if (detailFailed && !detail) {
    return (
      <ScreenLayout>
        <EmptyState
          icon={<Feather name="cloud-off" size={44} color={colors.text.muted} />}
          title="클럽 정보를 불러오지 못했어요"
          hint="잠시 후 다시 시도해주세요."
          action={<Button label="다시 시도" variant="tonal" onPress={fetchAll} />}
        />
      </ScreenLayout>
    );
  }

  const listData = tab === 'board' ? feeds : tab === 'playlists' ? (selectedPl ? plTracks : playlists) : [];
  const listRender = tab === 'board' ? renderFeed : tab === 'playlists' ? (selectedPl ? renderTrackRow : renderPlaylistRow) : () => null;

  const emptyComponent = tab === 'info'
    ? infoContent
    : tab === 'board'
    ? (boardFailed
      ? <EmptyState icon={<Feather name="cloud-off" size={44} color={colors.text.muted} />} title="게시판을 불러오지 못했어요" hint="잠시 후 아래로 당겨 다시 시도해주세요." />
      : <EmptyState icon={<Feather name="edit-3" size={44} color={colors.text.muted} />} title="아직 글이 없어요" hint="첫 글로 클럽의 시작을 알려보세요!" />)
    : selectedPl
    ? (plTracksLoading
      ? <ActivityIndicator size="large" color={colors.accent.primary} style={{ marginTop: spacing.xl }} />
      : <EmptyState title="이 플레이리스트에 곡이 없어요" hint="차트나 검색에서 곡을 담아보세요!" />)
    : (plFailed
      ? <EmptyState icon={<Feather name="cloud-off" size={44} color={colors.text.muted} />} title="플레이리스트를 불러오지 못했어요" hint="잠시 후 아래로 당겨 다시 시도해주세요." />
      : <EmptyState icon={<Feather name="music" size={44} color={colors.text.muted} />} title="아직 클럽 플레이리스트가 없어요" hint="멤버라면 첫 플레이리스트를 만들어보세요!" />);

  return (
    <ScreenLayout>
      <FlatList
        data={listData}
        keyExtractor={(item: any, i: number) => String(item?.id ?? item?.track_id ?? i)}
        renderItem={listRender as any}
        ListHeaderComponent={header}
        ListEmptyComponent={<View style={{ paddingTop: tab === 'info' ? 0 : spacing.xl }}>{emptyComponent}</View>}
        ListFooterComponent={tab === 'board' && boardMore
          ? <ActivityIndicator size="small" color={colors.accent.primary} style={{ marginVertical: spacing.lg }} />
          : null}
        onEndReached={handleBoardMore}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); fetchAll(); }}
            tintColor={colors.accent.primary}
            colors={[colors.accent.primary]}
          />
        }
        contentContainerStyle={{ flexGrow: 1, paddingBottom: playerStore.track ? 140 : 80 }}
      />

      {/* 클럽 플레이리스트 만들기 — PlaylistScreen 이름 변경 모달 관행(KAV padding) */}
      <Modal visible={showPlCreate} transparent animationType="fade" onRequestClose={() => setShowPlCreate(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" pointerEvents="box-none">
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setShowPlCreate(false)}>
            <View style={styles.modalCard}>
              <AppText style={styles.modalTitle}>클럽 플레이리스트 만들기</AppText>
              <TextInput
                style={styles.modalInput}
                value={plName}
                onChangeText={setPlName}
                placeholder="플레이리스트 이름"
                placeholderTextColor={colors.text.muted}
                autoFocus
                editable={!plBusy}
              />
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Button label="취소" variant="tonal" fullWidth onPress={() => setShowPlCreate(false)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button label="만들기" fullWidth loading={plBusy} onPress={handleCreatePlaylist} />
                </View>
              </View>
            </View>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>

      {/* 비로그인 액션(가입·글쓰기 등) → 로그인 오버레이 — FeedScreen 관행 */}
      {!user && ctaVisible ? (
        <TouchableOpacity style={styles.loginOverlay} activeOpacity={1} onPress={() => setCtaVisible(false)}>
          <LoginPrompt
            desc={'로그인하면 클럽에 가입하고\n게시판과 플레이리스트를 함께 쓸 수 있어요'}
            onPress={() => navigation.navigate('Settings')}
          />
        </TouchableOpacity>
      ) : null}
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  infoBox: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md },
  infoTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  // 탭바 — MyMusicScreen/UserChannelScreen 관행(15/600 + 액센트 언더라인)
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.bg.surface1, marginBottom: spacing.md },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: colors.accent.primary },
  tabText: { fontSize: 15, color: colors.text.muted, fontWeight: '600' },
  tabTextActive: { color: colors.accent.primary },
  // 글쓰기/플리 만들기 — UserChannel composeBtn(dashed) 관행
  composeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, marginBottom: spacing.md, marginHorizontal: spacing.lg,
    borderWidth: 1, borderColor: colors.accent.primary, borderStyle: 'dashed' as any,
    borderRadius: radius.lg,
  },
  composeText: { fontSize: 13, fontWeight: '700', color: colors.accent.primary },
  feedWrap: { paddingHorizontal: spacing.md },
  feedBody: { marginTop: spacing.sm, color: colors.text.secondary },
  feedTrackWrap: { marginTop: spacing.md, backgroundColor: colors.bg.deepest, borderRadius: radius.lg, overflow: 'hidden' },
  plRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    marginHorizontal: spacing.lg, marginBottom: spacing.md,
    backgroundColor: colors.bg.surface1, borderRadius: radius.lg, padding: spacing.md,
  },
  plIcon: {
    width: 44, height: 44, borderRadius: radius.md,
    backgroundColor: colors.bg.surface2, alignItems: 'center', justifyContent: 'center',
  },
  plSubHead: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  plBackBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  infoTab: { paddingHorizontal: spacing.lg },
  infoLabel: { fontWeight: '700', letterSpacing: 0.3, marginTop: spacing.lg },
  infoValue: { marginTop: spacing.xs, lineHeight: 19 },
  // 모달 — PlaylistScreen 이름 변경 모달 관행
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  modalCard: { backgroundColor: colors.bg.surface1, borderRadius: radius.xl, padding: spacing.xl, width: '80%' },
  modalTitle: { fontSize: 16, fontWeight: 'bold', color: colors.text.primary, marginBottom: spacing.md },
  modalInput: {
    backgroundColor: colors.bg.deepest, borderRadius: radius.md, padding: spacing.md,
    color: colors.text.primary, borderWidth: 1, borderColor: colors.border.subtle, marginBottom: spacing.lg,
  },
  loginOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
