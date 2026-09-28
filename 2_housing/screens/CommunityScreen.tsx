// [CommunityScreen] v3.245 커뮤니티 Phase 1b — 클럽 목록·내 클럽·개설 진입(클럽 코어 프론트).
// 헤더는 App.tsx 탭 공통 titleHeader('커뮤니티') — 화면 자체는 상단 여백 없이 시작(paddingTop 고정값 금지).
// v3.245 사이즈 감사(대표 지적 "다른 페이지보다 큼" 반영):
//   히어로 타이틀 title2(24)→subtitle(18) · 본문 bodyLg(14)→body(13) · 아이콘 28/56원→20/40원
//   CTA 버튼 lg(텍스트 18)→md 기본(16) · 클럽 카드 제목은 목록 행 관행(15~16/600)=callout.
// 서버 미배포(404/네트워크) → 안내 빈 상태로 강등(크래시 금지). 비로그인: 목록은 보이되
// 개설 시 로그인 오버레이(FeedScreen loginOverlay 관행). 가입 유도는 ClubHome 소관.
import { useCallback, useState } from 'react';
import { StyleSheet, View, FlatList, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { AppText, Button, EmptyState, ScreenLayout, Tag } from '../components/ui';
import LoginPrompt from '../components/LoginPrompt';
import { usePlayerStore } from '../stores/playerStore';
import { useAuthStore } from '../stores/authStore';
import { Club, ClubSort, listClubs, getMyClubs } from '../services/clubService';

const LIST_LIMIT = 20;

// 정렬 토글 — 계약 GET /clubs?sort=new|members
const SORTS: { key: ClubSort; label: string }[] = [
  { key: 'new', label: '최신' },
  { key: 'members', label: '멤버순' },
];

export default function CommunityScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuthStore();
  const playingTrack = usePlayerStore((s) => s.track);

  const [clubs, setClubs] = useState<Club[]>([]);
  const [myClubs, setMyClubs] = useState<Club[]>([]);
  const [sort, setSort] = useState<ClubSort>('new');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false); // 서버 미배포/오류 — 안내 빈 상태
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [ctaVisible, setCtaVisible] = useState(false); // 비로그인 개설 시 로그인 오버레이

  const fetchAll = useCallback(async (s: ClubSort) => {
    if (__DEV__) console.info('[Club] Community fetchAll', { sort: s, loggedIn: !!user });
    try {
      setLoading(true);
      const [listRes, mineRes] = await Promise.allSettled([
        listClubs({ sort: s, limit: LIST_LIMIT }),
        user ? getMyClubs() : Promise.resolve([] as Club[]),
      ]);
      if (listRes.status === 'fulfilled') {
        setClubs(listRes.value.clubs);
        setNextBefore(listRes.value.next_before);
        setLoadFailed(false);
      } else {
        // 서버 미배포(404)·네트워크 오류 — 목록만 안내 상태로 강등
        console.error('[Club] 목록 조회 실패', { status: (listRes.reason as any)?.response?.status ?? null });
        setClubs([]);
        setNextBefore(null);
        setLoadFailed(true);
      }
      if (mineRes.status === 'fulfilled') setMyClubs(mineRes.value);
      else {
        console.error('[Club] 내 클럽 조회 실패', { status: (mineRes.reason as any)?.response?.status ?? null });
        setMyClubs([]);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { fetchAll(sort); }, [fetchAll, sort]));

  const handleLoadMore = useCallback(async () => {
    if (!nextBefore || loadingMore || loading) return;
    setLoadingMore(true);
    if (__DEV__) console.info('[Club] Community loadMore', { before: nextBefore });
    try {
      const page = await listClubs({ sort, limit: LIST_LIMIT, before: nextBefore });
      setClubs((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        return [...prev, ...page.clubs.filter((c) => !seen.has(c.id))];
      });
      setNextBefore(page.next_before);
    } catch (err: any) {
      console.error('[Club] loadMore 실패', { status: err?.response?.status });
      setNextBefore(null); // 반복 실패 호출 방지 — 당겨서 새로고침으로 복구
    } finally {
      setLoadingMore(false);
    }
  }, [nextBefore, loadingMore, loading, sort]);

  const handleCreateClub = () => {
    if (!user) {
      if (__DEV__) console.info('[Club] 비로그인 개설 시도 → 로그인 오버레이');
      setCtaVisible(true);
      return;
    }
    if (__DEV__) console.info('[Club] 클럽 만들기 진입');
    navigation.navigate('ClubCreate');
  };

  const openClub = (club: Club) => {
    if (__DEV__) console.info('[Club] 클럽 홈 진입', { clubId: club.id });
    navigation.navigate('ClubHome', { clubId: club.id, name: club.name });
  };

  // 클럽 카드 — 이름(목록 행 제목 관행 16/600)·소개 1줄·멤버 수(Feather users 소형)
  const renderClubCard = useCallback(({ item }: { item: Club }) => (
    <TouchableOpacity style={styles.clubCard} activeOpacity={0.75} onPress={() => openClub(item)} accessibilityLabel={`클럽 ${item.name}`}>
      <View style={{ flex: 1 }}>
        <AppText variant="callout" numberOfLines={1}>{item.name}</AppText>
        {item.description
          ? <AppText variant="footnote" tone="secondary" numberOfLines={1} style={styles.clubDesc}>{item.description}</AppText>
          : null}
        <View style={styles.clubMetaRow}>
          <Feather name="users" size={12} color={colors.text.muted} />
          <AppText variant="caption" tone="muted">{`멤버 ${item.member_count ?? 0}명`}</AppText>
          {item.is_member ? <AppText variant="caption" tone="accent">가입됨</AppText> : null}
        </View>
      </View>
      <Feather name="chevron-right" size={18} color={colors.text.muted} />
    </TouchableOpacity>
  ), []);

  // 상단 — 컴팩트 히어로 + 내 클럽 가로 카드 + 정렬 토글(사이즈는 파일 상단 감사 표 기준)
  const header = (
    <View>
      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <Feather name="users" size={20} color={colors.accent.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="subtitle">클럽에서 함께 듣고, 함께 만들어요</AppText>
          <AppText variant="body" tone="secondary" style={styles.heroBody}>
            취향이 맞는 사람들과 곡을 나누고 플레이리스트를 함께 채워보세요.
          </AppText>
        </View>
      </View>
      <View style={styles.ctaWrap}>
        <Button
          label="클럽 만들기"
          fullWidth
          leading={<Feather name="plus" size={16} color={colors.text.primary} />}
          onPress={handleCreateClub}
        />
      </View>

      {user && myClubs.length > 0 ? (
        <View style={styles.myClubSection}>
          <AppText variant="footnote" tone="secondary" style={styles.sectionLabel}>내 클럽</AppText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.myClubRow}>
            {myClubs.map((c) => (
              <TouchableOpacity key={c.id} style={styles.myClubCard} activeOpacity={0.75} onPress={() => openClub(c)} accessibilityLabel={`내 클럽 ${c.name}`}>
                <View style={styles.myClubIcon}>
                  <Feather name="flag" size={16} color={colors.accent.primary} />
                </View>
                <AppText variant="bodyStrong" numberOfLines={1} style={{ marginTop: spacing.sm }}>{c.name}</AppText>
                <View style={styles.clubMetaRow}>
                  <Feather name="users" size={12} color={colors.text.muted} />
                  <AppText variant="caption" tone="muted">{`${c.member_count ?? 0}명`}</AppText>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <View style={styles.listLabelRow}>
        <AppText variant="footnote" tone="secondary" style={styles.sectionLabel}>클럽 목록</AppText>
        <View style={styles.sortRow}>
          {SORTS.map((s) => (
            <Tag
              key={s.key}
              label={s.label}
              selected={sort === s.key}
              onPress={() => {
                if (sort === s.key) return;
                if (__DEV__) console.info('[Club] 정렬 전환', { sort: s.key });
                setClubs([]);
                setNextBefore(null);
                setSort(s.key);
              }}
            />
          ))}
        </View>
      </View>
    </View>
  );

  return (
    <ScreenLayout>
      {loading && clubs.length === 0 ? (
        <View>
          {header}
          <ActivityIndicator size="large" color={colors.accent.primary} style={{ marginTop: spacing.huge }} />
        </View>
      ) : (
        <FlatList
          data={clubs}
          keyExtractor={(c) => c.id}
          renderItem={renderClubCard}
          ListHeaderComponent={header}
          ListEmptyComponent={
            loadFailed ? (
              <EmptyState
                icon={<Feather name="cloud-off" size={44} color={colors.text.muted} />}
                title="클럽 목록을 불러오지 못했어요"
                hint="잠시 후 아래로 당겨 다시 시도해주세요."
              />
            ) : (
              <EmptyState
                icon={<Feather name="flag" size={44} color={colors.text.muted} />}
                title="아직 클럽이 없어요"
                hint="첫 클럽을 만들어보세요!"
              />
            )
          }
          ListFooterComponent={loadingMore
            ? <ActivityIndicator size="small" color={colors.accent.primary} style={{ marginVertical: spacing.lg }} />
            : null}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); fetchAll(sort); }}
              tintColor={colors.accent.primary}
              colors={[colors.accent.primary]}
            />
          }
          // 미니플레이어 가림 방지 — 차트/피드와 동일한 재생 중 하단 패딩 관행
          contentContainerStyle={{ flexGrow: 1, paddingBottom: playingTrack ? 140 : 80 }}
        />
      )}

      {/* 비로그인 개설 시 로그인 오버레이 — FeedScreen loginOverlay 관행(탭하면 닫힘) */}
      {!user && ctaVisible ? (
        <TouchableOpacity style={styles.loginOverlay} activeOpacity={1} onPress={() => setCtaVisible(false)}>
          <LoginPrompt
            desc={'로그인하면 클럽을 만들고\n마음 맞는 사람들과 함께할 수 있어요'}
            onPress={() => navigation.navigate('Settings')}
          />
        </TouchableOpacity>
      ) : null}
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  // v3.245 사이즈 감사: 아이콘 원 56→40·아이콘 28→20, 텍스트는 파일 상단 표 참조
  hero: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingTop: spacing.lg,
  },
  heroIcon: {
    width: 40, height: 40, borderRadius: radius.lg,
    backgroundColor: colors.bg.surface2,
    alignItems: 'center', justifyContent: 'center',
  },
  heroBody: { marginTop: spacing.xs },
  ctaWrap: { paddingHorizontal: spacing.lg, marginTop: spacing.lg },
  // 섹션 라벨 — ChartScreen albumSectionLabel 관행(footnote 12 + 700)
  sectionLabel: { fontWeight: '700', letterSpacing: 0.3 },
  myClubSection: { marginTop: spacing.xl, paddingHorizontal: spacing.lg },
  myClubRow: { gap: spacing.md, paddingVertical: spacing.sm },
  myClubCard: {
    width: 140, padding: spacing.md, borderRadius: radius.lg,
    backgroundColor: colors.bg.surface1,
  },
  myClubIcon: {
    width: 28, height: 28, borderRadius: radius.md,
    backgroundColor: colors.bg.surface2,
    alignItems: 'center', justifyContent: 'center',
  },
  listLabelRow: {
    marginTop: spacing.xl, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  sortRow: { flexDirection: 'row', gap: spacing.sm },
  clubCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    marginHorizontal: spacing.lg, marginTop: spacing.md,
    padding: spacing.lg, borderRadius: radius.lg,
    backgroundColor: colors.bg.surface1,
  },
  clubDesc: { marginTop: spacing.xs },
  clubMetaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  // FeedScreen loginOverlay와 동일 스펙 — 까만 반투명 전체화면
  loginOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
