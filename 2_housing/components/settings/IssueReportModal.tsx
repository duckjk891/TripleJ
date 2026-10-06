// v3.285 [IssueReport] 문의하기(오류 신고) 모달 — 설정 '문의하기(오류 신고)' 행에서 연다.
// v3.95 의 "공식 계정 DM 프리필" 방식을 폐지: 사유(5종 라디오) + 내용(1~2000자) 을 받아
// POST /api/issues 로 전용 접수 → 관리자 웹 '오류 신고' 탭에 들어간다(DM 문의함엔 남지 않음).
// 디자인 = NicknameEditModal/ReportModal 과 같은 계열(오버레이·카드·라디오·입력·[취소][접수]).
// 접수 완료는 같은 카드 안의 완료 화면으로 안내(앱 내 다이얼로그 규칙 — 시스템 Alert 금지).
// 신고 본문 원문은 로그 금지(길이만).
import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  StyleSheet,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Constants from 'expo-constants';
import { Feather } from '@expo/vector-icons';
import api from '../../services/api';
import { AppText } from '../ui';
import { colors } from '../../theme/colors';
import { getCurrentPage, getRecentPages } from '../../utils/routeHistory';
import {
  ISSUE_REASONS,
  ISSUE_TEXT_MAX,
  buildIssuePayload,
  issueErrorMessage,
  normalizeIssueText,
  type IssueReasonCode,
} from '../../utils/issueReport';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/** 현재 화면 식별 — 웹은 경로만(쿼리 제외 — 검색어 등 사용자 데이터 비전송), 네이티브는 라우트명 */
function currentPageUrl(): string | null {
  if (Platform.OS === 'web') {
    try {
      if (typeof window !== 'undefined' && window.location?.pathname) return window.location.pathname;
    } catch { /* noop */ }
  }
  return getCurrentPage();
}

export default function IssueReportModal({ visible, onClose }: Props) {
  const [reason, setReason] = useState<IssueReasonCode | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  // 연타 가드 — setState 반영 전 두 번째 탭도 막는다(POST 1회)
  const busyRef = useRef(false);

  // 열 때마다 초기화
  useEffect(() => {
    if (visible) {
      setReason(null); setText(''); setError(''); setBusy(false); setDone(false);
      busyRef.current = false;
      console.info('[IssueReport] 모달 열기', { page: getCurrentPage(), recent: getRecentPages().length });
    }
  }, [visible]);

  const normalized = normalizeIssueText(text);
  const len = text.length;

  const close = () => {
    if (busy) return;
    onClose();
  };

  const submit = async () => {
    if (busyRef.current || !reason || !normalized) return;
    busyRef.current = true;
    setBusy(true); setError('');
    const payload = buildIssuePayload({
      reason,
      text: normalized,
      appVersion: Constants.expoConfig?.version || '1.0.0',
      platform: Platform.OS,
      pageUrl: currentPageUrl(),
      recentPages: getRecentPages(),
    });
    console.info('[IssueReport] 접수 시작', {
      reason, text_len: payload.text.length, recent_pages: payload.recent_pages?.length ?? 0, app_version: payload.app_version,
    });
    try {
      const { data } = await api.post('/issues', payload);
      console.info('[IssueReport] 접수 완료', { reason, issue_id: data?.id ? String(data.id).slice(0, 8) : null });
      setDone(true);
    } catch (err: any) {
      const status = err?.response?.status;
      const serverMsg = err?.response?.data?.error || err?.response?.data?.detail;
      console.error('[IssueReport] 접수 실패', { reason, status, message: err?.message });
      setError(issueErrorMessage(status, typeof serverMsg === 'string' ? serverMsg : null));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const submitDisabled = busy || !reason || !normalized;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      {/* Modal 내부는 adjustResize 미보장 → keyboard-controller KAV(padding) — ReportModal 관행 */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" pointerEvents="box-none">
        <View style={styles.overlay}>
          <View style={styles.box}>
            <AppText style={styles.title}>문의하기(오류 신고)</AppText>

            {done ? (
              <>
                <AppText style={styles.doneMain}>접수가 완료되었습니다</AppText>
                <AppText style={styles.doneSub}>
                  MAIDOL 운영팀이 확인 후 처리합니다. 추가 안내가 필요하면 알림 또는 메시지로 연락드려요.
                </AppText>
                <TouchableOpacity style={[styles.btn, styles.btnSubmit]} onPress={onClose}>
                  <AppText style={styles.btnSubmitText}>확인</AppText>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <AppText style={styles.guide}>어떤 문제가 있으셨나요? 사유를 선택하고 상황을 알려주세요.</AppText>
                {ISSUE_REASONS.map((r) => {
                  const selected = reason === r.code;
                  return (
                    <TouchableOpacity
                      key={r.code}
                      style={styles.reasonRow}
                      onPress={() => { setReason(r.code); if (error) setError(''); }}
                      disabled={busy}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={r.label}
                    >
                      <Feather
                        name={selected ? 'check-circle' : 'circle'}
                        size={20}
                        color={selected ? colors.accent.primary : colors.text.muted}
                      />
                      <AppText style={[styles.reasonLabel, selected && styles.reasonLabelSelected]}>{r.label}</AppText>
                    </TouchableOpacity>
                  );
                })}

                <TextInput
                  style={styles.input}
                  placeholder="언제, 어떤 화면에서, 어떤 문제가 있었는지 적어주세요"
                  placeholderTextColor={colors.text.muted}
                  value={text}
                  onChangeText={(v) => { setText(v.slice(0, ISSUE_TEXT_MAX)); if (error) setError(''); }}
                  editable={!busy}
                  multiline
                  maxLength={ISSUE_TEXT_MAX}
                  textAlignVertical="top"
                />
                <View style={styles.metaRow}>
                  <AppText style={[styles.errorText, !error && { opacity: 0 }]} numberOfLines={3}>
                    {error || ' '}
                  </AppText>
                  <AppText style={styles.counter}>{`${len}/${ISSUE_TEXT_MAX}`}</AppText>
                </View>
                <AppText style={styles.note}>앱 버전과 최근 이용 화면 정보가 함께 전달되어 문제 확인에 쓰여요.</AppText>

                <View style={styles.btnRow}>
                  <TouchableOpacity style={[styles.btn, styles.btnCancel]} onPress={close} disabled={busy}>
                    <AppText style={styles.btnCancelText}>취소</AppText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnSubmit, submitDisabled && { opacity: 0.4 }]}
                    onPress={submit}
                    disabled={submitDisabled}
                  >
                    {busy ? (
                      <ActivityIndicator color={colors.text.primary} />
                    ) : (
                      <AppText style={styles.btnSubmitText}>접수</AppText>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// NicknameEditModal(설정 화면 모달 통일)과 같은 값
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
    maxWidth: 420,
    maxHeight: '100%',
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
    marginBottom: 8,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
  },
  reasonLabel: { fontSize: 15, color: colors.text.secondary },
  reasonLabelSelected: { color: colors.text.primary, fontWeight: '600' },
  input: {
    marginTop: 8,
    minHeight: 96,
    maxHeight: 180,
    backgroundColor: colors.bg.deepest,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
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
  errorText: { flex: 1, fontSize: 12, color: '#cc6868' },
  counter: { fontSize: 12, color: colors.text.muted },
  note: { fontSize: 12, color: colors.text.muted, lineHeight: 17, marginBottom: 8 },
  doneMain: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text.primary,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  doneSub: {
    fontSize: 13,
    color: colors.text.secondary,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 20,
  },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
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
  btnCancelText: { color: colors.text.secondary, fontSize: 15, fontWeight: '600' },
  btnSubmit: { backgroundColor: colors.accent.primary },
  btnSubmitText: { color: colors.text.primary, fontSize: 15, fontWeight: '700' },
});
