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
import { useIsChild } from '../utils/kidsMode';
import { CLUB_LABEL, Club, ClubSort, listClubs, getMyClubs } from '../services/clubService';
// v3.252: 크루 채팅 unread 뱃지 — 소켓 club_chat 수신 시 화면 내 즉시 증가(재조회는 focus 관행 그대로)
import { dmSocketSubscribeClubChat } from '../services/dmSocket';
// v3.257: v3.253 크루 인지도 노출(레벨 배지·'인기 크루' 섹션·'인기' 정렬 토글) 전면 제거 —
// 대표 확정 "크루는 인지도가 필요없어. 크루원들한테 혜택이 가는 형태면 되."
// 크루 플리 실적(재생·담기)은 멤버 혜택 정산 원천으로 서버에 계속 축적된다(노출만 중단).

const LIST_LIMIT = 20;

// 정렬 토글 — 계약 GET /clubs?sort=new|members (v3.257: '인기' 토글 제거 — sort=popular 미사용)
const SORTS: { key: ClubSort; label: string }[] = [
  { key: 'new', label: '최신' },
  { key: 'members', label: '멤버순' },
];

export default function CommunityScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuthStore();
  const playingTrack = usePlayerStore((s) => s.track);
  // v3.247: 어린이 계정 = 클럽 개설 불가(서버 POST /clubs/ 403 child_restricted 계약) —
  // CTA 를 안내로 대체해 403 왕복 자체를 없앤다(가입·둘러보기는 그대로).
  const isChild = useIsChild();

  const [clubs, setClubs] = useState<Club[]>([]);
  const [myClubs, setMyClubs] = useState<Club[]>([]);
  const [sort, setSort] = useState<ClubSort>('new');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false); // 서버 미배포/오류 — 안내 빈 상태
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [ctaVisible, setCtaVisible] = useState(false); // 비로그인 개설 시 로그인 오버레이
  // v3.257: 인기 크루 섹션 상태(popular)·별도 fetch 제거 — 크루 인지도 미노출(대표 확정)

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

  // v3.252: 화면 표시 중 크루 채팅 수신 → 해당 크루 카드 unread_chat 즉시 +1 (focus 재조회가 서버값으로 보정)
  useFocusEffect(useCallback(() => {
    const unsub = dmSocketSubscribeClubChat((ev) => {
      if (ev.type !== 'club_chat' || ev.club_id == null) return;
      setMyClubs((prev) => prev.map((c) =>
        String(c.id) === String(ev.club_id) ? { ...c, unread_chat: (c.unread_chat ?? 0) + 1 } : c,
      ));
    });
    return unsub;
  }, []));

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

  // 크루 카드 — 이름(목록 행 제목 관행 16/600)·소개 1줄·멤버 수(Feather users 소형)
  // v3.252: join_status 'pending'(승인제 신서버) → '승인 대기 중' 칩
  // v3.257: v3.253 레벨 배지+라벨 제거(크루 인지도 미노출 — 서버 recognition 키는 무시)
  const renderClubCard = useCallback(({ item }: { item: Club }) => {
    return (
      <TouchableOpacity style={styles.clubCard} activeOpacity={0.75} onPress={() => openClub(item)} accessibilityLabel={`${CLUB_LABEL} ${item.name}`}>
        <View style={{ flex: 1 }}>
          <AppText variant="callout" numberOfLines={1}>{item.name}</AppText>
          {item.description
            ? <AppText variant="footnote" tone="secondary" numberOfLines={1} style={styles.clubDesc}>{item.description}</AppText>
            : null}
          <View style={styles.clubMetaRow}>
            <Feather name="users" size={12} color={colors.text.muted} />
            <AppText variant="caption" tone="muted">{`멤버 ${item.member_count ?? 0}명`}</AppText>
            {item.is_member ? <AppText variant="caption" tone="accent">가입됨</AppText>
              : item.join_status === 'pending' ? <AppText variant="caption" tone="muted">승인 대기 중</AppText> : null}
          </View>
        </View>
        <Feather name="chevron-right" size={18} color={colors.text.muted} />
      </TouchableOpacity>
    );
  }, []);

  // 상단 — 컴팩트 히어로 + 내 클럽 가로 카드 + 정렬 토글(사이즈는 파일 상단 감사 표 기준)
  const header = (
    <View>
      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <Feather name="users" size={20} color={colors.accent.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="subtitle">{`${CLUB_LABEL}에서 함께 듣고, 함께 만들어요`}</AppText>
          <AppText variant="body" tone="secondary" style={styles.heroBody}>
            취향이 맞는 사람들과 곡을 나누고 플레이리스트를 함께 채워보세요.
          </AppText>
        </View>
      </View>
      <View style={styles.ctaWrap}>
        {isChild ? (
          // v3.247: 어린이 CTA 대체 안내 — 개설 버튼 대신 정보 행.
          // 문구는 서버 403 child_restricted(feature:'club_create') 메시지와 동일(톤 일치 확정)
          <View style={styles.childNotice}>
            <Feather name="info" size={16} color={colors.text.muted} />
            <AppText variant="footnote" tone="secondary" style={{ flex: 1 }}>
              {`어린이 계정은 ${CLUB_LABEL}를 만들 수 없어요. ${CLUB_LABEL}에 가입해서 함께 즐기는 건 언제든 할 수 있어요.`}
            </AppText>
          </View>
        ) : (
          <Button
            label={`${CLUB_LABEL} 만들기`}
            fullWidth
            leading={<Feather name="plus" size={16} color={colors.text.primary} />}
            onPress={handleCreateClub}
          />
        )}
      </View>

      {user && myClubs.length > 0 ? (
        <View style={styles.myClubSection}>
          <AppText variant="footnote" tone="secondary" style={styles.sectionLabel}>{`내 ${CLUB_LABEL}`}</AppText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.myClubRow}>
            {myClubs.map((c) => (
              <TouchableOpacity key={c.id} style={styles.myClubCard} activeOpacity={0.75} onPress={() => openClub(c)} accessibilityLabel={`내 ${CLUB_LABEL} ${c.name}`}>
                <View style={styles.myClubIcon}>
                  <Feather name="flag" size={16} color={colors.accent.primary} />
                </View>
                {/* v3.252: 크루 채팅 unread 뱃지 — GET /clubs/mine 확장 필드(없으면 숨김) */}
                {typeof c.unread_chat === 'number' && c.unread_chat > 0 ? (
                  <View style={styles.unreadBadge}>
                    <AppText variant="caption" style={styles.unreadBadgeText}>
                      {c.unread_chat > 99 ? '99+' : String(c.unread_chat)}
                    </AppText>
                  </View>
                ) : null}
                <AppText variant="bodyStrong" numberOfLines={1} style={{ marginTop: spacing.sm }}>{c.name}</AppText>
                {/* v3.257: 내 크루 카드 레벨 배지 제거(크루 인지도 미노출) */}
                <View style={styles.clubMetaRow}>
                  <Feather name="users" size={12} color={colors.text.muted} />
                  <AppText variant="caption" tone="muted">{`${c.member_count ?? 0}명`}</AppText>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* v3.257: '인기 크루' 섹션 제거(크루 인지도 미노출 — 대표 확정) */}

      <View style={styles.listLabelRow}>
        <AppText variant="footnote" tone="secondary" style={styles.sectionLabel}>{`${CLUB_LABEL} 목록`}</AppText>
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
                title={`${CLUB_LABEL} 목록을 불러오지 못했어요`}
                hint="잠시 후 아래로 당겨 다시 시도해주세요."
              />
            ) : (
              <EmptyState
                icon={<Feather name="flag" size={44} color={colors.text.muted} />}
                title={`아직 ${CLUB_LABEL}가 없어요`}
                hint={`첫 ${CLUB_LABEL}를 만들어보세요!`}
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
            desc={`로그인하면 ${CLUB_LABEL}를 만들고\n마음 맞는 사람들과 함께할 수 있어요`}
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
  // v3.247: 어린이 CTA 대체 안내 행 — surface1 카드 관행(버튼과 같은 자리·높이감)
  childNotice: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.bg.surface1, borderRadius: radius.lg,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
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
  // v3.252: 크루 채팅 unread 뱃지 — 카드 우상단(알림 뱃지 관행: accent 원형 + 흰 숫자)
  unreadBadge: {
    position: 'absolute', top: spacing.sm, right: spacing.sm,
    minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
    backgroundColor: colors.accent.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  unreadBadgeText: { color: '#fff', fontWeight: '700', fontSize: 10 },
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
