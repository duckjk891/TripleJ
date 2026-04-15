import { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Image,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLyricsStore } from '../stores/lyricsStore';
import { useMusicStore } from '../stores/musicStore';
import api from '../services/api';

const IMAGE_PORTRAIT = require('../assets/portraits/image_director.png');

type Props = NativeStackScreenProps<any, 'CoverGeneration'>;

export default function CoverGenerationScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const lyricsStore = useLyricsStore();
  const musicStore = useMusicStore();

  const [style, setStyle] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);
  const [coverObjectName, setCoverObjectName] = useState<string | null>(null);

  const title = lyricsStore.generatedTitle || `${musicStore.genre} - ${musicStore.mood}` || '새로운 곡';

  const handleGenerate = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    try {
      const res = await api.post('/upload/generate-cover', {
        title,
        genre: lyricsStore.genre || musicStore.genre || undefined,
        mood: lyricsStore.mood || musicStore.mood || undefined,
        style: style.trim() || undefined,
      });
      const imageUrl = `http://192.168.219.106:9001${res.data.image_url}`;
      setCoverImageUrl(imageUrl);
      setCoverObjectName(res.data.object_name);
      Alert.alert('완료', '커버 이미지가 생성되었습니다!');
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || '커버 생성에 실패했습니다.';
      Alert.alert('실패', msg);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveToTrack = async () => {
    if (!coverImageUrl) {
      Alert.alert('알림', '먼저 커버 이미지를 생성해주세요.');
      return;
    }
    const trackId = musicStore.savedTrackId;
    if (!trackId) {
      Alert.alert('완료', '커버 이미지가 생성되었습니다!');
      navigation.popToTop();
      return;
    }

    try {
      // 생성된 이미지를 다운로드하여 POST /api/upload/image로 재업로드 (DB 자동 업데이트)
      const imageResponse = await fetch(coverImageUrl);
      const blob = await imageResponse.blob();

      const formData = new FormData();
      formData.append('file', {
        uri: coverImageUrl,
        type: 'image/png',
        name: 'cover.png',
      } as any);
      formData.append('type', 'cover');
      formData.append('id', trackId);

      await api.post('/upload/image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      console.log('[Cover] 트랙에 커버 연결 성공:', trackId);
      Alert.alert('완료', '커버 이미지가 저장되었습니다!');
    } catch (err: any) {
      console.error('[Cover] 연결 실패:', err?.message);
      Alert.alert('완료', '커버 이미지가 생성되었습니다!');
    }
    navigation.popToTop();
  };

  const handleSkip = () => {
    navigation.popToTop();
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
    >
      {/* Director message */}
      <View style={styles.directorRow}>
        <View style={styles.portraitContainer}>
          <Image source={IMAGE_PORTRAIT} style={styles.portraitImage} />
        </View>
        <View style={styles.directorBubble}>
          <Text style={styles.directorName}>이미지 디렉터</Text>
          <Text style={styles.directorText}>
            {coverImageUrl
              ? '커버 이미지가 완성됐어요! 마음에 드시나요?'
              : '곡의 커버 이미지를 만들어볼게요. 원하는 스타일이 있다면 알려주세요!'}
          </Text>
        </View>
      </View>

      {/* 곡 정보 */}
      <View style={styles.infoCard}>
        <Text style={styles.infoLabel}>곡 제목</Text>
        <Text style={styles.infoValue}>{title}</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          {(lyricsStore.genre || musicStore.genre) ? (
            <View style={styles.tag}><Text style={styles.tagText}>{lyricsStore.genre || musicStore.genre}</Text></View>
          ) : null}
          {(lyricsStore.mood || musicStore.mood) ? (
            <View style={[styles.tag, { backgroundColor: 'rgba(100,100,255,0.2)' }]}><Text style={styles.tagText}>{lyricsStore.mood || musicStore.mood}</Text></View>
          ) : null}
        </View>
      </View>

      {/* 스타일 입력 */}
      {!coverImageUrl && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>커버 스타일 (선택)</Text>
          <TextInput
            style={styles.styleInput}
            value={style}
            onChangeText={setStyle}
            placeholder="예: 몽환적인 밤하늘, 미니멀한 일러스트"
            placeholderTextColor="#555"
            multiline
          />
        </View>
      )}

      {/* 생성된 커버 */}
      {coverImageUrl && (
        <View style={styles.coverPreview}>
          <Image source={{ uri: coverImageUrl }} style={styles.coverImage} />
        </View>
      )}

      {/* 버튼 */}
      <View style={styles.buttonContainer}>
        {!coverImageUrl ? (
          <TouchableOpacity
            style={[styles.generateButton, isGenerating && { opacity: 0.6 }]}
            onPress={handleGenerate}
            disabled={isGenerating}
          >
            {isGenerating ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={styles.generateButtonText}>생성 중...</Text>
              </View>
            ) : (
              <Text style={styles.generateButtonText}>커버 이미지 생성하기</Text>
            )}
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity style={styles.generateButton} onPress={handleGenerate}>
              <Text style={styles.generateButtonText}>다시 생성하기</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveButton} onPress={handleSaveToTrack}>
              <Text style={styles.saveButtonText}>확인</Text>
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity style={styles.skipButton} onPress={handleSkip}>
          <Text style={styles.skipButtonText}>건너뛰기</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a1a' },
  content: { padding: 16 },
  directorRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 24 },
  portraitContainer: { width: 60, height: 60, borderRadius: 30, overflow: 'hidden', borderWidth: 2, borderColor: '#e94560', marginRight: 12 },
  portraitImage: { width: 60, height: 180, resizeMode: 'cover', position: 'absolute', top: 0, left: 0 },
  directorBubble: { flex: 1, backgroundColor: '#1a1a2e', borderRadius: 12, borderWidth: 1, borderColor: '#e94560', padding: 12 },
  directorName: { fontSize: 13, fontWeight: 'bold', color: '#e94560', marginBottom: 4 },
  directorText: { fontSize: 14, color: '#fff', lineHeight: 20 },
  infoCard: { backgroundColor: '#1a1a2e', borderRadius: 12, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: '#333' },
  infoLabel: { fontSize: 12, color: '#888', marginBottom: 4 },
  infoValue: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  tag: { backgroundColor: 'rgba(233,69,96,0.2)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  tagText: { fontSize: 12, color: '#aaa' },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: '#aaa', marginBottom: 8 },
  styleInput: { backgroundColor: '#1a1a2e', borderWidth: 1, borderColor: '#333', borderRadius: 12, padding: 14, color: '#fff', fontSize: 14, minHeight: 60, lineHeight: 22 },
  coverPreview: { alignItems: 'center', marginBottom: 24 },
  coverImage: { width: 240, height: 240, borderRadius: 16, borderWidth: 2, borderColor: '#e94560' },
  buttonContainer: { gap: 12, marginBottom: 40 },
  generateButton: { backgroundColor: '#e94560', borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  generateButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  saveButton: { backgroundColor: '#1a1a2e', borderRadius: 16, paddingVertical: 16, alignItems: 'center', borderWidth: 1, borderColor: '#e94560' },
  saveButtonText: { color: '#e94560', fontSize: 16, fontWeight: 'bold' },
  skipButton: { backgroundColor: '#1a1a2e', borderRadius: 16, paddingVertical: 16, alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  skipButtonText: { color: '#888', fontSize: 16, fontWeight: '600' },
});
