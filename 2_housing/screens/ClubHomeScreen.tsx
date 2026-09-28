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
import * as Clipboard from 'expo-clipboard';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { AppText, Button, EmptyState, ScreenLayout } from '../components/ui';
import LoginPrompt from '../components/LoginPrompt';
import FeedCard from '../components/feed/FeedCard';
import FeedImageBlock, { feedImageUri } from '../components/feed/FeedImageBlock';
import TrackRow from '../components/TrackRow';
import ReportModal from '../components/ReportModal'; // v3.249 — 멤버 신고(targetType 'club_member') 재사용
import { showAlert, type AppAlertButton } from '../utils/appAlert';
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { usePlayerStore } from '../stores/playerStore';
import { useIsChild, useKidsPermission } from '../utils/kidsMode';
import {
  Club, ClubPlaylist, TransferCandidate, getClub, getClubErrorCode, joinClub, leaveClub,
  listClubFeeds, listClubPlaylists, createClubPlaylist,
  transferCandidates, transferOwner, clubDeleteRequestDraft,
  // v3.249 멤버 관리 — 멤버 목록·내보내기·행 메뉴 규칙(문구 라벨은 CLUB_LABEL 단일화)
  CLUB_LABEL, ClubMember, ClubMembersError, classifyMembersError,
  listClubMembers, kickClubMember, memberMenuActions, kickErrorMessage,
  // v3.252 가입 승인제 — join 202/200 분기·pending 파생·owner 신청 목록(승인/거절)
  clubJoinStatus, JoinRequest, listJoinRequests, approveJoinRequest, rejectJoinRequest,
} from '../services/clubService';

// v3.252: 채팅 탭 신설(첫 탭) — 채팅|게시판|플레이리스트|정보 4탭
type ClubTab = 'chat' | 'board' | 'playlists' | 'info';
const BOARD_LIMIT = 20;
const MEMBERS_LIMIT = 30; // v3.249 — 멤버 목록 페이지 크기(before 커서 무한스크롤)

const TABS: { key: ClubTab; label: string }[] = [
  { key: 'chat', label: '채팅' },
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
  const [tab, setTab] = useState<ClubTab>('chat'); // v3.252: 채팅이 첫 탭
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

  // v3.247 운영자 위임 — 후보 시트(null=로딩 중, 실패는 transferFailed 로 구분)
  const [transferOpen, setTransferOpen] = useState(false);
  const [candidates, setCandidates] = useState<TransferCandidate[] | null>(null);
  const [transferFailed, setTransferFailed] = useState(false);
  const [transferBusy, setTransferBusy] = useState(false);

  // v3.249 멤버 관리 — 정보 탭 멤버 목록(무한스크롤) + 행 ⋯ 메뉴(신고하기/내보내기)
  const [members, setMembers] = useState<ClubMember[]>([]);
  const [membersError, setMembersError] = useState<ClubMembersError | null>(null);
  const [membersBefore, setMembersBefore] = useState<string | null>(null);
  const [membersMore, setMembersMore] = useState(false);
  const [kickBusy, setKickBusy] = useState(false);
  const [reportTarget, setReportTarget] = useState<ClubMember | null>(null);

  // v3.252 가입 승인제 — owner 신청 목록 시트(null=미로드, 구서버 404 는 빈 목록 강등 → 뱃지 숨김)
  const [joinReqs, setJoinReqs] = useState<JoinRequest[] | null>(null);
  const [joinReqOpen, setJoinReqOpen] = useState(false);
  const [joinReqBusy, setJoinReqBusy] = useState(false);

  const isMember = !!detail?.is_member || detail?.role === 'owner' || detail?.role === 'member';
  const isOwner = detail?.role === 'owner' || (!!user && !!detail?.owner_id && String(detail.owner_id) === String(user.id));
  // v3.252: 가입 상태 — 신서버 join_status 우선(pending 지원), 구서버는 is_member 폴백
  const joinStatus = clubJoinStatus(detail);
  const isPending = joinStatus === 'pending';

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

  // v3.249 — 멤버 목록(멤버 전용). 구서버(신규 라우트 404)·비멤버(403)·네트워크 전부 안내 강등(크래시 0)
  const fetchMembers = useCallback(async () => {
    try {
      const page = await listClubMembers(String(clubId), { limit: MEMBERS_LIMIT });
      setMembers(page.members);
      setMembersBefore(page.next_before);
      setMembersError(null);
    } catch (err: any) {
      console.error('[Club] 멤버 목록 조회 실패', { clubId, status: err?.response?.status });
      setMembers([]);
      setMembersBefore(null);
      setMembersError(classifyMembersError(err));
    }
  }, [clubId]);

  // v3.252 — owner 가입 신청 목록(승인제). 구서버(404)·비owner(403)·네트워크 전부 빈 목록 강등(뱃지 숨김)
  const fetchJoinRequests = useCallback(async () => {
    try {
      const rows = await listJoinRequests(String(clubId));
      console.info('[Club] 가입 신청 목록', { clubId, count: rows.length });
      setJoinReqs(rows);
    } catch (err: any) {
      console.error('[Club] 가입 신청 목록 조회 실패', { clubId, status: err?.response?.status });
      setJoinReqs([]);
    }
  }, [clubId]);

  const fetchAll = useCallback(async () => {
    if (__DEV__) console.info('[Club] ClubHome fetchAll', { clubId });
    setLoading(true);
    await Promise.allSettled([fetchDetail(), fetchBoard(), fetchPlaylists(), fetchMembers()]);
    setLoading(false);
    setRefreshing(false);
  }, [fetchDetail, fetchBoard, fetchPlaylists, fetchMembers]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // v3.252 — owner 확인 후 신청 목록 로드(비owner 는 왕복 자체 생략)
  useEffect(() => {
    if (isOwner) fetchJoinRequests();
  }, [isOwner, fetchJoinRequests]);

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

  // v3.249 — 멤버 목록 무한스크롤(정보 탭, before 커서 — 게시판 loadMore 관행)
  const handleMembersMore = useCallback(async () => {
    if (tab !== 'info' || !membersBefore || membersMore) return;
    setMembersMore(true);
    if (__DEV__) console.info('[Club] 멤버 목록 loadMore', { before: membersBefore });
    try {
      const page = await listClubMembers(String(clubId), { limit: MEMBERS_LIMIT, before: membersBefore });
      setMembers((prev) => {
        const seen = new Set(prev.map((m) => m.user_id));
        return [...prev, ...page.members.filter((m) => !seen.has(m.user_id))];
      });
      setMembersBefore(page.next_before);
    } catch (err: any) {
      console.error('[Club] 멤버 목록 loadMore 실패', { status: err?.response?.status });
      setMembersBefore(null);
    } finally {
      setMembersMore(false);
    }
  }, [tab, membersBefore, membersMore, clubId]);

  const requireLogin = (): boolean => {
    if (!user) { setCtaVisible(true); return false; }
    return true;
  };

  // v3.252 가입 승인제 — 202 {status:'pending'}(신서버) 은 신청 접수, 200(구서버) 은 즉시 가입(기존 흐름)
  const handleJoin = async () => {
    if (!requireLogin() || joinBusy) return;
    setJoinBusy(true);
    try {
      const result = await joinClub(String(clubId));
      if (result === 'pending') {
        console.info('[Club] 가입 신청 접수', { clubId });
        setDetail((d) => d ? { ...d, join_status: 'pending' } : d);
        showAlert('가입 신청', '가입 신청을 보냈어요. 운영자 승인 후 함께할 수 있어요.');
      } else {
        console.info('[Club] 가입 성공', { clubId });
        setDetail((d) => d ? { ...d, is_member: true, join_status: 'member', role: d.role === 'owner' ? d.role : 'member', member_count: (d.member_count ?? 0) + 1 } : d);
        fetchMembers(); // v3.249 — 멤버가 되면 멤버 목록 열람 가능(정보 탭 동기화)
      }
    } catch (err: any) {
      console.error('[Club] 가입 실패', { clubId, status: err?.response?.status, code: getClubErrorCode(err) });
      showAlert('오류', `${CLUB_LABEL}에 가입하지 못했어요. 잠시 후 다시 시도해주세요.`);
    } finally {
      setJoinBusy(false);
    }
  };

  // v3.252 — 신청 철회(DELETE /join 겸용). 404(이미 처리됨)는 상세 재조회로 수습.
  const doCancelJoinRequest = async () => {
    if (joinBusy) return;
    setJoinBusy(true);
    try {
      await leaveClub(String(clubId));
      console.info('[Club] 가입 신청 철회', { clubId });
      setDetail((d) => d ? { ...d, join_status: 'none' } : d);
    } catch (err: any) {
      console.error('[Club] 신청 철회 실패', { clubId, status: err?.response?.status });
      if (err?.response?.status === 404) fetchDetail(); // 이미 승인/거절됨 — 상태 최신화
      else showAlert('오류', '신청을 취소하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setJoinBusy(false);
    }
  };

  const confirmCancelJoinRequest = () => {
    showAlert('신청 취소', '가입 신청을 취소할까요?', [
      { text: '아니요', style: 'cancel' },
      { text: '신청 취소', style: 'destructive', onPress: doCancelJoinRequest },
    ]);
  };

  // ── v3.252 owner 신청 처리 — [승인]/[거절] 확인 다이얼로그 → 성공 시 신청·멤버 목록 갱신 ──
  const doJoinRequestAction = async (r: JoinRequest, action: 'approve' | 'reject') => {
    if (joinReqBusy) return;
    setJoinReqBusy(true);
    try {
      if (action === 'approve') {
        const res = await approveJoinRequest(String(clubId), r.user_id);
        console.info('[Club] 가입 신청 승인', { clubId, userId: r.user_id });
        setDetail((d) => d ? { ...d, member_count: res.member_count ?? (d.member_count ?? 0) + 1 } : d);
        fetchMembers(); // 새 멤버 반영
      } else {
        await rejectJoinRequest(String(clubId), r.user_id);
        console.info('[Club] 가입 신청 거절', { clubId, userId: r.user_id });
      }
      fetchJoinRequests(); // 신청 목록 갱신(뱃지 N 포함)
    } catch (err: any) {
      const status = err?.response?.status;
      console.error('[Club] 가입 신청 처리 실패', { clubId, userId: r.user_id, action, status });
      if (status === 404) {
        showAlert('알림', '이미 처리되었거나 철회된 신청이에요. 목록을 새로고침할게요.');
        fetchJoinRequests();
      } else if (status === 403) {
        showAlert('알림', `${CLUB_LABEL} 운영자만 신청을 처리할 수 있어요.`);
      } else {
        showAlert('오류', '신청을 처리하지 못했어요. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      setJoinReqBusy(false);
    }
  };

  const confirmJoinRequestAction = (r: JoinRequest, action: 'approve' | 'reject') => {
    const nick = r.nickname || '신청자';
    showAlert(
      action === 'approve' ? '가입 승인' : '가입 거절',
      action === 'approve'
        ? `"${nick}"님의 가입 신청을 승인할까요?`
        : `"${nick}"님의 가입 신청을 거절할까요?`,
      [
        { text: '취소', style: 'cancel' },
        action === 'approve'
          ? { text: '승인', onPress: () => doJoinRequestAction(r, 'approve') }
          : { text: '거절', style: 'destructive', onPress: () => doJoinRequestAction(r, 'reject') },
      ],
    );
  };

  const doLeave = async () => {
    setJoinBusy(true);
    try {
      await leaveClub(String(clubId));
      console.info('[Club] 탈퇴 성공', { clubId });
      setDetail((d) => d ? { ...d, is_member: false, role: null, member_count: Math.max(0, (d.member_count ?? 1) - 1) } : d);
      fetchMembers(); // v3.249 — 탈퇴 후 멤버 목록은 서버 규칙(비멤버 403)대로 안내 강등
    } catch (err: any) {
      const code = getClubErrorCode(err);
      console.error('[Club] 탈퇴 실패', { clubId, status: err?.response?.status, code });
      // v3.247: 서버 방어 응답도 위임 안내로 통일(정상 경로는 handleMembershipPress 가 선차단)
      if (code === 'owner_cannot_leave') showAlert('알림', '운영자는 먼저 다른 멤버에게 운영을 넘겨야 해요.');
      else showAlert('오류', '탈퇴하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setJoinBusy(false);
    }
  };

  // ── v3.247 운영자 위임 — 계약: GET /clubs/{id}/transfer-candidates · POST /clubs/{id}/transfer-owner ──
  const openTransferSheet = async () => {
    if (__DEV__) console.info('[Club] 위임 후보 시트 열기', { clubId });
    setTransferOpen(true);
    setCandidates(null);
    setTransferFailed(false);
    try {
      const rows = await transferCandidates(String(clubId));
      console.info('[Club] 위임 후보 조회', { clubId, count: rows.length });
      setCandidates(rows);
    } catch (err: any) {
      // 구서버(라우트 미배포 404)·네트워크 오류 — 시트 내 안내로 강등(크래시 금지)
      console.error('[Club] 위임 후보 조회 실패', { clubId, status: err?.response?.status });
      setCandidates([]);
      setTransferFailed(true);
    }
  };

  const doTransfer = async (c: TransferCandidate) => {
    if (transferBusy) return;
    setTransferBusy(true);
    try {
      await transferOwner(String(clubId), c.user_id);
      console.info('[Club] 운영자 위임 성공', { clubId, newOwner: c.user_id });
      setTransferOpen(false);
      // role 갱신 — owner_id 도 함께 바꿔 isOwner 재계산(위임 직후 '탈퇴' 버튼 노출)
      setDetail((d) => d ? { ...d, role: 'member', is_member: true, owner_id: c.user_id } : d);
      showAlert('위임 완료', `"${c.nickname || '멤버'}"님에게 운영을 넘겼어요. 이제 탈퇴할 수 있어요.`);
    } catch (err: any) {
      const code = getClubErrorCode(err);
      const status = err?.response?.status;
      console.error('[Club] 운영자 위임 실패', { clubId, status, code });
      // v3.247 서버 확정 오류 분기: 403(비owner)/400 not_member·not_eligible/409 club_limit·conflict
      if (code === 'transferee_not_eligible') showAlert('알림', '이 멤버는 아직 위임을 받을 수 없어요. 다른 멤버를 선택해주세요.');
      else if (code === 'transferee_not_member') {
        showAlert('알림', `이 멤버는 더 이상 ${CLUB_LABEL} 멤버가 아니에요. 후보 목록을 새로고침할게요.`);
        openTransferSheet(); // 후보 최신화
      } else if (code === 'club_limit') showAlert('알림', `이 멤버는 이미 다른 ${CLUB_LABEL}를 운영하고 있어 위임할 수 없어요.`);
      else if (code === 'conflict') showAlert('알림', '처리 중 충돌이 발생했어요. 잠시 후 다시 시도해주세요.');
      else if (status === 403) showAlert('알림', `${CLUB_LABEL} 운영자만 위임할 수 있어요.`);
      else showAlert('오류', '위임하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setTransferBusy(false);
    }
  };

  const pickCandidate = (c: TransferCandidate) => {
    if (c.eligible === false || transferBusy) return;
    showAlert('운영자 위임', `"${c.nickname || '멤버'}"님에게 ${CLUB_LABEL} 운영을 넘길까요?`, [
      { text: '취소', style: 'cancel' },
      { text: '위임하기', onPress: () => doTransfer(c) },
    ]);
  };

  // ── v3.249 멤버 관리 — 행 ⋯ 메뉴(신고하기=멤버 누구나 / 내보내기=owner 만), 팝업은 전부 showAlert ──
  const doKick = async (m: ClubMember) => {
    if (kickBusy) return;
    setKickBusy(true);
    try {
      const res = await kickClubMember(String(clubId), m.user_id);
      console.info('[Club] 멤버 내보내기 성공', { clubId, userId: m.user_id });
      // 성공: 목록 새로고침(커서 리셋) + 멤버 수 갱신(서버 응답 member_count 우선)
      setDetail((d) => d ? { ...d, member_count: res.member_count ?? Math.max(0, (d.member_count ?? 1) - 1) } : d);
      fetchMembers();
    } catch (err: any) {
      const code = getClubErrorCode(err);
      const status = err?.response?.status;
      console.error('[Club] 멤버 내보내기 실패', { clubId, userId: m.user_id, status, code });
      // 서버 확정 오류 분기(cannot_kick_owner·403·404) — 문구는 clubService 단일화
      showAlert('알림', kickErrorMessage(code, status));
      if (status === 404) fetchMembers(); // 이미 떠난 멤버 — 목록 최신화
    } finally {
      setKickBusy(false);
    }
  };

  const confirmKick = (m: ClubMember) => {
    showAlert(
      '멤버 내보내기',
      `"${m.nickname || '멤버'}"님을 ${CLUB_LABEL}에서 내보낼까요? 작성한 글과 담은 곡은 남아요.`,
      [
        { text: '취소', style: 'cancel' },
        { text: '내보내기', style: 'destructive', onPress: () => doKick(m) },
      ],
    );
  };

  const openMemberMenu = (m: ClubMember) => {
    const actions = memberMenuActions(
      { id: user?.id != null ? String(user.id) : null, isMember, isOwner }, m,
    );
    if (!actions.length || kickBusy) return;
    if (__DEV__) console.info('[Club] 멤버 메뉴 열기', { clubId, userId: m.user_id, actions });
    const buttons: AppAlertButton[] = [];
    if (actions.includes('report')) buttons.push({ text: '신고하기', onPress: () => setReportTarget(m) });
    if (actions.includes('kick')) buttons.push({ text: '내보내기', style: 'destructive', onPress: () => confirmKick(m) });
    buttons.push({ text: '취소', style: 'cancel' });
    showAlert('멤버 관리', `"${m.nickname || '멤버'}"님`, buttons);
  };

  const handleMembershipPress = () => {
    if (!requireLogin() || joinBusy) return;
    if (isPending) return; // v3.252: 승인 대기 — 버튼 비활성(철회는 별도 '신청 취소' 행)
    if (isOwner) {
      // v3.247: owner 탈퇴 시도 — 위임 선행 안내(계약: 위임 후 leave 가능). 서버 왕복 없음.
      showAlert('알림', '운영자는 먼저 다른 멤버에게 운영을 넘겨야 해요.', [
        { text: '취소', style: 'cancel' },
        { text: '운영자 위임하기', onPress: openTransferSheet },
      ]);
      return;
    }
    if (isMember) {
      showAlert(`${CLUB_LABEL} 탈퇴`, `"${detail?.name ?? CLUB_LABEL}"에서 탈퇴할까요?`, [
        { text: '취소', style: 'cancel' },
        { text: '탈퇴', style: 'destructive', onPress: doLeave },
      ]);
      return;
    }
    handleJoin();
  };

  // 멤버만 글쓰기 — 비멤버 탭 시 가입 유도 다이얼로그(v3.252: 승인제 — 신청 결과 문구는 handleJoin 이 분기)
  const handleComposePress = () => {
    if (!requireLogin()) return;
    if (isPending) {
      showAlert('알림', '가입 신청이 승인되면 글을 쓸 수 있어요.');
      return;
    }
    if (!isMember) {
      showAlert(`${CLUB_LABEL} 가입`, `${CLUB_LABEL} 멤버만 글을 쓸 수 있어요. 지금 가입 신청할까요?`, [
        { text: '취소', style: 'cancel' },
        { text: '가입 신청', onPress: handleJoin },
      ]);
      return;
    }
    if (__DEV__) console.info('[Club] 크루 글쓰기 진입', { clubId });
    navigation.navigate('FeedCompose', { kind: 'club', clubId: String(clubId) });
  };

  // v3.252 — 채팅방 입장(멤버 전용, ClubChat 풀스크린 — 키보드 처리·미니플레이어 숨김)
  const openChatRoom = () => {
    if (__DEV__) console.info('[Club] 채팅방 입장', { clubId, isOwner });
    navigation.navigate('ClubChat', { clubId: String(clubId), name: detail?.name ?? name, isOwner });
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

  // ── v3.247 클럽 삭제 요청 — 삭제 API 없음(운영팀 처리 정책). maidol_official DM 으로 요청. ──
  // 진입 관행: SettingsScreen CS 문의(GET /dm/official → POST /dm/conversations →
  // navigate('DmChat', { conversation, prefill })) 그대로. 실패 시 초안 클립보드 복사 폴백.
  const startDeleteRequestDm = async () => {
    const draft = clubDeleteRequestDraft(detail?.name ?? name ?? CLUB_LABEL);
    if (__DEV__) console.info('[Club] 삭제 요청 DM 열기', { clubId });
    try {
      const { data: official } = await api.get('/dm/official');
      const officialId = official?.official_id;
      if (!officialId) throw new Error('official_id missing');
      const { data: conv } = await api.post('/dm/conversations', { peer_id: officialId });
      if (!conv?.conversation_id) throw new Error('conversation_id missing');
      const conversation = conv?.peer
        ? conv
        : { ...conv, peer: { id: officialId, nickname: official?.nickname || '공식 계정' } };
      navigation.navigate('DmChat', { conversation, prefill: draft });
    } catch (err: any) {
      console.error('[Club] 삭제 요청 DM 열기 실패', { clubId, status: err?.response?.status, message: err?.message });
      try {
        await Clipboard.setStringAsync(draft);
        showAlert('안내', '문의 채널을 열지 못했어요. 요청 문구를 복사해두었으니 공식 계정 DM에 붙여넣어 보내주세요.');
      } catch {
        showAlert('오류', '문의 채널을 열지 못했어요. 잠시 후 다시 시도해주세요.');
      }
    }
  };

  const handleDeleteRequest = () => {
    if (__DEV__) console.info('[Club] 삭제 요청 진입', { clubId });
    showAlert(`${CLUB_LABEL} 삭제 요청`, `${CLUB_LABEL} 삭제는 MAIDOL 운영팀이 처리해요.`, [
      { text: '취소', style: 'cancel' },
      { text: '운영팀에 요청하기', onPress: startDeleteRequestDm },
    ]);
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
          hideClubBadge // v3.247: 클럽 게시판 안에서는 클럽명 배지 중복 — 억제

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
    <TouchableOpacity style={styles.plRow} activeOpacity={0.75} onPress={() => openPlaylist(item)} accessibilityLabel={`${CLUB_LABEL} 플레이리스트 ${item.title || item.name}`}>
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

  // ── v3.249 멤버 행 — 닉네임·role 뱃지·가입일 + ⋯ 메뉴(본인·owner 행 제외) ──
  const renderMemberRow = ({ item }: { item: ClubMember }) => {
    const isRowOwner = (item.role || 'member') === 'owner';
    const isMe = !!user && String(item.user_id) === String(user.id);
    const canMenu = memberMenuActions(
      { id: user?.id != null ? String(user.id) : null, isMember, isOwner }, item,
    ).length > 0;
    const joined = fmtDate(item.joined_at);
    return (
      <View style={styles.memberRow}>
        <View style={styles.memberAvatar}>
          <Feather name="user" size={16} color={colors.text.muted} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.memberNameRow}>
            <AppText variant="callout" numberOfLines={1} style={{ flexShrink: 1 }}>{item.nickname || '멤버'}</AppText>
            {isRowOwner ? (
              <View style={styles.roleBadge}>
                <AppText variant="caption" tone="accent">운영자</AppText>
              </View>
            ) : null}
            {isMe ? <AppText variant="caption" tone="muted">나</AppText> : null}
          </View>
          {joined ? (
            <AppText variant="caption" tone="muted" style={{ marginTop: 2 }}>{`${joined} 가입`}</AppText>
          ) : null}
        </View>
        {canMenu ? (
          <TouchableOpacity
            onPress={() => openMemberMenu(item)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel={`멤버 메뉴 ${item.nickname || '멤버'}`}
          >
            <Feather name="more-horizontal" size={18} color={colors.text.muted} />
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  // ── 정보 탭 본문(소개·개설일·운영자) — v3.249: 멤버 목록이 리스트 데이터가 되면서 헤더로 이동 ──
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
        {(detail as any)?.owner_nickname || (isOwner ? (user as any)?.nickname || '나' : `${CLUB_LABEL} 운영자`)}
      </AppText>
      {/* v3.247: 크루 삭제 요청 — owner 전용 행(삭제는 운영팀 처리, DM 요청 진입) */}
      {isOwner ? (
        <TouchableOpacity style={styles.deleteReqRow} activeOpacity={0.7} onPress={handleDeleteRequest} accessibilityLabel={`${CLUB_LABEL} 삭제 요청`}>
          <Feather name="trash-2" size={16} color={colors.status.error} />
          <AppText variant="body" style={{ color: colors.status.error, flex: 1 }}>{`${CLUB_LABEL} 삭제 요청`}</AppText>
          <Feather name="chevron-right" size={16} color={colors.text.muted} />
        </TouchableOpacity>
      ) : null}
      {/* v3.252: owner 가입 신청 대기 뱃지 행 — 멤버 섹션 상단(N>0 일 때만, 구서버 404 는 빈 목록 → 숨김) */}
      {isOwner && joinReqs && joinReqs.length > 0 ? (
        <TouchableOpacity style={styles.joinReqRow} activeOpacity={0.7} onPress={() => setJoinReqOpen(true)} accessibilityLabel="가입 신청 목록">
          <Feather name="user-plus" size={16} color={colors.accent.primary} />
          <AppText variant="body" tone="accent" style={{ flex: 1 }}>{`가입 신청 ${joinReqs.length}`}</AppText>
          <Feather name="chevron-right" size={16} color={colors.text.muted} />
        </TouchableOpacity>
      ) : null}
      {/* v3.249: 멤버 섹션 라벨 — 목록 행은 FlatList 데이터(무한스크롤) */}
      <AppText variant="footnote" tone="secondary" style={styles.infoLabel}>
        {`멤버 ${detail?.member_count ?? members.length}명`}
      </AppText>
    </View>
  );

  // ── v3.252 채팅 탭 본문 — 멤버=채팅방 입장(풀스크린 ClubChat), 비멤버=게이트+가입 신청 유도 ──
  const chatContent = (
    <View style={styles.chatPanel}>
      <View style={styles.chatIcon}>
        <Feather name={isMember ? 'message-circle' : 'lock'} size={20} color={isMember ? colors.accent.primary : colors.text.muted} />
      </View>
      {isMember ? (
        <>
          <AppText variant="callout" center style={{ marginTop: spacing.md }}>
            {`${CLUB_LABEL} 멤버들과 실시간으로 이야기해요`}
          </AppText>
          {typeof detail?.unread_chat === 'number' && detail.unread_chat > 0 ? (
            <AppText variant="caption" tone="accent" style={{ marginTop: spacing.xs }}>
              {`안 읽은 메시지 ${detail.unread_chat}개`}
            </AppText>
          ) : null}
          <View style={{ marginTop: spacing.lg, alignSelf: 'stretch' }}>
            <Button
              label="채팅방 들어가기"
              fullWidth
              leading={<Feather name="message-circle" size={16} color={colors.text.primary} />}
              onPress={openChatRoom}
            />
          </View>
        </>
      ) : (
        <>
          <AppText variant="callout" center style={{ marginTop: spacing.md }}>
            {`${CLUB_LABEL} 멤버만 채팅에 참여할 수 있어요`}
          </AppText>
          <AppText variant="footnote" tone="secondary" center style={{ marginTop: spacing.xs }}>
            {isPending ? '운영자가 승인하면 함께할 수 있어요.' : '가입 신청 후 운영자 승인을 받으면 함께할 수 있어요.'}
          </AppText>
          <View style={{ marginTop: spacing.lg, alignSelf: 'stretch' }}>
            <Button
              label={isPending ? '승인 대기 중' : '가입 신청'}
              fullWidth
              variant={isPending ? 'tonal' : 'filled'}
              disabled={isPending || joinBusy}
              onPress={handleJoin}
            />
          </View>
        </>
      )}
    </View>
  );

  // ── 상단 정보 + 탭바(FlatList 헤더) ──
  const header = (
    <View>
      <View style={styles.infoBox}>
        <View style={styles.infoTopRow}>
          <View style={{ flex: 1 }}>
            <AppText variant="subtitle" numberOfLines={1}>{detail?.name ?? name ?? CLUB_LABEL}</AppText>
            <View style={styles.metaRow}>
              <Feather name="users" size={12} color={colors.text.muted} />
              <AppText variant="caption" tone="muted">{`멤버 ${detail?.member_count ?? 0}명`}</AppText>
              {isOwner ? <AppText variant="caption" tone="accent">내가 운영</AppText>
                : isMember ? <AppText variant="caption" tone="accent">가입됨</AppText>
                : isPending ? <AppText variant="caption" tone="muted">승인 대기</AppText> : null}
            </View>
          </View>
          {/* v3.252 승인제: pending 은 '승인 대기 중' 비활성(철회는 아래 '가입 신청 취소' 행) */}
          <Button
            label={isOwner ? '운영자' : isMember ? '탈퇴' : isPending ? '승인 대기 중' : '가입하기'}
            variant={isMember || isPending ? 'tonal' : 'filled'}
            size="sm"
            disabled={joinBusy || isPending}
            onPress={handleMembershipPress}
          />
        </View>
        {detail?.description ? (
          <AppText variant="body" tone="secondary" style={{ marginTop: spacing.sm }} numberOfLines={3}>
            {detail.description}
          </AppText>
        ) : null}
        {/* v3.252: 신청 철회 행 — pending 전용(DELETE /join 겸용 계약) */}
        {isPending ? (
          <TouchableOpacity style={styles.cancelReqRow} activeOpacity={0.7} onPress={confirmCancelJoinRequest} accessibilityLabel="가입 신청 취소">
            <Feather name="x-circle" size={14} color={colors.text.secondary} />
            <AppText variant="footnote" tone="secondary">가입 신청 취소</AppText>
          </TouchableOpacity>
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
            accessibilityLabel={`${CLUB_LABEL} 탭 ${t.label}`}
          >
            <AppText style={[styles.tabText, tab === t.key && styles.tabTextActive]} numberOfLines={1}>{t.label}</AppText>
          </TouchableOpacity>
        ))}
      </View>

      {/* v3.252: 채팅 탭 — 본문은 헤더 영역(리스트 데이터 없음) */}
      {tab === 'chat' ? chatContent : null}

      {/* 게시판: 멤버만 글쓰기(dashed — UserChannel composeBtn 관행). 어린이 미허용은 숨김 */}
      {tab === 'board' && !feedWriteBlocked ? (
        <TouchableOpacity style={styles.composeBtn} activeOpacity={0.8} onPress={handleComposePress} accessibilityLabel={`${CLUB_LABEL} 글쓰기`}>
          <Feather name="edit-3" size={16} color={colors.accent.primary} />
          <AppText style={styles.composeText}>{`${CLUB_LABEL} 글쓰기`}</AppText>
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
            <AppText variant="caption" tone="muted" style={{ marginTop: 2 }}>{`${plTracks.length}곡 · ${CLUB_LABEL} 멤버가 함께 채워요`}</AppText>
          </View>
        ) : isMember ? (
          <TouchableOpacity style={styles.composeBtn} activeOpacity={0.8} onPress={() => setShowPlCreate(true)} accessibilityLabel={`${CLUB_LABEL} 플레이리스트 만들기`}>
            <Feather name="plus" size={16} color={colors.accent.primary} />
            <AppText style={styles.composeText}>플레이리스트 만들기</AppText>
          </TouchableOpacity>
        ) : null
      ) : null}

      {/* v3.249: 정보 탭 — 소개·개설일·운영자(+owner 삭제 요청)는 헤더, 멤버 행은 리스트 데이터 */}
      {tab === 'info' ? infoContent : null}
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
          title={`${CLUB_LABEL} 정보를 불러오지 못했어요`}
          hint="잠시 후 다시 시도해주세요."
          action={<Button label="다시 시도" variant="tonal" onPress={fetchAll} />}
        />
      </ScreenLayout>
    );
  }

  // v3.249: 정보 탭 리스트 데이터 = 멤버 행(무한스크롤) — 소개 등 본문은 헤더(infoContent)로 이동
  // v3.252: 채팅 탭은 리스트 데이터 없음(본문 전체가 헤더 chatContent — 실채팅은 ClubChat 풀스크린)
  const listData = tab === 'chat' ? [] : tab === 'board' ? feeds : tab === 'playlists' ? (selectedPl ? plTracks : playlists) : members;
  const listRender = tab === 'board' ? renderFeed : tab === 'playlists' ? (selectedPl ? renderTrackRow : renderPlaylistRow) : renderMemberRow;

  const emptyComponent = tab === 'chat'
    ? null
    : tab === 'info'
    // v3.249: 멤버 목록 강등 상태 — 구서버 404/네트워크 = failed, 비멤버 403 = forbidden
    ? (membersError === 'failed'
      ? <EmptyState icon={<Feather name="cloud-off" size={44} color={colors.text.muted} />} title="멤버 목록을 불러오지 못했어요" hint="잠시 후 아래로 당겨 다시 시도해주세요." />
      : membersError === 'forbidden'
      ? <EmptyState icon={<Feather name="lock" size={44} color={colors.text.muted} />} title={`${CLUB_LABEL} 멤버만 볼 수 있어요`} hint="가입하면 멤버 목록을 볼 수 있어요." />
      : <EmptyState icon={<Feather name="users" size={44} color={colors.text.muted} />} title="아직 멤버가 없어요" />)
    : tab === 'board'
    ? (boardFailed
      ? <EmptyState icon={<Feather name="cloud-off" size={44} color={colors.text.muted} />} title="게시판을 불러오지 못했어요" hint="잠시 후 아래로 당겨 다시 시도해주세요." />
      : <EmptyState icon={<Feather name="edit-3" size={44} color={colors.text.muted} />} title="아직 글이 없어요" hint={`첫 글로 ${CLUB_LABEL}의 시작을 알려보세요!`} />)
    : selectedPl
    ? (plTracksLoading
      ? <ActivityIndicator size="large" color={colors.accent.primary} style={{ marginTop: spacing.xl }} />
      : <EmptyState title="이 플레이리스트에 곡이 없어요" hint="차트나 검색에서 곡을 담아보세요!" />)
    : (plFailed
      ? <EmptyState icon={<Feather name="cloud-off" size={44} color={colors.text.muted} />} title="플레이리스트를 불러오지 못했어요" hint="잠시 후 아래로 당겨 다시 시도해주세요." />
      : <EmptyState icon={<Feather name="music" size={44} color={colors.text.muted} />} title={`아직 ${CLUB_LABEL} 플레이리스트가 없어요`} hint="멤버라면 첫 플레이리스트를 만들어보세요!" />);

  return (
    <ScreenLayout>
      <FlatList
        data={listData}
        keyExtractor={(item: any, i: number) => String(item?.id ?? item?.track_id ?? item?.user_id ?? i)}
        renderItem={listRender as any}
        ListHeaderComponent={header}
        ListEmptyComponent={<View style={{ paddingTop: tab === 'info' ? 0 : spacing.xl }}>{emptyComponent}</View>}
        ListFooterComponent={(tab === 'board' && boardMore) || (tab === 'info' && membersMore)
          ? <ActivityIndicator size="small" color={colors.accent.primary} style={{ marginVertical: spacing.lg }} />
          : null}
        onEndReached={() => { handleBoardMore(); handleMembersMore(); }}
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
              <AppText style={styles.modalTitle}>{`${CLUB_LABEL} 플레이리스트 만들기`}</AppText>
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

      {/* v3.247 운영자 위임 — 후보 목록 바텀시트(닉네임·활동 요약, 자격 미달은 흐리게+사유) */}
      <Modal visible={transferOpen} transparent animationType="slide" onRequestClose={() => setTransferOpen(false)}>
        <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setTransferOpen(false)}>
          <TouchableOpacity style={styles.sheet} activeOpacity={1} onPress={() => {}}>
            <AppText variant="title3" style={{ marginBottom: spacing.xs }}>운영자 위임</AppText>
            <AppText variant="footnote" tone="secondary" style={{ marginBottom: spacing.lg }}>
              운영을 넘길 멤버를 선택해주세요.
            </AppText>
            {candidates === null ? (
              <ActivityIndicator size="small" color={colors.accent.primary} style={{ marginVertical: spacing.xl }} />
            ) : transferFailed ? (
              <AppText variant="body" tone="secondary" style={styles.sheetEmpty}>
                위임 후보를 불러오지 못했어요. 잠시 후 다시 시도해주세요.
              </AppText>
            ) : candidates.length === 0 ? (
              <AppText variant="body" tone="secondary" style={styles.sheetEmpty}>
                아직 위임할 수 있는 멤버가 없어요. (활동한 멤버 필요)
              </AppText>
            ) : (
              <FlatList
                data={candidates}
                keyExtractor={(c) => c.user_id}
                style={{ maxHeight: 320 }}
                renderItem={({ item: c }) => {
                  // v3.247 서버 확정: 플랫 셰이프(posts/comments/playlist_adds 직접) — 자격은 서비스 파생(eligible/reason)
                  const ineligible = c.eligible === false;
                  return (
                    <TouchableOpacity
                      style={[styles.candRow, ineligible && { opacity: 0.4 }]}
                      disabled={ineligible || transferBusy}
                      onPress={() => pickCandidate(c)}
                      accessibilityLabel={`위임 후보 ${c.nickname || c.user_id}`}
                    >
                      <View style={{ flex: 1 }}>
                        <AppText variant="callout" numberOfLines={1}>{c.nickname || '멤버'}</AppText>
                        <AppText variant="caption" tone="muted" style={{ marginTop: 2 }}>
                          {`글 ${c.posts ?? 0} · 댓글 ${c.comments ?? 0} · 플리 담기 ${c.playlist_adds ?? 0}${fmtDate(c.joined_at) ? ` · ${fmtDate(c.joined_at)} 가입` : ''}`}
                        </AppText>
                        {ineligible ? (
                          <AppText variant="caption" tone="muted" style={{ marginTop: 2 }}>
                            {c.reason || '아직 위임을 받을 수 없어요'}
                          </AppText>
                        ) : null}
                      </View>
                      {!ineligible ? <Feather name="chevron-right" size={16} color={colors.text.muted} /> : null}
                    </TouchableOpacity>
                  );
                }}
              />
            )}
            <View style={{ marginTop: spacing.lg }}>
              <Button label="닫기" variant="tonal" fullWidth onPress={() => setTransferOpen(false)} />
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* v3.252 가입 신청 목록 — owner 전용 바텀시트(닉네임·신청일·was_kicked 표시, [승인]/[거절]) */}
      <Modal visible={joinReqOpen} transparent animationType="slide" onRequestClose={() => setJoinReqOpen(false)}>
        <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setJoinReqOpen(false)}>
          <TouchableOpacity style={styles.sheet} activeOpacity={1} onPress={() => {}}>
            <AppText variant="title3" style={{ marginBottom: spacing.xs }}>가입 신청</AppText>
            <AppText variant="footnote" tone="secondary" style={{ marginBottom: spacing.lg }}>
              {`승인하면 바로 ${CLUB_LABEL} 멤버가 돼요.`}
            </AppText>
            {!joinReqs || joinReqs.length === 0 ? (
              <AppText variant="body" tone="secondary" style={styles.sheetEmpty}>
                대기 중인 가입 신청이 없어요.
              </AppText>
            ) : (
              <FlatList
                data={joinReqs}
                keyExtractor={(r) => r.user_id}
                style={{ maxHeight: 320 }}
                renderItem={({ item: r }) => (
                  <View style={styles.candRow}>
                    <View style={{ flex: 1 }}>
                      <AppText variant="callout" numberOfLines={1}>{r.nickname || '신청자'}</AppText>
                      <AppText variant="caption" tone="muted" style={{ marginTop: 2 }}>
                        {fmtDate(r.requested_at) ? `${fmtDate(r.requested_at)} 신청` : '신청일 정보 없음'}
                      </AppText>
                      {r.was_kicked ? (
                        <AppText variant="caption" style={{ marginTop: 2, color: colors.status.error }}>
                          이전에 내보낸 멤버
                        </AppText>
                      ) : null}
                    </View>
                    <Button
                      label="승인"
                      size="sm"
                      disabled={joinReqBusy}
                      onPress={() => confirmJoinRequestAction(r, 'approve')}
                    />
                    <Button
                      label="거절"
                      size="sm"
                      variant="tonal"
                      disabled={joinReqBusy}
                      onPress={() => confirmJoinRequestAction(r, 'reject')}
                    />
                  </View>
                )}
              />
            )}
            <View style={{ marginTop: spacing.lg }}>
              <Button label="닫기" variant="tonal" fullWidth onPress={() => setJoinReqOpen(false)} />
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* v3.249 멤버 신고 — 기존 ReportModal 재사용(targetType 'club_member' + 크루 컨텍스트) */}
      <ReportModal
        visible={!!reportTarget}
        targetType="club_member"
        targetId={reportTarget?.user_id || ''}
        clubId={String(clubId)}
        onClose={() => setReportTarget(null)}
      />

      {/* 비로그인 액션(가입·글쓰기 등) → 로그인 오버레이 — FeedScreen 관행 */}
      {!user && ctaVisible ? (
        <TouchableOpacity style={styles.loginOverlay} activeOpacity={1} onPress={() => setCtaVisible(false)}>
          <LoginPrompt
            desc={`로그인하면 ${CLUB_LABEL}에 가입하고\n채팅과 게시판을 함께 쓸 수 있어요`}
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
  // v3.252: 채팅 탭 패널 — 멤버 입장 카드/비멤버 게이트(surface1 카드, 커뮤니티 히어로 관행)
  chatPanel: {
    alignItems: 'center', marginHorizontal: spacing.lg, marginBottom: spacing.md,
    paddingVertical: spacing.xl, paddingHorizontal: spacing.lg,
    backgroundColor: colors.bg.surface1, borderRadius: radius.lg,
  },
  chatIcon: {
    width: 40, height: 40, borderRadius: radius.lg,
    backgroundColor: colors.bg.surface2, alignItems: 'center', justifyContent: 'center',
  },
  // v3.252: pending 신청 철회 행 — infoBox 하단 소형 행
  cancelReqRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    marginTop: spacing.sm, alignSelf: 'flex-start', paddingVertical: spacing.xs,
  },
  // v3.252: owner 가입 신청 대기 행 — 멤버 섹션 상단(accent 톤)
  joinReqRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.lg, paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border.subtle,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  // v3.247: 크루 삭제 요청 행(정보 탭 owner 전용) — 목록 행 관행 + error 톤
  deleteReqRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.xxl, paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border.subtle,
  },
  // v3.249: 멤버 행(정보 탭) — 위임 후보 행 관행 + 아바타 원형
  memberRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.md, marginHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  memberAvatar: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: colors.bg.surface2, alignItems: 'center', justifyContent: 'center',
  },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  roleBadge: {
    paddingHorizontal: spacing.xs, paddingVertical: 1,
    borderRadius: radius.sm, backgroundColor: colors.bg.surface2,
  },
  // v3.247: 운영자 위임 바텀시트 — PlaylistPickerSheet 시트 관행
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg.surface1, borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl,
    padding: spacing.xl, maxHeight: '70%',
  },
  sheetEmpty: { marginVertical: spacing.xl, textAlign: 'center' as const },
  candRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.md, marginBottom: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
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
