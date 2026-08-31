import { useState, useEffect, useRef } from 'react';
import { TouchableOpacity, StyleSheet, Animated, Easing, View, Text } from 'react-native';
import SpriteAnimator, { AnimationType, Direction } from './SpriteAnimator';
import { colors } from '../theme/colors';

// 디렉터별 스프라이트 시트
const SPRITE_SHEETS = {
  artist: require('../assets/sprites/artist_director.png'),
  lyricist: require('../assets/sprites/lyricist_director.png'),
  composer: require('../assets/sprites/composer_director.png'),
  wondera: require('../assets/sprites/wondera_director.png'),
  image: require('../assets/sprites/image_director.png'),
  video: require('../assets/sprites/video_director.png'),
};

export type DirectorType = keyof typeof SPRITE_SHEETS;

// 각 디렉터의 기본 행동 패턴
const BEHAVIOR_CYCLES: Record<DirectorType, AnimationType[]> = {
  artist: ['idle', 'drink', 'idle', 'walk'],
  lyricist: ['idle', 'read', 'idle', 'walk'],
  composer: ['idle', 'drink', 'idle', 'walk'],
  wondera: ['idle', 'read', 'idle', 'drink'],
  image: ['idle', 'read', 'idle', 'drink'],
  video: ['idle', 'walk', 'idle', 'drink'],
};

interface Props {
  type: DirectorType;
  x: number; // 맵 기준 x좌표 (px)
  y: number; // 맵 기준 y좌표 (px)
  mapScale: number; // 맵 스케일
  onPress?: () => void;
  name?: string;        // 캐릭터 아래 표시할 이름 (함께 이동)
  roleEn?: string;      // 영문 역할 (이름 아래 작은 글씨)
  // TMX 바닥 + 가구 제외 flood-fill로 산출된 방별 이동 가능 지점 리스트
  // (map-px 단위의 [dx, dy] — 디렉터 베이스 위치 기준 delta)
  walkDeltas?: Array<[number, number]>;
}

export default function Character({
  type,
  x,
  y,
  mapScale,
  onPress,
  name,
  roleEn,
  walkDeltas,
}: Props) {
  const [animIndex, setAnimIndex] = useState(0);
  // v3.105: 이동 없음(v37) — 방향은 정면 고정 상수. 이전엔 setAnimIndex updater 안에서
  // setDirection을 호출했는데, updater는 렌더 단계에서 실행되므로 그 안의 setState는
  // "Maximum update depth exceeded" 콘솔 경고의 전형 원인(렌더 중 set) → 제거.
  const direction: Direction = 'front';

  const cycle = BEHAVIOR_CYCLES[type];
  const currentAnim = cycle[animIndex];

  // 이동용 translate Animated.Value (screen 좌표 기준)
  const offsetX = useRef(new Animated.Value(0)).current;
  const offsetY = useRef(new Animated.Value(0)).current;

  // 제자리 고정 — walk 단계 진입해도 이동 없음 (사용자 요청 v37)
  // walkDeltas는 수신만 하고 사용하지 않음 (나중에 재활성 시 코드 유지)
  void walkDeltas;

  useEffect(() => {
    const interval = setInterval(() => {
      // 스프라이트 방향은 정면 고정 (이동 없음) — updater 안에서 다른 setState 호출 금지
      setAnimIndex((i) => (i + 1) % cycle.length);
    }, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const spriteScale = mapScale * 1.5;

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: x * mapScale - (32 * spriteScale) / 2,
        top: y * mapScale - (64 * spriteScale) / 2,
        zIndex: 20, // fg 레이어(15)보다 위 — 캐릭터가 가구에 가려지지 않도록
        transform: [{ translateX: offsetX }, { translateY: offsetY }],
      }}
    >
      {/* 캐릭터 아래 네임 라벨 — 클릭 가능 (디렉터명 탭해도 대화 트리거) */}
      {name && (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={onPress}
          style={{
            position: 'absolute',
            top: 64 * spriteScale + 2,
            left: -80 + (32 * spriteScale) / 2,
            width: 160,
            alignItems: 'center',
            zIndex: 25,
          }}
        >
          <View style={characterStyles.nameBadge}>
            <Text style={characterStyles.nameText} numberOfLines={1}>
              {name}
            </Text>
          </View>
        </TouchableOpacity>
      )}
      <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
        <SpriteAnimator
          source={SPRITE_SHEETS[type]}
          animation={currentAnim}
          direction={direction}
          scale={spriteScale}
          fps={6}
        />
      </TouchableOpacity>
    </Animated.View>
  );
}

const characterStyles = StyleSheet.create({
  nameBadge: {
    alignSelf: 'center',
    backgroundColor: 'rgba(13, 8, 32, 0.85)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.accent.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    shadowColor: colors.bg.deepest,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.5,
    shadowRadius: 3,
    elevation: 3,
  },
  nameText: {
    color: colors.text.primary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
