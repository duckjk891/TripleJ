import { useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  Image,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Switch,
} from 'react-native';
import { AppText } from '../components/ui';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLyricsStore } from '../stores/lyricsStore';
import { useAuthStore } from '../stores/authStore';
import { getFatigueStatus } from '../services/fatigueService';
import { showFatigueCooldownDialog } from '../utils/fatigueGate';
import { colors } from '../theme/colors';
import {
  buildLyricsRequest,
  formatDuration,
  GENRE_OPTIONS,
  MOOD_OPTIONS,
  STYLE_OPTIONS,
  CONTENT_OPTIONS,
  KEYWORD_OPTIONS,
  PERSPECTIVE_OPTIONS,
  LANGUAGE_OPTIONS,
  STRUCTURE_OPTIONS,
  DUET_OPTIONS,
  DURATION_OPTIONS,
} from '../utils/lyricsPrompt';

const LYRICIST_PORTRAIT = require('../assets/portraits/lyricist_director.png');

// v3.110 — 사용자 화면은 "항목별 요약 카드"만. 프롬프트 원문은 숨기고
// 전송 시 utils/lyricsPrompt.buildLyricsRequest 가 백엔드 계약대로 조립한다.
type EditField =
  | 'genre'
  | 'mood'
  | 'style'
  | 'content'
  | 'keywords'
  | 'perspective'
  | 'language'
  | 'structure'
  | 'duration'
  | 'rap'
  | 'duet'
  | 'reference'
  | null;

type Props = NativeStackScreenProps<any, 'LyricsPromptReview'>;

export default function LyricsPromptReviewScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const store = useLyricsStore();
  const { user } = useAuthStore();
  const titleLabel = user?.display_title || '대표';
  const [editingField, setEditingField] = useState<EditField>(null);
  const [customInput, setCustomInput] = useState('');

  // v3.118: 작사 디렉터 피로 게이트 중복 탭 방지
  const fatigueCheckingRef = useRef(false);

  const startLyricsLoading = () => {
    // 프롬프트 원문은 사용자에게 노출하지 않고 전송 직전 조립 (generatedPrompt 는 세션 플래그 겸 기록)
    store.setGeneratedPrompt(buildLyricsRequest(useLyricsStore.getState()).prompt);
    console.log('[LyricsPromptReview] 작사 생성 시작 — LyricsLoading 직행');
    navigation.navigate('LyricsLoading' as any);
  };

  // v3.118: 작사 디렉터 휴식(쿨다운) 게이트 — 생성 시작 전 사전 확인(429 무과금과 동일 다이얼로그)
  const handleGenerate = async () => {
    if (fatigueCheckingRef.current) return;
    fatigueCheckingRef.current = true;
    try {
      const status = await getFatigueStatus('lyricist');
      const remain = Math.max(0, Math.floor(status?.cooldown_remaining_sec ?? 0));
      if (remain > 0) {
        console.log('[LyricsPromptReview] [fatigue:lyricist] 게이트 — 남은', remain, '초');
        showFatigueCooldownDialog({
          status,
          remainingSec: remain,
          director: 'lyricist',
          onCleared: startLyricsLoading,
        });
        return;
      }
    } catch (err: any) {
      // 조회 실패는 게이트 오픈 — 서버 429가 최종 방어 (LyricsLoading에서 동일 다이얼로그)
      console.warn('[LyricsPromptReview] [fatigue:lyricist] 상태 조회 실패:', err?.response?.status, err?.message);
    } finally {
      fatigueCheckingRef.current = false;
    }
    startLyricsLoading();
  };

  const handleFieldEdit = (field: EditField) => {
    setEditingField(field);
    if (field === 'reference') {
      setCustomInput(store.reference === '없음' ? '' : store.reference);
    } else if (field === 'keywords') {
      setCustomInput('');
    } else {
      setCustomInput('');
    }
  };

  const handleSelectOption = (value: string) => {
    switch (editingField) {
      case 'genre': store.setGenre(value); break;
      case 'mood': store.setMood(value); break;
      case 'style': store.setStyle(value); break;
      case 'content': store.setContent(value); break;
      case 'keywords': store.setKeywords(value); break;
      case 'perspective': store.setPerspective(value); break;
      case 'language': store.setLanguage(value); break;
      case 'structure': store.setStructure(value); break;
      case 'duet': store.setIsDuet(value === '듀엣'); break;
      case 'reference': store.setReference(value); break;
    }
    setEditingField(null);
  };

  const handleDurationSelect = (value: number) => {
    store.setDuration(value);
    setEditingField(null);
  };

  const handleRapToggle = (value: boolean) => {
    store.setHasRap(value);
    setEditingField(null);
  };

  const handleCustomSubmit = () => {
    if (editingField === 'reference') {
      // 추가 요청은 빈 값 = 없음 으로 허용
      store.setReference(customInput.trim());
      setEditingField(null);
      return;
    }
    if (!customInput.trim()) return;
    handleSelectOption(customInput.trim());
  };

  const getOptionsForField = (): string[] => {
    switch (editingField) {
      case 'genre': return GENRE_OPTIONS;
      case 'mood': return MOOD_OPTIONS;
      case 'style': return STYLE_OPTIONS;
      case 'content': return CONTENT_OPTIONS;
      case 'keywords': return KEYWORD_OPTIONS;
      case 'perspective': return PERSPECTIVE_OPTIONS;
      case 'language': return LANGUAGE_OPTIONS;
      case 'structure': return STRUCTURE_OPTIONS;
      case 'duet': return DUET_OPTIONS;
      default: return [];
    }
  };

  const isOptionSelected = (opt: string): boolean => {
    switch (editingField) {
      case 'genre': return store.genre === opt;
      case 'mood': return store.mood === opt;
      case 'style': return store.style === opt;
      case 'content': return store.content === opt;
      case 'keywords': return store.keywords === opt;
      case 'perspective': return store.perspective === opt;
      case 'language': return store.language === opt;
      case 'structure': return store.structure === opt;
      case 'duet': return (store.isDuet ? '듀엣' : '솔로') === opt;
      default: return false;
    }
  };

  const getFieldTitle = (): string => {
    switch (editingField) {
      case 'genre': return '장르 선택';
      case 'mood': return '분위기 선택';
      case 'style': return '스타일 선택';
      case 'content': return '주제 선택';
      case 'keywords': return '꼭 들어갈 말';
      case 'perspective': return '시점 선택';
      case 'language': return '언어 선택';
      case 'structure': return '곡 구조 선택';
      case 'duration': return '곡 길이 선택';
      case 'rap': return '랩 파트';
      case 'duet': return '듀엣 여부';
      case 'reference': return '추가 요청';
      default: return '';
    }
  };

  const displayValue = (v: string) => (v && v !== '없음' ? v : '-');

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 140 : 80}
    >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 16 }]}
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
              {`${titleLabel}님의 답변을 이렇게 정리했어요.\n카드를 탭하면 바꿀 수 있어요!`}
            </AppText>
          </View>
        </View>

        {/* ① 이야기 */}
        <View style={styles.summarySection}>
          <AppText style={styles.sectionTitle}>이야기</AppText>
          <View style={styles.summaryGrid}>
            <TouchableOpacity onPress={() => handleFieldEdit('content')}>
              <SummaryItem label="주제" value={displayValue(store.content)} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleFieldEdit('keywords')}>
              <SummaryItem label="꼭 들어갈 말" value={displayValue(store.keywords)} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleFieldEdit('perspective')}>
              <SummaryItem label="시점" value={displayValue(store.perspective)} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleFieldEdit('reference')}>
              <SummaryItem label="추가 요청" value={displayValue(store.reference)} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ② 사운드 */}
        <View style={styles.summarySection}>
          <AppText style={styles.sectionTitle}>사운드</AppText>
          <View style={styles.summaryGrid}>
            <TouchableOpacity onPress={() => handleFieldEdit('genre')}>
              <SummaryItem label="장르" value={displayValue(store.genre)} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleFieldEdit('mood')}>
              <SummaryItem label="분위기" value={displayValue(store.mood)} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleFieldEdit('style')}>
              <SummaryItem label="스타일" value={displayValue(store.style)} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ③ 구성 */}
        <View style={styles.summarySection}>
          <AppText style={styles.sectionTitle}>구성</AppText>
          <View style={styles.summaryGrid}>
            <TouchableOpacity onPress={() => handleFieldEdit('structure')}>
              <SummaryItem label="곡 구조" value={displayValue(store.structure)} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleFieldEdit('duration')}>
              <SummaryItem label="길이" value={formatDuration(store.duration)} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleFieldEdit('rap')}>
              <SummaryItem label="랩" value={store.hasRap ? '포함' : '없음'} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleFieldEdit('duet')}>
              <SummaryItem label="듀엣" value={store.isDuet ? '듀엣' : '솔로'} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleFieldEdit('language')}>
              <SummaryItem label="언어" value={displayValue(store.language)} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.flowHint}>
          <AppText style={styles.flowHintSubtext}>
            이대로 작사 디렉터에게 전달할게요. 수정하고 싶은 카드가 있다면 탭해서 바꿔주세요.
          </AppText>
        </View>

        {/* Buttons */}
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <AppText style={styles.backButtonText}>뒤로 가기</AppText>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.generateButton}
            onPress={handleGenerate}
          >
            <AppText style={styles.generateButtonText}>가사 생성 시작</AppText>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Edit Modal */}
      <Modal
        visible={editingField !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setEditingField(null)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setEditingField(null)}
        >
          <View style={styles.modalContent}>
            <AppText style={styles.modalTitle}>{getFieldTitle()}</AppText>

            {editingField === 'rap' ? (
              <View style={styles.rapToggleRow}>
                <AppText style={styles.rapToggleLabel}>랩 파트 포함</AppText>
                <Switch
                  value={store.hasRap}
                  onValueChange={handleRapToggle}
                  trackColor={{ false: colors.border.subtle, true: colors.accent.primary }}
                  thumbColor={store.hasRap ? colors.text.primary : colors.text.secondary}
                />
              </View>
            ) : editingField === 'duration' ? (
              <View style={styles.optionsContainer}>
                {DURATION_OPTIONS.map((d) => (
                  <TouchableOpacity
                    key={d.value}
                    style={[
                      styles.optionButton,
                      store.duration === d.value && styles.optionSelected,
                    ]}
                    onPress={() => handleDurationSelect(d.value)}
                  >
                    <AppText
                      style={[
                        styles.optionText,
                        store.duration === d.value && styles.optionTextSelected,
                      ]}
                    >
                      {d.label}
                    </AppText>
                  </TouchableOpacity>
                ))}
              </View>
            ) : editingField === 'reference' ? (
              <View style={styles.customRow}>
                <TextInput
                  style={styles.customInput}
                  placeholder="예: IU - 밤편지 느낌으로"
                  placeholderTextColor={colors.text.muted}
                  value={customInput}
                  onChangeText={setCustomInput}
                  onSubmitEditing={handleCustomSubmit}
                />
                <TouchableOpacity style={styles.customSubmit} onPress={handleCustomSubmit}>
                  <AppText style={styles.customSubmitText}>확인</AppText>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <View style={styles.optionsContainer}>
                  {getOptionsForField().map((opt) => (
                    <TouchableOpacity
                      key={opt}
                      style={[styles.optionButton, isOptionSelected(opt) && styles.optionSelected]}
                      onPress={() => handleSelectOption(opt)}
                    >
                      <AppText
                        style={[styles.optionText, isOptionSelected(opt) && styles.optionTextSelected]}
                      >
                        {opt}
                      </AppText>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.customRow}>
                  <TextInput
                    style={styles.customInput}
                    placeholder="직접 입력..."
                    placeholderTextColor={colors.text.muted}
                    value={customInput}
                    onChangeText={setCustomInput}
                    onSubmitEditing={handleCustomSubmit}
                  />
                  <TouchableOpacity
                    style={[styles.customSubmit, !customInput.trim() && styles.customSubmitDisabled]}
                    onPress={handleCustomSubmit}
                    disabled={!customInput.trim()}
                  >
                    <AppText style={styles.customSubmitText}>확인</AppText>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={[styles.summaryItem, styles.summaryItemEditable]}>
      <AppText style={styles.summaryLabel}>{label}</AppText>
      <View style={styles.summaryValueRow}>
        <AppText style={styles.summaryValue} numberOfLines={1}>
          {value}
        </AppText>
        <AppText style={styles.editIcon}>{'✎'}</AppText>
      </View>
    </View>
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
    marginBottom: 20,
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
  flowHint: {
    backgroundColor: colors.bg.surface1,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent.primary,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  flowHintSubtext: {
    fontSize: 12,
    color: colors.text.secondary,
    lineHeight: 18,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.accent.primary,
    marginBottom: 8,
  },
  summarySection: {
    marginBottom: 18,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  summaryItem: {
    backgroundColor: colors.bg.surface1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    maxWidth: 320,
  },
  summaryItemEditable: {
    borderColor: colors.accent.primary,
    borderStyle: 'dashed',
  },
  summaryLabel: {
    fontSize: 11,
    color: colors.text.secondary,
    marginBottom: 2,
  },
  summaryValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  summaryValue: {
    fontSize: 14,
    color: colors.text.primary,
    fontWeight: '600',
    flexShrink: 1,
  },
  editIcon: {
    fontSize: 12,
    color: colors.accent.primary,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  backButton: {
    flex: 1,
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.accent.primary,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  backButtonText: {
    color: colors.accent.primary,
    fontSize: 16,
    fontWeight: 'bold',
  },
  generateButton: {
    flex: 2,
    backgroundColor: colors.accent.primary,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  generateButtonText: {
    color: colors.text.primary,
    fontSize: 16,
    fontWeight: 'bold',
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.bg.surface1,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text.primary,
    marginBottom: 16,
    textAlign: 'center',
  },
  optionsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  optionButton: {
    backgroundColor: colors.bg.deepest,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  optionSelected: {
    backgroundColor: colors.accent.primary,
    borderColor: colors.accent.primary,
  },
  optionText: {
    color: colors.text.secondary,
    fontSize: 14,
  },
  optionTextSelected: {
    color: colors.text.primary,
    fontWeight: 'bold',
  },
  customRow: {
    flexDirection: 'row',
    gap: 8,
  },
  customInput: {
    flex: 1,
    backgroundColor: colors.bg.deepest,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: colors.text.primary,
    fontSize: 14,
  },
  customSubmit: {
    backgroundColor: colors.accent.primary,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  customSubmitDisabled: {
    backgroundColor: colors.border.subtle,
  },
  customSubmitText: {
    color: colors.text.primary,
    fontWeight: 'bold',
    fontSize: 14,
  },
  rapToggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  rapToggleLabel: {
    color: colors.text.primary,
    fontSize: 16,
  },
});
