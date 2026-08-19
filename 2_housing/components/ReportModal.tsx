// [ReportModal] 공용 신고 모달 (트랙/피드/댓글) — MAIDOL ReportModal 이식.
// 사유 5종 라디오 선택 + '기타'일 때만 상세 입력(최대 500자) → POST /reports/
// 주의: reason_text 원문은 절대 콘솔에 출력하지 않는다(길이만 기록).
import { useState } from 'react';
import { Modal, View, TouchableOpacity, TextInput, ActivityIndicator, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { AppText, Button } from './ui';
import LoginStartButton from './LoginStartButton';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';

export type ReportTargetType = 'track' | 'feed' | 'comment' | 'dm_message';

const REASONS: { code: string; label: string }[] = [
  { code: 'portrait', label: '초상권 침해' },
  { code: 'copyright', label: '저작권 침해' },
  { code: 'sexual', label: '성적·불쾌 콘텐츠' },
  { code: 'abuse', label: '욕설·괴롭힘' },
  { code: 'other', label: '기타' },
];

interface Props {
  visible: boolean;
  targetType: ReportTargetType;
  targetId: string;
  onClose: () => void;
}

export default function ReportModal({ visible, targetType, targetId, onClose }: Props) {
  const navigation = useNavigation<any>();
  const user = useAuthStore((s) => s.user);
  const [reasonCode, setReasonCode] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const close = () => {
    if (busy) return;
    setReasonCode(null); setReasonText(''); setError(''); setDone(false);
    onClose();
  };

  const submit = async () => {
    if (!reasonCode || busy) return;
    const text = reasonCode === 'other' ? reasonText.trim().slice(0, 500) : '';
    setBusy(true); setError('');
    // 신고 사유 원문은 남기지 않고 길이만 기록
    if (__DEV__) console.info('[ReportModal] submit', { target_type: targetType, target_id: targetId, reason_code: reasonCode, text_len: text.length });
    try {
      await api.post('/reports/', {
        target_type: targetType,
        target_id: targetId,
        reason_code: reasonCode,
        ...(text ? { reason_text: text } : {}),
      });
      setDone(true);
    } catch (err: any) {
      const status = err?.response?.status;
      console.error('[ReportModal] submit failed', { target_type: targetType, target_id: targetId, status });
      if (status === 409) setError('이미 신고한 콘텐츠입니다.');
      else if (status === 400) setError(err?.response?.data?.error || err?.response?.data?.detail || '신고할 수 없는 콘텐츠입니다.');
      else setError('신고 접수에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || !reasonCode || (reasonCode === 'other' && !reasonText.trim());

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={close}>
        <TouchableOpacity style={styles.card} activeOpacity={1} onPress={() => {}}>
          <AppText variant="title3" style={styles.title}>신고하기</AppText>

          {!user ? (
            // 비로그인 → 로그인 유도 (다른 화면과 동일한 공통 버튼)
            <>
              <AppText variant="body" tone="secondary" center style={styles.desc}>신고하려면 로그인이 필요합니다.</AppText>
              <LoginStartButton onPress={() => { onClose(); navigation.navigate('Settings'); }} />
            </>
          ) : done ? (
            <>
              <AppText variant="body" center style={styles.desc}>신고가 접수되었습니다</AppText>
              <AppText variant="footnote" tone="secondary" center style={styles.doneSub}>
                처리 결과는 [설정 &gt; 내 신고 내역]에서 확인하실 수 있어요.
              </AppText>
              <Button label="확인" fullWidth onPress={close} />
            </>
          ) : (
            <>
              {REASONS.map((r) => {
                const selected = reasonCode === r.code;
                return (
                  <TouchableOpacity key={r.code} style={styles.reasonRow} onPress={() => setReasonCode(r.code)} accessibilityLabel={r.label}>
                    <Feather
                      name={selected ? 'check-circle' : 'circle'}
                      size={20}
                      color={selected ? colors.accent.primary : colors.text.muted}
                    />
                    <AppText variant="body" tone={selected ? 'primary' : 'secondary'}>{r.label}</AppText>
                  </TouchableOpacity>
                );
              })}

              {reasonCode === 'other' ? (
                <TextInput
                  style={styles.input}
                  placeholder="신고 사유를 입력해주세요 (최대 500자)"
                  placeholderTextColor={colors.text.muted}
                  value={reasonText}
                  onChangeText={(v) => setReasonText(v.slice(0, 500))}
                  multiline
                  maxLength={500}
                />
              ) : null}

              {error ? <AppText variant="footnote" style={styles.error}>{error}</AppText> : null}
              {busy ? <ActivityIndicator color={colors.accent.primary} style={{ marginVertical: spacing.sm }} /> : null}

              <View style={styles.actions}>
                <View style={{ flex: 1 }}>
                  <Button label="취소" variant="tonal" fullWidth onPress={close} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button label="신고" fullWidth disabled={disabled} onPress={submit} />
                </View>
              </View>
            </>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  card: { width: '100%', maxWidth: 360, backgroundColor: colors.bg.surface1, borderRadius: radius.xxl, padding: spacing.xl },
  title: { marginBottom: spacing.lg },
  desc: { marginBottom: spacing.lg },
  doneSub: { marginBottom: spacing.xl, lineHeight: 20 },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  input: {
    marginTop: spacing.sm, minHeight: 80, textAlignVertical: 'top',
    backgroundColor: colors.bg.deepest, borderRadius: radius.md, padding: spacing.md,
    color: colors.text.primary, borderWidth: 1, borderColor: colors.border.subtle,
  },
  error: { color: colors.status.error, marginTop: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
});
