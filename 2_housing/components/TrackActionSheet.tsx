// [TrackActionSheet] 곡 더보기(⋮) 액션 시트 — 차트·검색·플레이리스트·낙서장·마이페이지 공용.
// v3.235 B2(D6): 공용 기본 항목 '공유하기' — 비로그인·어린이 포함 노출.
// v3.402 [TrackMenu] 대표 확정 개편(10-22 "종류가 너무 많아 헷갈린다"):
//   맨 위 아이콘 한 줄(재생·좋아요·재생목록·플레이리스트) + 묶음 4개(공유하기·이 곡으로 만들기·파일 받기·곡 관리).
//   묶음은 같은 시트 안에서 하위 목록으로 바뀌고, ‹ 또는 웹 뒤로 가기로 첫 목록에 돌아온다.
//   남의 곡 = 아이콘 줄 + 공유하기 › + 이 곡 느낌으로 만들기. 파일 받기는 내 곡만, 곡 관리는 manageItems 를 넘긴 화면(마이페이지)만.
import { useEffect, useState } from 'react';
import { ScrollView, View, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import AppModal from './AppModal'; // v3.401 iOS 창 겹침·팝업 무반응 방지(공용 AppModal)
import { showAlert } from '../utils/appAlert';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useAuthStore } from '../stores/authStore';
import { useLikesStore } from '../stores/likesStore';
import { usePlayerStore } from '../stores/playerStore';
import { AppText } from './ui';
import { TrackCover, RowTrack } from './TrackRow';
import GuestQueueNoticeModal from './GuestQueueNoticeModal';
import { shareTrack, ShareOutcome } from '../utils/trackShare';
// v3.256 [MakeLike]: '이 곡 느낌으로 만들기' — 장르·분위기 프리셋 후 작사 디렉터 직행(공용 로직)
import { startMakeLikeFlow } from '../utils/makeLike';
import { isGuestTrialUsed } from '../utils/guestTrial';
import { openLoginModal } from '../utils/loginModal';
import PlaylistPickerSheet from './PlaylistPickerSheet';
import TrackShareDownloadSheet, { downloadTrackMp3, saveTrackFileToDevice, VIDEO_NAME_SUFFIX } from './TrackShareDownloadSheet';
import { getMyClubs, Club } from '../services/clubService';
import { listMyShareVideos, latestShareVideoByTrack, shareVideoObjectUrl } from '../services/trackService';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { useWebBackClose } from '../utils/webBackClose';

/** 화면별 추가 메뉴 항목(플레이리스트에서 제거, 편곡, 곡 관리 등) */
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
  /** 첫 목록 맨 아래에 붙는 화면 고유 항목(예: 이 플레이리스트에서 제거) */
  extraItems?: ExtraAction[];
  /** v3.402: '이 곡으로 만들기 ›' 안에 붙는 항목(다른 장르로 편곡·MR — 조건 판단은 화면이) */
  makeItems?: ExtraAction[];
  /** v3.402: '곡 관리 ›' 항목(차트 업로드/숨기기·아티스트 지정·창작 기록·삭제). 없으면 묶음 자체를 숨김 */
  manageItems?: ExtraAction[];
  /** v3.235 B2: '공유하기' 노출(기본 true) */
  shareable?: boolean;
  /** v3.235 B2: 내 곡 목록(마이페이지) — 비공개 곡 공개 전환 후 공유·내 곡 문구. 생략 시 uploader_id 로 판정 */
  shareOwn?: boolean;
  /** v3.235 B2: 공유 흐름 종료(결과 포함) */
  onShared?: (trackId: string, outcome: ShareOutcome) => void;
  /** v3.235 B2: 비공개 → 공개 전환 성공 직후(목록 '차트 스트리밍 중' 갱신용) */
  onSharePublished?: (trackId: string) => void;
}

type Page = 'main' | 'share' | 'crew' | 'make' | 'file' | 'manage';

const PAGE_TITLE: Record<Exclude<Page, 'main'>, string> = {
  share: '공유하기',
  crew: '크루에 공유',
  make: '이 곡으로 만들기',
  file: '파일 받기',
  manage: '곡 관리',
};

export default function TrackActionSheet({
  track, onClose, onPlay, onLikeChanged, extraItems, makeItems, manageItems,
  shareable = true, shareOwn, onShared, onSharePublished,
}: Props) {
  const navigation = useNavigation<any>();
  const [page, setPage] = useState<Page>('main');
  useWebBackClose(!!track, onClose); // v3.369: 웹 뒤로 가기 = 시트 닫기(앱 종료 방지)
  // v3.402: 하위 목록에서 웹 뒤로 가기 = 한 단계 위로(크루 고르기 → 공유하기 → 첫 목록)
  useWebBackClose(!!track && page !== 'main', () => setPage((p) => (p === 'crew' ? 'share' : 'main')));
  const insets = useSafeAreaInsets(); // v3.196: Modal은 별도 window라 루트 안전영역 패딩 미상속 → 시트에 직접 보강
  const user = useAuthStore((s) => s.user);
  const likedMap = useLikesStore((s) => s.liked);
  const toggleLikeStore = useLikesStore((s) => s.toggle);
  const playerStore = usePlayerStore();

  const [playlistTarget, setPlaylistTarget] = useState<string | null>(null); // 플레이리스트에 담을 곡 id
  const [pendingQueueTrack, setPendingQueueTrack] = useState<RowTrack | null>(null);
  const [snsTrack, setSnsTrack] = useState<{ id: string; title: string } | null>(null); // 남의 곡 SNS 세로 영상 시트
  const [crews, setCrews] = useState<Club[] | null>(null);  // null = 불러오는 중
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // 다른 곡으로 열리면 항상 첫 목록부터
  useEffect(() => {
    setPage('main');
    setBusyKey(null);
  }, [track?.id]);

  const anyTrack = track as any;
  const isOwn = !!track && (shareOwn ?? (!!user && anyTrack?.uploader_id != null && String(anyTrack.uploader_id) === String(user.id)));

  const goPage = (p: Page) => {
    console.info('[TrackMenu] 하위 목록', { page: p, id: track?.id, own: isOwn });
    setPage(p);
  };

  // 비로그인 → 로그인 화면으로 이동(Alert 다중버튼은 웹에서 미동작)
  const requireLogin = (): boolean => {
    if (!user) {
      if (__DEV__) console.info('[TrackMenu] 비로그인 액션 → 로그인 화면 이동');
      onClose();
      navigation.navigate('Settings');
      return false;
    }
    return true;
  };

  // 공유 묶음(낙서장·크루·SNS) — 비로그인은 로그인 모달(v3.276 즉시 로그인 모달 관행)
  const requireLoginModal = (reason: string): boolean => {
    if (user) return true;
    console.info('[TrackMenu] 비로그인 → 로그인 모달', { reason });
    onClose();
    openLoginModal({ reason });
    return false;
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
    if (__DEV__) console.info('[TrackMenu] addToQueue', { id: t.id, ok });
    showAlert(ok ? '재생목록 추가' : '알림', ok ? '재생목록에 추가되었어요.' : '이미 재생목록에 있어요.');
  };

  const handleAddToQueue = (t: RowTrack) => {
    if (!user && !playerStore.guestNoticeAck) {
      if (__DEV__) console.info('[TrackMenu] 비회원 담기 → 안내 팝업', { id: t.id });
      setPendingQueueTrack(t);
      return;
    }
    addToQueueNow(t);
  };

  const handleAddToPlaylist = (t: RowTrack) => {
    if (!requireLogin()) return;
    setPlaylistTarget(t.id);
  };

  // 공유 진입 화면(측정 src) — 시트를 연 화면의 라우트명, 모르면 'sheet'
  const currentRouteName = (): string => {
    try {
      const st = navigation.getState?.();
      const name = st?.routes?.[st.index ?? 0]?.name;
      return typeof name === 'string' && name ? name.slice(0, 24) : 'sheet';
    } catch (err: any) {
      console.error('[TrackShare] fail — route name', { message: err?.message });
      return 'sheet';
    }
  };

  // 네비 params 는 표시에 필요한 필드만(직렬화 가능·가사 등 큰 필드 제외)
  const lightTrack = (st: any) => ({
    id: String(st.id), title: st.title, artist_name: st.artist_name,
    cover_image: anyTrack?.cover_image, cover_image_url: anyTrack?.cover_image_url,
  });

  // 공유 공통 게이트(utils/trackShare): 공개 곡 = 바로, 비공개 내 곡 = 공개 확인 후, 남의 비공개 곡 = 거절.
  const gateShare = (t: RowTrack, open: (st: any, own: boolean) => void) => {
    shareTrack(t as any, {
      isOwn,
      src: currentRouteName(),
      onPublished: onSharePublished,
      onDone: onShared,
      onCompose: open,
    }).catch((err: any) => console.error('[TrackShare] fail — sheet', { message: err?.message }));
  };

  // 카카오톡으로 공유 = 공유 문구 화면(ShareCompose, v3.237)
  const handleShareKakao = (t: RowTrack) => {
    console.info('[TrackMenu] 공유 — 카카오톡', { id: t.id });
    gateShare(t, (st, own) => {
      navigation.navigate('ShareCompose', {
        track: {
          ...lightTrack(st),
          // v3.237 버그 1: 폴백 문구 아티스트 판정용(실제 캐릭터 정보가 있을 때만 artist_name 사용 — 닉네임 유출 방지)
          character_id: typeof anyTrack?.character_id === 'string' ? anyTrack.character_id : undefined,
          user_character_snapshot: anyTrack?.user_character_snapshot?.name ? { name: String(anyTrack.user_character_snapshot.name) } : undefined,
        },
        isOwn: own,
        src: currentRouteName(),
      });
    });
  };

  // 낙서장에 공유 = 곡을 붙인 새 낙서(FeedCompose attachTrack — 낙서장 세션 v3.400 계약)
  const handleShareDoodle = (t: RowTrack) => {
    if (!requireLoginModal('track_menu_doodle')) return;
    console.info('[TrackMenu] 공유 — 낙서장', { id: t.id });
    onClose();
    gateShare(t, (st) => {
      navigation.navigate('FeedCompose', { attachTrackId: String(st.id), attachTrack: lightTrack(st) });
    });
  };

  // 크루에 공유 = 내 크루 고르기 → 그 크루 게시판 글쓰기(크루 채팅은 곡 첨부가 없어 게시판으로)
  const openCrewPicker = async () => {
    if (!requireLoginModal('track_menu_crew')) return;
    goPage('crew');
    setCrews(null);
    try {
      const mine = await getMyClubs();
      setCrews(mine.filter((c) => c.join_status == null || c.join_status === 'member'));
      console.info('[TrackMenu] 내 크루', { count: mine.length });
    } catch (err: any) {
      console.error('[TrackMenu] 내 크루 조회 실패', { status: err?.response?.status });
      setCrews([]);
    }
  };

  const handleShareCrew = (t: RowTrack, club: Club) => {
    console.info('[TrackMenu] 공유 — 크루', { id: t.id, clubId: club.id });
    onClose();
    gateShare(t, (st) => {
      navigation.navigate('FeedCompose', { kind: 'club', clubId: String(club.id), attachTrackId: String(st.id), attachTrack: lightTrack(st) });
    });
  };

  // 영상 디렉터 열기(내 곡) — Studio 스택 [Map, VideoDirector] 적재(v3.222 initial:false 관행)
  const openVideoDirector = (t: RowTrack, initialFormat?: 'sns') => {
    console.info('[TrackMenu] 영상 디렉터', { id: t.id, initialFormat: initialFormat ?? null });
    onClose();
    navigation.navigate('MainTabs', {
      screen: 'Studio',
      params: { screen: 'VideoDirector', initial: false, params: { initialTrackId: String(t.id), menuNonce: Date.now(), ...(initialFormat ? { initialFormat } : {}) } },
    });
  };

  // SNS에 공유 — 내 곡: 영상 디렉터를 'SNS용 세로'로 바로 / 남의 곡: 세로 영상 바로 만들기(쇼츠·릴스·틱톡)
  const handleShareSns = (t: RowTrack) => {
    if (!requireLoginModal('track_menu_sns')) return;
    if (isOwn) { openVideoDirector(t, 'sns'); return; }
    if (anyTrack?.is_public === false) { onClose(); showAlert('알림', '비공개 곡은 공유할 수 없어요.'); return; }
    console.info('[TrackMenu] 공유 — SNS 세로 영상(남의 곡)', { id: t.id });
    onClose();
    setSnsTrack({ id: String(t.id), title: t.title });
  };

  // v3.256 [MakeLike]: 곡의 장르·분위기만 프리셋(제목·가사·주제 비움)해 작사 디렉터로 직행.
  const handleMakeLike = async (t: RowTrack) => {
    // v3.279(대표): 비로그인 — 체험 미사용이면 이 곡 느낌으로 게스트 체험, 사용했으면 로그인 모달
    if (!user) {
      let used = false;
      try { used = await isGuestTrialUsed(); } catch { used = false; }
      console.info('[MakeLike] 게스트 시트 탭', { trialUsed: used });
      if (used) { openLoginModal({ reason: 'make_like_guest' }); return; }
      startMakeLikeFlow(navigation, t as any);
      return;
    }
    if (__DEV__) console.info('[MakeLike] 시트 탭', { id: t.id });
    startMakeLikeFlow(navigation, t as any);
  };

  // 파일 받기 › 내가 만든 영상 — 이 곡으로 만든 최신 영상(보관함 /tracks/my/share-videos), 없으면 만들기 안내
  const handleDownloadMyVideo = async (t: RowTrack) => {
    if (busyKey) return;
    setBusyKey('video');
    try {
      const latest = latestShareVideoByTrack(await listMyShareVideos())[String(t.id)];
      console.info('[TrackMenu] 내가 만든 영상', { id: t.id, found: !!latest, format: latest?.format ?? null });
      onClose();
      if (!latest) {
        showAlert('아직 만든 영상이 없어요', '영상 디렉터에서 이 곡으로 영상을 만들면 여기서 받을 수 있어요.', [
          { text: '취소', style: 'cancel' },
          { text: '영상 만들기', onPress: () => openVideoDirector(t) },
        ]);
        return;
      }
      const fmt = latest.format === 'wide' || latest.format === 'kakao' ? latest.format : 'sns';
      await saveTrackFileToDevice(
        shareVideoObjectUrl(latest.object_name, anyTrack?.is_public === false),
        `maidol_${fmt}.mp4`,
        `${t.title} (${VIDEO_NAME_SUFFIX[fmt]})`,
      );
    } catch (err: any) {
      console.error('[TrackMenu] 내가 만든 영상 받기 실패', { status: err?.response?.status, message: err?.message });
      onClose();
      showAlert('오류', '영상을 받지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusyKey(null);
    }
  };

  // ── 렌더 조각 ──
  const Row = ({ icon, label, hint, onPress, chevron, danger, busy }: {
    icon: any; label: string; hint?: string; onPress: () => void; chevron?: boolean; danger?: boolean; busy?: boolean;
  }) => (
    <TouchableOpacity style={styles.row} onPress={onPress} disabled={!!busyKey} accessibilityLabel={label}>
      <Feather name={icon} size={20} color={danger ? colors.status.error : colors.text.secondary} />
      <View style={{ flex: 1 }}>
        <AppText variant="body" style={danger ? { color: colors.status.error } : undefined}>{label}</AppText>
        {hint ? <AppText variant="caption" tone="muted">{hint}</AppText> : null}
      </View>
      {busy ? <ActivityIndicator size="small" color={colors.accent.primary} /> : null}
      {chevron ? <Feather name="chevron-right" size={18} color={colors.text.muted} /> : null}
    </TouchableOpacity>
  );

  // 하위 목록 항목: 누르면 시트를 닫고 실행(시트 위에 다른 팝업·화면이 겹치지 않게)
  const closeThen = (fn: (t: RowTrack) => void) => () => { if (!track) return; const t = track; onClose(); fn(t); };

  const IconCell = ({ icon, label, a11y, onPress, active }: { icon: any; label: string; a11y: string; onPress: () => void; active?: boolean }) => (
    <TouchableOpacity style={styles.iconCell} onPress={onPress} accessibilityLabel={a11y}>
      <View style={[styles.iconCircle, active && styles.iconCircleActive]}>
        <Feather name={icon} size={20} color={active ? colors.accent.primary : colors.text.primary} />
      </View>
      <AppText variant="caption" tone="secondary" style={styles.iconLabel} numberOfLines={2}>{label}</AppText>
    </TouchableOpacity>
  );

  const renderMain = (t: RowTrack) => (
    <>
      {/* 맨 위 아이콘 한 줄 — 재생·좋아요·재생목록·플레이리스트 */}
      <View style={styles.iconRow}>
        <IconCell icon="play" label="재생" a11y="재생" onPress={closeThen(onPlay)} />
        <IconCell icon="heart" label="좋아요" a11y={likedMap[t.id] ? '좋아요 취소' : '좋아요'} active={!!likedMap[t.id]} onPress={() => toggleLike(t.id)} />
        <IconCell icon="plus" label="재생목록" a11y="재생목록에 추가" onPress={closeThen(handleAddToQueue)} />
        {/* 대표 10-22: '플레이리스트'는 두 줄(플레이 / 리스트)로 */}
        <IconCell icon="bookmark" label={'플레이\n리스트'} a11y="플레이리스트에 담기" onPress={closeThen(handleAddToPlaylist)} />
      </View>
      {shareable ? <Row icon="share-2" label="공유하기" chevron onPress={() => goPage('share')} /> : null}
      {isOwn ? (
        <Row icon="star" label="이 곡으로 만들기" chevron onPress={() => goPage('make')} />
      ) : (
        <Row icon="feather" label="이 곡 느낌으로 만들기" onPress={closeThen(handleMakeLike)} />
      )}
      {isOwn ? <Row icon="download" label="파일 받기" chevron onPress={() => goPage('file')} /> : null}
      {isOwn && manageItems && manageItems.length ? <Row icon="settings" label="곡 관리" chevron onPress={() => goPage('manage')} /> : null}
      {/* 화면 고유 항목(이 플레이리스트에서 제거 등) */}
      {(extraItems || []).map((ex) => (
        <Row key={ex.label} icon={ex.icon} label={ex.label} danger={ex.danger} onPress={closeThen(ex.onPress)} />
      ))}
    </>
  );

  const renderSub = (t: RowTrack) => {
    switch (page) {
      case 'share':
        return (
          <>
            <Row icon="edit-3" label="낙서장에 공유" hint="곡을 붙여 낙서 쓰기" onPress={() => handleShareDoodle(t)} />
            <Row icon="users" label="크루에 공유" hint="내 크루 게시판에 글 쓰기" chevron onPress={() => { void openCrewPicker(); }} />
            <Row icon="smartphone" label="SNS에 공유" hint="세로 영상 · 쇼츠·릴스·틱톡" onPress={() => handleShareSns(t)} />
            <Row icon="message-circle" label="카카오톡으로 공유" hint="공유 문구 + 곡 링크" onPress={closeThen(handleShareKakao)} />
          </>
        );
      case 'crew':
        if (crews === null) return <ActivityIndicator size="small" color={colors.accent.primary} style={{ marginVertical: spacing.xl }} />;
        if (!crews.length) {
          return (
            <AppText variant="footnote" tone="secondary" style={styles.empty}>
              아직 가입한 크루가 없어요.{'\n'}크루에 가입하면 곡을 크루 게시판에 나눌 수 있어요.
            </AppText>
          );
        }
        return (
          <>
            {crews.map((c) => (
              <Row key={c.id} icon="users" label={c.name || '이름 없는 크루'}
                hint={typeof c.member_count === 'number' ? `멤버 ${c.member_count}명` : undefined}
                onPress={() => handleShareCrew(t, c)} />
            ))}
          </>
        );
      case 'make':
        return (
          <>
            <Row icon="feather" label="이 곡 느낌으로 새 곡" onPress={closeThen(handleMakeLike)} />
            {(makeItems || []).map((ex) => (
              <Row key={ex.label} icon={ex.icon} label={ex.label} danger={ex.danger} onPress={closeThen(ex.onPress)} />
            ))}
            <Row icon="film" label="영상 만들기" hint="영상 디렉터 · 형식 고르기" onPress={() => openVideoDirector(t)} />
          </>
        );
      case 'file':
        return (
          <>
            <Row icon="music" label="음원 (mp3)" onPress={closeThen((x) => { void downloadTrackMp3({ id: String(x.id), title: x.title }, !!user); })} />
            <Row icon="video" label="내가 만든 영상" hint="이 곡으로 만든 가장 최근 영상" busy={busyKey === 'video'}
              onPress={() => { void handleDownloadMyVideo(t); }} />
          </>
        );
      case 'manage':
        return (
          <>
            {(manageItems || []).map((ex) => (
              <Row key={ex.label} icon={ex.icon} label={ex.label} danger={ex.danger} onPress={closeThen(ex.onPress)} />
            ))}
          </>
        );
      default:
        return null;
    }
  };

  return (
    <>
      {/* 곡 더보기(⋮) 액션 시트 */}
      <AppModal visible={!!track} transparent animationType="slide" onRequestClose={() => (page !== 'main' ? setPage(page === 'crew' ? 'share' : 'main') : onClose())}>
        <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => !busyKey && onClose()}>
          {/* v3.196: Modal은 루트 인셋 미상속 → 하단 제스처 바만큼 paddingBottom 보강(v3.191 queueSheet 패턴) */}
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={[styles.sheet, { paddingBottom: insets.bottom + spacing.xl }]}>
            {track ? (
              <>
                {page === 'main' ? (
                  <View style={styles.actionSheetHead}>
                    <TrackCover track={track} />
                    <View style={{ flex: 1, marginLeft: spacing.md }}>
                      <AppText variant="bodyStrong" numberOfLines={1}>{track.title}</AppText>
                      <AppText variant="footnote" tone="secondary" numberOfLines={1}>{track.artist_name || '알 수 없는 아티스트'}</AppText>
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity style={styles.subHead} accessibilityLabel="뒤로"
                    onPress={() => setPage(page === 'crew' ? 'share' : 'main')}>
                    <Feather name="chevron-left" size={22} color={colors.text.primary} />
                    <AppText variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>{PAGE_TITLE[page]}</AppText>
                  </TouchableOpacity>
                )}
                {/* v3.218 ②: 넘치면 스크롤(Android·iOS 공통) */}
                <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
                  {page === 'main' ? renderMain(track) : renderSub(track)}
                </ScrollView>
              </>
            ) : null}
          </TouchableOpacity>
        </TouchableOpacity>
      </AppModal>

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

      {/* v3.402: 남의 곡 SNS에 공유 — 세로 9:16 영상 바로 만들기(쇼츠·릴스·틱톡·링크 복사) */}
      <TrackShareDownloadSheet visible={!!snsTrack} mode="share" track={snsTrack} onClose={() => setSnsTrack(null)} />
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
  subHead: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingBottom: spacing.md, marginBottom: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  iconRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingTop: spacing.xs, paddingBottom: spacing.md, marginBottom: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  iconCell: { flex: 1, alignItems: 'center', gap: spacing.xs },
  iconCircle: {
    width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.bg.surface2,
  },
  iconCircleActive: { borderWidth: 1, borderColor: colors.accent.primary },
  iconLabel: { textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  empty: { textAlign: 'center', marginVertical: spacing.xl, lineHeight: 20 },
});
