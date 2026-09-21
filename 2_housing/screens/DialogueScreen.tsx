import { useState, useEffect, useRef, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
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
import { AppText } from '../components/ui';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Character, { DirectorType } from '../components/Character';
import { DialogueNode } from '../types';

import lyricistDialogue from '../dialogues/lyricist.json';
import { useLyricsStore } from '../stores/lyricsStore';
import { useMusicStore } from '../stores/musicStore';
import { showAlert } from '../utils/appAlert';
import { colors } from '../theme/colors';
// v3.202(C): 창작 과정 기록 가이드 — recChip 탭·모드 안내 '자세히 보기'에서 PolicySheet로 표시
import PolicySheet from '../components/PolicySheet';
import { COPYRIGHT_RECORD_GUIDE } from '../constants/consentTexts';

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
    hasArtist?: boolean; // v3.182: 아티스트 디렉터 — 기보유 시 대화에서 내 아티스트로 안내
  };
  LyricsInput: undefined;
  ComposerSelect: undefined;
  MusicGeneration: undefined;
};

type Props = NativeStackScreenProps<StudioStackParamList, 'Dialogue'>;

// v3.200(②): 저작권 등록 모드 최초 선택 안내 — 앱 실행당 1회(모듈 플래그, rewardedGenerationIds 관행).
// 문구 금지선(Phase0 F7 §9): "저작권 등록 가능/보장/인정" 단정·"특허 기술" 언급 금지 — 사실 서술만.
let copyrightModeNoticeShown = false;

export default function DialogueScreen({ route, navigation }: Props) {
  const { directorType, directorName, directorRole, directorY, hasArtist } = route.params;
  const lyricsStore = useLyricsStore();
  const musicStore = useMusicStore();
  const hasLyrics = !!(lyricsStore.generatedLyrics || musicStore.lyrics);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [displayedText, setDisplayedText] = useState('');
  const [isTyping, setIsTyping] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  // v3.202(C): 창작 과정 기록 가이드 시트 — recChip 탭·모드 안내 '자세히 보기'로 열림(재열람 가능)
  const [recordGuideVisible, setRecordGuideVisible] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // v3.199(B): 대화 중 상단 명시적 뒤로가기 — Studio 탭 헤더(headerLeft)에 back 주입.
  // 아이콘·마진·사이즈는 stackHeader 관행(App.tsx) 동일.
  // v3.201(C): blur cleanup(headerLeft: undefined) 제거 — Dialogue→LyricsInput 전환 시 이 화면의
  // cleanup이 다음 화면 focus 주입 뒤에 실행될 수 있어(focus/blur 순서 비보장) 진입 직후 화살표가
  // 소실되는 경합의 주 원인이었다. "포커스 화면만 헤더에 쓴다" 불변식: 3화면 focus(set) +
  // MapScreen focus(clear)만 쓰기 지점 — 화살표 잔존 방지는 MapScreen 쪽 focus 클리어가 승계.
  useFocusEffect(
    useCallback(() => {
      const parent = navigation.getParent();
      parent?.setOptions({
        headerLeft: () => (
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={{ marginLeft: 12 }}
            accessibilityLabel="작업실로 돌아가기"
          >
            <Feather name="arrow-left" size={22} color={colors.text.primary} />
          </TouchableOpacity>
        ),
      });
    }, [navigation])
  );

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
        // v3.130(대표): 작사 DB(가사 보관함) 도입에 따라 작곡의 첫 질문 = 가사 선택.
        // 가사 유무 차단 제거 — 보관함 선택 화면이 빈 상태 안내까지 담당한다.
        return [
          {
            id: 1,
            speaker: 'composer',
            text: '안녕하세요! 작곡 디렉터입니다. 어떤 가사로 곡을 만들까요?',
            next: 2,
          },
          {
            id: 2,
            speaker: 'composer',
            text: '작사해둔 가사 중에서 골라주세요. 방금 작사한 가사가 있다면 맨 위에 보여드릴게요!',
            action: 'navigate:ComposeLyricsPick',
          },
        ] as DialogueNode[];
      case 'artist':
        // v3.182(대표): 기보유 계정도 대화 경유 — 캐릭터 인사 후 내 아티스트 목록으로
        if (hasArtist) {
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
              text: '우리 기획사 아티스트를 보러 가실까요? 꾸미기나 재생성도 거기서 할 수 있어요.',
              action: 'navigate:MyArtists',
            },
          ] as DialogueNode[];
        }
        return [
          {
            id: 1,
            speaker: 'artist',
            text: '안녕하세요! 우리 기획사의 새로운 아티스트를 함께 만들어볼까요?',
            next: 2,
          },
          {
            id: 2,
            speaker: 'artist',
            text: '얼굴 사진 한 장과 캐릭터의 인상만 알려주시면 제가 만들어드릴게요!',
            action: 'navigate:ArtistInput',
          },
        ] as DialogueNode[];
      case 'video':
        // v3.179(대표): 준비 중 안내 → 실제 영상 디렉터 상세 대화(VideoDirector)로 연결
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
            text: '발매한 곡의 커버와 가사로 공유 영상을 만들어 드려요. 스타일도 골라보실 수 있어요.',
            action: 'navigate:VideoDirector',
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

  // v3.200(②): 창작 모드 토글 — 작사 디렉터 대화(새 곡 시작 지점)에서만 노출.
  // 선택은 musicStore.creationMode에 저장 → 발매 track_type('copyright_ready',
  // 서버 화이트리스트)에 반영(MusicResultScreen). 세션 payload 반영은 백엔드 후속.
  const handleCreationModeSelect = (mode: 'standard' | 'copyright') => {
    if (mode === musicStore.creationMode) return;
    if (__DEV__) console.log('[CreationLog] 창작 모드 전환:', musicStore.creationMode, '->', mode);
    musicStore.setCreationMode(mode);
    if (mode === 'copyright' && !copyrightModeNoticeShown) {
      copyrightModeNoticeShown = true;
      // v3.202(C): '자세히 보기' → 가이드 전문(PolicySheet). 1회 안내 이후에도 recChip 탭으로 재열람 가능.
      showAlert(
        '저작권 등록 모드',
        '작사·작곡 전 과정(수정·선택 이력)이 기록됩니다. 저작권 등록 증빙 자료 생성 기능은 정식 프로모션 때 제공 예정이에요.',
        [
          { text: '자세히 보기', onPress: () => setRecordGuideVisible(true) },
          { text: '확인' },
        ]
      );
    }
  };

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
        if (target === 'goBack') {
          navigation.goBack();
          return;
        }
        // v3.130 — 가사 선택 모드로 보관함 진입 (파서가 params 미지원이라 별칭 처리)
        if (target === 'LyricsBookPick') {
          navigation.navigate('LyricsBook' as any, { pickerMode: true });
          return;
        }
        // RootStack 라우트는 parent navigator로 이동
        const ROOT_TARGETS = ['ArtistDetail', 'DirectorLineup', 'Player', 'Settings'];
        if (ROOT_TARGETS.includes(target)) {
          navigation.getParent()?.navigate(target as any);
        } else {
          navigation.navigate(target as any);
        }
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
        if (target === 'goBack') {
          navigation.goBack();
          return;
        }
        // v3.130 — 가사 선택 모드 별칭 (탭 진행 경로와 동일 처리)
        if (target === 'LyricsBookPick') {
          navigation.navigate('LyricsBook' as any, { pickerMode: true });
          return;
        }
        const ROOT_TARGETS = ['ArtistDetail', 'DirectorLineup', 'Player', 'Settings'];
        if (ROOT_TARGETS.includes(target)) {
          navigation.getParent()?.navigate(target as any);
        } else {
          navigation.navigate(target as any);
        }
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
          <AppText style={styles.nameText}>{directorName}</AppText>
        </View>

        {/* White dialogue box at bottom */}
        <View style={styles.dialogueBox}>
          <AppText style={styles.dialogueText}>
            {displayedText}
            {isTyping && <AppText style={styles.cursor}>|</AppText>}
          </AppText>

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
                    <AppText style={styles.choiceText}>{choice.text}</AppText>
                  </TouchableOpacity>
                ))}
              </View>
            )}

          {/* Tap to continue */}
          {!isTyping && !currentNode.choices && (
            <AppText style={styles.continueHint}>{'\u0009\u0009탭하여 계속\u25BC'}</AppText>
          )}
        </View>
      </TouchableOpacity>

      {/* v3.200(②): 창작 모드 토글 — 작사 디렉터 전용, 헤더 아래·대화 영역 위 상단 고정.
          v3.199(B) 뒤로가기는 부모 스택 헤더(headerLeft)에 있어 간섭 없음.
          % 게이지는 후속(origin 태깅 선행 필요) — 이번엔 상태 칩 1개만. */}
      {directorType === 'lyricist' && (
        <View style={styles.modeBar} pointerEvents="box-none">
          <View style={styles.modeToggle}>
            {([
              { key: 'standard', label: '일반 모드' },
              { key: 'copyright', label: '저작권 등록 모드' },
            ] as const).map(({ key, label }) => {
              const active = musicStore.creationMode === key;
              return (
                <TouchableOpacity
                  key={key}
                  style={[styles.modeSegment, active && styles.modeSegmentActive]}
                  onPress={() => handleCreationModeSelect(key)}
                  accessibilityLabel={label}
                >
                  <AppText style={[styles.modeSegmentText, active && styles.modeSegmentTextActive]}>
                    {label}
                  </AppText>
                </TouchableOpacity>
              );
            })}
          </View>
          {/* 저작권 등록 모드 상태 칩 — record 점(벡터 View, 이모지 금지) + 은은한 secondary 톤.
              v3.202(C): 탭 → 무엇이·왜 기록되는지 가이드(PolicySheet) 재열람. info 아이콘은 Feather(이모지 금지). */}
          {musicStore.creationMode === 'copyright' && (
            <TouchableOpacity
              style={styles.recChip}
              onPress={() => setRecordGuideVisible(true)}
              accessibilityLabel="창작 과정 기록 안내 보기"
            >
              <View style={styles.recDot} />
              <AppText style={styles.recChipText}>창작 과정 기록 중</AppText>
              <Feather name="info" size={12} color={colors.text.secondary} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* v3.202(C): 창작 과정 기록 가이드 — consentTexts 단일 출처, 사실 서술만(금지어 없음) */}
      <PolicySheet
        visible={recordGuideVisible}
        title={COPYRIGHT_RECORD_GUIDE.label}
        body={COPYRIGHT_RECORD_GUIDE.body}
        onClose={() => setRecordGuideVisible(false)}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.deepest,
  },
  tapArea: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  // v3.200(②): 창작 모드 토글 바 — 맵 오버레이(zIndex 2)·초상(10) 위, 탭 영역과 분리
  modeBar: {
    position: 'absolute',
    top: 12,
    left: 16,
    right: 16,
    zIndex: 30,
    alignItems: 'flex-start',
  },
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 20,
    padding: 3,
  },
  modeSegment: {
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  modeSegmentActive: {
    backgroundColor: colors.accent.primary,
  },
  modeSegmentText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text.secondary,
  },
  modeSegmentTextActive: {
    color: colors.text.primary,
    fontWeight: '700',
  },
  // 저작권 등록 모드 상태 칩 — 은은한 secondary 톤(과정 기록 사실 표시만)
  recChip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 10,
    gap: 6,
  },
  recDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.status.error,
  },
  recChipText: {
    fontSize: 11,
    color: colors.text.secondary,
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
    color: colors.text.primary,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 4,
  },
  dialogueBox: {
    backgroundColor: colors.text.primary,
    borderRadius: 16,
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 20,
    minHeight: 120,
    zIndex: 20,
  },
  dialogueText: {
    fontSize: 15,
    color: colors.bg.deepest,
    lineHeight: 24,
  },
  cursor: {
    color: colors.accent.primary,
  },
  continueHint: {
    fontSize: 12,
    color: colors.text.secondary,
    textAlign: 'right',
    marginTop: 8,
  },
  choicesContainer: {
    marginTop: 12,
    gap: 8,
  },
  choiceButton: {
    // TODO: 테마화 검토 (대화 선택지 - 밝은 회색 배경)
    backgroundColor: '#e8e8e8',
    borderWidth: 1,
    borderColor: colors.text.secondary,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  choiceText: {
    // TODO: 테마화 검토 (밝은 회색 배경 위 짙은 텍스트)
    color: '#222',
    fontSize: 14,
    textAlign: 'center',
  },
});
