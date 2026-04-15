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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../stores/authStore';

export default function SettingsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { user, isLoading, error, login, register, logout, clearError } = useAuthStore();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');

  const handleSubmit = async () => {
    if (isRegister) {
      const success = await register(email, password, nickname);
      if (success) {
        setEmail('');
        setPassword('');
        setNickname('');
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
          <Text style={styles.nicknameText}>{user.nickname}</Text>
          <Text style={styles.emailText}>{user.email}</Text>
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
          style={[styles.settingRow, styles.settingRowLast]}
          onPress={() => Alert.alert('알림', '준비 중인 기능입니다')}
        >
          <Text style={styles.settingLabel}>비밀번호 변경</Text>
          <Text style={styles.settingArrow}>{'>'}</Text>
        </TouchableOpacity>

        {/* 알림 설정 */}
        <Text style={styles.sectionTitle}>알림 설정</Text>
        <View style={[styles.settingRow, styles.settingRowFirst]}>
          <Text style={styles.settingLabel}>곡 생성 완료 알림</Text>
          <Switch
            value={notifySongComplete}
            onValueChange={setNotifySongComplete}
            trackColor={{ false: '#333', true: '#e94560' }}
            thumbColor="#fff"
          />
        </View>
        <View style={[styles.settingRow, styles.settingRowLast]}>
          <Text style={styles.settingLabel}>새로운 차트 업데이트</Text>
          <Switch
            value={notifyChartUpdate}
            onValueChange={setNotifyChartUpdate}
            trackColor={{ false: '#333', true: '#e94560' }}
            thumbColor="#fff"
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
          placeholderTextColor="#555"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <TextInput
          style={styles.input}
          placeholder="비밀번호"
          placeholderTextColor="#555"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        {isRegister && (
          <TextInput
            style={styles.input}
            placeholder="닉네임"
            placeholderTextColor="#555"
            value={nickname}
            onChangeText={setNickname}
          />
        )}

        <TouchableOpacity
          style={[styles.submitButton, isLoading && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
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
    backgroundColor: '#0a0a1a',
    paddingTop: 16,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    paddingHorizontal: 20,
    marginBottom: 30,
  },
  profileCard: {
    alignItems: 'center',
    paddingVertical: 30,
    marginHorizontal: 20,
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
  },
  avatarCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#e94560',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  nicknameText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  emailText: {
    fontSize: 14,
    color: '#888',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 24,
    marginBottom: 12,
    paddingHorizontal: 20,
  },
  settingRow: {
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
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
    color: '#fff',
  },
  settingValue: {
    fontSize: 15,
    color: '#888',
  },
  settingArrow: {
    fontSize: 16,
    color: '#555',
  },
  logoutButton: {
    marginTop: 30,
    marginBottom: 40,
    marginHorizontal: 20,
    backgroundColor: '#333',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  logoutText: {
    fontSize: 16,
    color: '#e94560',
    fontWeight: '600',
  },
  formContainer: {
    marginHorizontal: 20,
  },
  formTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
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
    color: '#e94560',
    fontSize: 14,
    textAlign: 'center',
  },
  input: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#fff',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  submitButton: {
    backgroundColor: '#e94560',
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
    color: '#fff',
  },
  toggleText: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
  },
});
