import { useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  Image,
} from 'react-native';
import { AppText } from '../components/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DIRECTOR_CATALOG, DirectorCatalog } from '../data/directors';
import { useDirectorsStore } from '../stores/directorsStore';
import { useGemsStore } from '../stores/gemsStore';
import { useCompanyStore } from '../stores/companyStore';
import { useAuthStore } from '../stores/authStore';
import { usePlayerStore } from '../stores/playerStore';
import type { DirectorType } from '../components/Character';
import { colors } from '../theme/colors';

const PORTRAITS: Partial<Record<DirectorType, any>> = {
  lyricist: require('../assets/portraits/lyricist_director.png'),
  composer: require('../assets/portraits/composer_director.png'),
  wondera: require('../assets/portraits/wondera_director.png'),
  image: require('../assets/portraits/image_director.png'),
  video: require('../assets/portraits/video_director.png'),
  artist: require('../assets/portraits/artist_director.png'),
};

const CATEGORY_LABEL: Record<DirectorType, string> = {
  lyricist: '작사 디렉터',
  composer: '작곡 디렉터',
  wondera: '작곡 디렉터',
  image: '이미지 디렉터',
  video: '영상 디렉터',
  artist: '아티스트 디렉터',
};

export default function DirectorLineupScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const hasMiniPlayer = !!usePlayerStore((s) => s.track);
  const { user } = useAuthStore();
  const { balance } = useGemsStore();
  const { hiredIds, hire, isHired, selectForCategory, selectedByCategory, initIfEmpty } =
    useDirectorsStore();
  const gemSpend = useGemsStore((s) => s.spend);

  useEffect(() => {
    if (user) initIfEmpty();
  }, [user]);

  const grouped = useMemo(() => {
    const map: Record<string, DirectorCatalog[]> = {};
    for (const d of DIRECTOR_CATALOG) {
      if (!map[d.category]) map[d.category] = [];
      map[d.category].push(d);
    }
    // 작사 → 작곡 → 이미지 → 영상 → 아티스트 순서
    const order: DirectorType[] = ['lyricist', 'composer', 'image', 'video', 'artist'];
    return order
      .filter((k) => map[k])
      .map((k) => ({ category: k, list: map[k].sort((a, b) => a.hireCost - b.hireCost) }));
  }, []);

  const handleHire = (d: DirectorCatalog) => {
    if (isHired(d.id)) {
      // 영입된 경우 → 선택 (현재 카테고리의 기본으로)
      selectForCategory(d.category, d.id);
      Alert.alert('선택 완료', `${d.name}님을 ${CATEGORY_LABEL[d.category]}로 지정했어요.`);
      return;
    }
    if (d.hireCost === 0) {
      hire(d.id);
      useCompanyStore.getState().addExp(20, 'hire');
      return;
    }
    Alert.alert(
      '디렉터 영입',
      `${d.name}님을 영입하시겠어요?\n\n비용: ${d.hireCost.toLocaleString()} 💎\n현재 잔액: ${balance.toLocaleString()} 💎`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '영입하기',
          onPress: () => {
            const ok = gemSpend(d.hireCost, 'hire_director', d.id);
            if (!ok) {
              Alert.alert('캐시 부족', '광고를 보거나 곡을 만들어 캐시를 모아주세요.');
              return;
            }
            hire(d.id);
            // 기획사 EXP: 영입 +20 / 사용한 💎 trackSpend
            const company = useCompanyStore.getState();
            company.addExp(20, 'hire');
            company.trackSpend(d.hireCost);
            Alert.alert('영입 완료', `${d.name}님이 우리 기획사에 합류했어요!`);
          },
        },
      ]
    );
  };

  if (!user) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
        <AppText style={styles.emptyTitle}>로그인이 필요해요</AppText>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* 헤더 */}
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <AppText style={styles.backText}>{'‹'}</AppText>
        </TouchableOpacity>
        <AppText style={styles.headerTitle}>디렉터 영입</AppText>
        <View style={styles.balancePill}>
          <AppText style={styles.balanceText}>💎 {balance.toLocaleString()}</AppText>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 + insets.bottom + (hasMiniPlayer ? 70 : 0) }}>
        <AppText style={styles.subTitle}>
          영입한 {hiredIds.length}명 / 전체 {DIRECTOR_CATALOG.length}명
        </AppText>

        {grouped.map(({ category, list }) => (
          <View key={category} style={styles.section}>
            <AppText style={styles.sectionTitle}>{CATEGORY_LABEL[category]}</AppText>
            <View style={styles.grid}>
              {list.map((d) => {
                const hired = isHired(d.id);
                const selected = selectedByCategory[category] === d.id;
                const portrait = PORTRAITS[category];
                return (
                  <TouchableOpacity
                    key={d.id}
                    style={[styles.card, hired && styles.cardHired, selected && styles.cardSelected]}
                    onPress={() => handleHire(d)}
                  >
                    {portrait ? (
                      <View style={styles.cardPortraitWrap}>
                        <Image source={portrait} style={styles.cardPortrait} />
                      </View>
                    ) : null}
                    <AppText style={styles.cardName} numberOfLines={1}>{d.name}</AppText>
                    <AppText style={styles.cardConcept} numberOfLines={2}>{d.concept}</AppText>
                    <View style={styles.tierRow}>
                      {Array.from({ length: d.tier }).map((_, i) => (
                        <AppText key={i} style={styles.tierStar}>★</AppText>
                      ))}
                    </View>
                    <View style={styles.cardCtaWrap}>
                      {selected ? (
                        <View style={[styles.cardCta, { backgroundColor: colors.accent.secondary }]}>
                          <AppText style={styles.cardCtaText}>선택됨</AppText>
                        </View>
                      ) : hired ? (
                        <View style={[styles.cardCta, { backgroundColor: colors.bg.surface2, borderWidth: 1, borderColor: colors.accent.primary }]}>
                          <AppText style={[styles.cardCtaText, { color: colors.accent.primary }]}>탭해서 선택</AppText>
                        </View>
                      ) : d.hireCost === 0 ? (
                        <View style={[styles.cardCta, { backgroundColor: colors.accent.primary }]}>
                          <AppText style={styles.cardCtaText}>기본 지급</AppText>
                        </View>
                      ) : (
                        <View
                          style={[
                            styles.cardCta,
                            { backgroundColor: balance >= d.hireCost ? colors.accent.primary : colors.bg.surface2 },
                          ]}
                        >
                          <AppText
                            style={[
                              styles.cardCtaText,
                              balance < d.hireCost && { color: colors.text.muted },
                            ]}
                          >
                            💎 {d.hireCost.toLocaleString()}
                          </AppText>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}

        <View style={styles.hintBox}>
          <AppText style={styles.hintText}>
            💡 곡을 만들거나 광고를 보면 캐시(💎)를 모을 수 있어요.{'\n'}
            같은 카테고리 디렉터 중 <AppText style={{ color: colors.accent.secondary }}>한 명만</AppText> 작업에 투입돼요. 카드를 탭해 바꿀 수 있어요.
          </AppText>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.bg.surface1,
  },
  backBtn: { padding: 8 },
  backText: { color: colors.text.primary, fontSize: 24, fontWeight: '600' },
  headerTitle: { flex: 1, color: colors.text.primary, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  balancePill: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.accent.primary,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  balanceText: { color: colors.accent.primaryGlow, fontSize: 12, fontWeight: '700' },
  subTitle: { color: colors.text.secondary, fontSize: 13, marginBottom: 14, textAlign: 'center' },

  emptyTitle: { color: colors.text.primary, fontSize: 16, fontWeight: '700', textAlign: 'center', padding: 40 },

  section: { marginBottom: 24 },
  sectionTitle: { color: colors.accent.primary, fontSize: 13, fontWeight: '700', marginBottom: 10, letterSpacing: 0.5 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: {
    width: '48%',
    backgroundColor: colors.bg.surface1,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  cardHired: { borderColor: colors.accent.primary },
  cardSelected: { borderColor: colors.accent.secondary, borderWidth: 2 },
  cardPortraitWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: colors.accent.primary,
    alignSelf: 'center',
    marginBottom: 10,
    backgroundColor: colors.bg.surface2,
  },
  cardPortrait: { width: 60, height: 180, resizeMode: 'cover', position: 'absolute', top: 0, left: 0 },
  cardName: { color: colors.text.primary, fontSize: 15, fontWeight: '700', textAlign: 'center', marginBottom: 4 },
  cardConcept: { color: colors.text.muted, fontSize: 11, lineHeight: 15, textAlign: 'center', marginBottom: 8, minHeight: 30 },
  tierRow: { flexDirection: 'row', justifyContent: 'center', marginBottom: 10 },
  tierStar: { color: colors.accent.secondary, fontSize: 11, marginHorizontal: 1 },
  cardCtaWrap: { alignItems: 'center' },
  cardCta: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  cardCtaText: { color: colors.text.primary, fontSize: 12, fontWeight: '700' },

  hintBox: {
    marginTop: 10,
    padding: 14,
    backgroundColor: colors.bg.surface1,
    borderRadius: 12,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent.primary,
  },
  hintText: { color: colors.text.secondary, fontSize: 12, lineHeight: 19 },
});
