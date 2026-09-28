// [CommunityScreen] v3.243 Phase1a — 커뮤니티(클럽) 탭 골격.
// 헤더는 App.tsx 탭 공통 titleHeader('커뮤니티') — 화면 자체는 상단 여백 없이 시작(paddingTop 고정값 금지).
// Phase 1b: clubs API(GET /clubs) 연결 시 아래 clubs 상태·renderClubCard 를 실데이터로 교체한다.
//   - 목록: FlatList 구조 그대로(빈 상태 ↔ 카드 목록 전환만)
//   - 개설: handleCreateClub 의 준비 중 안내를 클럽 개설 플로우로 교체
import { useCallback, useState } from 'react';
import { StyleSheet, View, FlatList } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { AppText, Button, EmptyState, ScreenLayout } from '../components/ui';
import { showAlert } from '../utils/appAlert';
import { usePlayerStore } from '../stores/playerStore';

// Phase 1b에서 서버 계약으로 대체될 최소 셰이프(카드 스텁이 참조하는 필드만)
interface Club {
  id: string;
  name: string;
  description?: string;
  member_count?: number;
}

export default function CommunityScreen() {
  // Phase 1b: fetch(GET /clubs) 로 채운다 — 1a는 항상 빈 목록(백엔드 무변경)
  const [clubs] = useState<Club[]>([]);
  const playingTrack = usePlayerStore((s) => s.track);

  const handleCreateClub = () => {
    if (__DEV__) console.info('[CommunityScreen] 클럽 만들기 탭 — Phase 1b 대기(준비 중 안내)');
    showAlert('준비 중', '클럽 개설은 곧 열려요! 조금만 기다려주세요.');
  };

  // Phase 1b: 실제 클럽 카드로 교체되는 스텁 — 이름·소개·멤버 수 자리만 잡아둔다
  const renderClubCard = useCallback(({ item }: { item: Club }) => (
    <View style={styles.clubCard}>
      <AppText variant="bodyStrong" numberOfLines={1}>{item.name}</AppText>
      {item.description
        ? <AppText variant="footnote" tone="secondary" numberOfLines={2} style={styles.clubDesc}>{item.description}</AppText>
        : null}
      {typeof item.member_count === 'number'
        ? <AppText variant="caption" tone="muted" style={styles.clubMeta}>{`멤버 ${item.member_count}명`}</AppText>
        : null}
    </View>
  ), []);

  // 안내 히어로 — 커뮤니티가 무엇을 하는 곳인지 첫 화면에서 설명 + 개설 CTA
  const hero = (
    <View style={styles.hero}>
      <View style={styles.heroIcon}>
        <Feather name="users" size={28} color={colors.accent.primary} />
      </View>
      <AppText variant="title2" style={styles.heroTitle}>클럽에서 함께 듣고, 함께 만들어요</AppText>
      <AppText variant="bodyLg" tone="secondary" style={styles.heroBody}>
        취향이 맞는 사람들과 클럽을 만들어 좋아하는 곡을 나누고, 함께 플레이리스트를 채워보세요.
        내가 만든 음악을 가장 먼저 들려줄 곳도 여기예요.
      </AppText>
      <Button
        label="클럽 만들기"
        size="lg"
        fullWidth
        leading={<Feather name="plus" size={18} color={colors.text.primary} />}
        onPress={handleCreateClub}
      />
      <View style={styles.listLabelRow}>
        <AppText variant="footnote" tone="secondary" style={styles.listLabel}>클럽 목록</AppText>
      </View>
    </View>
  );

  return (
    <ScreenLayout>
      <FlatList
        data={clubs}
        keyExtractor={(c) => c.id}
        renderItem={renderClubCard}
        ListHeaderComponent={hero}
        ListEmptyComponent={
          <EmptyState
            icon={<Feather name="flag" size={44} color={colors.text.muted} />}
            title="아직 클럽이 없어요"
            hint="첫 클럽을 만들어보세요!"
          />
        }
        // 미니플레이어 가림 방지 — 차트/피드와 동일한 재생 중 하단 패딩 관행
        contentContainerStyle={{ flexGrow: 1, paddingBottom: playingTrack ? 140 : 80 }}
      />
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  hero: {
    paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.sm,
  },
  heroIcon: {
    width: 56, height: 56, borderRadius: radius.xl,
    backgroundColor: colors.bg.surface2,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.md,
  },
  heroTitle: { marginBottom: spacing.sm },
  heroBody: { marginBottom: spacing.xl },
  listLabelRow: {
    marginTop: spacing.xxl, paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle,
  },
  listLabel: { fontWeight: '700', letterSpacing: 0.3 },
  // Phase 1b 카드 스텁 — 실데이터 연결 시 이 레이아웃 위에 채운다
  clubCard: {
    marginHorizontal: spacing.lg, marginTop: spacing.md,
    padding: spacing.lg, borderRadius: radius.lg,
    backgroundColor: colors.bg.surface1,
  },
  clubDesc: { marginTop: spacing.xs },
  clubMeta: { marginTop: spacing.sm },
});
