// [WelcomeGuide] v3.276 — 앱 첫 실행 이미지형 웰컴 팝업(대표 결정 2026-10-04).
// 화면별 코치마크 튜토리얼을 전부 대체: 실제 앱 화면 캡처 + 한 줄 설명 슬라이드, 마지막까지
// [작사 체험하러 가기](게스트 작사 체험 직행) / [둘러보기]. maidol.ai.kr 랜딩 톤(딥 바이올렛·칩·그라데이션 타이틀).
// 노출: 기기당 1회(AsyncStorage), 비로그인 첫 진입에서만. 로그인 사용자는 대상 아님.
import { useEffect, useRef, useState } from 'react';
import {
  Modal, View, Image, ScrollView, TouchableOpacity, StyleSheet, useWindowDimensions,
  NativeSyntheticEvent, NativeScrollEvent,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from './ui';
import { useAuthStore } from '../stores/authStore';
import { startGuestLyricsTrial } from '../utils/guestTrialEntry';
import { whenBootAuthSettled } from '../utils/bootAuth';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';

export const WELCOME_GUIDE_SEEN_KEY = 'maidol_welcome_guide_seen_v1';

const SLIDES = [
  {
    key: 'studio',
    image: require('../assets/welcome/studio.jpg'),
    chip: '작업실',
    title: '디렉터를 탭하면\n대화로 곡이 만들어져요',
    desc: '작사·작곡·커버·영상 디렉터가 기다리고 있어요.',
  },
  {
    key: 'dialogue',
    image: require('../assets/welcome/dialogue.jpg'),
    chip: '작사 디렉터',
    title: '몇 마디만 나누면\n나만의 가사 완성',
    desc: '장르와 분위기만 골라도 충분해요. 가입 없이 작사부터 작곡까지 체험할 수 있어요.',
  },
  {
    key: 'chart',
    image: require('../assets/welcome/chart.jpg'),
    chip: '차트',
    title: '완성한 곡으로\n차트에 도전',
    desc: '아티스트는 연습생 → 신인 → 루키 → 라이징 → 아이돌로 성장해요. 각 등급은 5단계에서 1단계까지.',
  },
  {
    key: 'player',
    image: require('../assets/welcome/player.jpg'),
    chip: '플레이어',
    title: '가사 자막·댓글·공유까지\n한 화면에서',
    desc: '마음에 드는 곡은 재생목록에 담아 이어서 들어요.',
  },
] as const;

export default function WelcomeGuide() {
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const user = useAuthStore((s) => s.user);
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);
  const checkedRef = useRef(false);

  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;
    (async () => {
      try {
        // 세션 복원 완료까지 대기 — 복원 전 user=null 을 게스트로 오판해 기존 회원에게 번쩍 뜨는 것 방지
        await whenBootAuthSettled();
        if (useAuthStore.getState().user) return; // 로그인 사용자는 대상 아님
        const seen = await AsyncStorage.getItem(WELCOME_GUIDE_SEEN_KEY);
        if (seen) return;
        console.info('[WelcomeGuide] 첫 실행 — 노출');
        setVisible(true);
      } catch (e: any) {
        console.warn('[WelcomeGuide] seen 조회 실패(미노출)', { message: e?.message });
      }
    })();
  }, []);

  // 노출 중 로그인되면 닫는다
  useEffect(() => {
    if (user && visible) setVisible(false);
  }, [user, visible]);

  const close = (via: 'skip' | 'trial') => {
    setVisible(false);
    AsyncStorage.setItem(WELCOME_GUIDE_SEEN_KEY, '1').catch(() => {});
    console.info('[WelcomeGuide] 닫힘', { via, slide: index });
  };

  const cardW = Math.min(winW, 480);
  // 이미지 영역: 화면 높이의 약 46% (폰 캡처 비율 540:1170 유지, 상단 크롭 표시)
  const shotH = Math.round(Math.min(winH * 0.46, 520));
  const shotW = Math.round(shotH * (540 / 1170));

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / cardW);
    if (i !== index && i >= 0 && i < SLIDES.length) setIndex(i);
  };

  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => close('skip')}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { width: cardW, paddingTop: insets.top + spacing.lg, paddingBottom: Math.max(spacing.lg, insets.bottom + spacing.md) }]}>
          <View style={styles.topRow}>
            <View style={styles.betaChip}>
              <View style={styles.dot} />
              <AppText style={styles.betaChipText}>MAIDOL · MY AI IDOL</AppText>
            </View>
            <TouchableOpacity onPress={() => close('skip')} accessibilityLabel="둘러보기" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <AppText variant="footnote" tone="secondary">건너뛰기</AppText>
            </TouchableOpacity>
          </View>

          <ScrollView
            horizontal pagingEnabled showsHorizontalScrollIndicator={false}
            onScroll={onScroll} scrollEventThrottle={16}
            style={{ width: cardW, flexGrow: 0 }}
          >
            {SLIDES.map((s) => (
              <View key={s.key} style={{ width: cardW, alignItems: 'center', paddingHorizontal: spacing.lg }}>
                <View style={[styles.phone, { width: shotW + 12, height: shotH + 12 }]}>
                  <Image source={s.image} style={{ width: shotW, height: shotH, borderRadius: 18 }} resizeMode="cover" />
                </View>
                <View style={styles.slideChip}><AppText style={styles.slideChipText}>{s.chip}</AppText></View>
                <AppText style={styles.title}>{s.title}</AppText>
                <AppText variant="footnote" tone="secondary" style={styles.desc}>{s.desc}</AppText>
              </View>
            ))}
          </ScrollView>

          <View style={styles.dots}>
            {SLIDES.map((s, i) => (
              <View key={s.key} style={[styles.pager, i === index && styles.pagerActive]} />
            ))}
          </View>

          <View style={{ paddingHorizontal: spacing.lg, width: '100%' }}>
            <TouchableOpacity
              style={styles.cta} activeOpacity={0.85} accessibilityLabel="무료로 한 곡 만들어보기"
              onPress={() => { close('trial'); startGuestLyricsTrial('welcome_guide'); }}
            >
              <AppText style={styles.ctaText}>무료로 한 곡 만들어보기</AppText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={() => close('skip')} accessibilityLabel="먼저 둘러보기">
              <AppText variant="footnote" tone="secondary">먼저 둘러볼게요</AppText>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0a0a1a', alignItems: 'center', justifyContent: 'center' },
  card: { flex: 1, alignItems: 'center', justifyContent: 'space-between' },
  topRow: {
    width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, marginBottom: spacing.md,
  },
  betaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 14,
    borderRadius: 999, backgroundColor: 'rgba(139,92,246,0.16)', borderWidth: 1, borderColor: 'rgba(167,139,250,0.4)',
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#a78bfa' },
  betaChipText: { fontSize: 12, fontWeight: '700', color: '#e9d5ff', letterSpacing: 0.6 },
  phone: {
    borderRadius: 24, padding: 6, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#1c1c3a', borderWidth: 1, borderColor: 'rgba(167,139,250,0.45)',
  },
  slideChip: {
    marginTop: spacing.md, paddingVertical: 4, paddingHorizontal: 12, borderRadius: 999,
    backgroundColor: 'rgba(139,92,246,0.16)',
  },
  slideChipText: { fontSize: 12, fontWeight: '700', color: '#c4b5fd' },
  title: { marginTop: spacing.sm, fontSize: 22, lineHeight: 30, fontWeight: '900', color: colors.text.primary, textAlign: 'center' },
  desc: { marginTop: spacing.xs, textAlign: 'center', lineHeight: 20 },
  dots: { flexDirection: 'row', gap: 6, marginVertical: spacing.md },
  pager: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(167,139,250,0.3)' },
  pagerActive: { width: 18, backgroundColor: '#a78bfa' },
  cta: {
    backgroundColor: colors.accent.primary, borderRadius: radius.lg, paddingVertical: 15, alignItems: 'center',
  },
  ctaText: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
  secondary: { alignItems: 'center', paddingVertical: spacing.md },
});
