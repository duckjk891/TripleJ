import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useDialogStore, type DialogButton } from '../stores/dialogStore';
import { colors } from '../theme/colors';

// v3.85: 전역 앱 내 다이얼로그 호스트 — App 루트에 1회 마운트.
// 디자인은 components/ConfirmDialog와 동일 계열(백드롭·카드·버튼 톤).
// 버튼 1개=단독 확인, 2개=[취소][확인] 가로, 3개 이상=세로 스택.
export default function AppDialogHost() {
  const dialog = useDialogStore((s) => s.queue[0]);
  const dismiss = useDialogStore((s) => s.dismiss);

  if (!dialog) return null;

  const cancelBtn = dialog.buttons.find((b) => b.style === 'cancel');
  const press = (b: DialogButton) => {
    dismiss(dialog.id);
    b.onPress?.();
  };
  // 백드롭/뒤로가기 = cancel 버튼(있으면), 없으면 마지막 버튼으로 닫기
  const close = () => press(cancelBtn ?? dialog.buttons[dialog.buttons.length - 1]);

  const vertical = dialog.buttons.length >= 3;

  const renderBtn = (b: DialogButton, i: number) => {
    const isCancel = b.style === 'cancel';
    const isDestructive = b.style === 'destructive';
    return (
      <TouchableOpacity
        key={i}
        style={[
          styles.btn,
          vertical && styles.btnVertical,
          isCancel ? styles.cancelBtn : isDestructive ? styles.destructiveBtn : styles.confirmBtn,
        ]}
        onPress={() => press(b)}
        activeOpacity={0.7}
      >
        <Text
          style={
            isCancel ? styles.cancelBtnText : isDestructive ? styles.destructiveBtnText : styles.confirmBtnText
          }
        >
          {b.text || '확인'}
        </Text>
      </TouchableOpacity>
    );
  };

  // 2버튼 가로 배치 시 cancel을 왼쪽으로
  const ordered = vertical
    ? dialog.buttons
    : [...dialog.buttons].sort((a, b) => (a.style === 'cancel' ? -1 : b.style === 'cancel' ? 1 : 0));

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={close} />
        <View style={styles.box}>
          <Text style={styles.title}>{dialog.title}</Text>
          {!!dialog.message && <Text style={styles.message}>{dialog.message}</Text>}
          <View style={vertical ? styles.btnCol : styles.btnRow}>{ordered.map(renderBtn)}</View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  box: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.bg.surface1,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text.primary,
    marginBottom: 10,
  },
  message: {
    fontSize: 13,
    color: colors.text.secondary,
    lineHeight: 19,
    marginBottom: 20,
  },
  btnRow: { flexDirection: 'row', gap: 8 },
  btnCol: { gap: 8 },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnVertical: { flex: 0 },
  cancelBtn: {
    backgroundColor: colors.bg.surface2,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  cancelBtnText: { color: colors.text.secondary, fontSize: 14, fontWeight: '600' },
  confirmBtn: { backgroundColor: colors.accent.primary },
  confirmBtnText: { color: colors.text.primary, fontSize: 14, fontWeight: '700' },
  destructiveBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#a04444',
  },
  destructiveBtnText: { color: '#cc6868', fontSize: 14, fontWeight: '700' },
});
