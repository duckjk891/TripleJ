// v3.251 [Recog] 승급 연출 — 토스트(세부 단계·안내) + 티어 승급 휘장 공개 다이얼로그.
//  · artist = 인지도 세부 단계 승급("연습생 4 승급!") — 휘장(md) + 라벨. 이모지 전시 금지.
//  · company = 기존 기획사 레벨업 토스트 무회귀(문구 동일) — 아이콘만 이모지 → Feather 'award'.
//  · notice = 경량 안내("공연을 마쳤어요! 인지도 +10") — Feather 'mic'.
//  · showArtistTierDialog = 티어 승급(연습생→신인 등) 휘장 공개 — 앱 내 다이얼로그(showCustomDialog,
//    시스템 Alert 금지 방침)로 새 티어 배지 + 문구 렌더.
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLevelUpQueueStore } from '../stores/levelUpQueueStore';
import { showCustomDialog } from '../utils/appAlert';
import ArtistLevelBadge from './ArtistLevelBadge';
import { colors } from '../theme/colors';
import type { ArtistRecognition, RecognitionTier } from '../data/levels';

const TOAST_MS = 3500;

// v3.251: 티어 승급 다이얼로그 문구 — 티어별 1문장 + 공통 서사
const TIER_DIALOG_TITLES: Record<RecognitionTier, string> = {
  trainee: '연습생이 되었어요!',
  newcomer: '신인이 되었어요!',
  rookie: '루키가 되었어요!',
  rising: '라이징 스타가 되었어요!',
  idol: '아이돌이 되었어요!',
};

/**
 * v3.251: 티어 승급 = 휘장 공개 다이얼로그(연출 위계 상단 — 세부 단계는 토스트).
 * 스토어(artistStore)에서 호출 — AppDialogHost 큐 경유라 별도 마운트 불필요.
 */
export function showArtistTierDialog(rec: ArtistRecognition) {
  if (__DEV__) console.info('[Recog] 티어 승급 다이얼로그', { tier: rec.tier, label: rec.label });
  showCustomDialog('새 휘장 공개', (ctx) => (
    <View style={styles.tierBody}>
      <View style={styles.tierBadgeWrap}>
        <ArtistLevelBadge tier={rec.tier} sub={rec.sub} size={72} />
      </View>
      <Text style={styles.tierTitle}>{TIER_DIALOG_TITLES[rec.tier]}</Text>
      <Text style={styles.tierSub}>
        {`${rec.label} 휘장을 획득했어요.\n인지도를 쌓아 다음 무대로 나아가요!`}
      </Text>
      <TouchableOpacity
        style={styles.tierBtn}
        onPress={ctx.close}
        accessibilityRole="button"
        accessibilityLabel="확인"
      >
        <Text style={styles.tierBtnText}>확인</Text>
      </TouchableOpacity>
    </View>
  ));
}

export default function LevelUpModal() {
  const insets = useSafeAreaInsets();
  const queue = useLevelUpQueueStore((s) => s.queue);
  const dequeue = useLevelUpQueueStore((s) => s.dequeue);

  const current = queue[0];
  const slideAnim = useRef(new Animated.Value(-100)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!current) return;

    // slide-in
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    // 자동 dismiss
    timeoutRef.current = setTimeout(() => {
      handleDismiss();
    }, TOAST_MS);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const handleDismiss = () => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: -100,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      dequeue();
      // slideAnim/fadeAnim 다음 이벤트를 위해 reset
      slideAnim.setValue(-100);
      fadeAnim.setValue(0);
    });
  };

  if (!current) return null;

  // v3.251: kind별 렌더 — artist=인지도 세부 승급, notice=경량 안내, company=레거시 무회귀
  const isArtist = current.kind === 'artist';
  const isNotice = current.kind === 'notice';
  const title = isArtist
    ? `${current.rankLabel} 승급!`
    : isNotice
      ? current.rankLabel
      : `기획사가 Lv.${current.newLevel}!`;
  const sub = current.message ?? (isArtist ? '인지도가 올랐어요!' : `${current.rankLabel} 달성!`);

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        { top: insets.top + 8 },
        { transform: [{ translateY: slideAnim }], opacity: fadeAnim },
      ]}
    >
      <TouchableOpacity activeOpacity={0.85} onPress={handleDismiss} style={styles.toast}>
        <View style={styles.lead}>
          {isArtist && current.tier ? (
            <ArtistLevelBadge tier={current.tier} sub={current.sub ?? 5} size="md" />
          ) : (
            <Feather
              name={isNotice ? 'mic' : 'award'}
              size={26}
              color={isNotice ? colors.accent.primary : colors.accent.secondary}
            />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.sub}>{sub}</Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 9999,
    elevation: 12,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.surface1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1.5,
    borderColor: colors.accent.primary,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  lead: { width: 36, alignItems: 'center', marginRight: 10 },
  title: { color: colors.text.primary, fontSize: 14, fontWeight: '800', marginBottom: 2 },
  sub: { color: colors.text.secondary, fontSize: 12, fontWeight: '600' },
  // v3.251: 티어 승급 다이얼로그 본문
  tierBody: { alignItems: 'center', paddingTop: 4 },
  tierBadgeWrap: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: colors.bg.surface2,
    borderWidth: 1.5,
    borderColor: colors.accent.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  tierTitle: { color: colors.text.primary, fontSize: 17, fontWeight: '800', marginBottom: 8 },
  tierSub: {
    color: colors.text.secondary,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 16,
  },
  tierBtn: {
    alignSelf: 'stretch',
    backgroundColor: colors.accent.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tierBtnText: { color: colors.text.primary, fontSize: 15, fontWeight: '700' },
});
