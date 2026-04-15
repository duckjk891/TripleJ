import { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  Animated,
  Alert,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMusicStore } from '../stores/musicStore';
import { useLyricsStore } from '../stores/lyricsStore';

const LYRICIST_PORTRAIT = require('../assets/portraits/lyricist_director.png');
const COMPOSER_PORTRAIT = require('../assets/portraits/composer_director.png');
const IMAGE_PORTRAIT = require('../assets/portraits/image_director.png');

type Props = NativeStackScreenProps<any, 'ComposerSelect'>;

interface ComposerInfo {
  id: 'suno' | 'wondera';
  name: string;
  portrait: any;
  description: string;
  specialties: string[];
  recommended: string[];
}

const COMPOSERS: ComposerInfo[] = [
  {
    id: 'suno',
    name: 'Suno 작곡가',
    portrait: COMPOSER_PORTRAIT,
    description: '다양한 장르의 음악을 빠르게 생성합니다. 보컬이 포함된 완성곡 제작에 특화되어 있어요.',
    specialties: ['팝', '힙합', 'R&B', '록', '일렉트로닉'],
    recommended: ['팝', '힙합', 'R&B', '록', '일렉트로닉', '가요'],
  },
  {
    id: 'wondera',
    name: 'Wondera 작곡가',
    portrait: IMAGE_PORTRAIT,
    description: '고품질 음악 제작이 전문입니다. 레퍼런스 음악을 참고해서 원하는 스타일로 만들 수 있어요.',
    specialties: ['클래식', 'BGM', '재즈', '앰비언트'],
    recommended: ['클래식', 'BGM', '재즈', '앰비언트'],
  },
];

export default function ComposerSelectScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const musicStore = useMusicStore();
  const lyricsStore = useLyricsStore();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  }, []);

  const isRecommended = (composer: ComposerInfo) => {
    return composer.recommended.includes(lyricsStore.genre);
  };

  const handleSelect = (composerId: 'suno' | 'wondera') => {
    if (!lyricsStore.generatedLyrics && !musicStore.lyrics) {
      Alert.alert('작사 필요', '먼저 작사 디렉터에게 가사를 만들어주세요!');
      return;
    }
    musicStore.setSelectedModel(composerId);
    navigation.navigate('MusicGeneration');
  };

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 16 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Director intro */}
        <View style={styles.directorRow}>
          <View style={styles.portraitContainer}>
            <Image source={LYRICIST_PORTRAIT} style={styles.portraitImage} />
          </View>
          <View style={styles.directorBubble}>
            <Text style={styles.directorName}>작사 디렉터</Text>
            <Text style={styles.directorText}>
              작곡을 도와줄 친구들을 소개해줄게요! 장르에 맞는 작곡가를 선택해보세요.
            </Text>
          </View>
        </View>

        {/* Composer cards */}
        {COMPOSERS.map((composer) => {
          const recommended = isRecommended(composer);
          return (
            <TouchableOpacity
              key={composer.id}
              style={[styles.composerCard, recommended && styles.composerCardRecommended]}
              onPress={() => handleSelect(composer.id)}
              activeOpacity={0.8}
            >
              {recommended && (
                <View style={styles.recommendBadge}>
                  <Text style={styles.recommendText}>추천</Text>
                </View>
              )}

              <View style={styles.composerHeader}>
                <View style={styles.composerPortraitContainer}>
                  <Image source={composer.portrait} style={styles.composerPortraitImage} />
                </View>
                <View style={styles.composerInfo}>
                  <Text style={styles.composerName}>{composer.name}</Text>
                  <Text style={styles.composerDescription}>
                    {composer.description}
                  </Text>
                </View>
              </View>

              <View style={styles.specialtiesContainer}>
                <Text style={styles.specialtiesLabel}>전문 장르</Text>
                <View style={styles.specialtiesChips}>
                  {composer.specialties.map((s) => (
                    <View key={s} style={styles.specialtyChip}>
                      <Text style={styles.specialtyText}>{s}</Text>
                    </View>
                  ))}
                </View>
              </View>

              <View style={styles.selectIndicator}>
                <Text style={styles.selectText}>선택하기</Text>
              </View>
            </TouchableOpacity>
          );
        })}

        <View style={{ height: 40 }} />
      </ScrollView>
    </Animated.View>
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
  composerCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#333',
    padding: 16,
    marginBottom: 16,
    position: 'relative',
  },
  composerCardRecommended: {
    borderColor: '#e94560',
  },
  recommendBadge: {
    position: 'absolute',
    top: -10,
    right: 16,
    backgroundColor: '#e94560',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
    zIndex: 1,
  },
  recommendText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  composerHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  composerPortraitContainer: {
    width: 70,
    height: 70,
    borderRadius: 35,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#e94560',
    marginRight: 14,
  },
  composerPortraitImage: {
    width: 70,
    height: 210,
    resizeMode: 'cover',
    position: 'absolute',
    top: 0,
    left: 0,
  },
  composerInfo: {
    flex: 1,
  },
  composerName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 6,
  },
  composerDescription: {
    fontSize: 13,
    color: '#aaa',
    lineHeight: 20,
  },
  specialtiesContainer: {
    marginBottom: 12,
  },
  specialtiesLabel: {
    fontSize: 12,
    color: '#888',
    marginBottom: 6,
  },
  specialtiesChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  specialtyChip: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  specialtyText: {
    color: '#ccc',
    fontSize: 12,
  },
  selectIndicator: {
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  selectText: {
    color: '#e94560',
    fontSize: 15,
    fontWeight: 'bold',
  },
});
