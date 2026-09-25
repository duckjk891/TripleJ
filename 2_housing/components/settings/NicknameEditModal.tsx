// v3.230 A2 [NicknameChange] 닉네임 변경 모달 — 설정 '닉네임 변경' 행에서 연다.
// 디자인 = SettingsScreen 회원탈퇴 확인 모달과 같은 계열(오버레이·박스·입력·[취소][저장] 버튼)로 통일.
// 규칙 안내(2~15자·중복 불가)·글자수 카운터·로컬 검증(utils/nicknameRules) → authStore.changeNickname
// → 409 "이미 쓰는 닉네임" / 400 서버 메시지 / 구서버 무시 "준비 중" 매핑. 성공 시 앱 내 팝업.
// 닉네임 원문은 로그 금지(길이만).
import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  StyleSheet,
} from 'react-native';
import { AppText } from '../ui';
import { colors } from '../../theme/colors';
import { showAlert } from '../../utils/appAlert';
import { useAuthStore } from '../../stores/authStore';
import {
  NICKNAME_MAX_LEN,
  NICKNAME_MIN_LEN,
  nicknameLength,
  normalizeNickname,
  validateNickname,
} from '../../utils/nicknameRules';

interface Props {
  visible: boolean;
  currentNickname: string;
  onClose: () => void;
}

export default function NicknameEditModal({ visible, currentNickname, onClose }: Props) {
  const changeNickname = useAuthStore((s) => s.changeNickname);
  const [value, setValue] = useState(currentNickname);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // 연타 가드 — setState 반영 전 두 번째 탭도 막는다(PATCH 1회)
  const busyRef = useRef(false);

  // 열 때마다 현재값으로 초기화
  useEffect(() => {
    if (visible) {
      setValue(currentNickname);
      setError('');
      setBusy(false);
      busyRef.current = false;
      console.info('[NicknameChange] 모달 열기', { currentLen: currentNickname.length });
    }
  }, [visible, currentNickname]);

  const normalized = normalizeNickname(value);
  const len = nicknameLength(normalized);
  const unchanged = normalized === normalizeNickname(currentNickname);

  const close = () => {
    if (busy) return;
    onClose();
  };

  const handleSave = async () => {
    if (busyRef.current) return;
    const check = validateNickname(value, currentNickname);
    if (!check.ok) {
      console.info('[NicknameChange] 로컬 검증 실패', { reason: check.reason, len });
      setError(check.message);
      return;
    }
    setError('');
    busyRef.current = true;
    setBusy(true);
    console.info('[NicknameChange] 저장 시작', { len: nicknameLength(check.value) });
    try {
      const r = await changeNickname(check.value);
      if (r.code === 'ok') {
        console.info('[NicknameChange] 저장 성공', { len: nicknameLength(r.nickname || ''), synced: r.synced ?? null });
        busyRef.current = false;
        setBusy(false);
        onClose();
        showAlert('닉네임을 바꿨어요', '내 곡·피드·댓글 표기도 새 닉네임으로 바뀌어요.');
        return;
      }
      console.info('[NicknameChange] 저장 실패', { code: r.code });
      busyRef.current = false;
      setBusy(false);
      if (r.code === 'unsupported' || r.code === 'auth') {
        onClose();
        showAlert('알림', r.message);
        return;
      }
      setError(r.message);
    } catch (err: any) {
      // changeNickname 은 예외를 삼키지만 방어적으로 한 번 더
      console.error('[NicknameChange] 저장 예외', { message: err?.message });
      busyRef.current = false;
      setBusy(false);
      setError('닉네임을 바꾸지 못했어요. 잠시 후 다시 시도해주세요.');
    }
  };

  const saveDisabled = busy || !normalized || unchanged;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      {/* Modal 내부는 adjustResize 미보장 → KAV(양 플랫폼 "padding") — SettingsScreen 관행 */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" pointerEvents="box-none">
        <View style={styles.overlay}>
          <View style={styles.box}>
            <AppText style={styles.title}>닉네임 변경</AppText>
            <AppText style={styles.guide}>
              {`${NICKNAME_MIN_LEN}~${NICKNAME_MAX_LEN}자로 입력해주세요. 다른 사람이 쓰는 닉네임은 쓸 수 없어요.`}
            </AppText>
            <TextInput
              style={styles.input}
              placeholder="새 닉네임"
              placeholderTextColor={colors.text.muted}
              value={value}
              onChangeText={(v) => { setValue(v); if (error) setError(''); }}
              editable={!busy}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={NICKNAME_MAX_LEN + 10 /* 공백 정리 전 여유 — 최종 길이는 검증에서 판정 */}
              returnKeyType="done"
              onSubmitEditing={handleSave}
            />
            <View style={styles.metaRow}>
              <AppText style={[styles.errorText, !error && { opacity: 0 }]} numberOfLines={2}>
                {error || ' '}
              </AppText>
              <AppText style={[styles.counter, len > NICKNAME_MAX_LEN && styles.counterOver]}>
                {`${len}/${NICKNAME_MAX_LEN}`}
              </AppText>
            </View>
            <AppText style={styles.note}>바꾸면 내 곡·피드·댓글에 보이는 이름도 함께 바뀌어요.</AppText>
            <View style={styles.btnRow}>
              <TouchableOpacity style={[styles.btn, styles.btnCancel]} onPress={close} disabled={busy}>
                <AppText style={styles.btnCancelText}>취소</AppText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnSave, saveDisabled && { opacity: 0.4 }]}
                onPress={handleSave}
                disabled={saveDisabled}
              >
                {busy ? (
                  <ActivityIndicator color={colors.text.primary} />
                ) : (
                  <AppText style={styles.btnSaveText}>저장</AppText>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// SettingsScreen modalOverlay/modalBox/modalTitle/input/modalBtn* 와 같은 값(설정 화면 모달 통일)
const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(13, 8, 32, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  box: {
    width: '100%',
    backgroundColor: colors.bg.surface1,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text.primary,
    marginBottom: 12,
    textAlign: 'center',
  },
  guide: {
    fontSize: 13,
    color: colors.text.secondary,
    lineHeight: 19,
    marginBottom: 12,
  },
  input: {
    backgroundColor: colors.bg.surface1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.text.primary,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    color: '#cc6868',
  },
  counter: {
    fontSize: 12,
    color: colors.text.muted,
  },
  counterOver: {
    color: '#cc6868',
  },
  note: {
    fontSize: 12,
    color: colors.text.muted,
    lineHeight: 17,
    marginBottom: 8,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  btn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnCancel: {
    backgroundColor: colors.bg.surface2,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  btnCancelText: {
    color: colors.text.secondary,
    fontSize: 15,
    fontWeight: '600',
  },
  btnSave: {
    backgroundColor: colors.accent.primary,
  },
  btnSaveText: {
    color: colors.text.primary,
    fontSize: 15,
    fontWeight: '700',
  },
});
