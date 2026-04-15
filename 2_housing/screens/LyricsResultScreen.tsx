import { useState } from 'react';
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
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLyricsStore } from '../stores/lyricsStore';
import { useMusicStore } from '../stores/musicStore';

const LYRICIST_PORTRAIT = require('../assets/portraits/lyricist_director.png');

type Props = NativeStackScreenProps<any, 'LyricsResult'>;

export default function LyricsResultScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const store = useLyricsStore();
  const musicStore = useMusicStore();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingLyrics, setIsEditingLyrics] = useState(false);
  const [editedTitle, setEditedTitle] = useState(store.generatedTitle || '');
  const [editedLyrics, setEditedLyrics] = useState(store.generatedLyrics);

  const hasError = !!store.error;
  const hasLyrics = editedLyrics.trim().length > 0;

  const handleSaveAndCompose = () => {
    store.setGeneratedTitle(editedTitle);
    store.setGeneratedLyrics(editedLyrics);
    // Pre-fill music store with lyrics params
    musicStore.setLyrics(editedLyrics);
    musicStore.setGenre(store.genre);
    musicStore.setMood(store.mood);
    musicStore.setTempo(store.tempo);
    navigation.navigate('ComposerSelect');
  };

  const handleRegenerate = () => {
    navigation.replace('LyricsLoading');
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
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
            <Text style={styles.directorName}>작사 디렉터</Text>
            <Text style={styles.directorText}>
              {hasError
                ? '앗, 문제가 생겼어요. 다시 시도해볼까요?'
                : '가사가 완성됐어요! 마음에 드시나요?'}
            </Text>
          </View>
        </View>

        {/* Error display */}
        {hasError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{store.error}</Text>
          </View>
        )}

        {/* Title display */}
        <View style={styles.titleSection}>
          <View style={styles.lyricsTitleRow}>
            <Text style={styles.sectionTitle}>곡 제목</Text>
            <TouchableOpacity onPress={() => setIsEditingTitle(!isEditingTitle)}>
              <Text style={styles.editButton}>{isEditingTitle ? '완료' : '수정'}</Text>
            </TouchableOpacity>
          </View>
          {isEditingTitle ? (
            <TextInput
              style={styles.titleInput}
              value={editedTitle}
              onChangeText={setEditedTitle}
              placeholder="곡 제목을 입력하세요"
              placeholderTextColor="#555"
            />
          ) : (
            <Text style={styles.titleDisplay}>{editedTitle || '제목 없음'}</Text>
          )}
        </View>

        {/* Lyrics display */}
        <View style={styles.lyricsSection}>
          <View style={styles.lyricsTitleRow}>
            <Text style={styles.sectionTitle}>생성된 가사</Text>
            <TouchableOpacity onPress={() => setIsEditingLyrics(!isEditingLyrics)}>
              <Text style={styles.editButton}>{isEditingLyrics ? '완료' : '수정'}</Text>
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
              <Text style={styles.lyricsText}>
                {hasLyrics ? editedLyrics : '가사가 없습니다.'}
              </Text>
            </View>
          )}
        </View>

        {/* Action buttons */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={styles.regenerateButton}
            onPress={handleRegenerate}
          >
            <Text style={styles.regenerateButtonText}>다시 생성하기</Text>
          </TouchableOpacity>

          {hasLyrics && (
            <TouchableOpacity
              style={styles.composeButton}
              onPress={handleSaveAndCompose}
            >
              <Text style={styles.composeButtonText}>
                저장하고 작곡하러 가기
              </Text>
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
    backgroundColor: '#0a0a1a',
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
    borderColor: '#e94560',
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
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e94560',
    padding: 12,
  },
  directorName: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#e94560',
    marginBottom: 4,
  },
  directorText: {
    fontSize: 14,
    color: '#fff',
    lineHeight: 20,
  },
  errorBox: {
    backgroundColor: '#2e1a1a',
    borderWidth: 1,
    borderColor: '#e94560',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 13,
    lineHeight: 20,
  },
  titleSection: {
    marginBottom: 16,
  },
  titleDisplay: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#e94560',
    marginTop: 8,
  },
  titleInput: {
    backgroundColor: '#1a1a2e',
    borderWidth: 2,
    borderColor: '#e94560',
    borderRadius: 12,
    padding: 12,
    color: '#e94560',
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
    color: '#fff',
  },
  editButton: {
    fontSize: 14,
    color: '#e94560',
    fontWeight: '600',
  },
  lyricsBox: {
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 12,
    padding: 16,
    minHeight: 200,
  },
  lyricsText: {
    color: '#ddd',
    fontSize: 15,
    lineHeight: 26,
  },
  lyricsInputEditing: {
    backgroundColor: '#1a1a2e',
    borderWidth: 2,
    borderColor: '#e94560',
    borderRadius: 12,
    padding: 16,
    color: '#fff',
    fontSize: 15,
    lineHeight: 26,
    minHeight: 200,
  },
  buttonContainer: {
    gap: 12,
  },
  regenerateButton: {
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#e94560',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  regenerateButtonText: {
    color: '#e94560',
    fontSize: 16,
    fontWeight: 'bold',
  },
  composeButton: {
    backgroundColor: '#e94560',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  composeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
