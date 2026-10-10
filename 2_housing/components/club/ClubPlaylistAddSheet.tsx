// [ClubPlaylistAddSheet] v3.325 크루 플레이리스트 안에서 바로 곡 추가(대표 10-10: "곡 쪽 ⋮ 메뉴로만 담는 방식은 안 됨").
// 탭 [내 곡](GET /tracks/my) · [곡 검색](GET /tracks/search) → [담기] = POST /playlists/{id}/tracks {track_id}.
// 이미 담긴 곡은 '담김'. 서버 권한(멤버만·남의 비공개 곡 거부)은 그대로 — 거부 사유는 서버 문구로 안내.
import { useEffect, useRef, useState } from 'react';
import { View, Modal, TextInput, TouchableOpacity, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import api from '../../services/api';
import { AppText } from '../ui';
import TrackRow from '../TrackRow';
import { colors } from '../../theme/colors';
import { spacing, radius } from '../../theme/spacing';
import { showAlert } from '../../utils/appAlert';

interface Props {
  visible: boolean;
  playlistId: string | null;
  playlistTitle?: string;
  existingIds: string[];
  onClose: () => void;
  onAdded: () => void;
}

type Tab = 'mine' | 'search';

export default function ClubPlaylistAddSheet({ visible, playlistId, playlistTitle, existingIds, onClose, onAdded }: Props) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('mine');
  const [mine, setMine] = useState<any[] | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const debounceRef = useRef<any>(null);

  useEffect(() => {
    if (!visible) return;
    setAdded(new Set(existingIds.map(String)));
    setQuery(''); setResults([]); setTab('mine');
    if (mine === null) {
      api.get('/tracks/my', { params: { page: 1, limit: 200, sort: 'created_at' } })
        .then((res) => setMine(res.data?.tracks || []))
        .catch((err: any) => {
          console.error('[ClubPlAdd] 내 곡 조회 실패', { status: err?.response?.status });
          setMine([]);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const onQuery = (q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.get('/tracks/search', { params: { q: q.trim(), limit: 50 } });
        setResults(res.data?.tracks || []);
      } catch (err: any) {
        console.error('[ClubPlAdd] 곡 검색 실패', { status: err?.response?.status });
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);
  };

  const addTrack = async (t: any) => {
    const id = String(t.id || t.track_id || '');
    if (!playlistId || !id || busyId || added.has(id)) return;
    setBusyId(id);
    try {
      await api.post(`/playlists/${playlistId}/tracks`, { track_id: id });
      setAdded((prev) => new Set(prev).add(id));
      console.info('[ClubPlAdd] 곡 담기', { playlistId, trackId: id });
      onAdded();
    } catch (err: any) {
      const status = err?.response?.status;
      console.error('[ClubPlAdd] 곡 담기 실패', { playlistId, trackId: id, status });
      if (status === 409) { setAdded((prev) => new Set(prev).add(id)); return; }
      showAlert('알림', err?.response?.data?.error || '곡을 담지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setBusyId(null);
    }
  };

  const data = tab === 'mine' ? (mine || []) : results;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} accessibilityLabel="뒤로" style={{ padding: 4, marginRight: spacing.sm }}>
            <Feather name="arrow-left" size={22} color={colors.text.primary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <AppText variant="subtitle" numberOfLines={1}>곡 추가</AppText>
            {playlistTitle ? <AppText variant="caption" tone="muted" numberOfLines={1}>{playlistTitle}</AppText> : null}
          </View>
        </View>
        <View style={styles.tabs}>
          {(['mine', 'search'] as Tab[]).map((t) => (
            <TouchableOpacity key={t} style={[styles.tabBtn, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
              <AppText variant="footnote" tone={tab === t ? 'accent' : 'secondary'}>{t === 'mine' ? '내 곡' : '곡 검색'}</AppText>
            </TouchableOpacity>
          ))}
        </View>
        {tab === 'search' ? (
          <View style={styles.searchBox}>
            <Feather name="search" size={16} color={colors.text.muted} />
            <TextInput
              style={styles.searchInput}
              placeholder="곡 제목·아티스트 검색"
              placeholderTextColor={colors.text.muted}
              value={query}
              onChangeText={onQuery}
              autoFocus
            />
          </View>
        ) : null}
        {tab === 'mine' && mine === null ? (
          <ActivityIndicator color={colors.accent.primary} style={{ marginTop: spacing.xl }} />
        ) : searching ? (
          <ActivityIndicator color={colors.accent.primary} style={{ marginTop: spacing.xl }} />
        ) : (
          <FlatList
            data={data}
            keyExtractor={(t: any) => String(t.id || t.track_id)}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <AppText variant="footnote" tone="muted" center style={{ marginTop: spacing.xl }}>
                {tab === 'mine' ? '아직 발매한 곡이 없어요.' : query.trim() ? '검색 결과가 없어요.' : '담고 싶은 곡을 검색해 보세요.'}
              </AppText>
            }
            renderItem={({ item }) => {
              const id = String(item.id || item.track_id);
              const isIn = added.has(id);
              return (
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <TrackRow track={{ ...item, id }} onPress={() => addTrack(item)} />
                  </View>
                  <TouchableOpacity
                    style={[styles.addBtn, isIn && styles.addBtnDone]}
                    onPress={() => addTrack(item)}
                    disabled={isIn || busyId === id}
                    accessibilityLabel={isIn ? '담김' : '담기'}
                  >
                    {busyId === id ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <AppText variant="caption" style={{ color: isIn ? colors.text.muted : '#fff', fontWeight: '700' }}>
                        {isIn ? '담김' : '담기'}
                      </AppText>
                    )}
                  </TouchableOpacity>
                </View>
              );
            }}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg.deepest },
  header: {
    flexDirection: 'row', alignItems: 'center', height: 56, paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  tabs: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  tabBtn: { paddingVertical: 6, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border.subtle },
  tabActive: { borderColor: colors.accent.primary, backgroundColor: colors.bg.surface1 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.lg, marginBottom: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: colors.bg.surface1, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border.subtle,
  },
  searchInput: { flex: 1, color: colors.text.primary, padding: 0 },
  row: { flexDirection: 'row', alignItems: 'center', paddingRight: spacing.md },
  addBtn: { minWidth: 52, paddingVertical: 7, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.accent.primary, alignItems: 'center' },
  addBtnDone: { backgroundColor: colors.bg.surface2 },
});
