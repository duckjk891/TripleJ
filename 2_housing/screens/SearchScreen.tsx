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
import TutorialOverlay, { TutorialStep } from '../components/TutorialOverlay';
import { useLikesStore } from '../stores/likesStore';
// v3.207 ①: 코치마크 anchor — 검색바 스포트라이트(결과 ⋮는 TrackRow prop 경유)
import { measureAndRegister, unregisterAnchor } from '../utils/tutorialAnchors';
// v3.231 A4·A5: 로맨스 포커싱(칩 순서·기본 선택)·느낌 이름 검색 바로 가기 — 순수 로직
import { MOOD_CATEGORY_FALLBACK, orderMoodChips, pickDefaultMood, matchMoodQuery } from '../utils/searchMood';

// v3.204 ⑥ → v3.213: 사용자 확정 문안 1스텝(검색바) — 로그인 시에만 노출(enabled=!!user).
// search-row-more 스텝은 v3.213에서 사용 철회.
const TUTORIAL_STEPS: TutorialStep[] = [
  { title: '곡 검색', desc: '검색하여 나에게 딱 맞는 곡을 찾아보세요.', anchorKey: 'search-input', placement: 'below' },
];

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
// v3.231 A4: 표시 순서는 로맨스가 맨 앞(서버 순서는 불변, 앱에서만 재정렬 — 폴백도 동일 규칙)
const CATEGORY_FALLBACK = orderMoodChips(MOOD_CATEGORY_FALLBACK);

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
  // v3.207 ①: 검색바 코치마크 anchor — onLayout 시 창 좌표 등록, unmount 시 해제
  const searchBarRef = useRef<View>(null);
  useEffect(() => () => unregisterAnchor('search-input'), []);
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
        // v3.231 A4: 서버 목록 → 로맨스 맨 앞으로 재정렬(유효 항목 없으면 폴백 유지)
        if (list.length) setCategories(orderMoodChips(list));
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
    setSubmitted(true);
    // v3.231 A5: 느낌 이름과 정확히 같은 검색어 → 해당 느낌 목록(서버 카테고리 색인 배포 전에도 0건 해소).
    // 그 느낌 곡이 0건이거나 불러오기 실패면 아래 일반 검색으로 이어간다(기존 검색 결과 회귀 방지).
    const mood = matchMoodQuery(trimmed, categories);
    if (mood) {
      if (__DEV__) console.info('[SearchScreen] 느낌 검색 바로 가기', { mood });
      const count = await loadCategory(mood);
      if (count && count > 0) return;
      if (__DEV__) console.info('[SearchScreen] 느낌 검색 바로 가기 → 일반 검색', { mood, count });
    }
    setActiveCategory(null);
    setLoading(true);
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
  // v3.231 A5: 불러온 곡 수 반환(실패 = null) — 느낌 검색 바로 가기의 일반 검색 이어가기 판단용
  const loadCategory = useCallback(async (cat: string): Promise<number | null> => {
    if (__DEV__) console.info('[SearchScreen] getCategoryChart', { cat });
    setActiveCategory(cat);
    setLoading(true);
    try {
      const res = await api.get(`/charts/category/${encodeURIComponent(cat)}`, { params: { limit: 50 } });
      const list: Track[] = Array.isArray(res.data) ? res.data : (res.data?.tracks || []);
      setResults(list);
      return list.length;
    } catch (err: any) {
      console.error('[SearchScreen] category 실패', { status: err?.response?.status, cat });
      setResults([]);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // 느낌 칩 탭 — 비로그인은 게이트, 로그인은 로드
  const handleSelectCategory = (cat: string) => {
    if (!useAuthStore.getState().user) { setGated(true); return; }
    loadCategory(cat);
  };

  // 기본: 로맨스를 디폴트 선택 + 곡 로드 (검색 전 빈 화면 방지)
  // v3.231 A4: 첫 칩(운동) → 로맨스(목록에 없으면 첫 칩). 비로그인도 기본 목록 노출은 현행 유지.
  const didDefault = useRef(false);
  useEffect(() => {
    if (didDefault.current || !categories.length) return;
    if (query || activeCategory || submitted) return;
    const def = pickDefaultMood(categories);
    if (!def) return;
    didDefault.current = true;
    if (__DEV__) console.info(`[SearchScreen] 기본 느낌=${def}`);
    loadCategory(def);
  }, [categories, query, activeCategory, submitted, loadCategory]);

  const handlePress = (t: Track) => {
    // v3.91: 검색 결과 클릭 로깅(CTR 측정) — POST /tracks/search/click { q, track_id }
    // (backend tracks.py:503 SearchClickBody — position 필드 없음, 인증 optional, best-effort)
    // fire-and-forget: 실패해도 재생 흐름에 영향 없도록 무음 처리
    const q = query.trim();
    if (submitted && !activeCategory && q) {
      api.post('/tracks/search/click', { q, track_id: t.id }).catch(() => {});
    }
    // v3.223 E-3: 곡 탭 = append(차트 곡 탭 관행 1:1) — results 통째 setQueue 교체 제거(재생목록 보존)
    playerStore.addToQueue(t);
    const queueNow = usePlayerStore.getState().queue;
    const idx = queueNow.findIndex((x: any) => String(x?.id) === String(t.id));
    playerStore.setCurrentIndex(idx >= 0 ? idx : queueNow.length - 1);
    if (__DEV__) console.info('[SearchScreen] 곡 탭 → 큐 추가+재생', { id: t.id, idx, queueLen: queueNow.length });
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
  // (v3.213: search-row-more anchor 등록 철회 — 해당 스텝 폐지)
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
      <View
        ref={searchBarRef}
        onLayout={() => measureAndRegister('search-input', searchBarRef.current)}
        style={styles.searchBar}
      >
        <Feather name="search" size={18} color={colors.text.muted} />
        <TextInput
          style={styles.input}
          placeholder="곡 제목, 아티스트, 장르 검색 (예: 로맨스)"
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
        // v3.193: 로그인 CTA = 작업실(MapScreen loginOverlay)과 동일한 absoluteFill 딤 오버레이 + 정중앙.
        // 배경 탭 = 게이트 해제.
        <TouchableOpacity
          style={styles.loginOverlay}
          activeOpacity={1}
          onPress={() => setGated(false)}
        >
          <LoginPrompt
            title="AI 음악 검색"
            desc={'검색 기능은 로그인 후\n이용할 수 있어요'}
            onPress={() => navigation.navigate('Settings')}
          />
        </TouchableOpacity>
      ) : loading ? (
        <View style={styles.loadingWrap}>
          <Feather name="headphones" size={28} color={colors.text.secondary} />
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
        <EmptyState icon={<Feather name="search" size={44} color={colors.text.muted} />} title="결과가 없습니다" hint="다른 검색어/느낌으로 시도해보세요" />
      ) : (
        <EmptyState icon={<Feather name="music" size={44} color={colors.text.muted} />} title="느낌을 선택하거나 검색해보세요" hint="위의 느낌을 눌러보세요" />
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

      {/* v3.204 ⑥ → v3.213: 검색 튜토리얼 — 로그인 시에만(검색이 로그인 게이트라 정합) */}
      <TutorialOverlay screenKey="search" steps={TUTORIAL_STEPS} enabled={!!user} />
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
  // v3.193: 작업실(MapScreen)의 loginOverlay와 동일 스펙 — 화면 전체 딤 + 정중앙 CTA
  loginOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
