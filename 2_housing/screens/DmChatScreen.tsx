// [DmChat] DM 대화방 — MAIDOL DmChatView 이식(RN).
// 말풍선 스레드 + 입력(Enter 전송, 2000자) + 메시지 요청 수락/거절/차단 바 + ⋯ 차단하기 + 상대 메시지 신고.
// 갱신: 화면 포커스 중 8초 폴링(모바일 관용 — MAIDOL은 WS+30s 폴링, WS는 후속).
import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { View, FlatList, TouchableOpacity, TextInput, Alert, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import api, { BACKEND_BASE_URL } from '../services/api';
import { dmSocketSubscribe } from '../services/dmSocket';
import { useAuthStore } from '../stores/authStore';
import { AppText, Avatar } from '../components/ui';
import ReportModal from '../components/ReportModal';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';

interface DmMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  text: string;
  created_at: string;
  read?: boolean;
}

// 서버 시각은 타임존 표기 없는 UTC — 'Z' 보정
const parseUtc = (iso: string) => new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z');
const fmtClock = (iso: string) => {
  const d = parseUtc(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default function DmChatScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const user = useAuthStore((s) => s.user);
  const [conv, setConv] = useState<any>(route.params?.conversation);
  const cid = conv?.conversation_id;
  const peer = conv?.peer || {};
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportMsg, setReportMsg] = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);

  const isPendingReceived = conv?.status === 'pending' && user && String(conv?.requester_id) !== String(user.id);
  const isPendingSent = conv?.status === 'pending' && user && String(conv?.requester_id) === String(user.id);

  const load = useCallback(async () => {
    if (!cid) return;
    if (__DEV__) console.info('[DmChat] 메시지 조회', { cid });
    try {
      const res = await api.get(`/dm/conversations/${cid}/messages`, { params: { limit: 100 } });
      const list: DmMessage[] = (res.data?.messages || []).slice().reverse(); // 서버 desc → 화면 asc
      setMessages(list);
      // 수신 pending이 아닐 때만 읽음 처리(백엔드도 pending은 no-op)
      api.post(`/dm/conversations/${cid}/read`).catch(() => {});
    } catch (err: any) {
      console.error('[DmChat] 메시지 조회 실패', { cid, status: err?.response?.status });
    } finally {
      setLoading(false);
    }
  }, [cid]);

  // 포커스 중 8초 폴링 + WS 이벤트 즉시 반영
  useFocusEffect(useCallback(() => {
    load();
    const t = setInterval(load, 8000);
    const unsub = dmSocketSubscribe((ev) => {
      if (ev.type === 'message' || ev.type === 'read' || ev.type === 'accepted') load();
    });
    return () => { clearInterval(t); unsub(); };
  }, [load]));

  useEffect(() => {
    // 새 메시지 도착 시 하단으로
    if (messages.length) setTimeout(() => listRef.current?.scrollToEnd?.({ animated: false }), 80);
  }, [messages.length]);

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    if (__DEV__) console.info('[DmChat] 전송', { cid, len: t.length });
    try {
      const res = await api.post(`/dm/conversations/${cid}/messages`, { text: t });
      const m = res.data?.message;
      if (m) setMessages((prev) => [...prev, m]);
      setText('');
    } catch (err: any) {
      const status = err?.response?.status;
      console.error('[DmChat] 전송 실패', { cid, status });
      Alert.alert('알림', err?.response?.data?.detail || err?.response?.data?.error || '메시지를 보낼 수 없습니다.');
    } finally {
      setSending(false);
    }
  };

  const accept = async () => {
    try {
      const res = await api.post(`/dm/conversations/${cid}/accept`);
      setConv(res.data?.conversation || { ...conv, status: 'accepted' });
    } catch (err: any) {
      console.error('[DmChat] 수락 실패', { cid, status: err?.response?.status });
    }
  };

  const decline = () => {
    Alert.alert('요청 거절', '요청을 거절하면 대화가 삭제됩니다. 신고가 필요하면 거절 전에 해주세요. 차단하지 않으면 다시 요청이 올 수 있어요.', [
      { text: '취소', style: 'cancel' },
      { text: '거절', style: 'destructive', onPress: async () => {
        try { await api.delete(`/dm/conversations/${cid}`); navigation.goBack(); }
        catch (err: any) { console.error('[DmChat] 거절 실패', { cid, status: err?.response?.status }); }
      } },
    ]);
  };

  const block = () => {
    Alert.alert('차단', `${peer.nickname}님을 차단할까요? 서로 메시지를 주고받을 수 없게 됩니다.`, [
      { text: '취소', style: 'cancel' },
      { text: '차단', style: 'destructive', onPress: async () => {
        try {
          await api.post(`/dm/blocks/${peer.id}`);
          if (isPendingReceived) await api.delete(`/dm/conversations/${cid}`).catch(() => {});
          Alert.alert('완료', '차단했습니다.');
          navigation.goBack();
        } catch (err: any) { console.error('[DmChat] 차단 실패', { status: err?.response?.status }); }
      } },
    ]);
  };

  const renderMsg = ({ item }: { item: DmMessage }) => {
    const mine = user && String(item.sender_id) === String(user.id);
    return (
      <View style={[styles.msgRow, mine ? styles.msgRowMine : styles.msgRowPeer]}>
        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubblePeer]}>
          <AppText variant="footnote" style={mine ? styles.textMine : undefined}>{item.text}</AppText>
        </View>
        <View style={styles.msgMeta}>
          <AppText variant="caption" tone="muted">{fmtClock(item.created_at)}</AppText>
          {!mine ? (
            <TouchableOpacity onPress={() => setReportMsg(item.id)} accessibilityLabel="메시지 신고">
              <AppText variant="caption" tone="muted"> · 신고</AppText>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* 헤더 */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="목록으로" style={{ padding: 4 }}>
          <Feather name="arrow-left" size={22} color={colors.text.primary} />
        </TouchableOpacity>
        <Avatar name={peer.nickname || '?'} uri={peer.profile_image ? `${BACKEND_BASE_URL}/api/auth/profile-image/${peer.profile_image}` : null} size={32} />
        <AppText variant="bodyStrong" style={{ flex: 1, marginLeft: spacing.sm }} numberOfLines={1}>
          {peer.nickname}
          {peer.code ? <AppText variant="footnote" tone="muted">  #{peer.code}</AppText> : null}
        </AppText>
        <TouchableOpacity onPress={() => setMenuOpen((v) => !v)} accessibilityLabel="더보기" style={{ padding: 4 }}>
          <Feather name="more-vertical" size={20} color={colors.text.muted} />
        </TouchableOpacity>
      </View>
      {menuOpen ? (
        <TouchableOpacity style={styles.menu} onPress={() => { setMenuOpen(false); block(); }}>
          <Feather name="slash" size={15} color={colors.status.error} />
          <AppText variant="footnote" style={{ color: colors.status.error }}>차단하기</AppText>
        </TouchableOpacity>
      ) : null}

      {/* 수신 요청 바 */}
      {isPendingReceived ? (
        <View style={styles.requestBar}>
          <AppText variant="caption" tone="secondary" style={{ flex: 1 }}>
            메시지 요청 — 수락하기 전까지 상대에게 읽음이 표시되지 않아요.
          </AppText>
          <TouchableOpacity style={styles.reqBtn} onPress={accept}><AppText variant="caption" tone="accent">수락</AppText></TouchableOpacity>
          <TouchableOpacity style={styles.reqBtn} onPress={decline}><AppText variant="caption" tone="secondary">거절</AppText></TouchableOpacity>
          <TouchableOpacity style={styles.reqBtn} onPress={block}><AppText variant="caption" style={{ color: colors.status.error }}>차단</AppText></TouchableOpacity>
        </View>
      ) : null}

      {/* 메시지 목록 */}
      {loading ? (
        <ActivityIndicator size="large" color={colors.accent.primary} style={{ marginTop: 60 }} />
      ) : messages.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <AppText variant="footnote" tone="muted" center>아직 주고받은 메시지가 없습니다.{'\n'}첫 메시지를 보내보세요.</AppText>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderMsg}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl }}
          style={{ flex: 1 }}
        />
      )}

      {/* 발신자 pending 안내 */}
      {isPendingSent ? (
        <AppText variant="caption" tone="muted" center style={{ marginBottom: spacing.xs }}>
          요청 대기 중 — 상대가 수락하면 대화가 시작돼요.
        </AppText>
      ) : null}

      {/* 입력바 — 수신 pending은 수락 전 답장 불가(백엔드 403과 일치) */}
      {!isPendingReceived ? (
        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            placeholder="메시지 입력..."
            placeholderTextColor={colors.text.muted}
            value={text}
            onChangeText={setText}
            maxLength={2000}
            multiline
          />
          <TouchableOpacity onPress={send} disabled={sending || !text.trim()} accessibilityLabel="보내기" style={{ padding: 6 }}>
            <Feather name="send" size={20} color={text.trim() ? colors.accent.primary : colors.text.muted} />
          </TouchableOpacity>
        </View>
      ) : null}

      <ReportModal visible={!!reportMsg} targetType="dm_message" targetId={String(reportMsg || '')} onClose={() => setReportMsg(null)} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest, paddingTop: 50 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  menu: {
    alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.bg.surface2, borderRadius: radius.md,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md, margin: spacing.sm,
  },
  requestBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.bg.surface1, padding: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  reqBtn: { paddingVertical: 4, paddingHorizontal: spacing.sm },
  msgRow: { marginBottom: spacing.md, maxWidth: '80%' },
  msgRowMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  msgRowPeer: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: { borderRadius: radius.lg, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  bubbleMine: { backgroundColor: colors.accent.primary },
  bubblePeer: { backgroundColor: colors.bg.surface1 },
  textMine: { color: '#fff' },
  msgMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm,
    margin: spacing.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: colors.bg.surface1, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  input: { flex: 1, color: colors.text.primary, maxHeight: 100, padding: 0 },
});
