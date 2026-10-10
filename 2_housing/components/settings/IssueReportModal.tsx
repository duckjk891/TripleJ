import { usePasteImages, type PastedAsset } from '../../utils/usePasteImages'; // v3.328
// v3.285 [IssueReport] 문의하기(오류 신고) 모달 — 설정 '문의하기(오류 신고)' 행에서 연다.
// v3.95 의 "공식 계정 DM 프리필" 방식을 폐지: 사유(5종 라디오) + 내용(1~2000자) 을 받아
// POST /api/issues 로 전용 접수 → 관리자 웹 '오류 신고' 탭에 들어간다(DM 문의함엔 남지 않음).
// 디자인 = NicknameEditModal/ReportModal 과 같은 계열(오버레이·카드·라디오·입력·[취소][접수]).
// 접수 완료는 같은 카드 안의 완료 화면으로 안내(앱 내 다이얼로그 규칙 — 시스템 Alert 금지).
// 신고 본문 원문은 로그 금지(길이만).
// v3.308 [IssueAttach](대표 10-09 "신고 이미지 첨부가 왜 없어졌나"): v3.285 전용 접수 전환 때 빠진 사진 첨부(최대 5장) 복원.
//   서버 /api/issues 는 텍스트 전용 → 사진은 공식 계정 DM 대화에 한 메시지로 올리고(v3.274 메시지당 5장) 그 대화 id 를
//   신고의 dm_conversation_id 로 연결 — 관리자 웹 '오류 신고' → [DM 대화에서 답장]에서 사진 확인(관리자 웹 무변경).
//   DM 문구는 '[오류신고' 머리말을 쓰지 않는다(서버 DM→신고 자동 접수와 중복 방지). 사진 전송 실패여도 신고는 접수.
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
import { Image, ScrollView } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useIsChild } from '../../utils/kidsMode';
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

// v3.308 [IssueAttach] 서버 /upload/dm-image 계약(jpg/png/webp ≤15MB)·DM 메시지당 최대 5장과 짝
const ISSUE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ISSUE_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
const ISSUE_MAX_IMAGES = 5;
interface IssueImage { key: string; localUri: string; name: string; mime: string; status: 'uploading' | 'done' | 'failed'; objectName?: string }

async function uploadIssueImage(img: IssueImage): Promise<string> {
  const formData = new FormData();
  if (Platform.OS === 'web') {
    const blob = await (await fetch(img.localUri)).blob();
    formData.append('file', blob, img.name);
  } else {
    formData.append('file', { uri: img.localUri, name: img.name, type: img.mime } as any);
  }
  const res = await api.post('/upload/dm-image', formData, {
    headers: Platform.OS === 'web' ? undefined : { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  });
  const objectName = res.data?.object_name;
  if (!objectName) throw new Error('object_name 누락');
  return String(objectName);
}

/** 사진을 공식 계정 DM 대화에 올리고 대화 id 반환(실패 시 throw) */
async function sendImagesToOfficial(objectNames: string[], reasonLabel: string): Promise<string> {
  const { data: official } = await api.get('/dm/official');
  const officialId = official?.official_id;
  if (!officialId) throw new Error('official_id missing');
  const { data: conv } = await api.post('/dm/conversations', { peer_id: officialId });
  const cid = conv?.conversation_id;
  if (!cid) throw new Error('conversation_id missing');
  await api.post(`/dm/conversations/${cid}/messages`, {
    text: `오류 신고 첨부 사진 (${reasonLabel})`,
    image_object_names: objectNames.slice(0, ISSUE_MAX_IMAGES),
  });
  return String(cid);
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
  // v3.308 [IssueAttach]
  const isChild = useIsChild();
  const [images, setImages] = useState<IssueImage[]>([]);
  const [imageNotice, setImageNotice] = useState('');
  // 연타 가드 — setState 반영 전 두 번째 탭도 막는다(POST 1회)
  const busyRef = useRef(false);

  // 열 때마다 초기화
  useEffect(() => {
    if (visible) {
      setReason(null); setText(''); setError(''); setBusy(false); setDone(false);
      setImages([]); setImageNotice('');
      busyRef.current = false;
      console.info('[IssueReport] 모달 열기', { page: getCurrentPage(), recent: getRecentPages().length });
    }
  }, [visible]);

  const normalized = normalizeIssueText(text);
  const len = text.length;

  const startUpload = (img: IssueImage) => {
    uploadIssueImage(img)
      .then((objectName) => {
        console.info('[IssueReport] 사진 업로드 완료', { name_len: img.name.length });
        setImages((prev) => prev.map((i) => (i.key === img.key ? { ...i, status: 'done', objectName } : i)));
      })
      .catch((err: any) => {
        console.error('[IssueReport] 사진 업로드 실패', { status: err?.response?.status, message: err?.message });
        setImages((prev) => prev.map((i) => (i.key === img.key ? { ...i, status: 'failed' } : i)));
        setError(err?.response?.data?.error || '사진을 올리지 못했어요. 사진을 눌러 다시 시도하거나 X로 빼주세요.');
      });
  };

  const pickImages = async (pasted?: PastedAsset[]) => {
    if (busy) return;
    if (images.length >= ISSUE_MAX_IMAGES) { setError(`사진은 최대 ${ISSUE_MAX_IMAGES}장까지 첨부할 수 있어요.`); return; }
    const res: DocumentPicker.DocumentPickerResult = pasted ? ({ canceled: false, assets: pasted } as any) : await DocumentPicker.getDocumentAsync({ type: 'image/*', multiple: true });
    if (res.canceled || !res.assets?.length) return;
    const room = ISSUE_MAX_IMAGES - images.length;
    const valid = res.assets.filter((f) => {
      const mime = f.mimeType || '';
      if (mime && !ISSUE_IMAGE_TYPES.includes(mime)) return false;
      if (typeof f.size === 'number' && f.size > ISSUE_IMAGE_MAX_BYTES) return false;
      return true;
    });
    const skipped = res.assets.length - valid.length;
    const accepted = valid.slice(0, room);
    const notes: string[] = [];
    if (skipped) notes.push(`${skipped}장은 jpg/png/webp·15MB 이하가 아니라 제외했어요.`);
    if (valid.length > room) notes.push(`최대 ${ISSUE_MAX_IMAGES}장까지라 ${valid.length - room}장은 제외했어요.`);
    setImageNotice(notes.join(' '));
    console.info('[IssueReport] 사진 선택', { picked: res.assets.length, accepted: accepted.length });
    const entries: IssueImage[] = accepted.map((f, i) => ({
      key: `${Date.now()}-${images.length + i}`, localUri: f.uri, name: f.name || 'image.jpg', mime: f.mimeType || 'image/jpeg', status: 'uploading',
    }));
    setImages((prev) => [...prev, ...entries]);
    entries.forEach(startUpload);
  };

  // v3.328 [PasteImage] 웹 Ctrl+V 이미지 붙여넣기(접수 화면 열려 있을 때·어린이 제외)
  usePasteImages(visible && !done && !isChild, (assets) => { void pickImages(assets); });

  const close = () => {
    if (busy) return;
    onClose();
  };

  const submit = async () => {
    if (busyRef.current || !reason || !normalized) return;
    if (images.some((i) => i.status === 'uploading')) { setError('사진 올리기가 끝난 뒤 접수할 수 있어요.'); return; }
    if (images.some((i) => i.status === 'failed')) { setError('올리지 못한 사진이 있어요. 다시 시도하거나 X로 빼주세요.'); return; }
    busyRef.current = true;
    setBusy(true); setError('');
    // v3.308 [IssueAttach] 사진 → 공식 계정 DM(실패해도 신고는 접수)
    const objectNames = images.map((i) => i.objectName).filter((x): x is string => !!x);
    let dmConversationId: string | null = null;
    let imagesFailed = false;
    if (objectNames.length) {
      try {
        dmConversationId = await sendImagesToOfficial(objectNames, ISSUE_REASONS.find((r) => r.code === reason)?.label || '기타');
        console.info('[IssueReport] 사진 DM 전송 완료', { n: objectNames.length });
      } catch (err: any) {
        imagesFailed = true;
        console.error('[IssueReport] 사진 DM 전송 실패(신고는 계속)', { status: err?.response?.status, message: err?.message });
      }
    }
    const attachNote = objectNames.length
      ? (dmConversationId ? `\n(사진 ${objectNames.length}장 첨부 — DM 대화에서 확인)` : `\n(사진 ${objectNames.length}장 첨부 시도 — 전송 실패)`)
      : '';
    const payload = buildIssuePayload({
      reason,
      text: (normalized + attachNote).slice(0, ISSUE_TEXT_MAX),
      appVersion: Constants.expoConfig?.version || '1.0.0',
      platform: Platform.OS,
      pageUrl: currentPageUrl(),
      recentPages: getRecentPages(),
    });
    console.info('[IssueReport] 접수 시작', {
      reason, text_len: payload.text.length, recent_pages: payload.recent_pages?.length ?? 0, app_version: payload.app_version,
    });
    try {
      const { data } = await api.post('/issues', dmConversationId ? { ...payload, dm_conversation_id: dmConversationId } : payload);
      if (imagesFailed) setImageNotice('사진은 보내지 못했어요. 필요하면 메시지(공식 계정)로 다시 보내주세요.');
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
                {imageNotice ? <AppText style={styles.note}>{imageNotice}</AppText> : null}
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
                {/* v3.308 [IssueAttach] 사진 첨부(어린이 제외 — 서버도 차단) */}
                {!isChild ? (
                  <View style={styles.attachRow}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, alignItems: 'center' }}>
                      {images.map((img) => (
                        <TouchableOpacity
                          key={img.key}
                          onPress={() => { if (img.status === 'failed') { setImages((p) => p.map((i) => (i.key === img.key ? { ...i, status: 'uploading' } : i))); startUpload({ ...img, status: 'uploading' }); } }}
                          activeOpacity={0.8}
                          accessibilityLabel={img.status === 'failed' ? '사진 다시 올리기' : '첨부한 사진'}
                        >
                          <Image source={{ uri: img.localUri }} style={[styles.thumb, img.status !== 'done' && { opacity: 0.5 }]} />
                          {img.status === 'uploading' ? <ActivityIndicator style={styles.thumbSpinner} color={colors.text.primary} /> : null}
                          {img.status === 'failed' ? <Feather name="rotate-ccw" size={16} color={colors.status.error} style={styles.thumbSpinner} /> : null}
                          <TouchableOpacity style={styles.thumbX} onPress={() => setImages((p) => p.filter((i) => i.key !== img.key))} disabled={busy} accessibilityLabel="사진 빼기">
                            <Feather name="x" size={12} color="#fff" />
                          </TouchableOpacity>
                        </TouchableOpacity>
                      ))}
                      {images.length < ISSUE_MAX_IMAGES ? (
                        <TouchableOpacity style={styles.addImage} onPress={() => { void pickImages(); }} disabled={busy} accessibilityLabel="사진 첨부">
                          <Feather name="image" size={18} color={colors.text.secondary} />
                          <AppText style={styles.addImageText}>{`사진 ${images.length}/${ISSUE_MAX_IMAGES}`}</AppText>
                        </TouchableOpacity>
                      ) : null}
                    </ScrollView>
                  </View>
                ) : null}
                {imageNotice ? <AppText style={styles.note}>{imageNotice}</AppText> : null}
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
  // v3.308 [IssueAttach]
  attachRow: { marginTop: 4, marginBottom: 8 },
  thumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: colors.bg.surface2 },
  thumbSpinner: { position: 'absolute', top: 20, left: 20 },
  thumbX: { position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center' },
  addImage: {
    width: 64, height: 56, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border.subtle,
    alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  addImageText: { fontSize: 11, color: colors.text.secondary },
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
