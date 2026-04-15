import { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Image,
  TouchableOpacity,
  Animated,
  useWindowDimensions,
  ScrollView,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Character, { DirectorType } from '../components/Character';
import { DialogueNode } from '../types';

import lyricistDialogue from '../dialogues/lyricist.json';
import { useLyricsStore } from '../stores/lyricsStore';
import { useMusicStore } from '../stores/musicStore';

const MAP_IMAGE = require('../assets/map_rendered.png');
const MAP_WIDTH = 704;
const MAP_HEIGHT = 2208;

// TMX 분석 결과: 걸레받이(baseboard) 행이 각 방 상단 벽 위치
// Room 1: rows 4-15, Room 2: rows 14-25, Room 3: rows 24-35, Room 4: rows 34-45, Room 5: rows 44-55
const ROOM_BOUNDS: Record<string, { top: number; bottom: number }> = {
  artist: { top: 128, bottom: 480 },
  lyricist: { top: 448, bottom: 800 },
  composer: { top: 768, bottom: 1120 },
  image: { top: 1088, bottom: 1440 },
  video: { top: 1408, bottom: 1760 },
};

const DIRECTOR_POSITIONS: Record<string, { x: number; y: number }> = {
  artist: { x: 208, y: 340 },
  lyricist: { x: 208, y: 660 },
  composer: { x: 208, y: 980 },
  image: { x: 208, y: 1300 },
  video: { x: 208, y: 1620 },
};

const PORTRAITS: Record<string, any> = {
  artist: require('../assets/portraits/artist_director.png'),
  lyricist: require('../assets/portraits/lyricist_director.png'),
  composer: require('../assets/portraits/composer_director.png'),
  image: require('../assets/portraits/image_director.png'),
  video: require('../assets/portraits/video_director.png'),
};

type StudioStackParamList = {
  Map: undefined;
  Dialogue: {
    directorType: DirectorType;
    directorName: string;
    directorRole: string;
    directorY: number;
  };
  LyricsInput: undefined;
  ComposerInput: undefined;
  ComposerSelect: undefined;
  MusicGeneration: undefined;
};

type Props = NativeStackScreenProps<StudioStackParamList, 'Dialogue'>;

export default function DialogueScreen({ route, navigation }: Props) {
  const { directorType, directorName, directorRole, directorY } = route.params;
  const lyricsStore = useLyricsStore();
  const musicStore = useMusicStore();
  const hasLyrics = !!(lyricsStore.generatedLyrics || musicStore.lyrics);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [displayedText, setDisplayedText] = useState('');
  const [isTyping, setIsTyping] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const mapScale = screenWidth / MAP_WIDTH;
  const mapDisplayHeight = MAP_HEIGHT * mapScale;

  // Use actual room boundaries for focus area
  const bounds = ROOM_BOUNDS[directorType] || { top: directorY - 128, bottom: directorY + 128 };
  const roomCenterY = ((bounds.top + bounds.bottom) / 2) * mapScale;
  const mapOffsetY = Math.max(0, roomCenterY - screenHeight * 0.3);

  // Room focus area using actual room bounds
  const roomTop = bounds.top * mapScale - mapOffsetY;
  const roomBottom = bounds.bottom * mapScale - mapOffsetY;

  const getDialogue = (): DialogueNode[] => {
    switch (directorType) {
      case 'lyricist':
        return lyricistDialogue as DialogueNode[];
      case 'composer':
        if (!hasLyrics) {
          return [
            {
              id: 1,
              speaker: 'composer',
              text: '안녕하세요! 작곡 디렉터입니다.',
              next: 2,
            },
            {
              id: 2,
              speaker: 'composer',
              text: '앗, 아직 가사가 준비되지 않았네요. 먼저 작사 디렉터에게 가사를 만들어 와주세요!',
            },
          ] as DialogueNode[];
        }
        return [
          {
            id: 1,
            speaker: 'composer',
            text: '안녕하세요! 작곡 디렉터입니다. 가사가 준비됐군요! 어떤 음악을 만들어 볼까요?',
            next: 2,
          },
          {
            id: 2,
            speaker: 'composer',
            text: '좋아요! 그럼 먼저 몇 가지를 여쭤볼게요. 저를 따라와주세요!',
            action: 'navigate:ComposerSelect',
          },
        ] as DialogueNode[];
      case 'artist':
        return [
          {
            id: 1,
            speaker: 'artist',
            text: '안녕하세요! 아티스트 디렉터입니다.',
            next: 2,
          },
          {
            id: 2,
            speaker: 'artist',
            text: '아직 서비스 준비 중이에요. 조금만 기다려주세요! 곧 멋진 아티스트를 만들어드릴게요.',
          },
        ] as DialogueNode[];
      case 'video':
        return [
          {
            id: 1,
            speaker: 'video',
            text: '안녕하세요! 영상 디렉터입니다.',
            next: 2,
          },
          {
            id: 2,
            speaker: 'video',
            text: '아직 서비스 준비 중이에요. 조금만 기다려주세요! 곧 멋진 뮤직비디오를 만들어드릴게요.',
          },
        ] as DialogueNode[];
      default:
        return [
          {
            id: 1,
            speaker: directorType,
            text: `안녕하세요! ${directorName}입니다. 아직 서비스 준비 중이에요. 조금만 기다려주세요!`,
          },
        ] as DialogueNode[];
    }
  };

  const dialogue = getDialogue();
  const currentNode = dialogue[currentIndex];

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, []);

  useEffect(() => {
    if (!currentNode) return;
    setDisplayedText('');
    setIsTyping(true);
    const fullText = currentNode.text;
    let charIndex = 0;

    const interval = setInterval(() => {
      charIndex++;
      setDisplayedText(fullText.substring(0, charIndex));
      if (charIndex >= fullText.length) {
        clearInterval(interval);
        setIsTyping(false);
      }
    }, 40);

    return () => clearInterval(interval);
  }, [currentIndex]);

  const handleTap = () => {
    if (isTyping) {
      setDisplayedText(currentNode.text);
      setIsTyping(false);
      return;
    }

    if (currentNode.action) {
      const [actionType, target] = currentNode.action.split(':');
      if (actionType === 'navigate') {
        navigation.navigate(target as any);
        return;
      }
    }

    if (currentNode.choices && currentNode.choices.length > 0) {
      return;
    }

    if (currentNode.next !== undefined) {
      const nextIdx = dialogue.findIndex((n) => n.id === currentNode.next);
      if (nextIdx !== -1) {
        setCurrentIndex(nextIdx);
        return;
      }
    }

    navigation.goBack();
  };

  const handleChoice = (nextId: number, action?: string) => {
    if (action) {
      const [actionType, target] = action.split(':');
      if (actionType === 'navigate') {
        navigation.navigate(target as any);
        return;
      }
    }
    const nextIdx = dialogue.findIndex((n) => n.id === nextId);
    if (nextIdx !== -1) {
      setCurrentIndex(nextIdx);
    }
  };

  if (!currentNode) {
    navigation.goBack();
    return null;
  }

  const speakerPortrait =
    PORTRAITS[currentNode.speaker] || PORTRAITS[directorType];

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      <TouchableOpacity
        style={styles.tapArea}
        activeOpacity={1}
        onPress={handleTap}
      >
        {/* Map background */}
        <View style={{ position: 'absolute', top: -mapOffsetY, left: 0, width: screenWidth, height: mapDisplayHeight, zIndex: 1 }}>
          <Image
            source={MAP_IMAGE}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: screenWidth,
              height: mapDisplayHeight,
            }}
            resizeMode="contain"
          />
          {/* Character sprites on map */}
          {(Object.keys(DIRECTOR_POSITIONS) as DirectorType[]).map((type) => (
            <Character
              key={type}
              type={type}
              x={DIRECTOR_POSITIONS[type].x}
              y={DIRECTOR_POSITIONS[type].y}
              mapScale={mapScale}
            />
          ))}
        </View>

        {/* Top dark overlay above the room */}
        {roomTop > 0 && (
          <View
            style={[
              styles.overlay,
              {
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: Math.max(0, roomTop),
                zIndex: 2,
              },
            ]}
          />
        )}
        {/* Bottom dark overlay below the room */}
        <View
          style={[
            styles.overlay,
            {
              position: 'absolute',
              top: Math.max(0, roomBottom),
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 2,
            },
          ]}
        />

        {/* Director portrait - large, bottom right, face to upper body */}
        <View style={styles.portraitContainer}>
          <Image
            source={speakerPortrait}
            style={styles.portrait}
            resizeMode="contain"
          />
        </View>

        {/* Director name */}
        <View style={styles.nameContainer}>
          <Text style={styles.nameText}>{directorName}</Text>
        </View>

        {/* White dialogue box at bottom */}
        <View style={styles.dialogueBox}>
          <Text style={styles.dialogueText}>
            {displayedText}
            {isTyping && <Text style={styles.cursor}>|</Text>}
          </Text>

          {/* Choices */}
          {!isTyping &&
            currentNode.choices &&
            currentNode.choices.length > 0 && (
              <View style={styles.choicesContainer}>
                {currentNode.choices.map((choice, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={styles.choiceButton}
                    onPress={() => handleChoice(choice.next, choice.action)}
                  >
                    <Text style={styles.choiceText}>{choice.text}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

          {/* Tap to continue */}
          {!isTyping && !currentNode.choices && (
            <Text style={styles.continueHint}>{'\u0009\u0009탭하여 계속\u25BC'}</Text>
          )}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  tapArea: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  overlay: {
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  portraitContainer: {
    position: 'absolute',
    bottom: 100,
    right: 0,
    zIndex: 10,
  },
  portrait: {
    width: 180,
    height: 320,
  },
  nameContainer: {
    position: 'absolute',
    bottom: 145,
    left: 16,
    zIndex: 21,
  },
  nameText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 4,
  },
  dialogueBox: {
    backgroundColor: '#f5f5f5',
    borderRadius: 16,
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 20,
    minHeight: 120,
    zIndex: 20,
  },
  dialogueText: {
    fontSize: 15,
    color: '#111',
    lineHeight: 24,
  },
  cursor: {
    color: '#e94560',
  },
  continueHint: {
    fontSize: 12,
    color: '#999',
    textAlign: 'right',
    marginTop: 8,
  },
  choicesContainer: {
    marginTop: 12,
    gap: 8,
  },
  choiceButton: {
    backgroundColor: '#e8e8e8',
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  choiceText: {
    color: '#222',
    fontSize: 14,
    textAlign: 'center',
  },
});
