import { useState } from 'react';
import {
  StyleSheet,
  View,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Modal,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { AppText } from './ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  // [KeyboardCtl] v3.207(⑤): useAndroidKeyboardLift(marginBottom 리프트·동적 maxHeight) 제거 —
  // RN Keyboard 이벤트 의존이 SDK 54 edge-to-edge+Fabric 실기기에서 실패 확정.
  // keyboard-controller KAV(behavior='padding')로 iOS·Android 리프트 일원화(Modal 내 동작).
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
      {/* [KeyboardCtl] v3.207(⑤): keyboard-controller KAV(behavior='padding') — iOS·Android 공통.
          keyboardVerticalOffset=-insets.bottom: overlay 자체 paddingBottom(insets.bottom+24)과의
          이중 계상 상쇄(컨테이너 하단 = 키보드 상단 + 24). maxHeight 60%는 줄어든 overlay 기준이라
          동적 클램프 불요. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        keyboardVerticalOffset={-insets.bottom}
        pointerEvents="box-none"
      >
        {/* v3.202(B): overlay center→flex-end — 하단 정렬 유지(키보드 리프트와 정합) */}
        <TouchableOpacity
          style={[styles.reselectOverlay, { paddingBottom: insets.bottom + 24 }]}
          activeOpacity={1}
          onPress={cancel}
        >
          <View style={styles.reselectContainer}>
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
