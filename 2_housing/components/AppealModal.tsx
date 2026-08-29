// [AppealModal] 소명 제출 모달 — MAIDOL AppealModal 이식(RN). v3.95(A-13)
// 블라인드된 내 콘텐츠(GET /reports/my-affected 항목)에 대해 POST /reports/{id}/appeal.
// 서버 계약: text 1~2000자, 신고당 1회(중복 409 · 비소유 403 · blind 아님 400 · 성공 201 {appeal_id}).
// 주의: 소명 텍스트 원문은 절대 콘솔에 출력하지 않는다(길이만 기록).
import { useState } from 'react';
import { Modal, View, TouchableOpacity, TextInput, ActivityIndicator, StyleSheet } from 'react-native';
import api from '../services/api';
import { AppText, Button } from './ui';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';

const APPEAL_MAX = 2000; // 서버 계약값(reports.py submit_appeal — 1~2000자)

const TYPE_LABEL: Record<string, string> = { track: '곡', feed: '피드', comment: '댓글' };
const ACTION_LABEL: Record<string, string> = {
  blind: '블라인드(비공개)',
  delete: '삭제',
  confirm_delete: '확정 삭제',
  restore: '복원',
};

// my-affected 응답 항목(reports.py list_my_affected_reports 계약 그대로)
export interface AffectedReport {
  report_id: string;
  target_type: string;
  target_id: string;
  reason_code: string;
  action: string;
  resolution?: string | null;
  handled_at?: string | null;
  has_appeal: boolean;
  appeal?: { text: string; created_at?: string | null } | null;
  target?: {
    title?: string;
    cover_image_url?: string;
    kind?: string;
    text_excerpt?: string;
    deleted?: boolean;
  } | null;
}

// 서버 시각은 타임존 표기 없는 UTC — 'Z' 보정 후 날짜 표기
const fmtDate = (iso?: string | null): string => {
  if (!iso) return '';
  const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z');
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ko-KR');
};

interface Props {
  report: AffectedReport | null; // null이면 닫힘
  onClose: () => void;
  onSubmitted?: (reportId: string) => void; // 제출 성공 → 목록 갱신용
}

export default function AppealModal({ report, onClose, onSubmitted }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const close = () => {
    if (busy) return;
    setText(''); setError(''); setDone(false);
    onClose();
  };

  const submit = async () => {
    const body = text.trim().slice(0, APPEAL_MAX);
    if (!report || !body || busy) return;
    setBusy(true); setError('');
    if (__DEV__) console.info('[AppealModal] submit', { report_id: report.report_id, text_len: body.length });
    try {
      await api.post(`/reports/${report.report_id}/appeal`, { text: body });
      setDone(true);
      onSubmitted?.(report.report_id);
    } catch (err: any) {
      const status = err?.response?.status;
      console.error('[AppealModal] submit failed', { report_id: report.report_id, status });
      if (status === 409) setError('이미 소명을 제출했습니다.');
      else if (status === 400) setError('현재 상태에서는 소명을 제출할 수 없습니다.');
      else if (status === 403) setError('본인 콘텐츠에 대해서만 소명할 수 있습니다.');
      else setError('소명 제출에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setBusy(false);
    }
  };

  if (!report) return null;
  const summaryText = report.target?.title || report.target?.text_excerpt
    || (report.target?.deleted ? '삭제된 콘텐츠' : '');

  return (
    <Modal visible={!!report} transparent animationType="fade" onRequestClose={close}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={close}>
        <TouchableOpacity style={styles.card} activeOpacity={1} onPress={() => {}}>
          <AppText variant="title3" style={styles.title}>소명하기</AppText>

          {done ? (
            <>
              <AppText variant="body" center style={styles.desc}>
                소명이 제출되었습니다. 확인 후 복원 또는 삭제가 결정됩니다.
              </AppText>
              <Button label="확인" fullWidth onPress={close} />
            </>
          ) : (
            <>
              {/* 대상 요약 — 콘텐츠 종류 · 요약 · 처리 상태 */}
              <View style={styles.target}>
                <AppText variant="caption" tone="accent">
                  {TYPE_LABEL[report.target_type] || '콘텐츠'}
                </AppText>
                {summaryText ? (
                  <AppText variant="footnote" numberOfLines={2}>{summaryText}</AppText>
                ) : null}
                <AppText variant="caption" tone="muted">
                  처리: {ACTION_LABEL[report.action] || report.action || '-'}
                  {report.handled_at ? ` · ${fmtDate(report.handled_at)}` : ''}
                </AppText>
              </View>

              {report.has_appeal ? (
                <AppText variant="footnote" tone="secondary" style={styles.desc}>
                  이미 소명을 제출했습니다. 처리 결과를 기다려주세요.
                </AppText>
              ) : (
                <>
                  <AppText variant="footnote" tone="secondary" style={styles.desc}>
                    본인 콘텐츠가 신고로 비공개 처리된 사유에 대해 소명할 내용을 입력해주세요.
                    소명은 1회만 제출할 수 있습니다.
                  </AppText>
                  <TextInput
                    style={styles.input}
                    placeholder="소명 내용을 입력해주세요 (2000자 이내)"
                    placeholderTextColor={colors.text.muted}
                    value={text}
                    onChangeText={(v) => setText(v.slice(0, APPEAL_MAX))}
                    multiline
                    maxLength={APPEAL_MAX}
                    editable={!busy}
                  />
                  <AppText variant="caption" tone="muted" style={styles.count}>
                    {text.length}/{APPEAL_MAX}
                  </AppText>
                </>
              )}

              {error ? <AppText variant="footnote" style={styles.error}>{error}</AppText> : null}
              {busy ? <ActivityIndicator color={colors.accent.primary} style={{ marginVertical: spacing.sm }} /> : null}

              <View style={styles.actions}>
                <View style={{ flex: 1 }}>
                  <Button label={report.has_appeal ? '닫기' : '취소'} variant="tonal" fullWidth onPress={close} />
                </View>
                {!report.has_appeal ? (
                  <View style={{ flex: 1 }}>
                    <Button label={busy ? '제출 중...' : '소명 제출'} fullWidth disabled={busy || !text.trim()} onPress={submit} />
                  </View>
                ) : null}
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
  target: {
    gap: 2, backgroundColor: colors.bg.deepest, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.md,
  },
  desc: { marginBottom: spacing.md, lineHeight: 20 },
  input: {
    minHeight: 110, textAlignVertical: 'top',
    backgroundColor: colors.bg.deepest, borderRadius: radius.md, padding: spacing.md,
    color: colors.text.primary, borderWidth: 1, borderColor: colors.border.subtle,
  },
  count: { alignSelf: 'flex-end', marginTop: 4 },
  error: { color: colors.status.error, marginTop: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
});
