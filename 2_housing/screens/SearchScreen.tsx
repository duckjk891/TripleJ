// [SearchScreen] 곡 검색 + 느낌별 음악(MAIDOL 메인 이식).
// 기본 화면(검색 전)=느낌별 음악 카테고리(운동~잠자기, GET /charts/categories → 탭 시 /charts/category/{name}).
// 비로그인 사용자가 검색을 시작(입력창 포커스)하면 "로그인하고 시작하기" CTA.
import { useState, useEffect, useCallback } from 'react';
import { View, TextInput, FlatList, ScrollView, TouchableOpacity, Image, ActivityIndicator, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import api, { BACKEND_BASE_URL } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { usePlayerStore } from '../stores/playerStore';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { AppText, EmptyState, ScreenLayout, Button } from '../components/ui';

interface Track {
  id: string;
  title: string;
  artist_name?: string;
  cover_image?: string;
  cover_image_url?: string;
}

// 느낌별 음악 — 백엔드 고정 카테고리 10종(운동~잠자기)에 표시용 이모지 매핑.
const CATEGORY_EMOJI: Record<string, string> = {
  '운동': '🏃', '에너지 충전': '⚡', '휴식': '🛋️', '출퇴근길': '🚇', '행복한 기분': '😊',
  '집중': '🎯', '로맨스': '💕', '파티': '🎉', '슬픔': '😢', '잠자기': '😴',
};
const CATEGORY_FALLBACK = ['운동', '에너지 충전', '휴식', '출퇴근길', '행복한 기분', '집중', '로맨스', '파티', '슬픔', '잠자기'];

export default function SearchScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuthStore();
  const playerStore = usePlayerStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [focused, setFocused] = useState(false);
  const [categories, setCategories] = useState<string[]>(CATEGORY_FALLBACK);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  // 카테고리 목록 로드
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/charts/categories');
        const list = Array.isArray(res.data?.categories) ? res.data.categories : [];
        if (list.length) setCategories(list);
      } catch (err: any) {
        console.error('[SearchScreen] categories 실패', { status: err?.response?.status });
      }
    })();
  }, []);

  const getCoverUri = (t: Track): string | null => {
    const img = t.cover_image || t.cover_image_url;
    return img ? `${BACKEND_BASE_URL}/api/upload/cover-preview/${encodeURIComponent(img)}` : null;
  };

  const handleSearch = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    if (__DEV__) console.info('[SearchScreen] handleSearch', { q: trimmed });
    setActiveCategory(null);
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

  const handleSelectCategory = useCallback(async (cat: string) => {
    if (activeCategory === cat) { setActiveCategory(null); setResults([]); setSubmitted(false); return; }
    if (__DEV__) console.info('[SearchScreen] getCategoryChart', { cat });
    setActiveCategory(cat);
    setSubmitted(true);
    setLoading(true);
    try {
      const res = await api.get(`/charts/category/${encodeURIComponent(cat)}`, { params: { limit: 50 } });
      setResults(Array.isArray(res.data) ? res.data : (res.data?.tracks || []));
    } catch (err: any) {
      console.error('[SearchScreen] category 실패', { status: err?.response?.status, cat });
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [activeCategory]);

  const handlePress = (t: Track) => {
    const idx = results.findIndex((x) => x.id === t.id);
    playerStore.setQueue(results);
    playerStore.setCurrentIndex(idx >= 0 ? idx : 0);
    navigation.navigate('Player', { track: t });
  };

  const clearAll = () => { setQuery(''); setResults([]); setSubmitted(false); setActiveCategory(null); };

  // 비로그인 사용자가 검색을 시작(입력창 포커스/입력)하면 로그인 유도
  const searchGated = !user && (focused || query.length > 0);

  const renderTrack = ({ item }: { item: Track }) => {
    const uri = getCoverUri(item);
    return (
      <TouchableOpacity style={styles.row} onPress={() => handlePress(item)} activeOpacity={0.7}>
        {uri ? <Image source={{ uri }} style={styles.cover} />
          : <View style={[styles.cover, styles.coverPh]}><AppText variant="title3" tone="muted">♪</AppText></View>}
        <View style={styles.info}>
          <AppText variant="bodyStrong" numberOfLines={1}>{item.title}</AppText>
          <AppText variant="footnote" tone="secondary" numberOfLines={1}>{item.artist_name || '알 수 없는 아티스트'}</AppText>
        </View>
        <Feather name="play-circle" size={22} color={colors.accent.primary} />
      </TouchableOpacity>
    );
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
          onFocus={() => { setFocused(true); if (!user && __DEV__) console.info('[SearchScreen] 미로그인 검색 시도'); }}
          onBlur={() => setFocused(false)}
          onSubmitEditing={() => !searchGated && handleSearch(query)}
          returnKeyType="search"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={clearAll} accessibilityLabel="지우기">
            <Feather name="x" size={18} color={colors.text.secondary} />
          </TouchableOpacity>
        )}
      </View>

      {searchGated ? (
        <View style={styles.loginCta}>
          <AppText variant="body" tone="secondary" center style={styles.loginHint}>
            검색은 로그인 후 이용할 수 있어요
          </AppText>
          <Button label="로그인하고 시작하기" onPress={() => navigation.navigate('Settings')} />
        </View>
      ) : loading ? (
        <ActivityIndicator size="large" color={colors.accent.primary} style={styles.spinner} />
      ) : results.length > 0 ? (
        <FlatList
          data={results}
          keyExtractor={(it) => it.id}
          keyboardShouldPersistTaps="handled"
          renderItem={renderTrack}
          ListHeaderComponent={activeCategory ? (
            <AppText variant="title3" style={styles.resultHead}>{CATEGORY_EMOJI[activeCategory] || '🎵'} {activeCategory}</AppText>
          ) : null}
        />
      ) : submitted ? (
        <EmptyState icon="🔍" title="결과가 없습니다" hint="다른 검색어/카테고리로 시도해보세요" />
      ) : (
        // 기본: 느낌별 음악
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.moodWrap}>
          <AppText variant="title3" style={styles.moodTitle}>느낌별 음악</AppText>
          <View style={styles.moodGrid}>
            {categories.map((cat) => (
              <TouchableOpacity key={cat} style={styles.moodChip} activeOpacity={0.8} onPress={() => handleSelectCategory(cat)} accessibilityLabel={`느낌별 ${cat}`}>
                <AppText variant="title2">{CATEGORY_EMOJI[cat] || '🎵'}</AppText>
                <AppText variant="footnote" numberOfLines={1}>{cat}</AppText>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
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
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  cover: { width: 48, height: 48, borderRadius: radius.md },
  coverPh: { backgroundColor: colors.bg.surface1, justifyContent: 'center', alignItems: 'center' },
  info: { flex: 1 },
  resultHead: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  loginCta: { alignItems: 'center', paddingVertical: spacing.huge, paddingHorizontal: spacing.lg, gap: spacing.lg },
  loginHint: { lineHeight: 20 },
  moodWrap: { padding: spacing.lg },
  moodTitle: { marginBottom: spacing.md },
  moodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'space-between' },
  moodChip: {
    width: '31%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.bg.surface1, borderRadius: radius.lg, marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
});
