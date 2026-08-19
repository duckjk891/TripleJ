// [DmInbox] 다이렉트 메시지함 — MAIDOL DmInboxPage 이식(RN).
// 탭: 메시지/요청. 새 메시지: 닉네임 또는 #태그 검색(#태그=추천코드 4자리, 전역 유일 '배틀태그').
// 게이트: 본인인증(is_verified) 회원만 — 미인증은 안내 화면.
import { useState, useCallback, useRef } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { View, FlatList, TouchableOpacity, TextInput, Modal, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import api, { BACKEND_BASE_URL } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { AppText, Avatar, EmptyState, Button } from '../components/ui';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';

export interface DmConversation {
  conversation_id: string;
  peer: { id: string; nickname: string; profile_image?: string | null; code?: string | null };
  last_message_text?: string | null;
  last_sender_id?: string | null;
  last_at?: string | null;
  unread: number;
  status: 'accepted' | 'pending';
  requester_id?: string;
}

const profileUri = (img?: string | null) =>
  img ? `${BACKEND_BASE_URL}/api/auth/profile-image/${img}` : null;

const parseUtc = (iso: string) => new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z');
const fmtTime = (iso?: string | null): string => {
  if (!iso) return '';
  const d = parseUtc(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    : `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
};

export default function DmInboxScreen() {
  const navigation = useNavigation<any>();
  const user = useAuthStore((s) => s.user);
  const [eligible, setEligible] = useState<boolean | null>(null);
  const [tab, setTab] = useState<'messages' | 'requests'>('messages');
  const [convs, setConvs] = useState<DmConversation[]>([]);
  const [requests, setRequests] = useState<DmConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 새 메시지 모달
  const [composeOpen, setComposeOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [myCode, setMyCode] = useState<string | null>(null);
  const debounceRef = useRef<any>(null);

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true); setError('');
    if (__DEV__) console.info('[DmInbox] 목록 조회');
    try {
      const el = await api.get('/dm/eligibility');
      const ok = !!el.data?.is_verified;
      setEligible(ok);
      if (!ok) { setLoading(false); return; }
      const [c, r] = await Promise.all([api.get('/dm/conversations'), api.get('/dm/requests')]);
      setConvs(c.data?.conversations || []);
      setRequests(r.data?.requests || []);
    } catch (err: any) {
      console.error('[DmInbox] 목록 조회 실패', { status: err?.response?.status });
      setError('대화 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openCompose = async () => {
    setComposeOpen(true);
    if (!myCode) {
      try {
        const res = await api.get('/referral/my-code');
        setMyCode(res.data?.referral_code || null);
      } catch (err: any) {
        console.error('[DmInbox] 내 태그 조회 실패', { status: err?.response?.status });
      }
    }
  };

  // 닉네임/#태그 검색 — 300ms 디바운스 (MAIDOL 동일)
  const onQueryChange = (q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults([]); setSearchFailed(false); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true); setSearchFailed(false);
      if (__DEV__) console.info('[DmInbox] 사용자 검색', { qLen: q.length });
      try {
        const res = await api.get('/dm/users/search', { params: { q: q.trim() } });
        setResults(res.data?.users || []);
      } catch (err: any) {
        console.error('[DmInbox] 사용자 검색 실패', { status: err?.response?.status });
        setSearchFailed(true); setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  };

  const startConversation = async (peerId: string) => {
    if (__DEV__) console.info('[DmInbox] 대화 시작', { peerId });
    try {
      const res = await api.post('/dm/conversations', { peer_id: peerId });
      const conv = res.data;
      setComposeOpen(false); setQuery(''); setResults([]);
      navigation.navigate('DmChat', { conversation: conv });
    } catch (err: any) {
      console.error('[DmInbox] 대화 시작 실패', { peerId, status: err?.response?.status });
      setSearchFailed(true);
    }
  };

  const renderConv = ({ item }: { item: DmConversation }) => {
    const mine = item.last_sender_id && user && String(item.last_sender_id) === String(user.id);
    const pendingMine = item.status === 'pending' && item.requester_id && user && String(item.requester_id) === String(user.id);
    return (
      <TouchableOpacity style={styles.convRow} activeOpacity={0.7}
        onPress={() => navigation.navigate('DmChat', { conversation: item })}>
        <Avatar name={item.peer?.nickname || '?'} uri={profileUri(item.peer?.profile_image)} size={44} />
        <View style={{ flex: 1, marginLeft: spacing.md }}>
          <View style={styles.convHead}>
            <AppText variant="bodyStrong" numberOfLines={1}>
              {item.peer?.nickname}
              {item.peer?.code ? <AppText variant="footnote" tone="muted">  #{item.peer.code}</AppText> : null}
            </AppText>
            <AppText variant="caption" tone="muted">{fmtTime(item.last_at)}</AppText>
          </View>
          <AppText variant="footnote" tone="secondary" numberOfLines={1}>
            {pendingMine ? '요청 대기 중' : (item.last_message_text ? `${mine ? '나: ' : ''}${item.last_message_text}` : '대화를 시작해보세요')}
          </AppText>
        </View>
        {item.unread > 0 ? (
          <View style={styles.unreadBadge}><AppText variant="caption" style={styles.unreadText}>{item.unread > 99 ? '99+' : item.unread}</AppText></View>
        ) : null}
      </TouchableOpacity>
    );
  };

  // ── 게이트: 비로그인/미인증 ──
  if (!user || eligible === false) {
    return (
      <View style={styles.gate}>
        <Feather name="mail" size={40} color={colors.text.muted} />
        <AppText variant="title3" center style={{ marginTop: spacing.lg }}>본인인증 후 이용할 수 있어요</AppText>
        <AppText variant="footnote" tone="secondary" center style={{ marginTop: spacing.sm, lineHeight: 20 }}>
          다이렉트 메시지는 본인인증을 완료한 회원만 이용할 수 있습니다.{'\n'}카카오/네이버 로그인 시 자동으로 인증돼요.
        </AppText>
        <View style={{ marginTop: spacing.xl, width: 160 }}>
          <Button label="돌아가기" variant="tonal" fullWidth onPress={() => navigation.goBack()} />
        </View>
      </View>
    );
  }

  const data = tab === 'messages' ? convs : requests;

  return (
    <View style={styles.container}>
      {/* 헤더: 메시지 + 새 메시지 */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="뒤로가기" style={{ padding: 4 }}>
          <Feather name="arrow-left" size={22} color={colors.text.primary} />
        </TouchableOpacity>
        <AppText variant="title3" style={{ flex: 1, marginLeft: spacing.sm }}>메시지</AppText>
        <TouchableOpacity onPress={openCompose} accessibilityLabel="새 메시지" style={{ padding: 4 }}>
          <Feather name="edit" size={20} color={colors.text.primary} />
        </TouchableOpacity>
      </View>

      {/* 탭: 메시지 / 요청 */}
      <View style={styles.tabs}>
        {(['messages', 'requests'] as const).map((t) => (
          <TouchableOpacity key={t} style={[styles.tabBtn, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <AppText variant="footnote" tone={tab === t ? 'accent' : 'secondary'}>
              {t === 'messages' ? '메시지' : `요청${requests.length ? ` ${requests.length > 99 ? '99+' : requests.length}` : ''}`}
            </AppText>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={colors.accent.primary} style={{ marginTop: 60 }} />
      ) : error ? (
        <EmptyState title={error} action={<Button label="다시 시도" variant="tonal" onPress={load} />} />
      ) : data.length === 0 ? (
        <EmptyState title={tab === 'messages' ? '아직 대화가 없습니다.' : '받은 메시지 요청이 없습니다.'} />
      ) : (
        <FlatList data={data} keyExtractor={(it) => it.conversation_id} renderItem={renderConv} />
      )}

      {/* 새 메시지 모달 */}
      <Modal visible={composeOpen} animationType="slide" onRequestClose={() => setComposeOpen(false)}>
        <View style={styles.container}>
          <View style={styles.header}>
            <AppText variant="title3" style={{ flex: 1 }}>새 메시지</AppText>
            <TouchableOpacity onPress={() => setComposeOpen(false)} accessibilityLabel="닫기" style={{ padding: 4 }}>
              <Feather name="x" size={22} color={colors.text.muted} />
            </TouchableOpacity>
          </View>
          <AppText variant="caption" tone="secondary" style={styles.composeHint}>
            닉네임으로 검색해 누구에게나 메시지를 보낼 수 있어요. 상대가 나를 팔로우하지 않으면 메시지 요청으로 전달돼요. 닉네임#태그 또는 #태그로 정확히 찾을 수 있어요.
          </AppText>
          <View style={styles.searchBox}>
            <Feather name="search" size={16} color={colors.text.muted} />
            <TextInput
              style={styles.searchInput}
              placeholder="닉네임 또는 #태그 검색"
              placeholderTextColor={colors.text.muted}
              value={query}
              onChangeText={onQueryChange}
              autoFocus
            />
          </View>
          {searching ? (
            <AppText variant="footnote" tone="muted" style={styles.searchStatus}>검색 중...</AppText>
          ) : searchFailed ? (
            <AppText variant="footnote" tone="muted" style={styles.searchStatus}>검색에 실패했습니다.</AppText>
          ) : query.trim() && !results.length ? (
            <AppText variant="footnote" tone="muted" style={styles.searchStatus}>검색 결과가 없어요.</AppText>
          ) : (
            <FlatList
              data={results}
              keyExtractor={(it) => it.id}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.convRow} onPress={() => startConversation(item.id)}>
                  <Avatar name={item.nickname || '?'} uri={profileUri(item.profile_image)} size={40} />
                  <AppText variant="body" style={{ marginLeft: spacing.md }}>
                    {item.nickname}
                    {item.code ? <AppText variant="footnote" tone="muted">  #{item.code}</AppText> : null}
                  </AppText>
                </TouchableOpacity>
              )}
            />
          )}
          {myCode ? (
            <AppText variant="caption" tone="muted" style={styles.myTag}>내 태그: #{myCode}</AppText>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest, paddingTop: 50 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  tabs: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  tabBtn: { paddingVertical: 6, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border.subtle },
  tabActive: { borderColor: colors.accent.primary, backgroundColor: colors.bg.surface1 },
  convRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  convHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  unreadBadge: {
    minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.accent.primary,
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 5, marginLeft: spacing.sm,
  },
  unreadText: { color: '#fff', fontSize: 11 },
  gate: { flex: 1, backgroundColor: colors.bg.deepest, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  composeHint: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, lineHeight: 18 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    margin: spacing.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: colors.bg.surface1, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border.subtle,
  },
  searchInput: { flex: 1, color: colors.text.primary, padding: 0 },
  searchStatus: { paddingHorizontal: spacing.lg },
  myTag: { padding: spacing.lg, textAlign: 'center' },
});
