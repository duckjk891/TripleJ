// [SearchScreen] 곡 검색 + 느낌별 음악(MAIDOL 메인 이식).
// 느낌별 음악 = 작은 아이콘 칩이 가로로 나열(가로 스크롤). 칩 탭 → 해당 느낌 곡 목록.
// 비로그인 사용자가 (검색 시도 | 느낌 칩 탭) 하면 "로그인하고 시작하기" CTA.
// 검색 로딩은 스피너 대신 "최적의 음악을 찾고 있습니다" 멘트.
import { useState, useEffect, useCallback, useRef } from 'react';
import { View, TextInput, FlatList, ScrollView, TouchableOpacity, Image, StyleSheet } from 'react-native';
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
  const [gated, setGated] = useState(false);
  const [categories, setCategories] = useState<string[]>(CATEGORY_FALLBACK);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  // 로그인되면 게이트 해제
  useEffect(() => { if (user) setGated(false); }, [user]);

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

  // 비로그인 → 로그인 CTA 노출(true 반환 시 차단)
  const blockIfGuest = (): boolean => {
    if (!user) {
      if (__DEV__) console.info('[SearchScreen] 미로그인 게이트');
      setGated(true);
      return true;
    }
    return false;
  };

  const handleSearch = async (q: string) => {
    if (blockIfGuest()) return;
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

  // 카테고리(느낌) 곡 로드 — 게이트 없음(디폴트 노출/실제 선택 공용)
  const loadCategory = useCallback(async (cat: string) => {
    if (__DEV__) console.info('[SearchScreen] getCategoryChart', { cat });
    setActiveCategory(cat);
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
  }, []);

  // 느낌 칩 탭 — 비로그인은 게이트, 로그인은 로드
  const handleSelectCategory = (cat: string) => {
    if (!useAuthStore.getState().user) { setGated(true); return; }
    loadCategory(cat);
  };

  // 기본: 첫 카테고리(운동)를 디폴트 선택 + 곡 로드 (검색 전 빈 화면 방지)
  const didDefault = useRef(false);
  useEffect(() => {
    if (didDefault.current || !categories.length) return;
    if (query || activeCategory || submitted) return;
    didDefault.current = true;
    loadCategory(categories[0]);
  }, [categories, query, activeCategory, submitted, loadCategory]);

  const handlePress = (t: Track) => {
    const idx = results.findIndex((x) => x.id === t.id);
    playerStore.setQueue(results);
    playerStore.setCurrentIndex(idx >= 0 ? idx : 0);
    navigation.navigate('Player', { track: t });
  };

  const clearAll = () => { setQuery(''); setResults([]); setSubmitted(false); setActiveCategory(null); };

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

  // 느낌별 음악 — 작은 칩 가로 스크롤 바
  const MoodBar = () => (
    <View style={styles.moodSection}>
      <AppText variant="footnote" tone="secondary" style={styles.moodTitle}>느낌별 음악</AppText>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.moodBar}
        keyboardShouldPersistTaps="handled"
      >
        {categories.map((cat) => {
          const active = activeCategory === cat;
          return (
            <TouchableOpacity
              key={cat}
              style={[styles.moodChip, active && styles.moodChipActive]}
              activeOpacity={0.8}
              onPress={() => handleSelectCategory(cat)}
              accessibilityLabel={`느낌별 ${cat}`}
            >
              <AppText variant="footnote">{CATEGORY_EMOJI[cat] || '🎵'}</AppText>
              <AppText variant="footnote" tone={active ? 'accent' : 'primary'} numberOfLines={1}>{cat}</AppText>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );

  return (
    <ScreenLayout>
      <View style={styles.searchBar}>
        <Feather name="search" size={18} color={colors.text.muted} />
        <TextInput
          style={styles.input}
          placeholder="곡 제목, 아티스트, 태그 검색"
          placeholderTextColor={colors.text.muted}
          value={query}
          onChangeText={(v) => { if (!user) { setGated(true); return; } setQuery(v); }}
          onFocus={() => { if (!user) setGated(true); }}
          onSubmitEditing={() => handleSearch(query)}
          returnKeyType="search"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={clearAll} accessibilityLabel="지우기">
            <Feather name="x" size={18} color={colors.text.secondary} />
          </TouchableOpacity>
        )}
      </View>

      {/* 느낌별 음악 가로 칩 바 (항상 노출) */}
      <MoodBar />

      {gated ? (
        <View style={styles.loginCta}>
          <AppText variant="body" tone="secondary" center style={styles.loginHint}>
            검색 기능은 로그인 후{'\n'}이용할 수 있어요
          </AppText>
          <Button label="로그인하고 시작하기" onPress={() => navigation.navigate('Settings')} />
        </View>
      ) : loading ? (
        <View style={styles.loadingWrap}>
          <AppText variant="title3">🎧</AppText>
          <AppText variant="body" tone="secondary" center style={{ marginTop: spacing.sm }}>
            최적의 음악을 찾고 있습니다…
          </AppText>
        </View>
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
        <EmptyState icon="🔍" title="결과가 없습니다" hint="다른 검색어/느낌으로 시도해보세요" />
      ) : (
        <EmptyState icon="🎵" title="느낌을 선택하거나 검색해보세요" hint="위의 느낌별 음악을 눌러보세요" />
      )}
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    margin: spacing.lg, marginBottom: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: colors.bg.surface1, borderRadius: radius.md,
  },
  input: { flex: 1, color: colors.text.primary, fontSize: 14, paddingVertical: 4 },
  moodSection: { marginBottom: spacing.sm },
  moodTitle: { marginLeft: spacing.lg, marginBottom: spacing.xs },
  moodBar: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  moodChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: colors.bg.surface1, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  moodChipActive: { borderColor: colors.accent.primary, backgroundColor: colors.bg.surface2 },
  loadingWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.huge },
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
});
