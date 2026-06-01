import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';

interface Props {
  visible: boolean;
  title: string;
  message: string;
  confirmText?: string;
  // null이면 cancel 버튼 숨김 (단순 알림 모드)
  cancelText?: string | null;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
}

export default function ConfirmDialog({
  visible,
  title,
  message,
  confirmText = '확인',
  cancelText = '취소',
  destructive = false,
  onConfirm,
  onCancel,
}: Props) {
  const showCancel = cancelText !== null;
  const handleClose = onCancel || onConfirm;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={handleClose}
        />
        <View style={styles.box}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.btnRow}>
            {showCancel && (
              <TouchableOpacity style={[styles.btn, styles.cancelBtn]} onPress={onCancel} activeOpacity={0.7}>
                <Text style={styles.cancelBtnText}>{cancelText}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[
                styles.btn,
                destructive ? styles.destructiveBtn : styles.confirmBtn,
              ]}
              onPress={onConfirm}
              activeOpacity={0.7}
            >
              <Text style={destructive ? styles.destructiveBtnText : styles.confirmBtnText}>
                {confirmText}
              </Text>
            </TouchableOpacity>
          </View>
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
  btnRow: {
    flexDirection: 'row',
    gap: 8,
  },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  cancelBtn: {
    backgroundColor: colors.bg.surface2,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  cancelBtnText: {
    color: colors.text.secondary,
    fontSize: 13,
    fontWeight: '600',
  },
  confirmBtn: {
    backgroundColor: colors.accent.primary,
  },
  confirmBtnText: {
    color: colors.text.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  destructiveBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#a04444',
  },
  destructiveBtnText: {
    color: '#cc6868',
    fontSize: 13,
    fontWeight: '700',
  },
});
