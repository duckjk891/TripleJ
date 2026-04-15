import { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Image,
  Animated,
  Easing,
  ActivityIndicator,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useLyricsStore } from '../stores/lyricsStore';
import { generateLyrics } from '../services/lyricsService';

const LYRICIST_PORTRAIT = require('../assets/portraits/lyricist_director.png');

type Props = NativeStackScreenProps<any, 'LyricsLoading'>;

const LOADING_MESSAGES = [
  '영감을 모으고 있어요...',
  '가사를 쓰고 있어요...',
  '운율을 맞추고 있어요...',
  '마무리 중이에요...',
];

export default function LyricsLoadingScreen({ navigation }: Props) {
  const store = useLyricsStore();
  const [messageIndex, setMessageIndex] = useState(0);
  const dotAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Cycle loading messages
  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex((i) => (i + 1) % LOADING_MESSAGES.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Pulse animation for portrait
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  // Call API
  useEffect(() => {
    let isMounted = true;

    const doGenerate = async () => {
      store.setIsLoading(true);
      store.setError(null);

      try {
        const result = await generateLyrics({
          prompt: store.generatedPrompt,
          genre: store.genre,
          mood: store.mood,
          language: store.language,
        });

        if (isMounted) {
          const lyrics =
            result.lyrics || result.generated_lyrics || result.text || result.result || '';
          const title = result.title || '';
          store.setGeneratedTitle(title);
          store.setGeneratedLyrics(lyrics);
          store.setIsLoading(false);
          navigation.replace('LyricsResult');
        }
      } catch (err: any) {
        if (isMounted) {
          const status = err?.response?.status;
          let errorMsg: string;
          if (status === 401) {
            errorMsg = '로그인이 필요합니다. 설정에서 다시 로그인해주세요.';
          } else {
            errorMsg =
              err?.response?.data?.detail ||
              err?.message ||
              '가사 생성에 실패했습니다.';
          }
          store.setError(typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg));
          store.setIsLoading(false);
          navigation.replace('LyricsResult');
        }
      }
    };

    doGenerate();
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <View style={styles.portraitContainer}>
            <Image source={LYRICIST_PORTRAIT} style={styles.portraitImage} />
          </View>
        </Animated.View>

        <Text style={styles.loadingText}>{LOADING_MESSAGES[messageIndex]}</Text>

        <ActivityIndicator size="large" color="#e94560" style={styles.spinner} />

        <View style={styles.noteContainer}>
          <Text style={styles.noteText}>
            작사 디렉터가 가사를 생성하고 있습니다.{'\n'}잠시만 기다려주세요...
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a1a',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  portraitContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: '#e94560',
    marginBottom: 32,
  },
  portraitImage: {
    width: 120,
    height: 360,
    resizeMode: 'cover',
    position: 'absolute',
    top: 0,
    left: 0,
  },
  loadingText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 24,
    textAlign: 'center',
  },
  spinner: {
    marginBottom: 32,
  },
  noteContainer: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  noteText: {
    fontSize: 13,
    color: '#888',
    textAlign: 'center',
    lineHeight: 20,
  },
});
