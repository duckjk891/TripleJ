import { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  Animated,
} from 'react-native';
import { showAlert } from '../utils/appAlert';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMusicStore } from '../stores/musicStore';
import { useLyricsStore } from '../stores/lyricsStore';
import { colors } from '../theme/colors';
import { AppText, Tag } from '../components/ui';

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
      showAlert('작사 필요', '먼저 작사 디렉터에게 가사를 만들어주세요!');
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
            <AppText style={styles.directorName}>작사 디렉터</AppText>
            <AppText style={styles.directorText}>
              작곡을 도와줄 친구들을 소개해줄게요! 장르에 맞는 작곡가를 선택해보세요.
            </AppText>
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
                  <AppText style={styles.recommendText}>추천</AppText>
                </View>
              )}

              <View style={styles.composerHeader}>
                <View style={styles.composerPortraitContainer}>
                  <Image source={composer.portrait} style={styles.composerPortraitImage} />
                </View>
                <View style={styles.composerInfo}>
                  <AppText style={styles.composerName}>{composer.name}</AppText>
                  <AppText style={styles.composerDescription}>
                    {composer.description}
                  </AppText>
                </View>
              </View>

              <View style={styles.specialtiesContainer}>
                <AppText style={styles.specialtiesLabel}>전문 장르</AppText>
                <View style={styles.specialtiesChips}>
                  {composer.specialties.map((s) => (
                    <Tag key={s} label={s} size="sm" />
                  ))}
                </View>
              </View>

              <View style={styles.selectIndicator}>
                <AppText style={styles.selectText}>선택하기</AppText>
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
  composerCard: {
    backgroundColor: colors.bg.surface1,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.border.subtle,
    padding: 16,
    marginBottom: 16,
    position: 'relative',
  },
  composerCardRecommended: {
    borderColor: colors.accent.primary,
  },
  recommendBadge: {
    position: 'absolute',
    top: -10,
    right: 16,
    backgroundColor: colors.accent.primary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
    zIndex: 1,
  },
  recommendText: {
    color: colors.text.primary,
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
    borderColor: colors.accent.primary,
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
    color: colors.text.primary,
    marginBottom: 6,
  },
  composerDescription: {
    fontSize: 13,
    color: colors.text.secondary,
    lineHeight: 20,
  },
  specialtiesContainer: {
    marginBottom: 12,
  },
  specialtiesLabel: {
    fontSize: 12,
    color: colors.text.secondary,
    marginBottom: 6,
  },
  specialtiesChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  specialtyChip: {
    backgroundColor: colors.bg.surface2,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  specialtyText: {
    color: colors.text.secondary,
    fontSize: 12,
  },
  selectIndicator: {
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
  selectText: {
    color: colors.accent.primary,
    fontSize: 15,
    fontWeight: 'bold',
  },
});
