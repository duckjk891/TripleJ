import { useState } from 'react';
import {
  StyleSheet,
  View,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Modal,
  useWindowDimensions,
} from 'react-native';
import { AppText } from './ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAndroidKeyboardLift } from '../hooks/useAndroidKeyboardLift';
import { colors } from '../theme/colors';

/**
 * v3.204(④): 답변 편집(재선택) 공용 모달 — 기준 UX는 작사 디렉터(LyricsInputScreen)의
 * 재선택 모달(v3.201(B)/v3.202(B) 검증본)을 마크업·스타일 그대로 추출한 것.
 * - Android edge-to-edge Modal 키보드 리프트(useAndroidKeyboardLift) + 동적 maxHeight 클램프
 * - freeText: 자유 입력 행(선택지 탭이 1차 UX — autoFocus 금지)
 * - extraActions: 배경 '사진 올리기'·의상 '꾸미기 가기' 같은 특수 버튼(선택지 아래 노출)
 */
export interface AnswerEditExtraAction {
  label: string;
  onPress: () => void;
}

interface AnswerEditModalProps {
  visible: boolean;
  title?: string;
  choices: string[];
  freeText?: boolean;
  extraActions?: AnswerEditExtraAction[];
  onPick: (text: string) => void;
  onCancel: () => void;
}

export default function AnswerEditModal({
  visible,
  title = '다시 선택하기',
  choices,
  freeText,
  extraActions,
  onPick,
  onCancel,
}: AnswerEditModalProps) {
  const insets = useSafeAreaInsets();
  // v3.202(B): 재선택 모달 동적 maxHeight 클램프용 — PlaylistPickerSheet 검증 패턴
  const { height: winH } = useWindowDimensions();
  // v3.201(B): Android edge-to-edge Modal — 키보드 열림 시 컨테이너를 위로 리프트(§1 훅 공용)
  const kbPad = useAndroidKeyboardLift(visible);
  const [input, setInput] = useState('');

  // 닫힘/선택 공통 — 자유 입력 리셋(선택지 탭·자유 입력 제출·취소 공통)
  const pick = (text: string) => {
    setInput('');
    onPick(text);
  };
  const cancel = () => {
    setInput('');
    onCancel();
  };
  const submitInput = () => {
    const text = input.trim();
    if (!text) return;
    pick(text);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={cancel}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        pointerEvents="box-none"
      >
        {/* v3.202(B): overlay center→flex-end — marginBottom 리프트가 100% 유효(담기 시트 검증) */}
        <TouchableOpacity
          style={[styles.reselectOverlay, { paddingBottom: insets.bottom + 24 }]}
          activeOpacity={1}
          onPress={cancel}
        >
          {/* Android: flex-end + marginBottom(kbPad) 리프트 — Modal 내 KAV padding 재도입 금지(v3.198)
              키보드 열림 중에는 maxHeight를 남는 화면과 기본 60% 중 작은 값으로 클램프 */}
          <View
            style={[
              styles.reselectContainer,
              { marginBottom: kbPad },
              kbPad > 0 && { maxHeight: Math.min(winH * 0.6, winH - (kbPad + insets.bottom) - 24) },
            ]}
          >
            <AppText style={styles.reselectTitle}>{title}</AppText>
            <ScrollView style={{ maxHeight: 300 }} keyboardShouldPersistTaps="handled">
              {choices.map((choice, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={styles.reselectOption}
                  onPress={() => pick(choice)}
                >
                  <AppText style={styles.reselectOptionText}>{choice}</AppText>
                </TouchableOpacity>
              ))}
              {(extraActions || []).map((action, idx) => (
                <TouchableOpacity
                  key={`extra_${idx}`}
                  style={styles.reselectOption}
                  onPress={() => {
                    setInput('');
                    action.onPress();
                  }}
                >
                  <AppText style={styles.extraActionText}>{action.label}</AppText>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {freeText && (
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.textInput}
                  placeholder="직접 입력..."
                  placeholderTextColor={colors.text.muted}
                  value={input}
                  onChangeText={setInput}
                  returnKeyType="send"
                  onSubmitEditing={submitInput}
                />
                <TouchableOpacity
                  style={[styles.sendButton, !input.trim() && styles.sendButtonDisabled]}
                  onPress={submitInput}
                  disabled={!input.trim()}
                >
                  <AppText style={styles.sendButtonText}>확인</AppText>
                </TouchableOpacity>
              </View>
            )}
            <TouchableOpacity style={styles.reselectClose} onPress={cancel}>
              <AppText style={styles.reselectCloseText}>취소</AppText>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// LyricsInputScreen 재선택 모달 스타일 그대로 추출 (회귀 0 원칙)
const styles = StyleSheet.create({
  reselectOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    // v3.202(B): center → flex-end — marginBottom 키보드 리프트가 전량 유효하도록(Yoga 산식).
    // 하단 여백은 렌더부 인라인 paddingBottom(insets.bottom+24)이 담당.
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  reselectContainer: {
    backgroundColor: colors.bg.surface1,
    borderRadius: 16,
    padding: 20,
    width: '85%',
    maxHeight: '60%',
  },
  reselectTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text.primary,
    marginBottom: 16,
    textAlign: 'center',
  },
  reselectOption: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: colors.bg.deepest,
    marginBottom: 6,
  },
  reselectOptionText: {
    color: colors.text.secondary,
    fontSize: 14,
  },
  // 특수 액션(사진 올리기·꾸미기 가기 등) — 선택지와 구분되는 강조 색
  extraActionText: {
    color: colors.accent.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  reselectClose: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  reselectCloseText: {
    color: colors.text.secondary,
    fontSize: 14,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 10,
    gap: 8,
  },
  textInput: {
    flex: 1,
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: colors.text.primary,
    fontSize: 14,
    maxHeight: 100,
  },
  sendButton: {
    backgroundColor: colors.accent.primary,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sendButtonDisabled: {
    backgroundColor: colors.border.subtle,
  },
  sendButtonText: {
    color: colors.text.primary,
    fontWeight: 'bold',
    fontSize: 14,
  },
});
