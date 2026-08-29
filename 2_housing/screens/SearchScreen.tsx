// [SearchScreen] 곡 검색 + 느낌별 음악(MAIDOL 메인 이식).
// 느낌별 음악 = 작은 아이콘 칩이 가로로 나열(가로 스크롤). 칩 탭 → 해당 느낌 곡 목록.
// 비로그인 사용자가 (검색 시도 | 느낌 칩 탭) 하면 "로그인하고 시작하기" CTA.
// 검색 로딩은 스피너 대신 "최적의 음악을 찾고 있습니다" 멘트.
import { useState, useEffect, useCallback, useRef } from 'react';
import { View, TextInput, FlatList, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import api, { BACKEND_BASE_URL } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { usePlayerStore } from '../stores/playerStore';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { AppText, EmptyState, ScreenLayout } from '../components/ui';
import LoginPrompt from '../components/LoginPrompt';
import TrackRow from '../components/TrackRow';
import TrackActionSheet from '../components/TrackActionSheet';
import PlaylistPickerSheet from '../components/PlaylistPickerSheet';
import { useLikesStore } from '../stores/likesStore';

interface Track {
  id: string;
  title: string;
  artist_name?: string;
  cover_image?: string;
  cover_image_url?: string;
  play_count?: number;
  like_count?: number;
}

// 느낌 카테고리 — 백엔드 고정 10종(운동~잠자기). 칩은 이모지 없이 텍스트만 표시한다.
const CATEGORY_FALLBACK = ['운동', '에너지 충전', '휴식', '출퇴근길', '행복한 기분', '집중', '로맨스', '파티', '슬픔', '잠자기'];

// 결과 제목 문구 — 카테고리명만 덩그러니 두지 않고 상황을 설명한다. (예: 운동 → "운동할 때 듣는 음악")
const CATEGORY_HEADLINE: Record<string, string> = {
  '운동': '운동할 때 듣는 음악',
  '에너지 충전': '에너지가 필요할 때 듣는 음악',
  '휴식': '쉬어갈 때 듣는 음악',
  '출퇴근길': '출퇴근길에 듣는 음악',
  '행복한 기분': '기분 좋을 때 듣는 음악',
  '집중': '집중할 때 듣는 음악',
  '로맨스': '설렐 때 듣는 음악',
  '파티': '신나게 놀 때 듣는 음악',
  '슬픔': '슬플 때 듣는 음악',
  '잠자기': '잠들기 전에 듣는 음악',
};
const categoryHeadline = (cat: string) => CATEGORY_HEADLINE[cat] || `${cat} 할 때 듣는 음악`;

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
  const [actionTrack, setActionTrack] = useState<Track | null>(null); // ⋮ 더보기 대상
  const [showBulkPicker, setShowBulkPicker] = useState(false); // 결과 전체 담기
  const likedMap = useLikesStore((s) => s.liked);
  const syncLikes = useLikesStore((s) => s.sync);

  // 로그인되면 게이트 해제
  useEffect(() => { if (user) setGated(false); }, [user]);

  // 결과가 바뀌면 좋아요 상태 동기화(차트와 동일하게 하트 수치 표시)
  useEffect(() => {
    if (user && results.length) syncLikes(results.map((t) => t.id));
  }, [results, user, syncLikes]);

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
    // v3.91: 검색 결과 클릭 로깅(CTR 측정) — POST /tracks/search/click { q, track_id }
    // (backend tracks.py:503 SearchClickBody — position 필드 없음, 인증 optional, best-effort)
    // fire-and-forget: 실패해도 재생 흐름에 영향 없도록 무음 처리
    const q = query.trim();
    if (submitted && !activeCategory && q) {
      api.post('/tracks/search/click', { q, track_id: t.id }).catch(() => {});
    }
    const idx = results.findIndex((x) => x.id === t.id);
    playerStore.setQueue(results);
    playerStore.setCurrentIndex(idx >= 0 ? idx : 0);
    navigation.navigate('Player', { track: t });
  };

  const clearAll = () => { setQuery(''); setResults([]); setSubmitted(false); setActiveCategory(null); };

  // 지금 보이는 결과 전체를 플레이리스트에 담기 (로그인 필요)
  const handleAddAllToPlaylist = () => {
    if (!user) { setGated(true); return; }
    if (!results.length) return;
    if (__DEV__) console.info('[SearchScreen] 모두 담기', { count: results.length, category: activeCategory });
    setShowBulkPicker(true);
  };

  // 행 디자인은 차트와 동일한 공용 TrackRow — 순위 개념이 없어 좌측 순번은 비운다
  const renderTrack = ({ item }: { item: Track }) => (
    <TrackRow
      track={item}
      liked={!!likedMap[item.id]}
      onPress={() => handlePress(item)}
      onMore={() => setActionTrack(item)}
    />
  );

  // 느낌 칩 가로 스크롤 바 (섹션 제목·이모지 없이 텍스트 칩만)
  const MoodBar = () => (
    <View style={styles.moodSection}>
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
        // 로그인 CTA는 피드/플레이리스트/작업실과 동일하게 공통 LoginPrompt + 세로 중앙 정렬로 통일
        <View style={styles.loginCta}>
          <LoginPrompt
            desc={'검색 기능은 로그인 후\n이용할 수 있어요'}
            onPress={() => navigation.navigate('Settings')}
          />
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
          ListHeaderComponent={
            <View style={styles.resultHead}>
              <AppText variant="title3" style={styles.resultHeadText} numberOfLines={2}>
                {activeCategory ? categoryHeadline(activeCategory) : `'${query.trim()}' 검색 결과`}
              </AppText>
              {/* 결과 전체를 한 번에 플레이리스트로 */}
              <TouchableOpacity style={styles.bulkBtn} onPress={handleAddAllToPlaylist} accessibilityLabel="모두 담기">
                <Feather name="bookmark" size={14} color={colors.accent.primary} />
                <AppText variant="footnote" tone="accent">모두 담기</AppText>
              </TouchableOpacity>
            </View>
          }
        />
      ) : submitted ? (
        <EmptyState icon="🔍" title="결과가 없습니다" hint="다른 검색어/느낌으로 시도해보세요" />
      ) : (
        <EmptyState icon="🎵" title="느낌을 선택하거나 검색해보세요" hint="위의 느낌을 눌러보세요" />
      )}

      {/* 결과 전체 담기 — 공용 플레이리스트 시트 */}
      <PlaylistPickerSheet
        visible={showBulkPicker}
        trackIds={results.map((t) => t.id)}
        onClose={() => setShowBulkPicker(false)}
      />

      {/* 곡 더보기(⋮) — 차트와 동일한 공용 액션 시트 */}
      <TrackActionSheet
        track={actionTrack}
        onClose={() => setActionTrack(null)}
        onPlay={(t) => handlePress(t as Track)}
        onLikeChanged={(trackId, delta) => setResults((prev) => prev.map((t) => t.id === trackId
          ? { ...t, like_count: Math.max(0, (t.like_count ?? 0) + delta) }
          : t))}
      />
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
  moodBar: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  moodChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: colors.bg.surface1, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  moodChipActive: { borderColor: colors.accent.primary, backgroundColor: colors.bg.surface2 },
  loadingWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.huge },
  resultHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm,
  },
  resultHeadText: { flex: 1 },
  bulkBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.accent.primary,
  },
  loginCta: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
