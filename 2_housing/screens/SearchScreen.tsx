// [SearchScreen] 곡 검색 전용 페이지 — /tracks/search (기존 차트 헤더 검색을 페이지로 승격).
// 아이콘: MAIDOL과 동일한 Feather(@expo/vector-icons).
import { useState } from 'react';
import { View, TextInput, FlatList, TouchableOpacity, Image, ActivityIndicator, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import api, { BACKEND_BASE_URL } from '../services/api';
import { usePlayerStore } from '../stores/playerStore';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { AppText, EmptyState, ScreenLayout } from '../components/ui';

interface Track {
  id: string;
  title: string;
  artist_name?: string;
  cover_image?: string;
  cover_image_url?: string;
}

export default function SearchScreen() {
  const navigation = useNavigation<any>();
  const playerStore = usePlayerStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSearch = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    if (__DEV__) console.info('[SearchScreen] handleSearch', { q: trimmed });
    setLoading(true);
    setSubmitted(true);
    try {
      const res = await api.get('/tracks/search', { params: { q: trimmed, limit: 50 } });
      setResults(res.data?.tracks || []);
    } catch (err: any) {
      console.error('[SearchScreen] 검색 실패', { status: err?.response?.status });
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const getCoverUri = (t: Track): string | null => {
    const img = t.cover_image || t.cover_image_url;
    return img ? `${BACKEND_BASE_URL}/api/upload/cover-preview/${encodeURIComponent(img)}` : null;
  };

  const handlePress = (t: Track) => {
    const idx = results.findIndex((x) => x.id === t.id);
    playerStore.setQueue(results);
    playerStore.setCurrentIndex(idx >= 0 ? idx : 0);
    navigation.navigate('Player', { track: t });
  };

  return (
    <ScreenLayout>
      <View style={styles.searchBar}>
        <Feather name="search" size={18} color={colors.text.muted} />
        <TextInput
          style={styles.input}
          placeholder="곡 제목, 아티스트, 태그 검색"
          placeholderTextColor={colors.text.muted}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => handleSearch(query)}
          returnKeyType="search"
          autoFocus
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => { setQuery(''); setResults([]); setSubmitted(false); }} accessibilityLabel="지우기">
            <Feather name="x" size={18} color={colors.text.secondary} />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={colors.accent.primary} style={styles.spinner} />
      ) : results.length > 0 ? (
        <FlatList
          data={results}
          keyExtractor={(it) => it.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const uri = getCoverUri(item);
            return (
              <TouchableOpacity style={styles.row} onPress={() => handlePress(item)} activeOpacity={0.7}>
                {uri ? (
                  <Image source={{ uri }} style={styles.cover} />
                ) : (
                  <View style={[styles.cover, styles.coverPh]}><AppText variant="title3" tone="muted">♪</AppText></View>
                )}
                <View style={styles.info}>
                  <AppText variant="bodyStrong" numberOfLines={1}>{item.title}</AppText>
                  <AppText variant="footnote" tone="secondary" numberOfLines={1}>
                    {item.artist_name || '알 수 없는 아티스트'}
                  </AppText>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      ) : submitted ? (
        <EmptyState icon="🔍" title="검색 결과가 없습니다" hint="다른 검색어로 시도해보세요" />
      ) : (
        <EmptyState icon="🎵" title="곡을 검색해보세요" hint="제목, 아티스트, 태그로 검색 가능" />
      )}
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    margin: spacing.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: colors.bg.surface1, borderRadius: radius.md,
  },
  input: { flex: 1, color: colors.text.primary, fontSize: 14, paddingVertical: 4 },
  spinner: { marginTop: spacing.huge },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  cover: { width: 48, height: 48, borderRadius: radius.md, marginRight: spacing.md },
  coverPh: { backgroundColor: colors.bg.surface1, justifyContent: 'center', alignItems: 'center' },
  info: { flex: 1 },
});
