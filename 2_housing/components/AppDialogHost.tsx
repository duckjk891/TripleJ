import { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useDialogStore, type DialogButton } from '../stores/dialogStore';
import { colors } from '../theme/colors';

// v3.85: 전역 앱 내 다이얼로그 호스트 — App 루트에 1회 마운트.
// 디자인은 components/ConfirmDialog와 동일 계열(백드롭·카드·버튼 톤).
// 버튼 1개=단독 확인, 2개=[취소][확인] 가로, 3개 이상=세로 스택.
export default function AppDialogHost() {
  const dialog = useDialogStore((s) => s.queue[0]);
  const dismiss = useDialogStore((s) => s.dismiss);
  // v3.230 A5-5: lockMs 다이얼로그 — 표시 후 잠금 시간 동안 cancel 외 버튼 무반응(같은 위치 연타 흡수).
  // 잠금 해제 시각은 다이얼로그 id별로 렌더 중 1회 고정(effect 전 첫 프레임부터 잠금), 해제 시 리렌더.
  const lockRef = useRef<{ id: number; until: number } | null>(null);
  if (dialog && dialog.lockMs && dialog.lockMs > 0 && lockRef.current?.id !== dialog.id) {
    lockRef.current = { id: dialog.id, until: Date.now() + dialog.lockMs };
  }
  const lockUntil = dialog && lockRef.current?.id === dialog.id ? lockRef.current.until : 0;
  const [, setUnlockTick] = useState(0);
  useEffect(() => {
    const wait = lockUntil - Date.now();
    if (!(wait > 0)) return undefined;
    const t = setTimeout(() => setUnlockTick((n) => n + 1), wait + 10);
    return () => clearTimeout(t);
  }, [lockUntil]);

  if (!dialog) return null;

  // v3.236 A1: 커스텀 본문 다이얼로그 — 카드 안에 제목 + 콘텐츠. 버튼·잠금·닫기는 콘텐츠가 담당.
  // 백드롭/뒤로가기 = custom.onRequestClose(바쁜 동안 무시 여부는 콘텐츠가 결정), 없으면 닫기.
  if (dialog.custom) {
    const custom = dialog.custom;
    const closeCustom = () => dismiss(dialog.id);
    const requestClose = () => {
      if (custom.onRequestClose) custom.onRequestClose();
      else closeCustom();
    };
    return (
      <Modal visible transparent animationType="fade" onRequestClose={requestClose}>
        <View style={styles.backdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={requestClose} />
          <View style={styles.box} key={dialog.id}>
            {!!dialog.title && <Text style={styles.title}>{dialog.title}</Text>}
            {custom.render({ close: closeCustom, lockUntil })}
          </View>
        </View>
      </Modal>
    );
  }

  const locked = lockUntil > Date.now();

  const cancelBtn = dialog.buttons.find((b) => b.style === 'cancel');
  const press = (b: DialogButton) => {
    // 잠금 중엔 cancel 외 버튼 무시(렌더가 늦어도 누른 시각 기준으로 판정)
    if (b.style !== 'cancel' && lockUntil > Date.now()) {
      console.info('[AppDialogHost] 잠금 중 버튼 입력 무시', { title: dialog.title, text: b.text });
      return;
    }
    dismiss(dialog.id);
    b.onPress?.();
  };
  // 백드롭/뒤로가기 = cancel 버튼(있으면), 없으면 마지막 버튼으로 닫기
  const close = () => press(cancelBtn ?? dialog.buttons[dialog.buttons.length - 1]);

  const vertical = dialog.buttons.length >= 3;

  const renderBtn = (b: DialogButton, i: number) => {
    const isCancel = b.style === 'cancel';
    const isDestructive = b.style === 'destructive';
    const btnLocked = locked && !isCancel;
    return (
      <TouchableOpacity
        key={i}
        style={[
          styles.btn,
          vertical && styles.btnVertical,
          isCancel ? styles.cancelBtn : isDestructive ? styles.destructiveBtn : styles.confirmBtn,
          btnLocked && styles.btnLocked,
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
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 10,
    alignItems: 'center',
  },
  // v3.118.3: 웹에서 flex:0이 flex-basis 압축으로 버튼 높이를 무너뜨려 글자 잘림
  // (앨범 커버 변경 3버튼 등 세로 스택 전부) — 화풍 버튼(v3.109)과 동일 패턴 수정.
  btnVertical: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' },
  btnLocked: { opacity: 0.45 },
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
