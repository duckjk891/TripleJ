// v3.334 [PasswordChange] 비밀번호 변경 — 설정 '비밀번호 변경' 행(이메일 가입 계정만). 현재 비밀번호 확인 → 새 비밀번호.
// 서버 POST /auth/me/password(메일 발송 없이 동작). 디자인 = NicknameEditModal 계열. 비밀번호 값·길이 로그 금지.
import { useEffect, useRef, useState } from 'react';
import { View, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import AppModal from '../AppModal'; // v3.400 iOS 창 겹침·팝업 무반응 방지
import { AppText } from '../ui';
import { colors } from '../../theme/colors';
import { showAlert } from '../../utils/appAlert';
import api from '../../services/api';
import { friendlyErrorMessage } from '../../utils/friendlyError';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const PW_RULE = '8자 이상, 영문과 숫자를 모두 넣어 주세요.';

export default function PasswordChangeModal({ visible, onClose }: Props) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    if (visible) {
      setCurrent(''); setNext(''); setConfirm(''); setError(''); setBusy(false);
      busyRef.current = false;
      console.info('[PasswordChange] 모달 열기');
    }
  }, [visible]);

  const mismatch = confirm.length > 0 && next !== confirm;
  const canSave = !!current && next.length >= 8 && next === confirm && !busy;

  const save = async () => {
    if (!canSave || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      console.info('[PasswordChange] 요청');
      await api.post('/auth/me/password', { current_password: current, new_password: next });
      console.info('[PasswordChange] 완료');
      onClose();
      showAlert('비밀번호 변경', '비밀번호를 바꿨어요. 다음 로그인부터 새 비밀번호를 써 주세요.');
    } catch (err: any) {
      console.error('[PasswordChange] 실패', { status: err?.response?.status });
      setError(friendlyErrorMessage(err, '비밀번호를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <AppModal visible={visible} transparent animationType="fade" onRequestClose={() => !busy && onClose()}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.overlay}>
          <View style={styles.box}>
            <AppText style={styles.title}>비밀번호 변경</AppText>
            <TextInput style={styles.input} value={current} onChangeText={setCurrent} placeholder="현재 비밀번호"
              placeholderTextColor={colors.text.muted} secureTextEntry autoCapitalize="none" autoComplete="current-password" />
            <TextInput style={styles.input} value={next} onChangeText={setNext} placeholder="새 비밀번호"
              placeholderTextColor={colors.text.muted} secureTextEntry autoCapitalize="none" autoComplete="new-password" />
            <TextInput style={styles.input} value={confirm} onChangeText={setConfirm} placeholder="새 비밀번호 확인"
              placeholderTextColor={colors.text.muted} secureTextEntry autoCapitalize="none" autoComplete="new-password"
              onSubmitEditing={save} returnKeyType="done" />
            <AppText style={styles.guide}>{PW_RULE}</AppText>
            {mismatch || error ? (
              <AppText style={styles.errorText}>{error || '새 비밀번호가 서로 달라요.'}</AppText>
            ) : null}
            <View style={styles.btnRow}>
              <TouchableOpacity style={[styles.btn, styles.btnCancel]} onPress={onClose} disabled={busy}>
                <AppText style={styles.btnCancelText}>취소</AppText>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.btnSave, !canSave && { opacity: 0.4 }]} onPress={save} disabled={!canSave}>
                {busy ? <ActivityIndicator color={colors.text.primary} /> : <AppText style={styles.btnSaveText}>변경</AppText>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(13, 8, 32, 0.85)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  box: { width: '100%', backgroundColor: colors.bg.surface1, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: colors.border.subtle },
  title: { fontSize: 18, fontWeight: '700', color: colors.text.primary, marginBottom: 12, textAlign: 'center' },
  input: {
    backgroundColor: colors.bg.surface1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16,
    color: colors.text.primary, marginBottom: 8, borderWidth: 1, borderColor: colors.border.subtle,
  },
  guide: { fontSize: 12, color: colors.text.muted, lineHeight: 17, marginBottom: 6 },
  errorText: { fontSize: 12, color: '#cc6868', marginBottom: 6 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  btn: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnCancel: { backgroundColor: colors.bg.surface2, borderWidth: 1, borderColor: colors.border.subtle },
  btnCancelText: { color: colors.text.secondary, fontSize: 15, fontWeight: '600' },
  btnSave: { backgroundColor: colors.accent.primary },
  btnSaveText: { color: colors.text.primary, fontSize: 15, fontWeight: '700' },
});
