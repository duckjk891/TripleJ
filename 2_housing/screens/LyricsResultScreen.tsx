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
// v3.200: 창작 기록 계층 — 가사 버전 커밋(문서 §7.4: 진입 시 AI 초안, 에디터 닫기 시 수정본).
// 실패 무해(서버 미배포/비로그인 시 no-op) — 가사 편집·작곡 진행을 절대 막지 않는다.
import { commitLyricsVersion } from '../services/creationLogService';
import { colors } from '../theme/colors';

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
  // 동일 내용 연속 저장 가드 (중복 저장 자체는 허용)
  const lastSavedSignatureRef = useRef<string | null>(null);

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

  const handleSaveAndCompose = () => {
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

  // v3.118: "다시 생성하기" — 작사 디렉터 휴식(쿨다운) 게이트 (대표 방침: 재생성 시 팝업)
  const handleRegenerate = async () => {
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
          onCleared: () => navigation.replace('LyricsLoading'),
        });
        return;
      }
    } catch (err: any) {
      // 조회 실패는 게이트 오픈 — 서버 429가 최종 방어 (LyricsLoading에서 동일 다이얼로그)
      console.warn('[LyricsResult] [fatigue:lyricist] 상태 조회 실패:', err?.response?.status, err?.message);
    } finally {
      fatigueCheckingRef.current = false;
    }
    navigation.replace('LyricsLoading');
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
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
        <View style={styles.lyricsSection}>
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
            <TextInput
              style={styles.lyricsInputEditing}
              value={editedLyrics}
              onChangeText={setEditedLyrics}
              multiline
              textAlignVertical="top"
            />
          ) : (
            <View style={styles.lyricsBox}>
              <AppText style={styles.lyricsText}>
                {hasLyrics ? editedLyrics : '가사가 없습니다.'}
              </AppText>
            </View>
          )}
        </View>

        {/* Action buttons */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={styles.regenerateButton}
            onPress={handleRegenerate}
          >
            <AppText style={styles.regenerateButtonText}>다시 생성하기</AppText>
          </TouchableOpacity>

          {hasLyrics && (
            <TouchableOpacity
              style={styles.bookSaveButton}
              onPress={handleSaveToBook}
            >
              <AppText style={styles.bookSaveButtonText}>보관함에 저장</AppText>
            </TouchableOpacity>
          )}

          {hasLyrics && (
            <TouchableOpacity
              style={styles.composeButton}
              onPress={handleSaveAndCompose}
            >
              <AppText style={styles.composeButtonText}>
                저장하고 작곡하러 가기
              </AppText>
            </TouchableOpacity>
          )}
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
