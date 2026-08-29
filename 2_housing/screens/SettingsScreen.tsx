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
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { showAlert, type AppAlertButton } from '../utils/appAlert';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../stores/authStore';
import { useVoiceStore } from '../stores/voiceStore';
import { useArtistProfileStore } from '../stores/artistProfileStore';
import api from '../services/api';
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
import PolicySheet, { CompanyFooter } from '../components/PolicySheet';
import { CONSENTS, CONSENT_VERSION } from '../constants/consentTexts';
import { colors } from '../theme/colors';
import { AppText } from '../components/ui';

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
    if ('error' in birth) {
      setEditError(birth.error);
      return;
    }
    // SNS 채널 — 빈 행 제외 후 클라 검증(MAIDOL Header.jsx 관행). URL 값 자체는 로그 금지.
    const snsLinks = editSns.map((u) => u.trim()).filter(Boolean);
    if (snsLinks.some((u) => !/^https?:\/\//i.test(u))) {
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
      patch.birth_date = birth.value;
      patch.gender = editGender;
    }
    if (__DEV__) {
      console.info('[SettingsScreen] profile save start', { snsCount: snsLinks.length, verifiedLocked });
    }
    setEditSaving(true);
    const ok = await updateProfile(patch);
    setEditSaving(false);
    if (ok) {
      console.info('[SettingsScreen] profile save success');
      setShowProfileEdit(false);
      showAlert('완료', '프로필이 업데이트되었습니다.');
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
  const CS_REASONS = ['재생 오류', '결제·별 오류', '계정 문제', '로그인·본인인증 문제', '기타'];
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
  const [policy, setPolicy] = useState<null | 'terms' | 'privacy'>(null); // 정책 문서 시트
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
      <ScrollView style={[styles.container, { paddingTop: insets.top + 16 }]} contentContainerStyle={styles.scrollContent}>
        {TitleRow}
        <View style={styles.profileCard}>
          {/* v3.92(A-16): 아바타 탭 → 앱 내 선택지(사진 선택/기본 이미지로/취소) */}
          <TouchableOpacity
            style={styles.avatarWrap}
            onPress={handleAvatarPress}
            disabled={avatarBusy}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <View style={styles.avatarCircle}>
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
          </TouchableOpacity>
        </View>

        {/* 계정 관리 */}
        <AppText variant="callout" style={styles.sectionTitle}>계정 관리</AppText>
        <TouchableOpacity
          style={[styles.settingRow, styles.settingRowFirst]}
          onPress={() => showAlert('알림', '준비 중인 기능입니다')}
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
        <TouchableOpacity
          style={styles.settingRow}
          onPress={() => navigation.navigate('Royalty' as never)}
        >
          <AppText style={styles.settingLabel}>내 정산</AppText>
          <AppText style={styles.settingArrow}>{'>'}</AppText>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.settingRow, styles.settingRowLast]}
          onPress={() => navigation.navigate('MyReports' as never)}
        >
          <AppText style={styles.settingLabel}>내 신고 내역</AppText>
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
        </Modal>

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
              <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
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
                    본인인증 완료 계정은 생년월일·성별을 수정할 수 없습니다.
                  </AppText>
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
                    editable={!editSaving && !user.is_verified}
                  />
                  <TextInput
                    style={[styles.input, styles.birthInput]}
                    placeholder="월"
                    placeholderTextColor={colors.text.muted}
                    value={editBirthM}
                    onChangeText={(v) => setEditBirthM(v.replace(/\D/g, '').slice(0, 2))}
                    keyboardType="number-pad"
                    editable={!editSaving && !user.is_verified}
                  />
                  <TextInput
                    style={[styles.input, styles.birthInput]}
                    placeholder="일"
                    placeholderTextColor={colors.text.muted}
                    value={editBirthD}
                    onChangeText={(v) => setEditBirthD(v.replace(/\D/g, '').slice(0, 2))}
                    keyboardType="number-pad"
                    editable={!editSaving && !user.is_verified}
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
        <PolicySheet
          visible={!!policy}
          title={policy === 'terms' ? '이용약관' : '개인정보 처리방침'}
          body={policy ? (CONSENTS as any)[policy].body : ''}
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
        <AuthPanel
          onSuccess={() => navigation.goBack()}
          onModeChange={(m) => setAuthTitle(m === 'login' ? '로그인' : '회원가입')}
        />
        <CompanyFooter onOpenPolicy={setPolicy} />
        <PolicySheet
          visible={!!policy}
          title={policy === 'terms' ? '이용약관' : '개인정보 처리방침'}
          body={policy ? (CONSENTS as any)[policy].body : ''}
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
});
