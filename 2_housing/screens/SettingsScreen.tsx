import { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Switch,
  Alert,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../stores/authStore';
import { colors } from '../theme/colors';

export default function SettingsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { user, isLoading, error, login, register, logout, clearError, updateProfile } = useAuthStore();
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [editCompany, setEditCompany] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const openProfileEdit = () => {
    if (!user) return;
    setEditCompany(user.company_name || '');
    setEditTitle(user.display_title || '대표');
    setShowProfileEdit(true);
  };

  const saveProfileEdit = async () => {
    setEditSaving(true);
    const ok = await updateProfile({
      company_name: editCompany.trim() || `${user!.nickname} 엔터테인먼트`,
      display_title: editTitle.trim() || '대표',
    });
    setEditSaving(false);
    if (ok) {
      setShowProfileEdit(false);
      Alert.alert('완료', '프로필이 업데이트되었습니다.');
    } else {
      Alert.alert('오류', '저장에 실패했습니다. 잠시 후 다시 시도해주세요.');
    }
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

  if (user) {
    return (
      <ScrollView style={[styles.container, { paddingTop: insets.top + 16 }]} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>설정</Text>
        <View style={styles.profileCard}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>{user.nickname[0]}</Text>
          </View>
          <Text style={styles.companyText}>
            {user.company_name || `${user.nickname} 엔터테인먼트`}
          </Text>
          <Text style={styles.nicknameText}>
            {user.nickname} {user.display_title || '대표'}
          </Text>
          <Text style={styles.emailText}>{user.email}</Text>
          <TouchableOpacity style={styles.profileEditBtn} onPress={openProfileEdit}>
            <Text style={styles.profileEditBtnText}>기획사 정보 편집</Text>
          </TouchableOpacity>
        </View>

        {/* 계정 관리 */}
        <Text style={styles.sectionTitle}>계정 관리</Text>
        <TouchableOpacity
          style={[styles.settingRow, styles.settingRowFirst]}
          onPress={() => Alert.alert('알림', '준비 중인 기능입니다')}
        >
          <Text style={styles.settingLabel}>닉네임 변경</Text>
          <Text style={styles.settingArrow}>{'>'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.settingRow}
          onPress={() => Alert.alert('알림', '준비 중인 기능입니다')}
        >
          <Text style={styles.settingLabel}>비밀번호 변경</Text>
          <Text style={styles.settingArrow}>{'>'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.settingRow, styles.settingRowLast]}
          onPress={() => navigation.navigate('Royalty' as never)}
        >
          <Text style={styles.settingLabel}>💸 내 정산</Text>
          <Text style={styles.settingArrow}>{'>'}</Text>
        </TouchableOpacity>

        {/* 알림 설정 */}
        <Text style={styles.sectionTitle}>알림 설정</Text>
        <View style={[styles.settingRow, styles.settingRowFirst]}>
          <Text style={styles.settingLabel}>곡 생성 완료 알림</Text>
          <Switch
            value={notifySongComplete}
            onValueChange={setNotifySongComplete}
            trackColor={{ false: colors.border.subtle, true: colors.accent.primary }}
            thumbColor={colors.text.primary}
          />
        </View>
        <View style={[styles.settingRow, styles.settingRowLast]}>
          <Text style={styles.settingLabel}>새로운 차트 업데이트</Text>
          <Switch
            value={notifyChartUpdate}
            onValueChange={setNotifyChartUpdate}
            trackColor={{ false: colors.border.subtle, true: colors.accent.primary }}
            thumbColor={colors.text.primary}
          />
        </View>

        {/* 앱 정보 */}
        <Text style={styles.sectionTitle}>앱 정보</Text>
        <View style={[styles.settingRow, styles.settingRowFirst]}>
          <Text style={styles.settingLabel}>앱 버전</Text>
          <Text style={styles.settingValue}>v1.0.0</Text>
        </View>
        <TouchableOpacity
          style={styles.settingRow}
          onPress={() => Alert.alert('알림', '준비 중인 기능입니다')}
        >
          <Text style={styles.settingLabel}>이용약관</Text>
          <Text style={styles.settingArrow}>{'>'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.settingRow}
          onPress={() => Alert.alert('알림', '준비 중인 기능입니다')}
        >
          <Text style={styles.settingLabel}>개인정보 처리방침</Text>
          <Text style={styles.settingArrow}>{'>'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.settingRow, styles.settingRowLast]}
          onPress={() => Alert.alert('알림', '준비 중인 기능입니다')}
        >
          <Text style={styles.settingLabel}>오픈소스 라이선스</Text>
          <Text style={styles.settingArrow}>{'>'}</Text>
        </TouchableOpacity>

        {/* 기타 */}
        <Text style={styles.sectionTitle}>기타</Text>
        <TouchableOpacity
          style={[styles.settingRow, styles.settingRowFirst]}
          onPress={() => Alert.alert('알림', '캐시가 삭제되었습니다')}
        >
          <Text style={styles.settingLabel}>캐시 삭제</Text>
          <Text style={styles.settingArrow}>{'>'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.settingRow, styles.settingRowLast]}
          onPress={() => Alert.alert('알림', 'triplej@support.com으로 문의해주세요')}
        >
          <Text style={styles.settingLabel}>문의하기</Text>
          <Text style={styles.settingArrow}>{'>'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.logoutButton} onPress={logout}>
          <Text style={styles.logoutText}>로그아웃</Text>
        </TouchableOpacity>

        {/* 프로필 편집 모달 */}
        <Modal
          visible={showProfileEdit}
          transparent
          animationType="fade"
          onRequestClose={() => setShowProfileEdit(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalBox}>
              <Text style={styles.modalTitle}>기획사 정보 편집</Text>
              <Text style={styles.modalLabel}>기획사명</Text>
              <TextInput
                style={styles.input}
                placeholder={`${user.nickname} 엔터테인먼트`}
                placeholderTextColor={colors.text.muted}
                value={editCompany}
                onChangeText={setEditCompany}
                maxLength={100}
              />
              <Text style={styles.modalLabel}>호칭</Text>
              <TextInput
                style={styles.input}
                placeholder="대표"
                placeholderTextColor={colors.text.muted}
                value={editTitle}
                onChangeText={setEditTitle}
                maxLength={20}
              />
              <Text style={styles.helperText}>
                비워두면 기본값(닉네임 엔터테인먼트 / 대표)으로 저장돼요.
              </Text>
              <View style={styles.modalBtnRow}>
                <TouchableOpacity
                  style={[styles.modalBtn, styles.modalBtnCancel]}
                  onPress={() => setShowProfileEdit(false)}
                  disabled={editSaving}
                >
                  <Text style={styles.modalBtnCancelText}>취소</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalBtn, styles.modalBtnSave, editSaving && { opacity: 0.6 }]}
                  onPress={saveProfileEdit}
                  disabled={editSaving}
                >
                  {editSaving ? (
                    <ActivityIndicator color={colors.text.primary} />
                  ) : (
                    <Text style={styles.modalBtnSaveText}>저장</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={[styles.container, { paddingTop: insets.top + 16 }]} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.title}>설정</Text>
      <View style={styles.formContainer}>
        <Text style={styles.formTitle}>
          {isRegister ? '회원가입' : '로그인'}
        </Text>

        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <TextInput
          style={styles.input}
          placeholder="이메일"
          placeholderTextColor={colors.text.muted}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <TextInput
          style={styles.input}
          placeholder="비밀번호"
          placeholderTextColor={colors.text.muted}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        {isRegister && (
          <>
            <TextInput
              style={styles.input}
              placeholder="닉네임"
              placeholderTextColor={colors.text.muted}
              value={nickname}
              onChangeText={setNickname}
            />
            <TextInput
              style={styles.input}
              placeholder={`기획사명 (비워두면 "${nickname || '닉네임'} 엔터테인먼트")`}
              placeholderTextColor={colors.text.muted}
              value={companyName}
              onChangeText={setCompanyName}
            />
            <TextInput
              style={styles.input}
              placeholder='호칭 (예: 대표, PD)'
              placeholderTextColor={colors.text.muted}
              value={displayTitle}
              onChangeText={setDisplayTitle}
              maxLength={20}
            />
            <Text style={styles.helperText}>
              PANN에서는 기획사명과 호칭으로 불러드려요. 나중에 설정에서 변경할 수 있어요.
            </Text>
          </>
        )}

        <TouchableOpacity
          style={[styles.submitButton, isLoading && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color={colors.text.primary} />
          ) : (
            <Text style={styles.submitText}>
              {isRegister ? '회원가입' : '로그인'}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={toggleMode}>
          <Text style={styles.toggleText}>
            {isRegister
              ? '이미 계정이 있으신가요? 로그인'
              : '계정이 없으신가요? 회원가입'}
          </Text>
        </TouchableOpacity>
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
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text.primary,
    paddingHorizontal: 20,
    marginBottom: 30,
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
    marginBottom: 12,
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
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text.primary,
    marginTop: 24,
    marginBottom: 12,
    paddingHorizontal: 20,
  },
  settingRow: {
    backgroundColor: colors.bg.surface1,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    // TODO: 테마화 검토 (세팅 구분선 배경)
    borderBottomColor: '#2a2a3e',
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
  formContainer: {
    marginHorizontal: 20,
  },
  formTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text.primary,
    marginBottom: 20,
    textAlign: 'center',
  },
  errorContainer: {
    backgroundColor: 'rgba(233, 69, 96, 0.15)',
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
    // TODO: 테마화 검토 (입력 폼 테두리)
    borderColor: '#2a2a3e',
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
});
