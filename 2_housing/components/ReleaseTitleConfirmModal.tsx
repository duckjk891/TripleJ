// [ReleaseTitleConfirmModal] v3.309 발매 전 마지막 제목 확인(대표 10-09) — 저장=발매(차트 공개)라 발매 후에는 제목을 바꿀 수 없다.
// "발매하면 제목 수정이 불가합니다" 안내 + 현재 제목 표시 + 이 팝업에서 한 번 편집할 기회. [취소][이 제목으로 발매].
import { useEffect, useState } from 'react';
import { Modal, View, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Feather } from '@expo/vector-icons';
import { AppText } from './ui';
import { colors } from '../theme/colors';

export const RELEASE_TITLE_MAX = 50;

/** 제목 정리(순수) — 공백 1칸·앞뒤 제거·최대 길이 */
export function normalizeReleaseTitle(raw: string): string {
  return (raw || '').replace(/\s+/g, ' ').trim().slice(0, RELEASE_TITLE_MAX);
}

interface Props {
  visible: boolean;
  initialTitle: string;
  /** 확인 버튼 문구(기본 '이 제목으로 발매') */
  confirmLabel?: string;
  onConfirm: (title: string) => void;
  onCancel: () => void;
}

export default function ReleaseTitleConfirmModal({ visible, initialTitle, confirmLabel = '이 제목으로 발매', onConfirm, onCancel }: Props) {
  const [title, setTitle] = useState(initialTitle);
  useEffect(() => { if (visible) setTitle(initialTitle); }, [visible, initialTitle]);
  const normalized = normalizeReleaseTitle(title);
  const changed = normalized !== normalizeReleaseTitle(initialTitle);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" pointerEvents="box-none">
        <View style={styles.overlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onCancel} accessibilityLabel="닫기" />
          <View style={styles.box}>
            <AppText style={styles.title}>발매 전 제목 확인</AppText>
            <View style={styles.warnRow}>
              <Feather name="alert-circle" size={15} color={colors.status.warning} />
              <AppText style={styles.warn}>발매하면 차트에 공개되고, 이후에는 제목을 수정할 수 없어요.</AppText>
            </View>
            <AppText style={styles.label}>곡 제목 (눌러서 바꿀 수 있어요)</AppText>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={(v) => setTitle(v.slice(0, RELEASE_TITLE_MAX + 10))}
              placeholder="곡 제목"
              placeholderTextColor={colors.text.muted}
              maxLength={RELEASE_TITLE_MAX + 10}
              returnKeyType="done"
              accessibilityLabel="곡 제목"
            />
            <AppText style={styles.counter}>{`${normalized.length}/${RELEASE_TITLE_MAX}${changed ? ' · 바뀐 제목으로 발매돼요' : ''}`}</AppText>
            <View style={styles.btnRow}>
              <TouchableOpacity style={[styles.btn, styles.btnCancel]} onPress={onCancel}>
                <AppText style={styles.btnCancelText}>취소</AppText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnOk, !normalized && { opacity: 0.4 }]}
                onPress={() => { if (normalized) onConfirm(normalized); }}
                disabled={!normalized}
              >
                <AppText style={styles.btnOkText}>{confirmLabel}</AppText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(13, 8, 32, 0.85)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  box: { width: '100%', maxWidth: 380, backgroundColor: colors.bg.surface1, borderRadius: 16, padding: 20, gap: 8 },
  title: { fontSize: 18, fontWeight: '700', color: colors.text.primary, marginBottom: 2 },
  warnRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  warn: { flex: 1, fontSize: 13, lineHeight: 19, color: colors.text.secondary },
  label: { fontSize: 12, color: colors.text.muted, marginTop: 6 },
  input: {
    borderWidth: 1, borderColor: colors.border.accent, borderRadius: 10, color: colors.text.primary,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 16,
  },
  counter: { fontSize: 11, color: colors.text.muted, alignSelf: 'flex-end' },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  btnCancel: { backgroundColor: colors.bg.surface2 },
  btnCancelText: { color: colors.text.secondary, fontSize: 15 },
  btnOk: { backgroundColor: colors.accent.primary },
  btnOkText: { color: colors.text.primary, fontSize: 15, fontWeight: '700' },
});
