import { useState, useEffect, useRef } from 'react';
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { FiSearch, FiMenu, FiX, FiMail } from 'react-icons/fi';
import { useAuth, ATTENDANCE_PROMPT_KEY } from '../contexts/AuthContext';
import * as api from '../api';
import dmSocket from '../utils/dmSocket';
import ProfileExtraForm from './ProfileExtraForm';
import AttendanceCard from './AttendanceCard';
import AppShareModal from './AppShareModal';
import ReportIssueModal from './ReportIssueModal';
import Avatar from './Avatar';
import { detectPlatform } from '../utils/snsPlatform';
import { CONSENTS, CONSENT_VERSION, OPTIONAL_INPUT_NOTICE } from '../constants/consentTexts';

const SNS_MAX = 5;
import './Header.css';

// v139 — 내 신고 내역: 대상 유형·상태 뱃지 표기
const REPORT_TYPE_LABEL = { track: '곡', feed: '피드', comment: '댓글' };

// v137 신고 사유 코드 → 라벨 (내 신고 내역 표시용)
const REPORT_REASON_LABEL = {
  portrait: '초상권 침해',
  copyright: '저작권 침해',
  sexual: '성적·불쾌 콘텐츠',
  abuse: '욕설·괴롭힘',
  other: '기타',
};

// 내가 접수한 신고의 사유 표시 — "사유 라벨" + 직접 쓴 상세(reason_text)가 있으면 이어붙임
function reportReasonText(r) {
  const label = REPORT_REASON_LABEL[r?.reason_code] || r?.reason_code || '기타';
  const detail = (r?.reason_text || '').trim();
  return detail ? `${label} · ${detail}` : label;
}

function reportStatusBadge(r) {
  if (r?.status === 'dismissed') return { label: '기각', cls: 'gray' };
  if (r?.status === 'pending') return { label: '처리 중', cls: 'yellow' };
  if (r?.status === 'actioned') {
    if (r.action === 'blind') return { label: '블라인드', cls: 'orange' };
    if (r.action === 'restore') return { label: '복원', cls: 'green' };
    if (r.action === 'delete' || r.action === 'confirm_delete') return { label: '삭제됨', cls: 'red' };
    return { label: '처리됨', cls: 'green' };
  }
  return { label: r?.status || '-', cls: 'gray' };
}

function reportSummaryText(r) {
  // BE 응답 키는 target (title | text_excerpt | text | {deleted:true})
  const s = r?.target || r?.target_summary || {};
  if (s.deleted) return '(삭제된 대상)';
  return s.title || s.text_excerpt || s.text || '(내용 없음)';
}

function fmtReportDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export default function Header() {
  const { user, logout, isAdmin, isBusiness, updateUser } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [points, setPoints] = useState(null);
  // v152 — DM: 본인인증 자격(봉투 활성) + 미읽음 배지
  const [dmVerified, setDmVerified] = useState(false);
  const [dmUnread, setDmUnread] = useState(0);
  // 출석체크(데일리 체크인) 모달 open 여부 — 별 배지 클릭으로 오픈
  const [attendanceOpen, setAttendanceOpen] = useState(false);
  // v154 — 앱 추천(리퍼럴) 공유 모달 open 여부 — 📢 버튼 클릭으로 오픈(로그인 전용)
  const [shareOpen, setShareOpen] = useState(false);
  // "내 정보 설정" 모달 — closed | loading | ready | saving
  const [profileModal, setProfileModal] = useState('closed');
  const [profileInitial, setProfileInitial] = useState(null);
  // 본인인증 상태 — { isVerified, provider } (getMe 의 is_verified/verify_provider)
  const [profileVerify, setProfileVerify] = useState({ isVerified: false, provider: null });
  // 미인증 사용자 [본인인증 하기] 클릭 시 인라인 안내 표시
  const [verifyNotice, setVerifyNotice] = useState(false);
  // 프로필 사진 업로드/삭제 진행 여부 + 사용자용 에러 메시지
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  // SNS 채널 행 (문자열 배열) + 클라 검증 인라인 에러 — 인증잠금과 무관하게 항상 수정 가능
  const [snsRows, setSnsRows] = useState([]);
  const [snsError, setSnsError] = useState('');
  // v125 — 마케팅 수신 동의 토글: null=로드 실패/미로드(행 숨김), bool=현재 상태
  const [marketingConsent, setMarketingConsent] = useState(null);
  const [marketingBusy, setMarketingBusy] = useState(false);
  // v135 — 얼굴 인증(생체정보) 상태: null=미로드/flag OFF(행 숨김), object=status 응답
  const [faceVerify, setFaceVerify] = useState(null);
  const [faceBusy, setFaceBusy] = useState(false);
  // v139 — 스트라이크: me.strikes {count, restricted_until, is_banned} (부재/실패 시 null → 배너 미표시)
  const [strikes, setStrikes] = useState(null);
  // v139 — 내 신고 내역: 프로필 모달 내 펼침 행 (null=미로드)
  const [myReportsOpen, setMyReportsOpen] = useState(false);
  const [myReports, setMyReports] = useState(null);
  const [myReportsLoading, setMyReportsLoading] = useState(false);
  const [myReportsError, setMyReportsError] = useState('');
  // CS 오류신고/문의 모달 (maidol_official DM 진입) — 프로필 설정 모달 내 진입점
  const [reportIssueOpen, setReportIssueOpen] = useState(false);
  // 회원탈퇴 — 모달 내 화면 전환(프로필 ↔ 탈퇴 확인) + 확인 문구 입력/에러/진행 상태
  // v156 — 내 태그(배틀태그 = referral_code). 로드 실패 시 빈값 유지 → 행 숨김.
  const [myTag, setMyTag] = useState('');
  const [myTagCopied, setMyTagCopied] = useState(false);
  const myTagCopyTimerRef = useRef(null);

  const [withdrawView, setWithdrawView] = useState(false);
  const [withdrawInput, setWithdrawInput] = useState('');
  const [withdrawError, setWithdrawError] = useState('');
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const avatarFileRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!user) { setPoints(null); return undefined; }
    let alive = true;
    const fetchBalance = (reason) => {
      if (import.meta.env.DEV) console.info('[Header] fetching points balance', { path: location.pathname, reason });
      api.getPointsBalance()
        .then(({ data }) => { if (alive) setPoints(data?.balance ?? 0); })
        .catch((err) => { console.error('[Header] getPointsBalance failed', { status: err?.response?.status, message: err?.message }); });
    };
    fetchBalance('route');
    // v158 — 과금/환불/스킵 직후 실시간 갱신: api.notifyPointsRefresh() 가 dispatch 하는 커스텀 이벤트 구독
    const onPointsRefresh = () => fetchBalance('points-refresh');
    window.addEventListener('aimu:points-refresh', onPointsRefresh);
    return () => {
      alive = false;
      window.removeEventListener('aimu:points-refresh', onPointsRefresh);
    };
  }, [user, location.pathname]);

  // v157 — 로그인 세션당 1회 출석체크 자동 팝업.
  // AuthContext 가 로그인 성공 시 세팅한 pending 플래그를 여기서 "동기적으로 소비" 후 status 판정.
  // 게이트 라우트(OAuth 콜백/로그인/가입)에서는 플래그를 소비하지 않고 보류 — 홈 등 이동 후 재실행 시 판정.
  useEffect(() => {
    if (!user) return;
    const path = location.pathname;
    if (path.startsWith('/oauth/callback') || path.startsWith('/login') || path.startsWith('/register')) return;
    let pending = null;
    try {
      pending = sessionStorage.getItem(ATTENDANCE_PROMPT_KEY);
      if (pending) sessionStorage.removeItem(ATTENDANCE_PROMPT_KEY); // fetch 전에 동기 소비 — StrictMode 이중 마운트에서도 1회성 보장
    } catch { /* sessionStorage 불가 환경 — 자동 팝업 생략(⭐ 배지 수동 경로 유지) */ }
    if (!pending) return;
    if (import.meta.env.DEV) console.info('[Header] attendance auto-prompt: flag consumed, checking status');
    api.getAttendanceStatus()
      .then(({ data }) => {
        // 주의: setAttendanceOpen 에 alive/cleanup 가드를 걸지 말 것 — StrictMode 이중 마운트에서 팝업 0회가 됨(PLAN v157 설계 결정 4)
        if (typeof data?.balance === 'number') setPoints(data.balance);
        if (data?.checked_today === false) {
          if (import.meta.env.DEV) console.info('[Header] attendance auto-prompt: open');
          setAttendanceOpen(true);
        } else if (import.meta.env.DEV) {
          console.info('[Header] attendance auto-prompt: skip(checked)');
        }
      })
      .catch((err) => {
        // 실패 시 조용히 무팝업 — ⭐ 배지 수동 경로가 폴백
        console.error('[Header] auto attendance status failed', { status: err?.response?.status, message: err?.message });
      });
  }, [user, location.pathname]);

  // v152 — DM 봉투: 본인인증 자격 확인 + 미읽음 배지(30s 폴링 + WS 실시간).
  // 미인증(is_verified=false)이면 봉투 비활성. 자격 있을 때만 unread 폴링/소켓 연결.
  useEffect(() => {
    if (!user) {
      setDmVerified(false);
      setDmUnread(0);
      dmSocket.disconnect();
      return undefined;
    }
    let alive = true;
    let pollTimer = null;
    let offMessage = () => {};
    let offUnread = () => {};
    let offRead = () => {};

    const refreshUnread = () => {
      api.getDmUnreadCount()
        .then(({ data }) => { if (alive) setDmUnread(Number(data?.count) || 0); })
        .catch((err) => {
          console.error('[Header] getDmUnreadCount failed', { status: err?.response?.status, message: err?.message });
        });
    };

    api.getDmEligibility()
      .then(({ data }) => {
        if (!alive) return;
        const verified = !!data?.is_verified;
        setDmVerified(verified);
        if (import.meta.env.DEV) console.info('[Header] dm eligibility', { is_verified: verified });
        if (!verified) return;
        // 자격 있음 → 배지 1회 + 30s 폴링 + 실시간 소켓 연결
        refreshUnread();
        pollTimer = setInterval(refreshUnread, 30000);
        dmSocket.connect();
        // WS 이벤트가 오면 배지 즉시 재동기화(정확도는 서버 카운트에 위임)
        offMessage = dmSocket.onMessage(() => refreshUnread());
        offUnread = dmSocket.onUnread((p) => {
          // v195 — 서버가 본인 대상 {"type":"unread"} 를 발행한다(count 미동봉).
          // count 부재 폴백(refreshUnread)이 실제 경로 — 대화 id·본문은 로그에 남기지 않는다.
          if (import.meta.env.DEV) console.info('[Header] ws unread event', { hasCount: typeof p?.count === 'number' });
          if (typeof p?.count === 'number') setDmUnread(p.count);
          else refreshUnread();
        });
        offRead = dmSocket.onRead(() => refreshUnread());
      })
      .catch((err) => {
        console.error('[Header] getDmEligibility failed', { status: err?.response?.status, message: err?.message });
      });

    return () => {
      alive = false;
      if (pollTimer) clearInterval(pollTimer);
      offMessage(); offUnread(); offRead();
    };
  }, [user]);

  // v139 — 스트라이크 상태 로드 (로그인 시 1회). strikes 필드 부재/실패 시 배너 미표시.
  useEffect(() => {
    if (!user) { setStrikes(null); return undefined; }
    let alive = true;
    api.getMe()
      .then(({ data }) => {
        if (!alive) return;
        const s = data?.strikes;
        setStrikes(s && typeof s.count === 'number' ? s : null);
        if (import.meta.env.DEV && s && typeof s.count === 'number' && s.count >= 1) {
          console.info('[Header] strikes loaded', {
            count: s.count,
            restricted: !!s.restricted_until,
            is_banned: !!s.is_banned,
          });
        }
      })
      .catch((err) => {
        console.error('[Header] strikes load failed', { status: err?.response?.status, message: err?.message });
      });
    return () => { alive = false; };
  }, [user]);

  // v139 — 생성 제한 활성 여부 (restricted_until 이 미래인 경우만)
  const restrictedUntilDate = strikes?.restricted_until ? new Date(strikes.restricted_until) : null;
  const strikeRestricted =
    !!restrictedUntilDate &&
    !Number.isNaN(restrictedUntilDate.getTime()) &&
    restrictedUntilDate.getTime() > Date.now();

  const handleSearch = (e) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (q) {
      navigate(`/search?q=${encodeURIComponent(q)}`);
    }
  };

  const closeMenu = () => setMenuOpen(false);

  // "내 정보 설정" — 현재 인구통계 값 로드 후 모달 표시.
  // 주의: birth_date/gender/region 값 자체는 콘솔에 출력 금지(원격 로깅으로 서버에 남음).
  const openProfileModal = async () => {
    setProfileModal('loading');
    setVerifyNotice(false);
    setAvatarError('');
    if (import.meta.env.DEV) console.info('[Header] profile settings open, fetching /auth/me');
    // v125 — 마케팅 동의 현재 상태 로드(비차단). 실패 시 토글 행 숨김(null 유지).
    setMarketingConsent(null);
    api.getMyConsents()
      .then(({ data }) => {
        const agreed = !!data?.consents?.marketing?.agreed;
        setMarketingConsent(agreed);
        if (import.meta.env.DEV) console.info('[Header] marketing consent loaded', { key: 'marketing', agreed });
      })
      .catch((err) => {
        console.error('[Header] getMyConsents failed', { status: err?.response?.status, message: err?.message });
      });
    // v156 — 내 태그(= referral_code) 로드(비차단). 실패 시 빈값 유지 → 행 자체 숨김.
    setMyTag('');
    setMyTagCopied(false);
    api.getMyReferralCode()
      .then(({ data }) => {
        const code = data?.referral_code || '';
        setMyTag(code);
        if (import.meta.env.DEV) console.info('[Header] my tag loaded', { code });
      })
      .catch((err) => {
        console.error('[Header] getMyReferralCode failed', { status: err?.response?.status, message: err?.message });
      });
    // v135 — 얼굴 인증 상태 로드(비차단). flag OFF/실패 시 null 유지 → 행 자체 숨김.
    setFaceVerify(null);
    api.getFaceVerifyStatus()
      .then(({ data }) => {
        if (data?.enabled) setFaceVerify(data);
        if (import.meta.env.DEV) {
          console.info('[FaceVerifyFlow] header status loaded', {
            enabled: !!data?.enabled,
            consent_needed: !!data?.consent_needed,
            registered: !!data?.registered,
          });
        }
      })
      .catch((err) => {
        console.error('[FaceVerifyFlow] header status load failed', { status: err?.response?.status, message: err?.message });
      });
    try {
      const { data } = await api.getMe();
      setProfileInitial({
        birth_date: data?.birth_date ?? null,
        gender: data?.gender ?? null,
        region: data?.region ?? null,
        nationality: data?.nationality ?? null,
      });
      setProfileVerify({
        isVerified: !!data?.is_verified,
        provider: data?.verify_provider ?? null,
      });
      setSnsRows(Array.isArray(data?.sns_links) ? data.sns_links : []);
      setSnsError('');
      // getMe 응답의 profile_image 를 AuthContext user 에 동기화 — 헤더/모달 미리보기 일치
      if (data && 'profile_image' in data) {
        updateUser({ profile_image: data.profile_image ?? null });
      }
      if (import.meta.env.DEV) {
        console.info('[Header] profile verify state', {
          isVerified: !!data?.is_verified,
          provider: data?.verify_provider ?? null,
        });
      }
      setProfileModal('ready');
    } catch (err) {
      console.error('[Header] getMe failed', { status: err?.response?.status, message: err?.message });
      // 조회 실패 시에도 빈 값으로 편집은 가능하게 (인증 상태는 미인증으로 간주)
      setProfileInitial({ birth_date: null, gender: null, region: null, nationality: null });
      setProfileVerify({ isVerified: false, provider: null });
      setSnsRows([]);
      setSnsError('');
      setProfileModal('ready');
    }
  };

  const closeProfileModal = () => {
    setProfileModal('closed');
    setProfileInitial(null);
    setVerifyNotice(false);
    setAvatarError('');
    setSnsRows([]);
    setSnsError('');
    setWithdrawView(false);
    setWithdrawInput('');
    setWithdrawError('');
    setWithdrawBusy(false);
    setMarketingConsent(null);
    setMarketingBusy(false);
    setFaceVerify(null);
    setFaceBusy(false);
    setMyReportsOpen(false);
    setMyReports(null);
    setMyReportsLoading(false);
    setMyReportsError('');
  };

  // v156 — 내 태그 복사 (#XXXX 형식 — DM 검색창에 그대로 붙여넣기 가능).
  // clipboard API → execCommand 폴백 (AppShareModal copyText 관행)
  const handleMyTagCopy = async () => {
    if (!myTag) return;
    const text = `#${myTag}`;
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        copied = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        copied = false;
      }
    }
    if (import.meta.env.DEV) console.info('[Header] my tag copy', { code: myTag, copied });
    if (!copied) {
      alert('복사에 실패했습니다.');
      return;
    }
    setMyTagCopied(true);
    if (myTagCopyTimerRef.current) clearTimeout(myTagCopyTimerRef.current);
    myTagCopyTimerRef.current = setTimeout(() => setMyTagCopied(false), 2000);
  };

  useEffect(() => {
    return () => {
      if (myTagCopyTimerRef.current) clearTimeout(myTagCopyTimerRef.current);
    };
  }, []);

  // v139 — 내 신고 내역 펼침/접기 — 첫 펼침 시에만 목록 로드.
  // 주의: reason_text 등 신고 원문은 절대 콘솔에 출력하지 않는다(건수만 로깅).
  const toggleMyReports = async () => {
    const next = !myReportsOpen;
    setMyReportsOpen(next);
    if (!next || myReports !== null || myReportsLoading) return;
    setMyReportsLoading(true);
    setMyReportsError('');
    if (import.meta.env.DEV) console.info('[MyReports] load start');
    try {
      const { data } = await api.getMyReports();
      const items = Array.isArray(data?.reports) ? data.reports : (Array.isArray(data?.items) ? data.items : []);
      setMyReports(items);
      if (import.meta.env.DEV) console.info('[MyReports] loaded', { count: items.length });
    } catch (err) {
      console.error('[MyReports] load failed', { status: err?.response?.status, message: err?.message });
      setMyReportsError('신고 내역을 불러오지 못했습니다.');
    } finally {
      setMyReportsLoading(false);
    }
  };

  // v135 — 얼굴 인증 동의 철회: confirm → DELETE → 상태 재조회.
  // 파기(저장 얼굴·검증 기록) 후 얼굴 사진 기능 이용이 중단됨을 confirm 문구로 고지.
  const handleFaceWithdraw = async () => {
    if (faceBusy) return;
    if (!window.confirm('철회하면 저장된 얼굴 정보가 파기되며 얼굴 사진 기능 이용이 중단됩니다. 철회할까요?')) return;
    setFaceBusy(true);
    if (import.meta.env.DEV) console.info('[FaceVerifyFlow] withdraw start');
    try {
      await api.withdrawFaceVerify();
      if (import.meta.env.DEV) console.info('[FaceVerifyFlow] withdraw success');
      const { data } = await api.getFaceVerifyStatus();
      setFaceVerify(data?.enabled ? data : null);
    } catch (err) {
      console.error('[FaceVerifyFlow] withdraw failed', { status: err?.response?.status, message: err?.message });
      alert('동의 철회에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setFaceBusy(false);
    }
  };

  // v125 — 마케팅 수신 동의 변경 → 동의 이력 기록(거부도 false 로 기록)
  const handleMarketingToggle = async () => {
    if (marketingConsent === null || marketingBusy) return;
    const next = !marketingConsent;
    setMarketingBusy(true);
    if (import.meta.env.DEV) console.info('[Header] marketing consent change', { key: 'marketing', agreed: next });
    try {
      await api.recordConsents([{ key: 'marketing', agreed: next }], CONSENT_VERSION);
      setMarketingConsent(next);
    } catch (err) {
      console.error('[Header] recordConsents failed', { status: err?.response?.status, message: err?.message });
    } finally {
      setMarketingBusy(false);
    }
  };

  // 프로필 화면 ↔ 탈퇴 확인 화면 전환 (모달 유지)
  const openWithdrawView = () => {
    if (import.meta.env.DEV) console.info('[Header] withdraw view open');
    setWithdrawInput('');
    setWithdrawError('');
    setWithdrawView(true);
  };

  const cancelWithdrawView = () => {
    if (withdrawBusy) return;
    if (import.meta.env.DEV) console.info('[Header] withdraw view cancel');
    setWithdrawView(false);
    setWithdrawInput('');
    setWithdrawError('');
  };

  // [탈퇴하기] — confirm 문구 일치 시에만 호출됨.
  // 주의: 입력값 자체는 콘솔 출력 금지(원격 로깅) — 일치 여부 bool 만 로깅.
  const handleWithdraw = async () => {
    const confirmText = withdrawInput.trim();
    if (confirmText !== '회원탈퇴' || withdrawBusy) return;
    setWithdrawError('');
    setWithdrawBusy(true);
    if (import.meta.env.DEV) console.info('[Header] withdrawAccount start', { confirmMatched: true });
    try {
      await api.withdrawAccount(confirmText);
      if (import.meta.env.DEV) console.info('[Header] withdrawAccount success');
      alert('탈퇴가 완료되었습니다.');
      logout();
      closeProfileModal();
      navigate('/');
    } catch (err) {
      console.error('[Header] withdrawAccount failed', { status: err?.response?.status, message: err?.message });
      setWithdrawError(
        err?.response?.status === 400
          ? '확인 문구가 일치하지 않습니다.'
          : '탈퇴 처리에 실패했습니다. 잠시 후 다시 시도해주세요.'
      );
      setWithdrawBusy(false);
    }
  };

  // 프로필 사진 선택 → 클라이언트 검증(이미지/5MB) → 즉시 업로드 → AuthContext 반영
  const handleAvatarSelect = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 같은 파일 재선택 허용
    if (!file) return;
    setAvatarError('');
    if (!file.type || !file.type.startsWith('image/')) {
      setAvatarError('이미지 파일만 업로드할 수 있습니다.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError('5MB 이하의 이미지만 업로드할 수 있습니다.');
      return;
    }
    setAvatarBusy(true);
    if (import.meta.env.DEV) console.info('[Header] profile image upload start', { sizeBytes: file.size });
    try {
      const { data } = await api.uploadProfileImage(file);
      if (import.meta.env.DEV) console.info('[Header] profile image upload success');
      updateUser({ profile_image: data?.profile_image ?? null });
    } catch (err) {
      console.error('[Header] uploadProfileImage failed', { status: err?.response?.status, message: err?.message });
      setAvatarError('사진 업로드에 실패했습니다.');
    } finally {
      setAvatarBusy(false);
    }
  };

  // [기본으로] — 프로필 사진 삭제 후 이니셜 폴백 복귀
  const handleAvatarDelete = async () => {
    setAvatarError('');
    setAvatarBusy(true);
    if (import.meta.env.DEV) console.info('[Header] profile image delete start');
    try {
      await api.deleteProfileImage();
      if (import.meta.env.DEV) console.info('[Header] profile image delete success');
      updateUser({ profile_image: null });
    } catch (err) {
      console.error('[Header] deleteProfileImage failed', { status: err?.response?.status, message: err?.message });
      setAvatarError('사진 삭제에 실패했습니다.');
    } finally {
      setAvatarBusy(false);
    }
  };

  const handleProfileSave = async (values) => {
    // SNS 채널 — 빈 행 제외 후 클라 검증. 위반 시 인라인 안내 후 저장 중단.
    // 주의: URL 값 자체는 콘솔 출력 금지(원격 로깅) — 개수만 로깅.
    const snsLinks = snsRows.map((u) => u.trim()).filter(Boolean);
    if (snsLinks.some((u) => !/^https?:\/\//i.test(u))) {
      setSnsError('http:// 또는 https:// 로 시작하는 주소를 입력해주세요.');
      return;
    }
    setSnsError('');
    // 미인증: 전 필드 전송 — null 은 "지우기" (백엔드 PATCH 스펙)
    // 인증 계정: birth_date/gender 는 본인인증 잠금 필드 — 페이로드에서 제외(백엔드 400 방지)
    //   nationality 는 자기신고 값이라 잠금과 무관하게 항상 수정 허용(v123)
    // sns_links 는 인증잠금과 무관하게 항상 포함 (빈 배열 = 전량 삭제)
    const payload = profileVerify.isVerified
      ? { region: values.region, nationality: values.nationality }
      : { ...values };
    payload.sns_links = snsLinks;
    setProfileModal('saving');
    if (import.meta.env.DEV) {
      const filled = Object.values(payload).filter((v) => v !== null).length;
      console.info('[Header] updateMyProfile start', {
        filledFields: filled,
        verifiedLocked: profileVerify.isVerified,
        snsCount: snsLinks.length,
      });
    }
    try {
      await api.updateMyProfile(payload);
      if (import.meta.env.DEV) console.info('[Header] updateMyProfile success', { snsCount: snsLinks.length });
      updateUser(payload);
      closeProfileModal();
    } catch (err) {
      console.error('[Header] updateMyProfile failed', { status: err?.response?.status, message: err?.message });
      setProfileModal('ready');
    }
  };

  // 본인인증 제공자 표기 — naver/kakao 외에는 접미 없이 "본인인증 완료"만
  const verifyProviderLabel =
    profileVerify.provider === 'naver' ? ' (네이버 인증)'
      : profileVerify.provider === 'kakao' ? ' (카카오 인증)'
        : '';

  return (
    <header className="header">
      <div className="header__inner">
        <Link to="/" className="header__logo">
          <img src="/aimu-logo.svg" alt="MAIDOL" />
        </Link>

        <nav className={`header__nav ${menuOpen ? 'header__nav--open' : ''}`}>
          <button className="header__nav-close" onClick={closeMenu}>
            <FiX />
          </button>
          <NavLink to="/chart" onClick={closeMenu}>AI 차트</NavLink>
          {/* v134 — 타임라인 (비로그인도 노출) */}
          <NavLink to="/timeline" onClick={closeMenu}>타임라인</NavLink>
          <NavLink to="/playlist" onClick={closeMenu}>플레이리스트</NavLink>
          {user && <NavLink to="/my-music" onClick={closeMenu}>내 음악</NavLink>}
          {user && <NavLink to={`/artist/${user.id}`} onClick={closeMenu}>내 채널</NavLink>}
          {user && isBusiness && <NavLink to="/business" onClick={closeMenu}>회사관리</NavLink>}
          {user && isAdmin && <NavLink to="/admin" onClick={closeMenu}>관리자</NavLink>}
        </nav>

        <form className="header__search" onSubmit={handleSearch}>
          <input
            type="text"
            placeholder="AI 음악 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button type="submit" className="header__search-btn">
            <FiSearch />
          </button>
        </form>

        <div className="header__actions">
          <button
            className="header__menu-btn"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <FiMenu />
          </button>
          {user ? (
            <div className="header__user">
              <button
                type="button"
                className="header__points"
                title="출석체크하고 별 받기"
                onClick={() => {
                  if (import.meta.env.DEV) console.info('[Header] attendance modal open');
                  setAttendanceOpen(true);
                }}
              >
                ⭐ {points ?? '—'}
              </button>
              {/* v154 — 앱 추천(리퍼럴) 공유 모달 오픈 */}
              <button
                type="button"
                className="header__share"
                title="친구에게 MAIDOL 추천하기"
                aria-label="친구에게 MAIDOL 추천하기"
                onClick={() => {
                  if (import.meta.env.DEV) console.info('[Header] share modal open');
                  setShareOpen(true);
                }}
              >
                📢
              </button>
              {/* v152 — DM함 진입(봉투). 미인증 시 비활성 + 툴팁. */}
              <button
                type="button"
                className={`header__dm ${!dmVerified ? 'header__dm--disabled' : ''}`}
                title={dmVerified ? '메시지' : '본인인증 후 이용할 수 있어요'}
                aria-label="메시지"
                disabled={!dmVerified}
                onClick={() => {
                  if (!dmVerified) return;
                  if (import.meta.env.DEV) console.info('[Header] open DM inbox');
                  navigate('/dm');
                }}
              >
                <FiMail />
                {dmVerified && dmUnread > 0 && (
                  <span className="header__dm-badge">{dmUnread > 99 ? '99+' : dmUnread}</span>
                )}
              </button>
              <span className="header__nickname">
                <Avatar src={user.profile_image} name={user.nickname} size={28} />
                {user.nickname}
              </span>
              <button
                className="header__profile-btn"
                onClick={openProfileModal}
                disabled={profileModal === 'loading'}
              >
                내 정보 설정
              </button>
              <button className="header__logout-btn" onClick={logout}>
                로그아웃
              </button>
            </div>
          ) : (
            <>
              <Link to="/login" className="header__login-btn">
                로그인
              </Link>
              <Link to="/register" className="header__register-btn">
                회원가입
              </Link>
            </>
          )}
        </div>
      </div>

      {/* v139 — 스트라이크 경고 배너 (me.strikes 부재 시 미표시) */}
      {strikes && strikes.count >= 1 && (
        <div className="header__strike-banner">
          <span>
            ⚠ 커뮤니티 가이드 위반 {strikes.count}회 — 반복 시 이용이 제한될 수 있습니다.
          </span>
          {strikeRestricted && (
            <span className="header__strike-restricted">
              생성 기능 제한 중 (해제: {restrictedUntilDate.toLocaleString('ko-KR')})
            </span>
          )}
        </div>
      )}

      {(profileModal === 'ready' || profileModal === 'saving') && profileInitial && (
        <div className="header__profile-modal-overlay" onClick={closeProfileModal}>
          <div className="header__profile-modal" onClick={(e) => e.stopPropagation()}>
            <div className="header__profile-modal-head">
              <h2 className="header__profile-modal-title">
                {withdrawView ? '회원탈퇴' : '내 정보 설정'}
              </h2>
              <button
                className="header__profile-modal-close"
                onClick={closeProfileModal}
                disabled={withdrawBusy}
              >
                <FiX />
              </button>
            </div>
            {withdrawView ? (
              <div className="header__withdraw">
                <div className="header__withdraw-warning">
                  <p className="header__withdraw-warning-title">⚠ 정말 탈퇴하시겠어요?</p>
                  <p className="header__withdraw-warning-text">
                    탈퇴 시 계정 정보가 삭제되며 복구할 수 없습니다. 회원님이 발행한 곡은
                    &lsquo;탈퇴한 사용자&rsquo; 명의로 유지됩니다.
                  </p>
                </div>
                <p className="header__withdraw-guide">
                  계속하려면 아래에 &quot;회원탈퇴&quot; 를 정확히 입력하세요
                </p>
                <input
                  type="text"
                  className="header__withdraw-input"
                  placeholder="회원탈퇴"
                  value={withdrawInput}
                  disabled={withdrawBusy}
                  onChange={(e) => { setWithdrawInput(e.target.value); setWithdrawError(''); }}
                />
                {withdrawError && (
                  <p className="header__withdraw-error">{withdrawError}</p>
                )}
                <div className="header__withdraw-actions">
                  <button
                    type="button"
                    className="header__withdraw-cancel-btn"
                    onClick={cancelWithdrawView}
                    disabled={withdrawBusy}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    className="header__withdraw-confirm-btn"
                    onClick={handleWithdraw}
                    disabled={withdrawInput.trim() !== '회원탈퇴' || withdrawBusy}
                  >
                    {withdrawBusy ? '처리 중...' : '탈퇴하기'}
                  </button>
                </div>
              </div>
            ) : (
              <>
            <div className="header__profile-avatar">
              <Avatar src={user?.profile_image} name={user?.nickname} size={96} />
              <div className="header__profile-avatar-actions">
                <button
                  type="button"
                  className="header__profile-avatar-btn"
                  onClick={() => avatarFileRef.current?.click()}
                  disabled={avatarBusy}
                >
                  {avatarBusy ? '처리 중...' : '📷 사진 변경'}
                </button>
                <button
                  type="button"
                  className="header__profile-avatar-btn header__profile-avatar-btn--reset"
                  onClick={handleAvatarDelete}
                  disabled={avatarBusy || !user?.profile_image}
                >
                  기본으로
                </button>
                <input
                  ref={avatarFileRef}
                  type="file"
                  accept="image/*"
                  className="header__profile-avatar-input"
                  onChange={handleAvatarSelect}
                />
              </div>
              {avatarError && (
                <p className="header__profile-avatar-error">{avatarError}</p>
              )}
            </div>
            {/* v156 — 내 태그(배틀태그) 행: 값 = referral_code, 로드 실패/로딩 중 숨김 */}
            {myTag && (
              <div className="header__profile-tag">
                <div className="header__profile-tag-row">
                  <span className="header__profile-tag-label">내 태그</span>
                  <span className="header__profile-tag-code">#{myTag}</span>
                  <button
                    type="button"
                    className="header__profile-tag-copy"
                    onClick={handleMyTagCopy}
                  >
                    {myTagCopied ? '복사됨' : '📋 복사'}
                  </button>
                </div>
                <p className="header__profile-tag-sub">친구 추가·추천코드와 동일해요</p>
              </div>
            )}
            {profileVerify.isVerified && (
              <p className="header__profile-verified-badge">
                🔒 본인인증 완료{verifyProviderLabel} — 생년월일·성별은 수정할 수 없습니다
              </p>
            )}
            {/* v125 — 선택 입력(지역·SNS) 입력=동의 고지문 */}
            <p className="header__profile-optional-notice">{OPTIONAL_INPUT_NOTICE}</p>
            <ProfileExtraForm
              initialValues={profileInitial}
              onSubmit={handleProfileSave}
              busy={profileModal === 'saving'}
              lockedFields={profileVerify.isVerified ? ['birth_date', 'gender'] : []}
            />
            <div className="header__profile-sns">
              <h3 className="header__profile-sns-title">SNS 채널</h3>
              {snsRows.map((url, idx) => {
                const platform = detectPlatform(url);
                return (
                  <div className="header__profile-sns-row" key={idx}>
                    <span className="header__profile-sns-icon" title={platform.label}>
                      {platform.icon}
                    </span>
                    <input
                      type="url"
                      className="header__profile-sns-input"
                      placeholder="https://..."
                      value={url}
                      disabled={profileModal === 'saving'}
                      onChange={(e) =>
                        setSnsRows((rows) => rows.map((r, i) => (i === idx ? e.target.value : r)))
                      }
                    />
                    <button
                      type="button"
                      className="header__profile-sns-remove"
                      title="삭제"
                      disabled={profileModal === 'saving'}
                      onClick={() => setSnsRows((rows) => rows.filter((_, i) => i !== idx))}
                    >
                      <FiX />
                    </button>
                  </div>
                );
              })}
              <button
                type="button"
                className="header__profile-sns-add"
                disabled={snsRows.length >= SNS_MAX || profileModal === 'saving'}
                onClick={() => setSnsRows((rows) => (rows.length < SNS_MAX ? [...rows, ''] : rows))}
              >
                + URL 추가
              </button>
              {snsRows.length >= SNS_MAX && (
                <p className="header__profile-sns-hint">최대 5개까지 등록할 수 있습니다.</p>
              )}
              {snsError && <p className="header__profile-sns-error">{snsError}</p>}
            </div>
            {/* v125 — 마케팅 수신 동의 토글(현재 상태 로드 성공 시에만 표시) */}
            {marketingConsent !== null && (
              <div className="header__profile-marketing">
                <label className="header__profile-marketing-label">
                  <input
                    type="checkbox"
                    checked={marketingConsent}
                    disabled={marketingBusy}
                    onChange={handleMarketingToggle}
                  />
                  <span>{CONSENTS.marketing.label}</span>
                </label>
              </div>
            )}
            {/* v135 — 얼굴 인증(생체정보) 행: FACE_VERIFY_ENABLED(flag) ON 일 때만 표시 */}
            {faceVerify?.enabled && (
              <div className="header__profile-face">
                <div className="header__profile-face-row">
                  <span className="header__profile-face-label">얼굴 인증</span>
                  <span className="header__profile-face-status">
                    {faceVerify.consent_needed
                      ? '미동의'
                      : faceVerify.registered
                        ? '동의 완료 · 얼굴 정보 등록됨'
                        : '동의 완료 · 얼굴 정보 미등록'}
                  </span>
                </div>
                {(!faceVerify.consent_needed || faceVerify.registered) && (
                  <button
                    type="button"
                    className="header__profile-face-withdraw-btn"
                    onClick={handleFaceWithdraw}
                    disabled={faceBusy || profileModal === 'saving'}
                  >
                    {faceBusy ? '처리 중...' : '동의 철회하기'}
                  </button>
                )}
              </div>
            )}
            {/* v139 — 내 신고 내역 (클릭 시 펼침 목록) */}
            <div className="header__profile-myreports">
              <button
                type="button"
                className="header__profile-myreports-toggle"
                onClick={toggleMyReports}
                disabled={profileModal === 'saving'}
              >
                <span>내 신고 내역</span>
                <span className="header__profile-myreports-arrow">{myReportsOpen ? '▲' : '▼'}</span>
              </button>
              {myReportsOpen && (
                <div className="header__profile-myreports-body">
                  {myReportsLoading ? (
                    <p className="header__profile-myreports-empty">불러오는 중...</p>
                  ) : myReportsError ? (
                    <p className="header__profile-myreports-error">{myReportsError}</p>
                  ) : !myReports || myReports.length === 0 ? (
                    <p className="header__profile-myreports-empty">접수한 신고가 없습니다.</p>
                  ) : (
                    <ul className="header__profile-myreports-list">
                      {myReports.map((r) => {
                        const badge = reportStatusBadge(r);
                        return (
                          <li key={r.report_id} className="header__profile-myreports-item">
                            <div className="header__profile-myreports-toprow">
                              <span className="header__profile-myreports-type">
                                {REPORT_TYPE_LABEL[r.target_type] || r.target_type}
                              </span>
                              <span className="header__profile-myreports-summary" title={reportSummaryText(r)}>
                                {reportSummaryText(r)}
                              </span>
                              <span className={`header__profile-myreports-badge header__profile-myreports-badge--${badge.cls}`}>
                                {badge.label}
                              </span>
                              <span className="header__profile-myreports-date">
                                {fmtReportDate(r.handled_at || r.created_at)}
                              </span>
                            </div>
                            <span className="header__profile-myreports-reason" title={reportReasonText(r)}>
                              사유: {reportReasonText(r)}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>
            {/* CS 오류신고/문의 — maidol_official DM 문의로 연결 (내 신고 내역과 같은 맥락) */}
            <div className="header__profile-report">
              <button
                type="button"
                className="header__profile-report-btn"
                onClick={() => {
                  if (import.meta.env.DEV) console.info('[Header] report issue open');
                  // 오류신고 모달만 보이도록 내 정보 설정 모달을 먼저 닫는다
                  // (프로필 모달 오버레이가 위를 덮어 리포트 모달이 가려지는 문제 방지).
                  setReportIssueOpen(true);
                  closeProfileModal();
                }}
                disabled={profileModal === 'saving'}
              >
                🚨 오류신고 / 문의하기
              </button>
            </div>
            {!profileVerify.isVerified && (
              <div className="header__profile-verify">
                <button
                  type="button"
                  className="header__profile-verify-btn"
                  onClick={() => {
                    if (import.meta.env.DEV) console.info('[Header] verify CTA clicked');
                    setVerifyNotice(true);
                  }}
                >
                  본인인증 하기
                </button>
                {verifyNotice && (
                  <p className="header__profile-verify-notice">
                    본인인증 서비스는 준비 중입니다.
                  </p>
                )}
              </div>
            )}
            <div className="header__profile-withdraw">
              <button
                type="button"
                className="header__profile-withdraw-btn"
                onClick={openWithdrawView}
                disabled={profileModal === 'saving'}
              >
                회원탈퇴
              </button>
            </div>
              </>
            )}
          </div>
        </div>
      )}

      {attendanceOpen && (
        <AttendanceCard
          onClose={() => setAttendanceOpen(false)}
          onBalanceChange={(b) => { if (typeof b === 'number') setPoints(b); }}
        />
      )}

      {/* v154 — 앱 추천(리퍼럴) 공유 모달 (로그인 전용) */}
      {shareOpen && user && (
        <AppShareModal onClose={() => setShareOpen(false)} />
      )}

      {/* CS 오류신고/문의 모달 — 사유 선택 → maidol_official DM 진입.
          onClose 는 리포트 모달과 프로필 설정 모달을 함께 닫는다.
          ReportIssueModal 의 "다음" 흐름이 navigate 직전에 onClose 를 호출하므로
          라우팅 시점엔 프로필 모달이 이미 닫힌다(모달 뜬 채 라우팅 방지). */}
      {reportIssueOpen && (
        <ReportIssueModal
          onClose={() => {
            setReportIssueOpen(false);
            closeProfileModal();
          }}
        />
      )}
    </header>
  );
}
