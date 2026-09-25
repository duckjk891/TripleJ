import { useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Switch,
  Modal,
  KeyboardAvoidingView,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { showAlert, type AppAlertButton } from '../utils/appAlert';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../stores/authStore';
import { useVoiceStore } from '../stores/voiceStore';
import { useArtistProfileStore } from '../stores/artistProfileStore';
import api from '../services/api';
import { resetToChartTab } from '../services/navigationRef';
import { fetchOfficial } from '../services/officialService';
import {
  getMe,
  getMyConsents,
  recordConsents,
  uploadProfileImage,
  deleteProfileImage,
  profileImageUrl,
  PROFILE_IMAGE_TYPES,
  PROFILE_IMAGE_MAX_BYTES,
} from '../services/authService';
import AuthPanel from '../components/auth/AuthPanel';
import NicknameEditModal from '../components/settings/NicknameEditModal';
import PolicySheet, { CompanyFooter } from '../components/PolicySheet';
import { CONSENTS, CONSENT_VERSION, AI_GENERATION_NOTICE } from '../constants/consentTexts';
import { colors } from '../theme/colors';
import { AppText, seedColor } from '../components/ui';
// v3.232 K3: 어린이 모드(서버 kids_restricted) · 생년월일 잠금(서버 birth_date_locked)
import { useIsChild, useBirthDateLocked, isChildNow, KIDS_TEXT } from '../utils/kidsMode';
import { showKidsSafetyNotice } from '../components/kids/KidsSafetyNotice';

// v3.92(A-18): 인구통계 선택지 — MAIDOL backend user.py GENDERS/REGIONS 계약값 그대로
const GENDER_OPTIONS: Array<{ value: 'male' | 'female' | 'other' | null; label: string }> = [
  { value: 'male', label: '남성' },
  { value: 'female', label: '여성' },
  { value: 'other', label: '기타' },
  { value: null, label: '선택안함' },
];
const REGION_OPTIONS = [
  '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종',
  '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남',
  '제주', '해외',
];
const SNS_MAX = 5; // MAIDOL SNS_LINKS_MAX 계약값

// 선택 칩(성별/지역 공용) — 앱 내 선택 UI, 시스템 드롭다운 금지 관행
function Chip({
  label,
  selected,
  onPress,
  disabled,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.chip, selected && styles.chipSelected, disabled && { opacity: 0.4 }]}
      onPress={onPress}
      disabled={disabled}
    >
      <AppText style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</AppText>
    </TouchableOpacity>
  );
}

export default function SettingsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { user, isLoading, error, login, register, logout, clearError, updateProfile, setUser } = useAuthStore();
  // v3.232 K3: 둘 다 서버 키가 true 일 때만 — 구서버·성인·나이 모름은 false(기존 화면 그대로)
  const isChild = useIsChild();
  const birthLocked = useBirthDateLocked();
  useEffect(() => {
    if (isChild) console.info('[KidsMode] settings child ui');
  }, [isChild]);
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [editCompany, setEditCompany] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  // v3.92(A-18): 인구통계 편집 상태 — 서버 계약: birth_date "YYYY-MM-DD" | gender male/female/other | region 17시·도+해외 | sns_links ≤5
  const [editBirthY, setEditBirthY] = useState('');
  const [editBirthM, setEditBirthM] = useState('');
  const [editBirthD, setEditBirthD] = useState('');
  const [editGender, setEditGender] = useState<'male' | 'female' | 'other' | null>(null);
  const [editRegion, setEditRegion] = useState<string | null>(null);
  const [editSns, setEditSns] = useState<string[]>([]);
  const [editError, setEditError] = useState('');

  // /auth/me 응답의 인구통계 값을 편집 상태로 반영 (값 자체 로그 금지 — 개인정보)
  const applyDemoFromUser = (u: {
    birth_date?: string | null;
    gender?: string | null;
    region?: string | null;
    sns_links?: string[];
  }) => {
    const m = typeof u.birth_date === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(u.birth_date) : null;
    setEditBirthY(m ? m[1] : '');
    setEditBirthM(m ? String(parseInt(m[2], 10)) : '');
    setEditBirthD(m ? String(parseInt(m[3], 10)) : '');
    const g = u.gender;
    setEditGender(g === 'male' || g === 'female' || g === 'other' ? g : null);
    setEditRegion(u.region && REGION_OPTIONS.includes(u.region) ? u.region : null);
    setEditSns(Array.isArray(u.sns_links) ? u.sns_links.filter((s) => typeof s === 'string') : []);
  };

  const openProfileEdit = () => {
    if (!user) return;
    if (__DEV__) console.info('[SettingsScreen] profile edit open');
    setEditCompany(user.company_name || '');
    setEditTitle(user.display_title || '대표');
    applyDemoFromUser(user);
    setEditError('');
    setShowProfileEdit(true);
    // 로그인 응답에는 인구통계 필드가 없어 /auth/me로 최신값 보강(빠른 단건 조회)
    (async () => {
      try {
        const me = await getMe();
        setUser(me);
        applyDemoFromUser(me);
      } catch (err: any) {
        // 보강 실패 시 스토어 값으로 계속 편집 가능 — 에러 팝업은 과잉이라 로그만
        console.error('[SettingsScreen] getMe for edit failed', { status: err?.response?.status, message: err?.message });
      }
    })();
  };

  // 생년월일 조합 — 전부 비우면 null(지우기), 일부만 입력/무효 날짜면 에러 문자열 반환
  const buildBirthDate = (): { value: string | null } | { error: string } => {
    const y = editBirthY.trim();
    const m = editBirthM.trim();
    const d = editBirthD.trim();
    if (!y && !m && !d) return { value: null };
    if (!y || !m || !d) return { error: '생년월일은 연·월·일을 모두 입력하거나 모두 비워주세요.' };
    const yy = parseInt(y, 10);
    const mm = parseInt(m, 10);
    const dd = parseInt(d, 10);
    const dt = new Date(yy, mm - 1, dd);
    const valid =
      yy >= 1900 &&
      mm >= 1 && mm <= 12 &&
      dd >= 1 &&
      dt.getFullYear() === yy && dt.getMonth() === mm - 1 && dt.getDate() === dd &&
      dt.getTime() <= Date.now();
    if (!valid) return { error: '생년월일을 올바르게 입력해주세요. (1900년 이후~오늘)' };
    return { value: `${String(yy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}` };
  };

  const saveProfileEdit = async () => {
    const birth = buildBirthDate();
    // v3.232 K3(A4): 생년월일 잠금이면 입력값을 보내지 않으므로 검증도 생략(잠금 UI 로 수정 불가)
    if ('error' in birth && !birthLocked) {
      setEditError(birth.error);
      return;
    }
    // SNS 채널 — 빈 행 제외 후 클라 검증(MAIDOL Header.jsx 관행). URL 값 자체는 로그 금지.
    const snsLinks = editSns.map((u) => u.trim()).filter(Boolean);
    // v3.232 K3(C7): 어린이는 SNS 입력이 숨겨져 전송하지 않으므로 검증 생략
    if (!isChild && snsLinks.some((u) => !/^https?:\/\//i.test(u))) {
      setEditError('SNS 링크는 http:// 또는 https:// 로 시작하는 주소를 입력해주세요.');
      return;
    }
    setEditError('');
    // 본인인증 계정은 birth_date/gender 전송 금지(서버 400) — MAIDOL Header.jsx 관행
    const verifiedLocked = !!user?.is_verified;
    const patch: Parameters<typeof updateProfile>[0] = {
      company_name: editCompany.trim() || `${user!.nickname} 엔터테인먼트`,
      display_title: editTitle.trim() || '대표',
      region: editRegion,
      sns_links: snsLinks,
    };
    if (!verifiedLocked) {
      patch.birth_date = 'value' in birth ? birth.value : undefined;
      patch.gender = editGender;
    }
    // v3.232 K3(A4): 생년월일 잠금(서버 birth_date_locked) — birth_date 미전송(인증 잠금과 같은 방식)
    if (birthLocked) delete patch.birth_date;
    // v3.232 K3(C7): 어린이 — 지역·SNS 미전송(서버도 무시)
    if (isChild) {
      delete patch.region;
      delete patch.sns_links;
    }
    if (__DEV__) {
      console.info('[SettingsScreen] profile save start', { snsCount: snsLinks.length, verifiedLocked, birthLocked, child: isChild });
    }
    setEditSaving(true);
    const { ok, starGranted } = await updateProfile(patch);
    setEditSaving(false);
    if (ok) {
      console.info('[SettingsScreen] profile save success', { starGranted });
      setShowProfileEdit(false);
      // v3.190: 프로필 완성 보상 — 생년월일·성별·지역 3종 완성 시 1회 ⭐10
      if (starGranted) {
        showAlert('⭐10 지급 완료!', '프로필을 완성해주셔서 감사합니다. ⭐10을 드렸어요.');
      } else {
        showAlert('완료', '프로필이 업데이트되었습니다.');
      }
    } else {
      console.error('[SettingsScreen] profile save failed');
      showAlert('오류', useAuthStore.getState().error || '저장에 실패했습니다. 잠시 후 다시 시도해주세요.');
    }
  };

  // ── v3.92(A-16): 프로필 이미지 업로드/삭제 ──────────────────────────────
  // 계약(backend auth.py): POST /auth/me/profile-image (multipart `image`, jpeg/png/webp ≤5MB,
  //   서버 512x512 크롭) → { profile_image }, DELETE /auth/me/profile-image → { profile_image: null }
  const [avatarBusy, setAvatarBusy] = useState(false);

  const pickAndUploadAvatar = async () => {
    // v3.232 K3(C6): 어린이 프로필 사진 업로드 차단(방어 — 선택지에서도 숨김, 서버도 403)
    if (isChildNow()) {
      showAlert('안내', KIDS_TEXT.photoBlocked);
      return;
    }
    try {
      // expo-image-picker 미설치 — 기존 이미지 선택 관행(ArtistInputScreen DocumentPicker image/*) 재사용
      const res = await DocumentPicker.getDocumentAsync({ type: 'image/*' });
      if (res.canceled || !res.assets || !res.assets[0]) return;
      const file = res.assets[0];
      const mime = file.mimeType || '';
      if (mime && !PROFILE_IMAGE_TYPES.includes(mime)) {
        showAlert('안내', '지원하지 않는 이미지 형식입니다. (jpeg/png/webp)');
        return;
      }
      if (typeof file.size === 'number' && file.size > PROFILE_IMAGE_MAX_BYTES) {
        showAlert('안내', '이미지 크기는 5MB 이하여야 합니다.');
        return;
      }
      setAvatarBusy(true);
      if (__DEV__) console.info('[SettingsScreen] profile image upload start', { size: file.size ?? -1 });
      const data = await uploadProfileImage(file.uri, file.name || 'profile.jpg', mime || 'image/jpeg');
      setUser({ profile_image: data.profile_image });
      console.info('[SettingsScreen] profile image upload success');
    } catch (err: any) {
      console.error('[SettingsScreen] profile image upload failed', { status: err?.response?.status, message: err?.message });
      showAlert('오류', err?.response?.data?.error || '사진 업로드에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setAvatarBusy(false);
    }
  };

  const removeAvatar = async () => {
    setAvatarBusy(true);
    if (__DEV__) console.info('[SettingsScreen] profile image delete start');
    try {
      await deleteProfileImage();
      setUser({ profile_image: null });
      console.info('[SettingsScreen] profile image delete success');
    } catch (err: any) {
      console.error('[SettingsScreen] profile image delete failed', { status: err?.response?.status, message: err?.message });
      showAlert('오류', '사진 삭제에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setAvatarBusy(false);
    }
  };

  const handleAvatarPress = () => {
    if (avatarBusy) return;
    // v3.232 K3(C6·D10): 어린이 — "사진 선택" 없이 기본 이미지만
    if (isChild) {
      const kidButtons: AppAlertButton[] = [];
      if (user?.profile_image) kidButtons.push({ text: '기본 이미지로', onPress: removeAvatar });
      kidButtons.push({ text: user?.profile_image ? '취소' : '확인', style: 'cancel' });
      showAlert('프로필 사진', `${KIDS_TEXT.photoBlocked} 기본 이미지를 사용해요.`, kidButtons);
      return;
    }
    const buttons: AppAlertButton[] = [{ text: '사진 선택', onPress: pickAndUploadAvatar }];
    if (user?.profile_image) buttons.push({ text: '기본 이미지로', onPress: removeAvatar });
    buttons.push({ text: '취소', style: 'cancel' });
    showAlert('프로필 사진', '프로필 사진을 변경할 수 있어요. 사진은 512x512로 잘려 저장돼요.', buttons);
  };

  // ── v3.92(A-17): 마케팅 정보 수신 동의 토글 ─────────────────────────────
  // 계약: GET /auth/me/consents → { consents: { marketing: { agreed, .. } } },
  //   변경은 POST /auth/me/consents [{ key:'marketing', agreed }] + CONSENT_VERSION (append 이력)
  // MAIDOL Header.jsx 관행: 로드 성공 시에만 행 노출, 이력 목록 UI는 없음(미노출 동일).
  const [marketingConsent, setMarketingConsent] = useState<boolean | null>(null);
  const [marketingBusy, setMarketingBusy] = useState(false);

  useEffect(() => {
    if (!user?.id) {
      setMarketingConsent(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const consents = await getMyConsents();
        if (cancelled) return;
        const agreed = !!consents?.marketing?.agreed;
        setMarketingConsent(agreed);
        if (__DEV__) console.info('[SettingsScreen] marketing consent loaded', { agreed });
      } catch (err: any) {
        // 로드 실패 시 행 미노출(MAIDOL 관행) — 팝업 없이 로그만
        console.error('[SettingsScreen] getMyConsents failed', { status: err?.response?.status, message: err?.message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const handleMarketingToggle = async (next: boolean) => {
    if (marketingConsent === null || marketingBusy) return;
    const prev = marketingConsent;
    setMarketingConsent(next); // 낙관 반영 — 실패 시 롤백
    setMarketingBusy(true);
    if (__DEV__) console.info('[SettingsScreen] marketing consent change', { agreed: next });
    try {
      await recordConsents([{ key: 'marketing', agreed: next }], CONSENT_VERSION);
      console.info('[SettingsScreen] marketing consent recorded', { agreed: next });
    } catch (err: any) {
      console.error('[SettingsScreen] recordConsents failed', { status: err?.response?.status, message: err?.message });
      setMarketingConsent(prev);
      showAlert('오류', '동의 상태 변경에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setMarketingBusy(false);
    }
  };
  // v3.91: 회원탈퇴 — MAIDOL Header.jsx 확인 문구 입력식 흐름 이식.
  // 계약(backend_9004 auth.py:962 withdraw_account): DELETE /auth/me body { confirm_text: "회원탈퇴" }
  //   소프트 삭제(개인정보 익명화, 발행 곡은 '탈퇴한 사용자' 명의 유지). 불일치 400 { error }, 성공 { message }.
  const [showWithdraw, setShowWithdraw] = useState(false);
  // v3.230 A2: 닉네임 변경 모달
  const [showNicknameEdit, setShowNicknameEdit] = useState(false);
  const [withdrawInput, setWithdrawInput] = useState('');
  const [withdrawError, setWithdrawError] = useState('');
  const [withdrawBusy, setWithdrawBusy] = useState(false);

  const openWithdraw = () => {
    if (__DEV__) console.info('[SettingsScreen] withdraw view open');
    setWithdrawInput('');
    setWithdrawError('');
    setShowWithdraw(true);
  };

  const closeWithdraw = () => {
    if (withdrawBusy) return;
    if (__DEV__) console.info('[SettingsScreen] withdraw view cancel');
    setShowWithdraw(false);
    setWithdrawInput('');
    setWithdrawError('');
  };

  // [탈퇴하기] — 확인 문구 일치 시에만 호출됨.
  // 주의(MAIDOL 관행): 입력값 자체는 로그 금지(원격 로깅 대비) — 일치 여부 bool만 로깅.
  const handleWithdraw = async () => {
    const confirmText = withdrawInput.trim();
    if (confirmText !== '회원탈퇴' || withdrawBusy) return;
    setWithdrawError('');
    setWithdrawBusy(true);
    if (__DEV__) console.info('[SettingsScreen] withdrawAccount start', { confirmMatched: true });
    try {
      await api.delete('/auth/me', { data: { confirm_text: confirmText } });
      console.info('[SettingsScreen] withdrawAccount success — 로컬 계정 상태 정리');
      // ── 탈퇴 후 로컬 정리 방침 ─────────────────────────────────────────────
      // · 계정 종속 데이터는 정리한다:
      //   - voiceStore.artistVoice: 클론이면 서버 voice persona 참조(계정 소멸로 사용 불가),
      //     프리셋도 "그 기획사의 아티스트 목소리" 정체성이라 함께 초기화.
      //   - artistProfileStore: 서버 /character/me(계정 종속)의 로컬 보조 프로필 → 전체 삭제.
      // · lyricsBook(가사 보관함)은 유지: 서버를 참조하지 않는 순수 로컬 창작 자산이고,
      //   MAIDOL도 탈퇴 시 서버 콘텐츠를 '탈퇴한 사용자' 명의로 남길 뿐 로컬 저장물을
      //   지우는 관행이 없다(Header.jsx handleWithdraw는 logout()만 수행).
      try { useVoiceStore.getState().clearArtistVoice(); } catch {}
      try { useArtistProfileStore.getState().clearAll(); } catch {}
      setShowWithdraw(false);
      setWithdrawBusy(false);
      showAlert('회원탈퇴', '탈퇴가 완료되었습니다.');
      // logout(): 토큰/유저 제거 + 재생목록 초기화 → user=null이 되며 이 화면이 로그인 화면으로 전환됨
      logout();
    } catch (err: any) {
      const status = err?.response?.status;
      console.error('[SettingsScreen] withdrawAccount failed', { status, message: err?.message });
      if (status === 400) {
        setWithdrawError('확인 문구가 일치하지 않습니다.');
      } else {
        showAlert('오류', '탈퇴 처리에 실패했습니다. 잠시 후 다시 시도해주세요.');
      }
      setWithdrawBusy(false);
    }
  };

  // v3.95(A-14): CS 오류신고 — 사유 선택 → GET /dm/official → POST /dm/conversations →
  // 기존 DM 채팅(DmChat)으로 "[오류신고: 사유] " 프리필 입장(자동 전송 X — MAIDOL ReportIssueModal 관행).
  const CS_REASONS = ['재생 오류', '결제·별 오류', '계정 문제', '로그인·계정 인증 문제', '기타'];
  const startCsInquiry = async (reason: string) => {
    if (__DEV__) console.info('[SettingsScreen] CS 문의 시작', { reason });
    try {
      // (a) 공식 계정 연락처 조회 — {official_id, nickname}
      const { data: official } = await api.get('/dm/official');
      const officialId = official?.official_id;
      if (!officialId) throw new Error('official_id missing');
      // (b) 공식 계정과 DM 대화 생성(기존 반환 포함)
      const { data: conv } = await api.post('/dm/conversations', { peer_id: officialId });
      const cid = conv?.conversation_id;
      if (!cid) throw new Error('conversation_id missing');
      if (__DEV__) console.info('[SettingsScreen] CS 대화 준비 완료', { cid: String(cid).slice(0, 8) });
      // (c) 콜드 진입 시 peer가 비어 렌더가 깨지지 않게 최소 peer 구성
      const conversation = conv?.peer
        ? conv
        : { ...conv, peer: { id: officialId, nickname: official?.nickname || '공식 계정' } };
      navigation.navigate('DmChat', { conversation, prefill: `[오류신고: ${reason}] ` });
    } catch (err: any) {
      console.error('[SettingsScreen] CS 문의 시작 실패', { status: err?.response?.status, message: err?.message });
      const detail = err?.response?.data?.error || err?.response?.data?.detail;
      showAlert('알림', detail || '문의 채널을 여는 데 실패했습니다. 잠시 후 다시 시도해주세요.');
    }
  };
  const openCsInquiry = () => {
    if (!user) {
      showAlert('알림', '로그인 후 문의할 수 있습니다.');
      return;
    }
    showAlert('문의하기(오류 신고)', '어떤 문제가 있으셨나요? 사유를 선택하면 공식 계정과의 문의 대화가 열립니다.', [
      ...CS_REASONS.map((r) => ({ text: r, onPress: () => startCsInquiry(r) })),
      { text: '취소', style: 'cancel' as const },
    ]);
  };

  // v3.205(④): 공지사항 — 공지 = official 계정의 kind=community 채널 글.
  // officialService(프로세스 캐시, FeedCard 공지 배지와 공유)로 official_id 해석 →
  // official UserChannel 커뮤니티 탭 직행(initialTab).
  const openNotices = async () => {
    if (__DEV__) console.info('[Settings] 공지사항 진입');
    const official = await fetchOfficial();
    if (!official) {
      console.error('[Settings] 공지사항 진입 실패', { reason: 'official 조회 실패' });
      showAlert('알림', '공지사항을 여는 데 실패했습니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    if (__DEV__) console.info('[Settings] 공지사항 official 확인 완료');
    navigation.navigate('UserChannel', {
      authorId: official.official_id,
      name: official.nickname || 'maidol_official',
      initialTab: 'community',
    });
  };

  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [displayTitle, setDisplayTitle] = useState('대표');

  const handleSubmit = async () => {
    if (isRegister) {
      const finalCompany = companyName.trim() || `${nickname.trim()} 엔터테인먼트`;
      const finalTitle = displayTitle.trim() || '대표';
      const success = await register(email, password, nickname, finalCompany, finalTitle);
      if (success) {
        setEmail('');
        setPassword('');
        setNickname('');
        setCompanyName('');
        setDisplayTitle('대표');
        navigation.goBack();
      }
    } else {
      const success = await login(email, password);
      if (success) {
        setEmail('');
        setPassword('');
        navigation.goBack();
      }
    }
  };

  const toggleMode = () => {
    setIsRegister(!isRegister);
    clearError();
  };

  const [notifySongComplete, setNotifySongComplete] = useState(true);
  const [notifyChartUpdate, setNotifyChartUpdate] = useState(true);
  // v3.200(F6): 'ai' = AI 생성 고지 상시 항목(앱 정보 섹션) — 가입 동의문 재사용(consentTexts)
  const [policy, setPolicy] = useState<null | 'terms' | 'privacy' | 'ai'>(null); // 정책 문서 시트
  const [authTitle, setAuthTitle] = useState('로그인'); // 비로그인 헤더 타이틀(AuthPanel 모드 연동)

  // 닫기 버튼 + 제목 row (양쪽 분기 공통)
  const TitleRow = (
    <View style={styles.headerRow}>
      <AppText variant="title2">{user ? '설정' : authTitle}</AppText>
      <TouchableOpacity
        onPress={() => navigation.goBack()}
        style={styles.closeBtn}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <AppText style={styles.closeBtnText}>✕</AppText>
      </TouchableOpacity>
    </View>
  );

  if (user) {
    return (
      <ScrollView style={[styles.container, { paddingTop: insets.top + 16 }]} contentContainerStyle={styles.scrollContent} automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled">
        {TitleRow}
        <View style={styles.profileCard}>
          {/* v3.92(A-16): 아바타 탭 → 앱 내 선택지(사진 선택/기본 이미지로/취소) */}
          <TouchableOpacity
            style={styles.avatarWrap}
            onPress={handleAvatarPress}
            disabled={avatarBusy}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            {/* v3.199(A): 이미지 없는 폴백 배경 = 고정 보라 → Avatar 공용 seed 팔레트(계정별 상이·결정적) */}
            <View style={[styles.avatarCircle, !user.profile_image && { backgroundColor: seedColor(String(user.id), user.nickname) }]}>
              {avatarBusy ? (
                <ActivityIndicator color={colors.text.primary} />
              ) : user.profile_image ? (
                <Image source={{ uri: profileImageUrl(user.profile_image)! }} style={styles.avatarImg} />
              ) : (
                <AppText style={styles.avatarText}>{user.nickname[0]}</AppText>
              )}
            </View>
            <View style={styles.avatarEditBadge}>
              <AppText style={styles.avatarEditBadgeText}>편집</AppText>
            </View>
          </TouchableOpacity>
          <AppText style={styles.companyText}>
            {user.company_name || `${user.nickname} 엔터테인먼트`}
          </AppText>
          <AppText style={styles.nicknameText}>
            {user.nickname} {user.display_title || '대표'}
          </AppText>
          <AppText style={styles.emailText}>{user.email}</AppText>
          <TouchableOpacity style={styles.profileEditBtn} onPress={openProfileEdit}>
            <AppText style={styles.profileEditBtnText}>기획사 정보 편집</AppText>
            {/* v3.190: 프로필(생년월일·성별·지역) 미완성 시 ⭐10 보상 배지 노출
                v3.232 K3(A5): 어린이는 지역 입력이 없어 생년월일·성별 2종 기준(서버 S4 와 동일) */}
            {!(user.birth_date && user.gender && (isChild || user.region)) ? (
              <View style={styles.verifyBadge}>
                <AppText variant="caption" style={styles.verifyBadgeText}>완성하고 ⭐10 받기</AppText>
              </View>
            ) : null}
          </TouchableOpacity>
        </View>

        {/* 계정 관리 */}
        <AppText variant="callout" style={styles.sectionTitle}>계정 관리</AppText>
        <TouchableOpacity
          style={[styles.settingRow, styles.settingRowFirst]}
          onPress={() => {
            console.info('[NicknameChange] 설정 행 탭');
            setShowNicknameEdit(true);
          }}
        >
          <AppText style={styles.settingLabel}>닉네임 변경</AppText>
          <AppText style={styles.settingArrow}>{'>'}</AppText>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.settingRow}
          onPress={() => showAlert('알림', '준비 중인 기능입니다')}
        >
          <AppText style={styles.settingLabel}>비밀번호 변경</AppText>
          <AppText style={styles.settingArrow}>{'>'}</AppText>
        </TouchableOpacity>
        {/* v3.230 A8 [IdentityBypass]: '본인인증' 행(⭐30 유도·준비 중 팝업) 제거 — 본인인증은 추후 적용(대표 지시).
            인증 상태 표시도 필요 없어 숨김. 복원 시 v3.189 행을 되살리면 된다. */}
        <TouchableOpacity
          style={styles.settingRow}
          onPress={() => navigation.navigate('MyReports' as never)}
        >
          <AppText style={styles.settingLabel}>내 신고 내역</AppText>
          <AppText style={styles.settingArrow}>{'>'}</AppText>
        </TouchableOpacity>
        {/* v3.232 K4(B8): 어린이 — 온라인 안전 안내 다시 보기 */}
        {isChild && (
          <TouchableOpacity
            style={styles.settingRow}
            onPress={() => {
              console.info('[KidsNotice] 설정 행 탭');
              showKidsSafetyNotice();
            }}
          >
            <AppText style={styles.settingLabel}>{KIDS_TEXT.safetyRowLabel}</AppText>
            <AppText style={styles.settingArrow}>{'>'}</AppText>
          </TouchableOpacity>
        )}
        {/* v3.230 A7-3(D8): 스타(⭐) 적립·사용 내역 */}
        <TouchableOpacity
          style={[styles.settingRow, styles.settingRowLast]}
          onPress={() => {
            console.info('[StarHistory] 설정 행 탭');
            navigation.navigate('StarHistory' as never);
          }}
        >
          <AppText style={styles.settingLabel}>스타 내역</AppText>
          <AppText style={styles.settingArrow}>{'>'}</AppText>
        </TouchableOpacity>

        {/* 알림 설정 */}
        <AppText variant="callout" style={styles.sectionTitle}>알림 설정</AppText>
        <View style={[styles.settingRow, styles.settingRowFirst]}>
          <AppText style={styles.settingLabel}>곡 생성 완료 알림</AppText>
          <Switch
            value={notifySongComplete}
            onValueChange={setNotifySongComplete}
            trackColor={{ false: colors.border.subtle, true: colors.accent.primary }}
            thumbColor={colors.text.primary}
          />
        </View>
        <View style={[styles.settingRow, marketingConsent === null && styles.settingRowLast]}>
          <AppText style={styles.settingLabel}>새로운 차트 업데이트</AppText>
          <Switch
            value={notifyChartUpdate}
            onValueChange={setNotifyChartUpdate}
            trackColor={{ false: colors.border.subtle, true: colors.accent.primary }}
            thumbColor={colors.text.primary}
          />
        </View>
        {/* v3.92(A-17): 마케팅 수신 동의 — 현재 상태 로드 성공 시에만 표시(MAIDOL 관행) */}
        {marketingConsent !== null && (
          <View style={[styles.settingRow, styles.settingRowLast]}>
            <AppText style={styles.settingLabel}>마케팅 정보 수신 동의</AppText>
            <Switch
              value={marketingConsent}
              disabled={marketingBusy}
              onValueChange={handleMarketingToggle}
              trackColor={{ false: colors.border.subtle, true: colors.accent.primary }}
              thumbColor={colors.text.primary}
            />
          </View>
        )}

        {/* 앱 정보 */}
        <AppText variant="callout" style={styles.sectionTitle}>앱 정보</AppText>
        <View style={[styles.settingRow, styles.settingRowFirst]}>
          <AppText style={styles.settingLabel}>앱 버전</AppText>
          <AppText style={styles.settingValue}>v1.0.0</AppText>
        </View>
        <TouchableOpacity
          style={styles.settingRow}
          onPress={() => setPolicy('terms')}
        >
          <AppText style={styles.settingLabel}>이용약관</AppText>
          <AppText style={styles.settingArrow}>{'>'}</AppText>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.settingRow}
          onPress={() => setPolicy('privacy')}
        >
          <AppText style={styles.settingLabel}>개인정보 처리방침</AppText>
          <AppText style={styles.settingArrow}>{'>'}</AppText>
        </TouchableOpacity>
        {/* v3.200(F6): AI 생성 고지 상시 확인 항목 — 가입 시 동의문 언제든 재열람(법정 고지 P0) */}
        <TouchableOpacity
          style={styles.settingRow}
          onPress={() => setPolicy('ai')}
        >
          <AppText style={styles.settingLabel}>AI 생성 고지</AppText>
          <AppText style={styles.settingArrow}>{'>'}</AppText>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.settingRow, styles.settingRowLast]}
          onPress={() => showAlert('알림', '준비 중인 기능입니다')}
        >
          <AppText style={styles.settingLabel}>오픈소스 라이선스</AppText>
          <AppText style={styles.settingArrow}>{'>'}</AppText>
        </TouchableOpacity>

        {/* 기타 */}
        <AppText variant="callout" style={styles.sectionTitle}>기타</AppText>
        <TouchableOpacity
          style={[styles.settingRow, styles.settingRowFirst]}
          onPress={() => showAlert('알림', '캐시가 삭제되었습니다')}
        >
          <AppText style={styles.settingLabel}>캐시 삭제</AppText>
          <AppText style={styles.settingArrow}>{'>'}</AppText>
        </TouchableOpacity>
        {/* v3.205(④): 공지사항 — official 채널 커뮤니티 탭(공지 글)으로 진입 */}
        <TouchableOpacity
          style={styles.settingRow}
          onPress={openNotices}
        >
          <AppText style={styles.settingLabel}>공지사항</AppText>
          <AppText style={styles.settingArrow}>{'>'}</AppText>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.settingRow, styles.settingRowLast]}
          onPress={openCsInquiry}
        >
          <AppText style={styles.settingLabel}>문의하기(오류 신고)</AppText>
          <AppText style={styles.settingArrow}>{'>'}</AppText>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.logoutButton}
          onPress={() =>
            showAlert('로그아웃', '정말 로그아웃할까요?', [
              { text: '취소', style: 'cancel' },
              { text: '로그아웃', style: 'destructive', onPress: logout },
            ])
          }
        >
          <AppText style={styles.logoutText}>로그아웃</AppText>
        </TouchableOpacity>

        {/* v3.91: 회원탈퇴 — 로그아웃 아래 작은 회색 텍스트 관행(심사 필수 항목) */}
        <TouchableOpacity
          style={styles.withdrawEntry}
          onPress={openWithdraw}
          hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}
        >
          <AppText style={styles.withdrawEntryText}>회원탈퇴</AppText>
        </TouchableOpacity>

        {/* 회원탈퇴 확인 모달 — 확인 문구("회원탈퇴") 일치 시에만 탈퇴 버튼 활성 */}
        <Modal
          visible={showWithdraw}
          transparent
          animationType="fade"
          onRequestClose={closeWithdraw}
        >
          {/* v3.196: Modal 내부는 adjustResize 미보장 → KAV(양 플랫폼 "padding")로 키보드 가림 해소(ReportModal 패턴) */}
          <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" pointerEvents="box-none">
          <View style={styles.modalOverlay}>
            <View style={styles.modalBox}>
              <AppText style={styles.modalTitle}>회원탈퇴</AppText>
              <View style={styles.withdrawWarnBox}>
                <AppText style={styles.withdrawWarnTitle}>정말 탈퇴하시겠어요?</AppText>
                <AppText style={styles.withdrawWarnText}>
                  탈퇴 시 계정 정보가 삭제되며 복구할 수 없습니다. 회원님이 발행한 곡은
                  '탈퇴한 사용자' 명의로 유지됩니다.
                </AppText>
              </View>
              <AppText style={styles.withdrawGuide}>
                계속하려면 아래에 "회원탈퇴" 를 정확히 입력하세요
              </AppText>
              <TextInput
                style={styles.input}
                placeholder="회원탈퇴"
                placeholderTextColor={colors.text.muted}
                value={withdrawInput}
                onChangeText={(v) => { setWithdrawInput(v); if (withdrawError) setWithdrawError(''); }}
                editable={!withdrawBusy}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {!!withdrawError && (
                <AppText style={styles.withdrawErrorText}>{withdrawError}</AppText>
              )}
              <View style={styles.modalBtnRow}>
                <TouchableOpacity
                  style={[styles.modalBtn, styles.modalBtnCancel]}
                  onPress={closeWithdraw}
                  disabled={withdrawBusy}
                >
                  <AppText style={styles.modalBtnCancelText}>취소</AppText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modalBtn,
                    styles.withdrawConfirmBtn,
                    (withdrawInput.trim() !== '회원탈퇴' || withdrawBusy) && { opacity: 0.4 },
                  ]}
                  onPress={handleWithdraw}
                  disabled={withdrawInput.trim() !== '회원탈퇴' || withdrawBusy}
                >
                  {withdrawBusy ? (
                    <ActivityIndicator color={colors.text.primary} />
                  ) : (
                    <AppText style={styles.withdrawConfirmBtnText}>탈퇴하기</AppText>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* v3.230 A2: 닉네임 변경 모달 */}
        <NicknameEditModal
          visible={showNicknameEdit}
          currentNickname={user.nickname}
          onClose={() => setShowNicknameEdit(false)}
        />

        {/* 프로필 편집 모달 */}
        <Modal
          visible={showProfileEdit}
          transparent
          animationType="fade"
          onRequestClose={() => setShowProfileEdit(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalBox}>
              <AppText style={styles.modalTitle}>기획사 정보 편집</AppText>
              <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
                <AppText style={styles.modalLabel}>기획사명</AppText>
                <TextInput
                  style={styles.input}
                  placeholder={`${user.nickname} 엔터테인먼트`}
                  placeholderTextColor={colors.text.muted}
                  value={editCompany}
                  onChangeText={setEditCompany}
                  maxLength={100}
                />
                <AppText style={styles.modalLabel}>호칭</AppText>
                <TextInput
                  style={styles.input}
                  placeholder="대표"
                  placeholderTextColor={colors.text.muted}
                  value={editTitle}
                  onChangeText={setEditTitle}
                  maxLength={20}
                />
                <AppText style={styles.helperText}>
                  비워두면 기본값(닉네임 엔터테인먼트 / 대표)으로 저장돼요.
                </AppText>

                {/* v3.92(A-18): 인구통계 — 전부 선택 입력, 미입력은 저장 시 지우기(null) */}
                {user.is_verified && (
                  <AppText style={styles.verifiedNotice}>
                    인증이 완료된 계정은 생년월일·성별을 수정할 수 없어요.
                  </AppText>
                )}
                {/* v3.232 K3(A4): 서버 생년월일 잠금(미인증·기존 값 있음) — 인증 계정은 위 안내가 우선 */}
                {birthLocked && !user.is_verified && (
                  <AppText style={styles.verifiedNotice}>{KIDS_TEXT.birthDateLocked}</AppText>
                )}
                <AppText style={styles.modalLabel}>생년월일 (선택)</AppText>
                <View style={styles.birthRow}>
                  <TextInput
                    style={[styles.input, styles.birthInput]}
                    placeholder="연도(YYYY)"
                    placeholderTextColor={colors.text.muted}
                    value={editBirthY}
                    onChangeText={(v) => setEditBirthY(v.replace(/\D/g, '').slice(0, 4))}
                    keyboardType="number-pad"
                    editable={!editSaving && !user.is_verified && !birthLocked}
                  />
                  <TextInput
                    style={[styles.input, styles.birthInput]}
                    placeholder="월"
                    placeholderTextColor={colors.text.muted}
                    value={editBirthM}
                    onChangeText={(v) => setEditBirthM(v.replace(/\D/g, '').slice(0, 2))}
                    keyboardType="number-pad"
                    editable={!editSaving && !user.is_verified && !birthLocked}
                  />
                  <TextInput
                    style={[styles.input, styles.birthInput]}
                    placeholder="일"
                    placeholderTextColor={colors.text.muted}
                    value={editBirthD}
                    onChangeText={(v) => setEditBirthD(v.replace(/\D/g, '').slice(0, 2))}
                    keyboardType="number-pad"
                    editable={!editSaving && !user.is_verified && !birthLocked}
                  />
                </View>
                <AppText style={styles.modalLabel}>성별 (선택)</AppText>
                <View style={styles.chipWrap}>
                  {GENDER_OPTIONS.map((opt) => (
                    <Chip
                      key={opt.label}
                      label={opt.label}
                      selected={editGender === opt.value}
                      onPress={() => setEditGender(opt.value)}
                      disabled={editSaving || !!user.is_verified}
                    />
                  ))}
                </View>
                {/* v3.232 K3(C7): 어린이 — 지역·SNS 입력 숨김(개인정보 최소화) */}
                {!isChild && (<>
                <AppText style={styles.modalLabel}>지역 (선택)</AppText>
                <View style={styles.chipWrap}>
                  {REGION_OPTIONS.map((r) => (
                    <Chip
                      key={r}
                      label={r}
                      selected={editRegion === r}
                      onPress={() => setEditRegion(editRegion === r ? null : r)}
                      disabled={editSaving}
                    />
                  ))}
                </View>
                <AppText style={styles.modalLabel}>SNS 채널 (선택, 최대 {SNS_MAX}개)</AppText>
                {editSns.map((url, idx) => (
                  <View style={styles.snsRow} key={idx}>
                    <TextInput
                      style={[styles.input, styles.snsInput]}
                      placeholder="https://..."
                      placeholderTextColor={colors.text.muted}
                      value={url}
                      onChangeText={(v) =>
                        setEditSns((rows) => rows.map((r, i) => (i === idx ? v : r)))
                      }
                      autoCapitalize="none"
                      autoCorrect={false}
                      editable={!editSaving}
                    />
                    <TouchableOpacity
                      style={styles.snsRemoveBtn}
                      onPress={() => setEditSns((rows) => rows.filter((_, i) => i !== idx))}
                      disabled={editSaving}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <AppText style={styles.snsRemoveText}>✕</AppText>
                    </TouchableOpacity>
                  </View>
                ))}
                {editSns.length < SNS_MAX && (
                  <TouchableOpacity
                    style={styles.snsAddBtn}
                    onPress={() => setEditSns((rows) => [...rows, ''])}
                    disabled={editSaving}
                  >
                    <AppText style={styles.snsAddText}>+ URL 추가</AppText>
                  </TouchableOpacity>
                )}
                </>)}
                {!!editError && <AppText style={styles.editErrorText}>{editError}</AppText>}
              </ScrollView>
              <View style={styles.modalBtnRow}>
                <TouchableOpacity
                  style={[styles.modalBtn, styles.modalBtnCancel]}
                  onPress={() => setShowProfileEdit(false)}
                  disabled={editSaving}
                >
                  <AppText style={styles.modalBtnCancelText}>취소</AppText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalBtn, styles.modalBtnSave, editSaving && { opacity: 0.6 }]}
                  onPress={saveProfileEdit}
                  disabled={editSaving}
                >
                  {editSaving ? (
                    <ActivityIndicator color={colors.text.primary} />
                  ) : (
                    <AppText style={styles.modalBtnSaveText}>저장</AppText>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* 사업자 정보 표기 + 정책 문서 */}
        <View style={{ paddingHorizontal: 20 }}>
          <CompanyFooter onOpenPolicy={setPolicy} />
        </View>
        {/* v3.211: expo-audio 백그라운드 재생 스파이크 진입 — 스파이크 기간 한정, 이관 완료 후 제거 예정.
            테스터·사용자 실기기 검증용이라 __DEV__ 무관 노출(눈에 안 띄는 최하단 소형 텍스트) */}
        <TouchableOpacity
          style={styles.spikeEntry}
          onPress={() => navigation.navigate('AudioSpike')}
          hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}
        >
          <AppText style={styles.spikeEntryText}>재생 엔진 테스트</AppText>
        </TouchableOpacity>
        <PolicySheet
          visible={!!policy}
          title={policy === 'ai' ? AI_GENERATION_NOTICE.label : policy === 'terms' ? '이용약관' : '개인정보 처리방침'}
          body={policy === 'ai' ? AI_GENERATION_NOTICE.body : policy ? (CONSENTS as any)[policy].body : ''}
          onClose={() => setPolicy(null)}
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={[styles.container, { paddingTop: insets.top + 16 }]} contentContainerStyle={styles.scrollContent}>
      {TitleRow}
      <View style={styles.formContainer}>
        {/* 로그인/회원가입 — MAIDOL 구성(연령 게이트·약관 동의·소셜 로그인 포함) 공용 패널 */}
        {/* v3.216b F1: 로그인/가입 성공 = goBack(직전 화면 복귀) 대신 항상 차트 탭으로 리셋 착지 */}
        <AuthPanel
          onSuccess={() => resetToChartTab()}
          onModeChange={(m) =>
            setAuthTitle(m === 'login' ? '로그인' : m === 'forgot' ? '비밀번호 재설정' : '회원가입')
          }
        />
        <CompanyFooter onOpenPolicy={setPolicy} />
        {/* v3.211: 스파이크 진입 — 비로그인에도 노출(로그인 상태 무관 검증 경로, 기간 한정) */}
        <TouchableOpacity
          style={styles.spikeEntry}
          onPress={() => navigation.navigate('AudioSpike')}
          hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}
        >
          <AppText style={styles.spikeEntryText}>재생 엔진 테스트</AppText>
        </TouchableOpacity>
        {/* v3.200: 'ai' 항목은 로그인 뷰 전용이지만, 시트 열린 채 로그아웃되는 엣지 방어 */}
        <PolicySheet
          visible={!!policy}
          title={policy === 'ai' ? AI_GENERATION_NOTICE.label : policy === 'terms' ? '이용약관' : '개인정보 처리방침'}
          body={policy === 'ai' ? AI_GENERATION_NOTICE.body : policy ? (CONSENTS as any)[policy].body : ''}
          onClose={() => setPolicy(null)}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.deepest,
    paddingTop: 16,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 30,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text.primary,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.bg.surface1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: {
    color: colors.text.primary,
    fontSize: 18,
    fontWeight: '600',
  },
  profileCard: {
    alignItems: 'center',
    paddingVertical: 30,
    marginHorizontal: 20,
    backgroundColor: colors.bg.surface1,
    borderRadius: 16,
  },
  avatarCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.accent.primary,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden', // v3.92: 이미지 원형 클리핑 (하단 여백은 avatarWrap이 담당)
  },
  avatarText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.text.primary,
  },
  companyText: {
    fontSize: 13,
    color: colors.accent.primary,
    fontWeight: '600',
    marginBottom: 4,
  },
  nicknameText: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text.primary,
    marginBottom: 4,
  },
  emailText: {
    fontSize: 14,
    color: colors.text.secondary,
  },
  sectionTitle: {
    marginTop: 24,
    marginBottom: 12,
    paddingHorizontal: 20,
  },
  settingRow: {
    backgroundColor: colors.bg.surface1,
    marginHorizontal: 20, // 다른 화면과 동일하게 좌우 여백(풀블리드 해소)
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  settingRowFirst: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  settingRowLast: {
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    borderBottomWidth: 0,
  },
  settingLabel: {
    fontSize: 15,
    color: colors.text.primary,
  },
  settingValue: {
    fontSize: 15,
    color: colors.text.secondary,
  },
  settingArrow: {
    fontSize: 16,
    color: colors.text.muted,
  },
  // v3.189 보상 배지 스타일 — v3.230 A8 이후 프로필 완성 ⭐10 배지만 사용(본인인증 행 제거)
  verifyBadge: {
    backgroundColor: colors.accent.primary,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  verifyBadgeText: {
    color: '#fff',
    fontWeight: '700',
  },
  logoutButton: {
    marginTop: 30,
    marginBottom: 40,
    marginHorizontal: 20,
    backgroundColor: colors.border.subtle,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  logoutText: {
    fontSize: 16,
    color: colors.accent.primary,
    fontWeight: '600',
  },
  // v3.91: 회원탈퇴 진입(작은 회색 텍스트) + 확인 모달 전용 스타일
  withdrawEntry: {
    alignSelf: 'center',
    marginTop: -24, // logoutButton의 marginBottom(40) 내부로 살짝 끌어올림
    marginBottom: 32,
    paddingVertical: 6,
  },
  withdrawEntryText: {
    fontSize: 12,
    color: colors.text.muted,
    textDecorationLine: 'underline',
  },
  withdrawWarnBox: {
    backgroundColor: 'rgba(160, 68, 68, 0.12)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#a04444',
    padding: 12,
    marginBottom: 14,
  },
  withdrawWarnTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#cc6868',
    marginBottom: 6,
  },
  withdrawWarnText: {
    fontSize: 12,
    color: colors.text.secondary,
    lineHeight: 18,
  },
  withdrawGuide: {
    fontSize: 12,
    color: colors.text.secondary,
    marginBottom: 8,
  },
  withdrawErrorText: {
    fontSize: 12,
    color: '#cc6868',
    marginBottom: 8,
  },
  withdrawConfirmBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#a04444',
  },
  withdrawConfirmBtnText: {
    color: '#cc6868',
    fontSize: 15,
    fontWeight: '700',
  },
  formContainer: {
    marginHorizontal: 20,
  },
  formTitle: {
    marginBottom: 20,
  },
  errorContainer: {
    backgroundColor: 'rgba(248, 113, 113, 0.15)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: colors.accent.primary,
    fontSize: 14,
    textAlign: 'center',
  },
  input: {
    backgroundColor: colors.bg.surface1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.text.primary,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  submitButton: {
    backgroundColor: colors.accent.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  submitButtonDisabled: {
    opacity: 0.7,
  },
  submitText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text.primary,
  },
  toggleText: {
    fontSize: 14,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  helperText: {
    fontSize: 12,
    color: colors.text.muted,
    lineHeight: 18,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  profileEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.accent.primary,
  },
  profileEditBtnText: {
    fontSize: 13,
    color: colors.accent.primary,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(13, 8, 32, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  modalBox: {
    width: '100%',
    backgroundColor: colors.bg.surface1,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text.primary,
    marginBottom: 16,
    textAlign: 'center',
  },
  modalLabel: {
    fontSize: 12,
    color: colors.accent.primary,
    fontWeight: '600',
    marginBottom: 6,
    marginLeft: 2,
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnCancel: {
    backgroundColor: colors.bg.surface2,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  modalBtnCancelText: {
    color: colors.text.secondary,
    fontSize: 15,
    fontWeight: '600',
  },
  modalBtnSave: {
    backgroundColor: colors.accent.primary,
  },
  modalBtnSaveText: {
    color: colors.text.primary,
    fontSize: 15,
    fontWeight: '700',
  },
  // v3.92(A-16): 아바타 편집
  avatarWrap: {
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarImg: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.bg.surface2,
  },
  avatarEditBadge: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: colors.bg.surface2,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  avatarEditBadgeText: {
    fontSize: 11,
    color: colors.text.secondary,
    fontWeight: '600',
  },
  // v3.92(A-18): 인구통계 편집(모달 확장)
  modalScroll: {
    maxHeight: 440,
  },
  verifiedNotice: {
    fontSize: 12,
    color: colors.text.muted,
    marginBottom: 8,
  },
  birthRow: {
    flexDirection: 'row',
    gap: 8,
  },
  birthInput: {
    flex: 1,
    minWidth: 0,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: colors.bg.surface2,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  chipSelected: {
    backgroundColor: colors.accent.primary,
    borderColor: colors.accent.primary,
  },
  chipText: {
    fontSize: 13,
    color: colors.text.secondary,
  },
  chipTextSelected: {
    color: colors.text.primary,
    fontWeight: '600',
  },
  snsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  snsInput: {
    flex: 1,
    minWidth: 0,
  },
  snsRemoveBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.bg.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  snsRemoveText: {
    fontSize: 14,
    color: colors.text.secondary,
  },
  snsAddBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    marginBottom: 12,
  },
  snsAddText: {
    fontSize: 13,
    color: colors.accent.primary,
    fontWeight: '600',
  },
  editErrorText: {
    fontSize: 12,
    color: '#cc6868',
    marginBottom: 8,
  },
  // v3.211: 스파이크 진입 행(회원탈퇴 소형 텍스트 관행 — 눈에 안 띄는 최하단, 기간 한정)
  spikeEntry: {
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 4,
    paddingVertical: 6,
  },
  spikeEntryText: {
    fontSize: 11,
    color: colors.text.muted,
  },
});
