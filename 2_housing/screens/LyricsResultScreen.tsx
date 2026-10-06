import { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Image,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { AppText } from '../components/ui';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLyricsStore } from '../stores/lyricsStore';
import { useMusicStore } from '../stores/musicStore';
import { usePlayerStore } from '../stores/playerStore';
import { useLyricsBookStore, makeLyricsBookId } from '../stores/lyricsBookStore';
import { showAlert } from '../utils/appAlert';
import { useAuthStore } from '../stores/authStore';
import { saveLyricsAsset } from '../services/lyricsService';
import { getFatigueStatus } from '../services/fatigueService';
import { showFatigueCooldownDialog } from '../utils/fatigueGate';
import { confirmStarSpend } from '../utils/starSpendConfirm';
// v3.200: 창작 기록 계층 — 가사 버전 커밋(문서 §7.4: 진입 시 AI 초안, 에디터 닫기 시 수정본).
// 실패 무해(서버 미배포/비로그인 시 no-op) — 가사 편집·작곡 진행을 절대 막지 않는다.
import { commitLyricsVersion } from '../services/creationLogService';
// v3.228 W3: 작사 중복 생성 가드(전역 추적기)
import { guardGeneration } from '../services/generationTracker';
import { colors } from '../theme/colors';
// v3.276 [GuestLyrics]: 게스트 체험 결과 — 보기·수정·선택 복사만 허용, 저장·작곡·다시 생성은 로그인 모달 후 원래 동작
import { openLoginModal } from '../utils/loginModal';
import { GUEST_TEXT, isGuestNow, isGuestTrialUsed, isGuestComposeUsed } from '../utils/guestTrial';
// v3.281 [SectionLyrics]: 가사 수정 = 곡 구성별(벌스·후렴·브릿지) 아코디언 편집 + 전체 보기/직접 편집 탈출구
import SectionLyricsEditor from '../components/lyrics/SectionLyricsEditor';
import ResultActionBar, { ResultSecondaryButton, resultBarStyles } from '../components/ResultActionBar';

const LYRICIST_PORTRAIT = require('../assets/portraits/lyricist_director.png');

type Props = NativeStackScreenProps<any, 'LyricsResult'>;

export default function LyricsResultScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const store = useLyricsStore();
  const hasMiniPlayer = !!usePlayerStore((s) => s.track);
  const musicStore = useMusicStore();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingLyrics, setIsEditingLyrics] = useState(false);
  const [editedTitle, setEditedTitle] = useState(store.generatedTitle || '');
  const [editedLyrics, setEditedLyrics] = useState(store.generatedLyrics);

  const hasError = !!store.error;
  const hasLyrics = editedLyrics.trim().length > 0;
  // v3.281 [SectionLyrics]: 구성별 편집기 카드 → 페이지 스크롤(레이아웃 좌표 합산: 섹션 y + 편집기 y + 카드 y)
  const pageScrollRef = useRef<ScrollView>(null);
  const lyricsSectionYRef = useRef(0);
  const lyricsEditorYRef = useRef(0);
  const scrollToLyricsEditorY = (y: number) => {
    const target = lyricsSectionYRef.current + lyricsEditorYRef.current + y - 12;
    pageScrollRef.current?.scrollTo({ y: Math.max(0, target), animated: true });
  };
  // 동일 내용 연속 저장 가드 (중복 저장 자체는 허용)
  const lastSavedSignatureRef = useRef<string | null>(null);

  // ── v3.276 [GuestLyrics] 게스트 체험 결과 ──
  const user = useAuthStore((s) => s.user);
  const isGuest = !user;
  // 이 화면을 게스트로 열었고 아직 서버 출처가 없는 결과 = 로그인 직후 서버 가사 자산으로 1회 승계 대상
  // (로그인 사용자의 작사는 서버가 save:true 로 자동 자산화 — 같은 '작사 DB 자동 축적' 규칙을 맞춘다)
  const guestOriginRef = useRef(isGuestNow() && !store.error && !store.sourceAssetId);
  const guestClaimRef = useRef<Promise<string | null> | null>(null);
  const editedRef = useRef({ title: editedTitle, lyrics: editedLyrics });
  editedRef.current = { title: editedTitle, lyrics: editedLyrics };
  const claimGuestResult = (): Promise<string | null> => {
    if (guestClaimRef.current) return guestClaimRef.current;
    const title = editedRef.current.title.trim() || '제목 없음';
    const content = editedRef.current.lyrics.trim();
    if (!guestOriginRef.current || !content || isGuestNow()) return Promise.resolve(null);
    guestClaimRef.current = (async () => {
      try {
        const res = await saveLyricsAsset({
          title,
          content,
          genre: store.genre || undefined,
          mood: store.mood || undefined,
          source: 'ai',
        });
        const id = res?.lyrics_id || null;
        if (id) {
          // 작업본(영속)·작곡 출처에 기록 — 작곡 중 제목·가사 수정 동기화(v3.134)·발매 lyrics_id 연결
          useLyricsStore.getState().setSourceAssetId(id);
          useMusicStore.getState().setLyricsSource({ lyrics_id: id, title, is_mine: true });
          lastSavedSignatureRef.current = `${title} ${content}`;
        }
        if (__DEV__) console.info('[LyricsResult] [guest] 체험 가사 → 로그인 계정 보관함 승계', { saved: !!id });
        return id;
      } catch (err: any) {
        guestClaimRef.current = null; // 다음 시도(저장 버튼)에서 재시도
        console.error('[LyricsResult] [guest] 체험 가사 승계 실패', { status: err?.response?.status });
        return null;
      }
    })();
    return guestClaimRef.current;
  };
  // 어떤 경로로든(모달·다른 화면) 로그인되면 체험 결과를 1회 승계
  useEffect(() => {
    if (user && guestOriginRef.current) void claimGuestResult();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!user]);

  // v3.277 [GuestCompose]: 작곡 체험 사용 여부 — 미사용이면 '작곡하러 가기'가 로그인 없이 작곡 대화로 진입
  const [guestComposeUsed, setGuestComposeUsed] = useState(false);
  useEffect(() => {
    if (!isGuest) return;
    let alive = true;
    isGuestComposeUsed().then((used) => { if (alive) setGuestComposeUsed(used); }).catch(() => {});
    return () => { alive = false; };
  }, [isGuest]);

  /** 게스트면 로그인 모달(성공 시 afterLogin) 후 true — 호출부는 원래 동작을 중단 */
  const requireLoginForGuest = (reason: string, afterLogin: () => void): boolean => {
    if (!isGuestNow()) return false;
    // 편집 중이던 내용도 작업본(영속)에 남긴다 — 로그인(소셜 리다이렉트 포함) 후 이어서
    store.setGeneratedTitle(editedRef.current.title);
    store.setGeneratedLyrics(editedRef.current.lyrics);
    if (__DEV__) console.info('[LyricsResult] [guest] 로그인 필요 액션', { reason });
    openLoginModal({ reason, afterLogin });
    return true;
  };

  // v3.200: 진입 시 AI 초안 버전 커밋(source:'ai_draft') — 초안 원문은 지금 안 남기면 소급 불가.
  // 동일 텍스트 재커밋은 서비스가 중복 제거. 재생성으로 재진입해도 새 초안이면 새 버전이 남는다.
  useEffect(() => {
    if (!hasError && store.generatedLyrics?.trim()) {
      commitLyricsVersion('ai_draft', store.generatedLyrics)
        .catch((err: any) => {
          console.error('[CreationLog] AI 초안 가사 커밋 실패(진행 무영향):', err?.message);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v3.127 (B-2): 로그인 시 서버 가사 자산(/api/lyrics)에 저장 — 재설치·타기기 유지.
  // 서버 실패·비로그인은 기존 로컬 보관함으로 폴백 (기능 무손실).
  const handleSaveToBook = async () => {
    const title = editedTitle.trim() || '제목 없음';
    const lyricsText = editedLyrics.trim();
    if (!lyricsText) return;
    // v3.276 [GuestLyrics]: 게스트 → 로그인 후 승계 저장(실패 시 기존 저장 경로로 폴백)
    if (requireLoginForGuest('guest_lyrics_save', () => {
      void (async () => {
        const id = await claimGuestResult();
        if (id) showAlert('보관함 저장 완료', '가사 보관함에 저장했어요. 재설치하거나 기기를 바꿔도 유지돼요.');
        else await handleSaveToBook();
      })();
    })) return;
    const signature = `${title} ${lyricsText}`;
    if (lastSavedSignatureRef.current === signature) {
      showAlert('이미 저장했어요', '방금 저장한 가사와 같은 내용이에요.');
      return;
    }
    const loggedIn = !!useAuthStore.getState().token;
    if (loggedIn) {
      try {
        console.info('[LyricsResult] calling saveLyricsAsset', { titleLen: title.length, contentLen: lyricsText.length });
        await saveLyricsAsset({
          title,
          content: lyricsText,
          genre: store.genre || undefined,
          mood: store.mood || undefined,
          source: 'ai',
        });
        lastSavedSignatureRef.current = signature;
        showAlert('보관함 저장 완료', '가사 보관함에 저장했어요. 재설치하거나 기기를 바꿔도 유지돼요.');
        return;
      } catch (err: any) {
        console.error('[LyricsResult] saveLyricsAsset failed — 로컬 폴백', { status: err?.response?.status });
      }
    }
    useLyricsBookStore.getState().add({
      id: makeLyricsBookId(),
      title,
      lyrics: lyricsText,
      genre: store.genre || undefined,
      mood: store.mood || undefined,
      createdAt: Date.now(),
    });
    lastSavedSignatureRef.current = signature;
    if (__DEV__) console.log('[LyricsBook] 보관함 저장(로컬):', title);
    showAlert('보관함 저장 완료', '작사 디렉터 시작 화면의 "가사 보관함"에서 언제든 다시 꺼내 쓸 수 있어요.');
  };

  const handleSaveAndCompose = async () => {
    // v3.277 [GuestCompose]: 게스트 — 작곡 체험 미사용이면 로그인 없이 작곡 디렉터 대화로(체험 1회),
    // 이미 썼으면 기존대로 로그인 모달(v3.276: 로그인 후 체험 가사 승계 뒤 작곡으로)
    if (isGuestNow()) {
      let composeUsed = true;
      try { composeUsed = await isGuestComposeUsed(); } catch { composeUsed = true; }
      if (!composeUsed) {
        console.info('[GuestCompose] 가사 결과 → 작곡 체험 진입');
      } else if (requireLoginForGuest('guest_compose', () => {
        void (async () => {
          await claimGuestResult();
          void handleSaveAndCompose();
        })();
      })) return;
    }
    store.setGeneratedTitle(editedTitle);
    store.setGeneratedLyrics(editedLyrics);
    // v3.200: 작곡 진입 = '적용' 시점 커밋(§7.4) — 편집 중이던 내용까지 확정본으로 기록
    commitLyricsVersion('user_edit', editedLyrics)
      .catch((err: any) => {
        console.error('[CreationLog] 작곡 진입 가사 커밋 실패(진행 무영향):', err?.message);
      });
    // Pre-fill music store with lyrics params
    musicStore.setLyrics(editedLyrics);
    musicStore.setGenre(store.genre);
    musicStore.setMood(store.mood);
    musicStore.setTempo(store.tempo);
    navigation.navigate('ComposerSelect');
  };

  // v3.118: 작사 디렉터 피로 게이트 중복 탭 방지
  const fatigueCheckingRef = useRef(false);

  // v3.230 A5-2/A5-4: 다시 생성 ⭐ 차감 직전 확인 1회 — 휴식 게이트 뒤, 휴식 단축 해제 뒤에도 동일
  const confirmingRef = useRef(false);
  const confirmThenRegenerate = async (via: 'button' | 'fatigue-chain') => {
    if (confirmingRef.current) return;
    confirmingRef.current = true;
    try {
      const ok = await confirmStarSpend({ source: 'LyricsResult', costKey: 'lyrics', action: '가사 다시 만들기' });
      console.info('[LyricsResult] ⭐ 확인 결과', { via, ok });
      if (ok) navigation.replace('LyricsLoading');
    } finally {
      confirmingRef.current = false;
    }
  };

  // v3.118: "다시 생성하기" — 작사 디렉터 휴식(쿨다운) 게이트 (대표 방침: 재생성 시 팝업)
  const handleRegenerate = async () => {
    // v3.276 [GuestLyrics]: 게스트 — 체험권이 남아 있으면(서버 오류·금칙어로 미소모) 다시 체험, 아니면 로그인 후 재생성
    if (isGuestNow()) {
      if (hasError && !(await isGuestTrialUsed())) {
        if (__DEV__) console.info('[LyricsResult] [guest] 체험 재시도(체험권 미소모)');
        navigation.replace('LyricsLoading');
        return;
      }
      requireLoginForGuest('guest_regenerate', () => { void handleRegenerate(); });
      return;
    }
    // v3.228 W3: 사용자당 진행 중 작사 1건 — 피로·과금 게이트보다 먼저(미확인 완성본은 비차단)
    if (guardGeneration('lyrics', { navigation, where: 'LyricsResult' })) return;
    if (fatigueCheckingRef.current) return;
    fatigueCheckingRef.current = true;
    try {
      const status = await getFatigueStatus('lyricist');
      const remain = Math.max(0, Math.floor(status?.cooldown_remaining_sec ?? 0));
      if (remain > 0) {
        console.log('[LyricsResult] [fatigue:lyricist] 재생성 게이트 — 남은', remain, '초');
        showFatigueCooldownDialog({
          status,
          remainingSec: remain,
          director: 'lyricist',
          onCleared: () => { void confirmThenRegenerate('fatigue-chain'); },
        });
        return;
      }
    } catch (err: any) {
      // 조회 실패는 게이트 오픈 — 서버 429가 최종 방어 (LyricsLoading에서 동일 다이얼로그)
      console.warn('[LyricsResult] [fatigue:lyricist] 상태 조회 실패:', err?.response?.status, err?.message);
    } finally {
      fatigueCheckingRef.current = false;
    }
    await confirmThenRegenerate('button');
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        ref={pageScrollRef}
        keyboardShouldPersistTaps="handled"
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 16, paddingBottom: 32 + (hasMiniPlayer ? 70 : 0) + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Director message */}
        <View style={styles.directorRow}>
          <View style={styles.portraitContainer}>
            <Image source={LYRICIST_PORTRAIT} style={styles.portraitImage} />
          </View>
          <View style={styles.directorBubble}>
            <AppText style={styles.directorName}>작사 디렉터</AppText>
            <AppText style={styles.directorText}>
              {hasError
                ? '앗, 문제가 생겼어요. 다시 시도해볼까요?'
                : '가사가 완성됐어요! 마음에 드시나요?'}
            </AppText>
          </View>
        </View>

        {/* v3.276 [GuestLyrics]: 게스트 체험 안내 1줄 */}
        {isGuest && !hasError && (
          <TouchableOpacity
            style={styles.guestBanner}
            activeOpacity={0.7}
            onPress={() => openLoginModal({ reason: 'guest_result_banner' })}
            accessibilityLabel="가입하고 이어서 하기"
          >
            <AppText style={styles.guestBannerText}>
              {guestComposeUsed ? GUEST_TEXT.resultBannerComposeUsed : GUEST_TEXT.resultBanner}
            </AppText>
          </TouchableOpacity>
        )}

        {/* Error display */}
        {hasError && (
          <View style={styles.errorBox}>
            <AppText style={styles.errorText}>{store.error}</AppText>
          </View>
        )}

        {/* Title display */}
        <View style={styles.titleSection}>
          <View style={styles.lyricsTitleRow}>
            <AppText style={styles.sectionTitle}>곡 제목</AppText>
            <TouchableOpacity onPress={() => setIsEditingTitle(!isEditingTitle)}>
              <AppText style={styles.editButton}>{isEditingTitle ? '완료' : '수정'}</AppText>
            </TouchableOpacity>
          </View>
          {isEditingTitle ? (
            <TextInput
              style={styles.titleInput}
              value={editedTitle}
              onChangeText={setEditedTitle}
              placeholder="곡 제목을 입력하세요"
              placeholderTextColor={colors.text.muted}
            />
          ) : (
            <AppText style={styles.titleDisplay}>{editedTitle || '제목 없음'}</AppText>
          )}
        </View>

        {/* Lyrics display */}
        <View
          style={styles.lyricsSection}
          onLayout={(e) => { lyricsSectionYRef.current = e.nativeEvent.layout.y; }}
        >
          <View style={styles.lyricsTitleRow}>
            <AppText style={styles.sectionTitle}>생성된 가사</AppText>
            <TouchableOpacity
              onPress={() => {
                // v3.200: '완료'(에디터 닫기) = 가사 버전 커밋 시점(§7.4) — 수정 없으면 서비스가 중복 제거
                if (isEditingLyrics) {
                  commitLyricsVersion('user_edit', editedLyrics)
                    .catch((err: any) => {
                      console.error('[CreationLog] 가사 수정본 커밋 실패(진행 무영향):', err?.message);
                    });
                }
                setIsEditingLyrics(!isEditingLyrics);
              }}
            >
              <AppText style={styles.editButton}>{isEditingLyrics ? '완료' : '수정'}</AppText>
            </TouchableOpacity>
          </View>

          {isEditingLyrics ? (
            <View onLayout={(e) => { lyricsEditorYRef.current = e.nativeEvent.layout.y; }}>
              <SectionLyricsEditor
                value={editedLyrics}
                onChange={setEditedLyrics}
                onRequestScroll={scrollToLyricsEditorY}
                inputStyle={styles.lyricsInputEditing}
              />
            </View>
          ) : (
            <View style={styles.lyricsBox}>
              <AppText style={styles.lyricsText} selectable={isGuest}>
                {hasLyrics ? editedLyrics : '가사가 없습니다.'}
              </AppText>
            </View>
          )}
        </View>

        {/* v3.290 [ResultBar]: 보조 [다시 생성하기][보관함에 저장] + 하단 [‹ 이전 | 저장하고 작곡하러 가기] */}
        <View style={styles.buttonContainer}>
          {hasLyrics && (
            <View style={resultBarStyles.secondaryRow}>
              <ResultSecondaryButton label="다시 생성하기" onPress={handleRegenerate} />
              <ResultSecondaryButton label="보관함에 저장" onPress={handleSaveToBook} />
            </View>
          )}
          <ResultActionBar
            screen="LyricsResult"
            onBack={() => {
              if (navigation.canGoBack()) navigation.goBack();
              else navigation.popToTop();
            }}
            primaryLabel={
              !hasLyrics
                ? '다시 생성하기'
                : isGuest && !guestComposeUsed
                  ? '이 가사로 작곡 체험하기' // v3.277 [GuestCompose]: 게스트 작곡 체험 미사용이면 저장 없이 체험으로
                  : '저장하고 작곡하러 가기'
            }
            onPrimary={!hasLyrics ? handleRegenerate : handleSaveAndCompose}
          />
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.deepest,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingTop: 16,
  },
  directorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  portraitContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: colors.accent.primary,
    marginRight: 12,
  },
  portraitImage: {
    width: 60,
    height: 180,
    resizeMode: 'cover',
    position: 'absolute',
    top: 0,
    left: 0,
  },
  directorBubble: {
    flex: 1,
    backgroundColor: colors.bg.surface1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.accent.primary,
    padding: 12,
  },
  directorName: {
    fontSize: 13,
    fontWeight: 'bold',
    color: colors.accent.primary,
    marginBottom: 4,
  },
  directorText: {
    fontSize: 14,
    color: colors.text.primary,
    lineHeight: 20,
  },
  guestBanner: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  guestBannerText: {
    color: colors.text.secondary,
    fontSize: 13,
    lineHeight: 19,
  },
  errorBox: {
    backgroundColor: colors.bg.surface2,
    borderWidth: 1,
    borderColor: colors.accent.primary,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  errorText: {
    color: colors.status.error,
    fontSize: 13,
    lineHeight: 20,
  },
  titleSection: {
    marginBottom: 16,
  },
  titleDisplay: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.accent.primary,
    marginTop: 8,
  },
  titleInput: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 2,
    borderColor: colors.accent.primary,
    borderRadius: 12,
    padding: 12,
    color: colors.accent.primary,
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 8,
  },
  lyricsSection: {
    marginBottom: 24,
  },
  lyricsTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text.primary,
  },
  editButton: {
    fontSize: 14,
    color: colors.accent.primary,
    fontWeight: '600',
  },
  lyricsBox: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 12,
    padding: 16,
    minHeight: 200,
  },
  lyricsText: {
    color: colors.text.secondary,
    fontSize: 15,
    lineHeight: 26,
  },
  lyricsInputEditing: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 2,
    borderColor: colors.accent.primary,
    borderRadius: 12,
    padding: 16,
    color: colors.text.primary,
    fontSize: 15,
    lineHeight: 26,
    minHeight: 200,
  },
  buttonContainer: {
    gap: 12,
  },
  regenerateButton: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.accent.primary,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  regenerateButtonText: {
    color: colors.accent.primary,
    fontSize: 16,
    fontWeight: 'bold',
  },
  bookSaveButton: {
    backgroundColor: colors.bg.surface2,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  bookSaveButtonText: {
    color: colors.text.secondary,
    fontSize: 16,
    fontWeight: 'bold',
  },
  composeButton: {
    backgroundColor: colors.accent.primary,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  composeButtonText: {
    color: colors.text.primary,
    fontSize: 16,
    fontWeight: 'bold',
  },
});
