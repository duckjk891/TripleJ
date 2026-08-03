import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FiEdit } from 'react-icons/fi';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../api';
import dmSocket from '../utils/dmSocket';
import Avatar from '../components/Avatar';
import DmChatView from '../components/DmChatView';
import ReportModal from '../components/ReportModal';
import './DmInboxPage.css';

// v152 — 실시간 1:1 DM함. 좌측 대화목록 + 우측 DmChatView(인스타식 2패널, 모바일 전환).
// v155 — 인스타 완전체(C안): 새 메시지 전체 사용자 검색(300ms 디바운스) + "메시지|요청 N" 탭
//        + 수락/거절/차단 흐름 + 발신자 pending 라벨 + WS pending/accepted 분기.
// v156 — 배틀태그(#XXXX = referral_code) 병기: 목록/요청/검색 결과 닉네임 옆 + compose 내 태그 안내.
// 로그 prefix `[DmInbox]`. 메시지 text/검색어 원문은 콘솔 출력 금지(길이만). 태그값은 비밀 아님 — 로그 허용.

const MSG_PAGE = 30;

function fmtListTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
}

export default function DmInboxPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { cid: routeCid } = useParams();

  const [eligible, setEligible] = useState(null); // null=미확인, true/false
  const [conversations, setConversations] = useState([]);
  const [convLoading, setConvLoading] = useState(true);
  const [convError, setConvError] = useState('');

  const [activeCid, setActiveCid] = useState(routeCid || null);
  const [messages, setMessages] = useState([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [msgLoadingMore, setMsgLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [sending, setSending] = useState(false);
  const [reportMsg, setReportMsg] = useState(null); // 신고 대상 메시지

  // v155 — 메시지 요청함 탭 ('messages' | 'requests')
  const [tab, setTab] = useState('messages');
  const [requests, setRequests] = useState([]); // 수신 pending 대화 (serialize 동일 형태)
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestsError, setRequestsError] = useState('');
  const [requestsCount, setRequestsCount] = useState(0); // 탭 뱃지 (unread-count.requests | requests.length)

  // 새 메시지 모달 — v155: 전체 사용자 서버 검색 + 추천(나를 팔로우) 섹션
  const [composeOpen, setComposeOpen] = useState(false);
  const [followers, setFollowers] = useState([]);
  const [followersLoading, setFollowersLoading] = useState(false);
  const [followersError, setFollowersError] = useState('');
  const [composeFilter, setComposeFilter] = useState('');
  const [composeStarting, setComposeStarting] = useState(null); // 시작 중인 peer id
  const [searchResults, setSearchResults] = useState([]); // 서버 검색 결과
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [myTag, setMyTag] = useState(''); // v156 — 내 태그(= referral_code), compose 하단 안내. 실패 시 빈값 유지 → 미표시

  // WS 콜백에서 최신 activeCid 참조용
  const activeCidRef = useRef(activeCid);
  useEffect(() => { activeCidRef.current = activeCid; }, [activeCid]);
  // 콜백에서 최신 목록/요청함 참조용 (pending 판정)
  const conversationsRef = useRef(conversations);
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);
  const requestsRef = useRef(requests);
  useEffect(() => { requestsRef.current = requests; }, [requests]);

  const currentUserId = user?.id;

  // 비로그인 → 로그인 유도
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      if (import.meta.env.DEV) console.info('[DmInbox] no user, redirecting to /login');
      navigate('/login');
    }
  }, [authLoading, user, navigate]);

  // 자격(본인인증) 확인
  useEffect(() => {
    if (!user) return;
    let alive = true;
    if (import.meta.env.DEV) console.info('[DmInbox] fetching eligibility');
    api.getDmEligibility()
      .then(({ data }) => {
        if (!alive) return;
        setEligible(!!data?.is_verified);
        if (import.meta.env.DEV) console.info('[DmInbox] eligibility', { is_verified: !!data?.is_verified });
      })
      .catch((err) => {
        console.error('[DmInbox] getDmEligibility failed', { status: err?.response?.status, message: err?.message });
        // 실패 시엔 목록 로드를 시도하되(서버가 최종 게이트), 자격은 미확정(null)으로 둠
        if (alive) setEligible(true);
      });
    return () => { alive = false; };
  }, [user]);

  // 대화 목록 로드
  const loadConversations = useCallback(async () => {
    setConvLoading(true);
    setConvError('');
    if (import.meta.env.DEV) console.info('[DmInbox] loading conversations');
    try {
      const { data } = await api.getDmConversations();
      const list = Array.isArray(data?.conversations) ? data.conversations : [];
      setConversations(list);
      if (import.meta.env.DEV) console.info('[DmInbox] conversations loaded', { count: list.length });
    } catch (err) {
      console.error('[DmInbox] getDmConversations failed', { status: err?.response?.status, message: err?.message });
      setConvError('대화 목록을 불러오지 못했습니다.');
    } finally {
      setConvLoading(false);
    }
  }, []);

  // v155 — 수신 pending 요청 목록 로드 (탭 진입/WS 갱신 시)
  const loadRequests = useCallback(async () => {
    setRequestsLoading(true);
    setRequestsError('');
    if (import.meta.env.DEV) console.info('[DmInbox] loading requests');
    try {
      const { data } = await api.getDmRequests();
      const list = Array.isArray(data?.requests) ? data.requests : [];
      setRequests(list);
      setRequestsCount(list.length);
      if (import.meta.env.DEV) console.info('[DmInbox] requests loaded', { count: list.length });
    } catch (err) {
      console.error('[DmInbox] getDmRequests failed', { status: err?.response?.status, message: err?.message });
      setRequestsError('요청 목록을 불러오지 못했습니다.');
    } finally {
      setRequestsLoading(false);
    }
  }, []);

  // v155 — 요청 탭 뱃지 카운트 (unread-count 확장 응답의 requests 필드)
  const refreshRequestsCount = useCallback(async () => {
    try {
      const { data } = await api.getDmUnreadCount();
      if (typeof data?.requests === 'number') setRequestsCount(data.requests);
    } catch (err) {
      console.error('[DmInbox] getDmUnreadCount failed', { status: err?.response?.status, message: err?.message });
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    loadConversations();
    refreshRequestsCount();
  }, [user, loadConversations, refreshRequestsCount]);

  const activeConversation = conversations.find((c) => c.conversation_id === activeCid)
    || requests.find((c) => c.conversation_id === activeCid)
    || null;
  // v155 — 내가 수신자인 pending 요청 대화 여부 (수락/거절 바 + markDmRead skip)
  const isRequestMode = !!activeConversation
    && activeConversation.status === 'pending'
    && String(activeConversation.requester_id) !== String(currentUserId);

  // 대화 선택 → 메시지 로드 + 읽음 처리 (convHint: 목록 state 반영 전 직접 전달용)
  const openConversation = useCallback(async (cid, convHint = null) => {
    if (!cid) return;
    setActiveCid(cid);
    setMessages([]);
    setHasMore(false);
    setMsgLoading(true);
    if (import.meta.env.DEV) console.info('[DmInbox] opening conversation', { cid: String(cid).slice(0, 8) });
    try {
      const { data } = await api.getDmMessages(cid, { limit: MSG_PAGE });
      const list = Array.isArray(data?.messages) ? data.messages : [];
      // 서버는 created_at desc → 오름차순으로 표시(과거→최신)
      const ordered = [...list].reverse();
      setMessages(ordered);
      setHasMore(data?.has_more ?? (list.length >= MSG_PAGE));
      if (import.meta.env.DEV) console.info('[DmInbox] messages loaded', { count: ordered.length, has_more: !!data?.has_more });
    } catch (err) {
      console.error('[DmInbox] getDmMessages failed', { status: err?.response?.status, message: err?.message });
    }
    setMsgLoading(false);
    // v155 — 수신 pending 요청은 읽음 처리 skip (열람 노출 금지 — 백엔드도 no-op 이지만 프론트도 안 부름)
    const conv = convHint
      || conversationsRef.current.find((c) => c.conversation_id === cid)
      || requestsRef.current.find((c) => c.conversation_id === cid);
    const pendingReceived = !!conv
      && conv.status === 'pending'
      && String(conv.requester_id) !== String(currentUserId);
    if (pendingReceived) {
      if (import.meta.env.DEV) console.info('[DmInbox] pending request opened, skip markDmRead', { cid: String(cid).slice(0, 8) });
      return;
    }
    // 읽음 처리 + 목록 unread 0
    try {
      await api.markDmRead(cid);
      setConversations((prev) => prev.map((c) => (c.conversation_id === cid ? { ...c, unread: 0 } : c)));
    } catch (err) {
      console.error('[DmInbox] markDmRead failed', { status: err?.response?.status, message: err?.message });
    }
  }, [currentUserId]);

  // 라우트 파라미터(/dm/:cid)로 진입 시 자동 오픈 (목록 로드 후)
  useEffect(() => {
    if (routeCid && routeCid !== activeCidRef.current) {
      openConversation(routeCid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeCid]);

  // 과거 메시지 로드 (before 커서 = 현재 가장 오래된 메시지 id)
  const loadMore = useCallback(async () => {
    const cid = activeCidRef.current;
    if (!cid || msgLoadingMore || messages.length === 0) return;
    const before = messages[0]?.id;
    if (!before) return;
    setMsgLoadingMore(true);
    if (import.meta.env.DEV) console.info('[DmInbox] loading older messages', { before: String(before).slice(0, 8) });
    try {
      const { data } = await api.getDmMessages(cid, { before, limit: MSG_PAGE });
      const list = Array.isArray(data?.messages) ? data.messages : [];
      const older = [...list].reverse();
      setMessages((prev) => [...older, ...prev]);
      setHasMore(data?.has_more ?? (list.length >= MSG_PAGE));
    } catch (err) {
      console.error('[DmInbox] load older failed', { status: err?.response?.status, message: err?.message });
    } finally {
      setMsgLoadingMore(false);
    }
  }, [messages, msgLoadingMore]);

  // 메시지 전송 (낙관적 추가 → 서버 응답 반영)
  const handleSend = useCallback(async (text) => {
    const cid = activeCidRef.current;
    if (!cid || !text) return;
    const tempId = `tmp-${Date.now()}`;
    const optimistic = {
      id: tempId,
      sender_id: currentUserId,
      text,
      created_at: new Date().toISOString(),
      read: false,
      pending: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    setSending(true);
    try {
      const { data } = await api.sendDmMessage(cid, text);
      const saved = data?.message;
      if (import.meta.env.DEV) console.info('[DmInbox] message sent', { cid: String(cid).slice(0, 8) });
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...saved, pending: false } : m)));
      // 목록 last_message 갱신 + 상단 이동
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.conversation_id === cid);
        if (idx < 0) return prev;
        const updated = {
          ...prev[idx],
          last_message_text: text.slice(0, 200),
          last_sender_id: currentUserId,
          last_at: saved?.created_at || optimistic.created_at,
          unread: 0,
        };
        return [updated, ...prev.filter((_, i) => i !== idx)];
      });
    } catch (err) {
      const status = err?.response?.status;
      console.error('[DmInbox] sendDmMessage failed', { status, message: err?.message });
      // 낙관적 메시지 제거 + 사용자 안내
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      const detail = err?.response?.data?.error || err?.response?.data?.detail;
      alert(status === 403
        ? (detail || '메시지를 보낼 수 없습니다.')
        : '메시지 전송에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setSending(false);
    }
  }, [currentUserId]);

  // ── WebSocket 실시간 수신 ───────────────────────────────
  useEffect(() => {
    if (!user) return undefined;
    dmSocket.connect();

    const offMessage = dmSocket.onMessage((payload) => {
      const cid = payload?.conversation_id;
      const msg = payload?.message;
      if (!cid || !msg) return;
      const isActive = cid === activeCidRef.current;
      // v155 — pending 대화 수신 메시지 = 내가 수신자(요청자만 전송 가능) → 요청함 갱신
      const isPendingIncoming = payload?.conversation_status === 'pending'
        && !conversationsRef.current.some((c) => c.conversation_id === cid);

      if (isActive) {
        // 현재 열린 대화 → append (중복/낙관적 방지: 동일 id 존재 시 skip)
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        // 즉시 읽음 처리 (v155 — 수신 pending 은 열람 노출 금지 → skip)
        if (!isPendingIncoming) {
          api.markDmRead(cid).catch((err) => {
            console.error('[DmInbox] markDmRead(ws) failed', { status: err?.response?.status, message: err?.message });
          });
        }
      }

      if (isPendingIncoming) {
        // 메인 목록 대신 요청함/카운트 갱신
        setRequests((prev) => {
          const idx = prev.findIndex((c) => c.conversation_id === cid);
          if (idx < 0) {
            if (import.meta.env.DEV) console.info('[DmInbox] ws pending message for unknown request, refetching requests');
            loadRequests();
            return prev;
          }
          const updated = {
            ...prev[idx],
            last_message_text: (msg.text || '').slice(0, 200),
            last_sender_id: msg.sender_id,
            last_at: msg.created_at,
            unread: (prev[idx].unread || 0) + 1,
          };
          return [updated, ...prev.filter((_, i) => i !== idx)];
        });
        return;
      }

      // 목록 갱신: 해당 대화 last_message/unread 갱신 + 상단 이동
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.conversation_id === cid);
        if (idx < 0) {
          // 목록에 없는 신규 대화 → 목록 재조회
          if (import.meta.env.DEV) console.info('[DmInbox] ws message for unknown conversation, refetching');
          loadConversations();
          return prev;
        }
        const mine = String(msg.sender_id) === String(currentUserId);
        const updated = {
          ...prev[idx],
          last_message_text: (msg.text || '').slice(0, 200),
          last_sender_id: msg.sender_id,
          last_at: msg.created_at,
          unread: isActive || mine ? (prev[idx].unread || 0) : (prev[idx].unread || 0) + 1,
        };
        return [updated, ...prev.filter((_, i) => i !== idx)];
      });
    });

    // v155 — 내가 보낸 요청이 수락됨(요청자 수신) → 대화 status 갱신("요청 대기 중" 라벨 제거)
    const offAccepted = dmSocket.onAccepted((payload) => {
      const cid = payload?.conversation_id;
      if (!cid) return;
      if (import.meta.env.DEV) console.info('[DmInbox] ws accepted', { cid: String(cid).slice(0, 8) });
      setConversations((prev) => prev.map((c) => (
        c.conversation_id === cid ? { ...c, status: 'accepted' } : c
      )));
    });

    const offRead = dmSocket.onRead((payload) => {
      const cid = payload?.conversation_id;
      if (!cid) return;
      // 멀티탭 읽음 동기화 → 목록 unread 0
      setConversations((prev) => prev.map((c) => (c.conversation_id === cid ? { ...c, unread: 0 } : c)));
      if (cid === activeCidRef.current) {
        setMessages((prev) => prev.map((m) => (
          String(m.sender_id) === String(currentUserId) ? { ...m, read: true } : m
        )));
      }
    });

    return () => {
      offMessage();
      offRead();
      offAccepted();
      // 소켓 자체는 헤더 배지도 공유하므로 여기서 disconnect 하지 않는다.
    };
  }, [user, currentUserId, loadConversations, loadRequests]);

  // 차단 (v155 — 요청함 대화도 지원: 차단 후 요청 삭제로 재요청 차단)
  const handleBlock = useCallback(async () => {
    const cid = activeCidRef.current;
    const conv = conversationsRef.current.find((c) => c.conversation_id === cid)
      || requestsRef.current.find((c) => c.conversation_id === cid);
    const peer = conv?.peer;
    if (!peer?.id) return;
    if (!window.confirm(`${peer.nickname || '이 사용자'}님을 차단할까요? 서로 메시지를 주고받을 수 없게 됩니다.`)) return;
    if (import.meta.env.DEV) console.info('[DmInbox] block user', { peer: String(peer.id).slice(0, 8) });
    try {
      await api.blockDmUser(peer.id);
      const pendingReceived = conv.status === 'pending'
        && String(conv.requester_id) !== String(currentUserId);
      if (pendingReceived) {
        // 요청함 항목 — 차단 후 요청도 삭제(대화+메시지 제거, 결정 1 완화책)
        api.declineDmRequest(cid).catch((err) => {
          console.error('[DmInbox] declineDmRequest(after block) failed', { status: err?.response?.status, message: err?.message });
        });
        setRequests((prev) => prev.filter((c) => c.conversation_id !== cid));
        setRequestsCount((n) => Math.max(0, n - 1));
      } else {
        // 대화 목록에서 제거
        setConversations((prev) => prev.filter((c) => c.conversation_id !== cid));
      }
      setActiveCid(null);
      setMessages([]);
      alert('차단했습니다.');
    } catch (err) {
      console.error('[DmInbox] blockDmUser failed', { status: err?.response?.status, message: err?.message });
      alert('차단에 실패했습니다. 잠시 후 다시 시도해주세요.');
    }
  }, [currentUserId]);

  // v155 — 요청 수락: accepted 전환 → 메시지 탭 이동 + 대화 유지(입력 활성) + 이때 읽음 처리
  const handleAccept = useCallback(async () => {
    const cid = activeCidRef.current;
    if (!cid) return;
    const fallback = requestsRef.current.find((c) => c.conversation_id === cid);
    if (import.meta.env.DEV) console.info('[DmInbox] accepting request', { cid: String(cid).slice(0, 8) });
    try {
      const { data } = await api.acceptDmRequest(cid);
      const accepted = data?.conversation
        || (fallback ? { ...fallback, status: 'accepted' } : null);
      setRequests((prev) => prev.filter((c) => c.conversation_id !== cid));
      setRequestsCount((n) => Math.max(0, n - 1));
      if (accepted) {
        setConversations((prev) => [accepted, ...prev.filter((c) => c.conversation_id !== cid)]);
      } else {
        loadConversations();
      }
      setTab('messages');
      // 수락 후 첫 읽음 처리 (이제 정상 read 허용)
      try {
        await api.markDmRead(cid);
        setConversations((prev) => prev.map((c) => (c.conversation_id === cid ? { ...c, unread: 0 } : c)));
      } catch (err) {
        console.error('[DmInbox] markDmRead(accept) failed', { status: err?.response?.status, message: err?.message });
      }
    } catch (err) {
      const status = err?.response?.status;
      console.error('[DmInbox] acceptDmRequest failed', { status, message: err?.message });
      alert(status === 400 ? '이미 처리된 요청입니다.' : '요청 수락에 실패했습니다. 잠시 후 다시 시도해주세요.');
      loadRequests();
    }
  }, [loadConversations, loadRequests]);

  // v155 — 요청 거절: 대화+메시지 삭제(상대 무통지) → 요청 목록 제거 + 뷰 닫기
  const handleDecline = useCallback(async () => {
    const cid = activeCidRef.current;
    if (!cid) return;
    if (!window.confirm('요청을 거절하면 대화가 삭제됩니다. 신고가 필요하면 거절 전에 해주세요. 차단하지 않으면 다시 요청이 올 수 있어요.')) return;
    if (import.meta.env.DEV) console.info('[DmInbox] declining request', { cid: String(cid).slice(0, 8) });
    try {
      await api.declineDmRequest(cid);
      setRequests((prev) => prev.filter((c) => c.conversation_id !== cid));
      setRequestsCount((n) => Math.max(0, n - 1));
      setActiveCid(null);
      setMessages([]);
    } catch (err) {
      const status = err?.response?.status;
      console.error('[DmInbox] declineDmRequest failed', { status, message: err?.message });
      alert('요청 거절에 실패했습니다. 잠시 후 다시 시도해주세요.');
      loadRequests();
    }
  }, [loadRequests]);

  const handleBack = useCallback(() => {
    setActiveCid(null);
    setMessages([]);
  }, []);

  // ── 새 메시지 (v155 — 전체 사용자 검색 + 추천(나를 팔로우) 섹션) ───────────────
  const openCompose = useCallback(async () => {
    setComposeOpen(true);
    setComposeFilter('');
    setSearchResults([]);
    setSearchError('');
    setFollowersLoading(true);
    setFollowersError('');
    // v156 — 내 태그(= referral_code) 비차단 로드. 실패 시 조용히 숨김(안내 문구 미표시).
    api.getMyReferralCode()
      .then(({ data }) => {
        const code = data?.referral_code || '';
        setMyTag(code);
        if (import.meta.env.DEV) console.info('[DmInbox] my tag loaded', { code });
      })
      .catch((err) => {
        console.error('[DmInbox] getMyReferralCode failed', { status: err?.response?.status, message: err?.message });
      });
    if (import.meta.env.DEV) console.info('[DmInbox] compose open, loading followers');
    try {
      const { data } = await api.getMyFollowers({ page: 1, limit: 100 });
      const list = Array.isArray(data?.followers) ? data.followers : [];
      setFollowers(list);
      if (import.meta.env.DEV) console.info('[DmInbox] followers loaded', { count: list.length });
    } catch (err) {
      console.error('[DmInbox] getMyFollowers failed', { status: err?.response?.status, message: err?.message });
      setFollowersError('목록을 불러오지 못했습니다.');
    } finally {
      setFollowersLoading(false);
    }
  }, []);

  const startConversation = useCallback(async (peer) => {
    if (!peer?.id || composeStarting) return;
    setComposeStarting(peer.id);
    if (import.meta.env.DEV) console.info('[DmInbox] starting conversation', { peer: String(peer.id).slice(0, 8) });
    try {
      const { data } = await api.createDmConversation(peer.id);
      const cid = data?.conversation_id;
      if (!cid) throw new Error('conversation_id missing');
      if (import.meta.env.DEV) console.info('[DmInbox] conversation ready', { cid: String(cid).slice(0, 8), status: data?.status });
      // v155 — 이미 상대가 나에게 보낸 pending 요청이면 요청함으로 (기존 대화 반환 케이스)
      const isReceivedRequest = data?.status === 'pending'
        && String(data?.requester_id) !== String(currentUserId);
      if (isReceivedRequest) {
        setRequests((prev) => (
          prev.some((c) => c.conversation_id === cid) ? prev : [data, ...prev]
        ));
        setTab('requests');
      } else {
        // 목록에 없으면 추가 (기존 대화면 그대로 — 발신자측 pending 도 메인 목록, 결정 4)
        setConversations((prev) => (
          prev.some((c) => c.conversation_id === cid) ? prev : [data, ...prev]
        ));
      }
      setComposeOpen(false);
      navigate(`/dm/${cid}`);
      openConversation(cid, data);
    } catch (err) {
      const status = err?.response?.status;
      console.error('[DmInbox] createDmConversation failed', { status, message: err?.message });
      const detail = err?.response?.data?.error || err?.response?.data?.detail;
      alert(status === 403 ? (detail || '이 사용자와는 대화를 시작할 수 없습니다.') : '대화를 시작하지 못했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setComposeStarting(null);
    }
  }, [composeStarting, navigate, openConversation, currentUserId]);

  // v155 — 검색어 입력 시 300ms 디바운스 서버 검색 (검색어 원문 미로그 — 길이만)
  const composeQuery = composeFilter.trim();
  useEffect(() => {
    if (!composeOpen) return undefined;
    if (!composeQuery) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchError('');
      return undefined;
    }
    setSearchLoading(true);
    setSearchError('');
    let cancelled = false;
    const timer = setTimeout(() => {
      if (import.meta.env.DEV) console.info('[DmInbox] searching users', { qlen: composeQuery.length });
      api.searchDmUsers(composeQuery)
        .then(({ data }) => {
          if (cancelled) return;
          const list = Array.isArray(data?.users) ? data.users : [];
          setSearchResults(list);
          if (import.meta.env.DEV) console.info('[DmInbox] user search results', { count: list.length });
        })
        .catch((err) => {
          if (cancelled) return;
          console.error('[DmInbox] searchDmUsers failed', { status: err?.response?.status, message: err?.message });
          setSearchError('검색에 실패했습니다.');
        })
        .finally(() => {
          if (!cancelled) setSearchLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [composeOpen, composeQuery]);

  // ── 렌더 ───────────────────────────────
  if (authLoading || !user) {
    return <div className="dminbox dminbox--center"><p>불러오는 중...</p></div>;
  }

  // 미인증 안내 (서버가 최종 게이트지만 UX 상 선안내)
  if (eligible === false) {
    return (
      <div className="dminbox dminbox--center">
        <div className="dminbox__gate">
          <p className="dminbox__gate-title">본인인증 후 이용할 수 있어요</p>
          <p className="dminbox__gate-sub">다이렉트 메시지는 본인인증을 완료한 회원만 이용할 수 있습니다.</p>
          <button className="dminbox__gate-btn" onClick={() => navigate('/')}>홈으로</button>
        </div>
      </div>
    );
  }

  // 대화/요청 목록 공용 항목 렌더 (v155 — 발신자측 pending 은 "요청 대기 중" 라벨)
  const renderConvItem = (c) => {
    const peer = c.peer || {};
    const active = c.conversation_id === activeCid;
    const unread = c.unread || 0;
    const senderPending = c.status === 'pending' && String(c.requester_id) === String(currentUserId);
    return (
      <li key={c.conversation_id}>
        <button
          className={`dminbox__conv ${active ? 'dminbox__conv--active' : ''}`}
          onClick={() => openConversation(c.conversation_id)}
        >
          <Avatar src={peer.profile_image} name={peer.nickname} size={44} />
          <div className="dminbox__conv-main">
            <div className="dminbox__conv-top">
              <span className="dminbox__conv-name">
                {peer.nickname || '알 수 없음'}
                {peer.code && <span className="dminbox__tag">#{peer.code}</span>}
              </span>
              {senderPending && <span className="dminbox__conv-pending">요청 대기 중</span>}
              <span className="dminbox__conv-time">{fmtListTime(c.last_at)}</span>
            </div>
            <div className="dminbox__conv-bottom">
              <span className={`dminbox__conv-preview ${unread > 0 ? 'dminbox__conv-preview--unread' : ''}`}>
                {c.last_message_text || '대화를 시작해보세요'}
              </span>
              {unread > 0 && (
                <span className="dminbox__conv-badge">{unread > 99 ? '99+' : unread}</span>
              )}
            </div>
          </div>
        </button>
      </li>
    );
  };

  return (
    <div className="dminbox">
      <div className={`dminbox__panels ${activeCid ? 'dminbox__panels--chat' : ''}`}>
        {/* 좌측: 대화 목록 */}
        <aside className="dminbox__list">
          <div className="dminbox__list-head">
            <h1 className="dminbox__title">메시지</h1>
            <button
              className="dminbox__compose-btn"
              onClick={openCompose}
              title="새 메시지"
              aria-label="새 메시지"
            >
              <FiEdit size={18} />
            </button>
          </div>
          {/* v155 — "메시지 | 요청 N" 탭 */}
          <div className="dminbox__tabs">
            <button
              className={`dminbox__tab ${tab === 'messages' ? 'dminbox__tab--active' : ''}`}
              onClick={() => setTab('messages')}
            >
              메시지
            </button>
            <button
              className={`dminbox__tab ${tab === 'requests' ? 'dminbox__tab--active' : ''}`}
              onClick={() => { setTab('requests'); loadRequests(); }}
            >
              요청
              {requestsCount > 0 && (
                <span className="dminbox__tab-badge">{requestsCount > 99 ? '99+' : requestsCount}</span>
              )}
            </button>
          </div>
          {tab === 'requests' ? (
            requestsLoading ? (
              <p className="dminbox__list-status">불러오는 중...</p>
            ) : requestsError ? (
              <div className="dminbox__list-status">
                <p>{requestsError}</p>
                <button className="dminbox__retry" onClick={loadRequests}>다시 시도</button>
              </div>
            ) : requests.length === 0 ? (
              <p className="dminbox__list-status">받은 메시지 요청이 없습니다.</p>
            ) : (
              <ul className="dminbox__conv-list">
                {requests.map((c) => renderConvItem(c))}
              </ul>
            )
          ) : convLoading ? (
            <p className="dminbox__list-status">불러오는 중...</p>
          ) : convError ? (
            <div className="dminbox__list-status">
              <p>{convError}</p>
              <button className="dminbox__retry" onClick={loadConversations}>다시 시도</button>
            </div>
          ) : conversations.length === 0 ? (
            <p className="dminbox__list-status">아직 대화가 없습니다.</p>
          ) : (
            <ul className="dminbox__conv-list">
              {conversations.map((c) => renderConvItem(c))}
            </ul>
          )}
        </aside>

        {/* 우측: 대화 뷰 */}
        <section className="dminbox__chat">
          {activeConversation ? (
            <DmChatView
              conversation={activeConversation}
              messages={messages}
              currentUserId={currentUserId}
              loading={msgLoading}
              loadingMore={msgLoadingMore}
              hasMore={hasMore}
              sending={sending}
              onSend={handleSend}
              onLoadMore={loadMore}
              onBack={handleBack}
              onBlock={handleBlock}
              onReport={(m) => setReportMsg(m)}
              requestMode={isRequestMode}
              onAccept={handleAccept}
              onDecline={handleDecline}
            />
          ) : (
            <div className="dminbox__chat-empty">
              <p>대화를 선택하세요</p>
            </div>
          )}
        </section>
      </div>

      {reportMsg && (
        <ReportModal
          targetType="dm_message"
          targetId={reportMsg.id}
          onClose={() => setReportMsg(null)}
        />
      )}

      {/* 새 메시지 — v155: 전체 사용자 서버 검색 + 추천(나를 팔로우) 섹션 */}
      {composeOpen && (
        <div className="dmcompose__overlay" onClick={() => setComposeOpen(false)}>
          <div className="dmcompose" onClick={(e) => e.stopPropagation()}>
            <div className="dmcompose__head">
              <h2 className="dmcompose__title">새 메시지</h2>
              <button className="dmcompose__close" onClick={() => setComposeOpen(false)} aria-label="닫기">×</button>
            </div>
            <p className="dmcompose__hint">
              닉네임으로 검색해 누구에게나 메시지를 보낼 수 있어요.
              상대가 나를 팔로우하지 않으면 메시지 요청으로 전달돼요.
              닉네임#태그 또는 #태그로 정확히 찾을 수 있어요.
            </p>
            <input
              className="dmcompose__filter"
              type="text"
              placeholder="닉네임 또는 #태그 검색"
              value={composeFilter}
              onChange={(e) => setComposeFilter(e.target.value)}
              autoFocus
            />
            <div className="dmcompose__body">
              {composeQuery ? (
                /* 검색어 있음 → 서버 검색 결과 */
                searchLoading ? (
                  <p className="dmcompose__status">검색 중...</p>
                ) : searchError ? (
                  <p className="dmcompose__status">{searchError}</p>
                ) : searchResults.length === 0 ? (
                  <p className="dmcompose__status">검색 결과가 없어요.</p>
                ) : (
                  <ul className="dmcompose__list">
                    {searchResults.map((f) => (
                      <li key={f.id}>
                        <button
                          className="dmcompose__user"
                          onClick={() => startConversation(f)}
                          disabled={!!composeStarting}
                        >
                          <Avatar src={f.profile_image} name={f.nickname} size={40} />
                          <span className="dmcompose__user-name">
                            {f.nickname || '알 수 없음'}
                            {f.code && <span className="dminbox__tag">#{f.code}</span>}
                          </span>
                          {composeStarting === f.id && <span className="dmcompose__user-status">시작 중...</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : followersLoading ? (
                <p className="dmcompose__status">불러오는 중...</p>
              ) : followersError ? (
                <div className="dmcompose__status">
                  <p>{followersError}</p>
                  <button className="dminbox__retry" onClick={openCompose}>다시 시도</button>
                </div>
              ) : followers.length === 0 ? (
                <p className="dmcompose__status">아직 나를 팔로우하는 사용자가 없어요.<br />닉네임을 검색해 메시지를 보내보세요.</p>
              ) : (
                <>
                  <p className="dmcompose__section">추천 — 나를 팔로우하는 사용자</p>
                  <ul className="dmcompose__list">
                    {followers.map((f) => (
                      <li key={f.id}>
                        <button
                          className="dmcompose__user"
                          onClick={() => startConversation(f)}
                          disabled={!!composeStarting}
                        >
                          <Avatar src={f.profile_image} name={f.nickname} size={40} />
                          <span className="dmcompose__user-name">
                            {f.nickname || '알 수 없음'}
                            {f.code && <span className="dminbox__tag">#{f.code}</span>}
                          </span>
                          {composeStarting === f.id && <span className="dmcompose__user-status">시작 중...</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            {/* v156 — 내 태그 안내 (로드 실패 시 미표시) */}
            {myTag && (
              <p className="dmcompose__mytag">
                내 태그: <span className="dmcompose__mytag-code">#{myTag}</span>
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
