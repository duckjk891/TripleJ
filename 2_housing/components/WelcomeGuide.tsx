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
    title: '편하게 얘기하다 보면\n어느새 내 곡이 완성돼요',
    desc: '악보도 장비도 필요 없어요. 디렉터들이 다 도와줘요.',
  },
  {
    key: 'dialogue',
    image: require('../assets/welcome/dialogue.jpg'),
    chip: '작사 디렉터',
    title: '오늘 있었던 일도\n노래 가사가 될 수 있어요',
    desc: '떠오르는 한마디면 충분해요. 가입 없이 지금 바로 한 곡 만들어 보세요.',
  },
  {
    key: 'chart',
    image: require('../assets/welcome/chart.jpg'),
    chip: '차트',
    title: '내가 만든 노래를\n다른 사람들이 듣고 있다면?',
    desc: '발매하면 차트에 올라가요. 연습생에서 아이돌까지, 들을수록 성장해요.',
  },
  {
    key: 'player',
    image: require('../assets/welcome/player.jpg'),
    chip: '플레이어',
    title: '세상에 하나뿐인 내 노래,\n친구에게 들려주세요',
    desc: '가사 자막과 함께 듣고, 링크 하나로 바로 공유할 수 있어요.',
  },
] as const;

export default function WelcomeGuide() {
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const user = useAuthStore((s) => s.user);
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);
  const checkedRef = useRef(false);
  // v3.279: 웹 키보드/스크린리더 초점을 체험 버튼에(종전: DOM 첫 요소인 '건너뛰기'에 포커스 링)
  const ctaRef = useRef<any>(null);
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => { try { ctaRef.current?.focus?.(); } catch {} }, 350);
    return () => clearTimeout(t);
  }, [visible]);

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
          {/* v3.279(대표): 상단은 앱 상단바와 같은 MAIDOL 로고만 — 상단 '건너뛰기' 제거(시선·포커스는 체험 버튼으로) */}
          <View style={styles.topRow}>
            <AppText variant="title2" style={{ letterSpacing: 1 }}>
              M<AppText variant="title2" tone="accent">AI</AppText>DOL
            </AppText>
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
              ref={ctaRef}
              style={styles.cta} activeOpacity={0.85} accessibilityLabel="무료로 한 곡 만들어보기"
              onPress={() => { close('trial'); startGuestLyricsTrial('welcome_guide'); }}
            >
              <AppText style={styles.ctaText}>무료로 한 곡 만들어보기</AppText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={() => close('skip')} accessibilityLabel="먼저 둘러보기">
              <AppText style={styles.secondaryText}>나중에 할게요</AppText>
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
    width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
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
  secondaryText: { fontSize: 12, color: colors.text.muted },
});
