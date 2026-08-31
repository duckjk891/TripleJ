import { useState, useEffect } from 'react';
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
  Modal,
  Switch,
} from 'react-native';
import { showAlert } from '../utils/appAlert';
import { AppText } from '../components/ui';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLyricsStore } from '../stores/lyricsStore';
import { useAuthStore } from '../stores/authStore';
import { colors } from '../theme/colors';

const LYRICIST_PORTRAIT = require('../assets/portraits/lyricist_director.png');

const GENRE_OPTIONS = ['K-Pop', 'R&B', '힙합', '클래식', 'BGM', '록', '일렉트로닉', '가요'];
const MOOD_OPTIONS = ['밝은', '어두운', '감성적', '에너지틱', '몽환적'];
const TEMPO_OPTIONS = ['느린', '보통', '빠른'];
const LANGUAGE_OPTIONS = ['한국어', '영어', '일본어', '중국어'];
const DURATION_OPTIONS = [
  { value: 30, label: '30초' },
  { value: 60, label: '1분' },
  { value: 120, label: '2분' },
  { value: 180, label: '3분' },
  { value: 240, label: '4분' },
  { value: 300, label: '5분' },
];

type EditField = 'genre' | 'mood' | 'style' | 'content' | 'perspective' | 'language' | 'structure' | 'duration' | 'rap' | 'duet' | null;

const DUET_OPTIONS = ['솔로', '듀엣'];

const CONTENT_OPTIONS = ['사랑', '이별', '짝사랑', '우정', '성장·자기계발', '자유·일탈', '희망·꿈', '외로움·그리움', '일상의 소소함', '청춘·방황'];
const PERSPECTIVE_OPTIONS = ['1인칭 — 나', '2인칭 — 너에게 말하는', '3인칭 — 관찰자', '독백체', '대화체'];
const STYLE_OPTIONS = ['어쿠스틱', '피아노 발라드', '일렉트로닉', '밴드 사운드', '오케스트라', '로파이', '레트로', '트로피컬'];
const STRUCTURE_OPTIONS = ['절 — 후렴 (2절)', '절 — 후렴 — 브릿지', '절 — 후렴 (3절)', '절 — 후렴 — 절 — 후렴 — 브릿지 — 후렴', '자유 형식'];

type Props = NativeStackScreenProps<any, 'LyricsPromptReview'>;

export default function LyricsPromptReviewScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const store = useLyricsStore();
  const { user } = useAuthStore();
  const titleLabel = user?.display_title || '대표';
  const [editablePrompt, setEditablePrompt] = useState(store.generatedPrompt);
  const [editingField, setEditingField] = useState<EditField>(null);
  const [customInput, setCustomInput] = useState('');

  const buildPromptText = () => {
    const durationText = store.duration >= 60 ? `${Math.floor(store.duration / 60)}분` : `${store.duration}초`;
    const rapText = store.hasRap ? ', 랩 파트 포함' : '';
    const duetText = store.isDuet ? '. 듀엣 곡으로 메인 보컬과 서브 보컬 파트를 구분하여 작성해주세요' : '';
    const styleText = store.style ? ` 스타일은 ${store.style}입니다.` : '';
    const refText = store.reference ? ` ${store.reference} 스타일을 참고해주세요.` : '';
    const kwText = store.keywords ? ` 키워드는 ${store.keywords}입니다.` : '';
    return `${store.language} ${store.genre} 장르의 ${store.mood} 분위기 노래 가사를 작성해주세요. 곡 길이는 약 ${durationText}이고, ${store.perspective} 시점으로 ${store.content}에 대한 내용입니다. 구조는 ${store.structure}${rapText}${duetText}.${styleText}${kwText}${refText}`;
  };

  // 선택요약 수정 시 자동 반영
  useEffect(() => {
    const prompt = buildPromptText();
    setEditablePrompt(prompt);
    store.setGeneratedPrompt(prompt);
  }, [store.genre, store.mood, store.content, store.perspective, store.language, store.structure, store.duration, store.hasRap, store.isDuet, store.style, store.keywords, store.reference]);

  // v3.107: 대기열 타이머 폐지 — 요청 즉시 LyricsLoading으로 직행해 결과를 바로 보여준다
  // (작사는 서버 쿨다운 없음 — fatigue_service.py:5-6 미게이트)
  const handleGenerate = () => {
    store.setGeneratedPrompt(editablePrompt);
    console.log('[LyricsPromptReview] 작사 생성 시작 — LyricsLoading 직행');
    navigation.navigate('LyricsLoading' as any);
  };

  const handleFieldEdit = (field: EditField) => {
    setEditingField(field);
    setCustomInput('');
  };

  const handleSelectOption = (value: string) => {
    switch (editingField) {
      case 'genre': store.setGenre(value); break;
      case 'mood': store.setMood(value); break;
      case 'style': store.setStyle(value); break;
      case 'content': store.setContent(value); break;
      case 'perspective': store.setPerspective(value); break;
      case 'language': store.setLanguage(value); break;
      case 'structure': store.setStructure(value); break;
      case 'duet': store.setIsDuet(value === '듀엣'); break;
    }
    setEditingField(null);
    // useEffect가 자동 반영
  };

  const handleDurationSelect = (value: number) => {
    if (value > 300) {
      showAlert('알림', '5분 미만으로 입력해주세요.');
      return;
    }
    store.setDuration(value);
    setEditingField(null);
    // useEffect가 자동 반영
  };

  const handleRapToggle = (value: boolean) => {
    store.setHasRap(value);
    setEditingField(null);
    // useEffect가 자동 반영
  };

  const handleCustomSubmit = () => {
    if (!customInput.trim()) return;
    handleSelectOption(customInput.trim());
  };

  const getOptionsForField = (): string[] => {
    switch (editingField) {
      case 'genre': return GENRE_OPTIONS;
      case 'mood': return MOOD_OPTIONS;
      case 'style': return STYLE_OPTIONS;
      case 'content': return CONTENT_OPTIONS;
      case 'perspective': return PERSPECTIVE_OPTIONS;
      case 'language': return LANGUAGE_OPTIONS;
      case 'structure': return STRUCTURE_OPTIONS;
      case 'duet': return DUET_OPTIONS;
      default: return [];
    }
  };

  const getFieldTitle = (): string => {
    switch (editingField) {
      case 'genre': return '장르 선택';
      case 'mood': return '분위기 선택';
      case 'style': return '스타일 선택';
      case 'content': return '주제 선택';
      case 'perspective': return '시점 선택';
      case 'language': return '언어 선택';
      case 'structure': return '구조 선택';
      case 'duration': return '곡 길이 선택';
      case 'rap': return '랩 파트';
      case 'duet': return '듀엣 여부';
      default: return '';
    }
  };

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
              {`${titleLabel}님의 12가지 답변을 모아\n아래 프롬프트로 정리했어요`}
            </AppText>
          </View>
        </View>

        {/* 답변 → 프롬프트 흐름 안내 */}
        <View style={styles.flowHint}>
          <AppText style={styles.flowHintText}>
            <AppText style={{ color: colors.accent.primary, fontWeight: '700' }}>① 답변 요약</AppText>
            <AppText>{'  →  '}</AppText>
            <AppText style={{ color: colors.accent.primary, fontWeight: '700' }}>② 작사 디렉터에 전달할 내용</AppText>
          </AppText>
          <AppText style={styles.flowHintSubtext}>
            요약 카드를 탭하면 수정할 수 있고, 프롬프트도 직접 다듬을 수 있어요
          </AppText>
        </View>

        {/* Summary - clickable items (위) */}
        <View style={styles.summarySection}>
          <AppText style={styles.sectionTitle}>{`① ${titleLabel}님의 선택 (탭하여 수정)`}</AppText>
          <View style={styles.summaryGrid}>
            <TouchableOpacity onPress={() => handleFieldEdit('genre')}>
              <SummaryItem label="장르" value={store.genre} editable />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleFieldEdit('mood')}>
              <SummaryItem label="분위기" value={store.mood} editable />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleFieldEdit('style')}>
              <SummaryItem label="스타일" value={store.style || '-'} editable />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleFieldEdit('content')}>
              <SummaryItem label="주제" value={store.content} editable />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleFieldEdit('perspective')}>
              <SummaryItem label="시점" value={store.perspective} editable />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleFieldEdit('language')}>
              <SummaryItem label="언어" value={store.language} editable />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleFieldEdit('structure')}>
              <SummaryItem label="구조" value={store.structure} editable />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleFieldEdit('duration')}>
              <SummaryItem label="길이" value={store.duration >= 60 ? `${Math.floor(store.duration / 60)}분` : `${store.duration}초`} editable />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleFieldEdit('rap')}>
              <SummaryItem label="랩" value={store.hasRap ? '포함' : '없음'} editable />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleFieldEdit('duet')}>
              <SummaryItem label="듀엣" value={store.isDuet ? '듀엣' : '솔로'} editable />
            </TouchableOpacity>
          </View>
        </View>

        {/* Prompt review (아래) */}
        <View style={styles.promptSection}>
          <AppText style={styles.sectionTitle}>② 작사 디렉터에 전달할 내용 (자동 생성됨)</AppText>
          <AppText style={styles.promptHelper}>
            직접 다듬으셔도 좋아요. 위 답변을 수정하면 자동으로 다시 생성돼요.
          </AppText>
          <TextInput
            style={styles.promptInput}
            value={editablePrompt}
            onChangeText={setEditablePrompt}
            multiline
            textAlignVertical="top"
            placeholderTextColor={colors.text.muted}
          />
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
            ) : (
              <>
                <View style={styles.optionsContainer}>
                  {getOptionsForField().map((opt) => (
                    <TouchableOpacity
                      key={opt}
                      style={[
                        styles.optionButton,
                        ((editingField === 'genre' && store.genre === opt) ||
                          (editingField === 'mood' && store.mood === opt) ||
                          (editingField === 'style' && store.style === opt) ||
                          (editingField === 'content' && store.content === opt) ||
                          (editingField === 'perspective' && store.perspective === opt) ||
                          (editingField === 'language' && store.language === opt) ||
                          (editingField === 'structure' && store.structure === opt)) &&
                          styles.optionSelected,
                      ]}
                      onPress={() => handleSelectOption(opt)}
                    >
                      <AppText
                        style={[
                          styles.optionText,
                          ((editingField === 'genre' && store.genre === opt) ||
                            (editingField === 'mood' && store.mood === opt) ||
                            (editingField === 'style' && store.style === opt) ||
                            (editingField === 'content' && store.content === opt) ||
                            (editingField === 'perspective' && store.perspective === opt) ||
                            (editingField === 'language' && store.language === opt) ||
                            (editingField === 'structure' && store.structure === opt)) &&
                            styles.optionTextSelected,
                        ]}
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

function SummaryItem({ label, value, editable }: { label: string; value: string; editable?: boolean }) {
  return (
    <View style={[styles.summaryItem, editable && styles.summaryItemEditable]}>
      <AppText style={styles.summaryLabel}>{label}</AppText>
      <View style={styles.summaryValueRow}>
        <AppText style={styles.summaryValue}>{value}</AppText>
        {editable && <AppText style={styles.editIcon}>{'✎'}</AppText>}
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
  promptSection: {
    marginBottom: 20,
  },
  flowHint: {
    backgroundColor: colors.bg.surface1,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent.primary,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  flowHintText: {
    fontSize: 13,
    color: colors.text.primary,
    fontWeight: '600',
  },
  flowHintSubtext: {
    fontSize: 11,
    color: colors.text.muted,
    marginTop: 4,
    lineHeight: 16,
  },
  promptHelper: {
    fontSize: 11,
    color: colors.text.muted,
    marginBottom: 8,
    fontStyle: 'italic',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text.primary,
    marginBottom: 10,
  },
  promptInput: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.accent.primary,
    borderRadius: 12,
    padding: 14,
    color: colors.text.primary,
    fontSize: 14,
    minHeight: 160,
    lineHeight: 22,
  },
  summarySection: {
    marginBottom: 24,
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
