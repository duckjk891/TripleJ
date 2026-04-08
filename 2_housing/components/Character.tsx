import { useState, useEffect } from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import SpriteAnimator, { AnimationType, Direction } from './SpriteAnimator';

// 디렉터별 스프라이트 시트
const SPRITE_SHEETS = {
  artist: require('../assets/sprites/artist_director.png'),
  lyricist: require('../assets/sprites/lyricist_director.png'),
  composer: require('../assets/sprites/composer_director.png'),
  image: require('../assets/sprites/image_director.png'),
  video: require('../assets/sprites/video_director.png'),
};

export type DirectorType = keyof typeof SPRITE_SHEETS;

// 각 디렉터의 기본 행동 패턴
const BEHAVIOR_CYCLES: Record<DirectorType, AnimationType[]> = {
  artist: ['idle', 'drink', 'idle', 'walk'],
  lyricist: ['idle', 'read', 'idle', 'walk'],
  composer: ['idle', 'drink', 'idle', 'walk'],
  image: ['idle', 'read', 'idle', 'drink'],
  video: ['idle', 'walk', 'idle', 'drink'],
};

interface Props {
  type: DirectorType;
  x: number; // 맵 기준 x좌표 (px)
  y: number; // 맵 기준 y좌표 (px)
  mapScale: number; // 맵 스케일
  onPress?: () => void;
}

export default function Character({ type, x, y, mapScale, onPress }: Props) {
  const [animIndex, setAnimIndex] = useState(0);
  const [direction, setDirection] = useState<Direction>('front');

  const cycle = BEHAVIOR_CYCLES[type];
  const currentAnim = cycle[animIndex];

  // 행동 패턴 순환 (각 동작 3초)
  useEffect(() => {
    const interval = setInterval(() => {
      setAnimIndex((i) => {
        const next = (i + 1) % cycle.length;
        // 걷기일 때 방향 랜덤 변경
        if (cycle[next] === 'walk') {
          const dirs: Direction[] = ['right', 'back', 'left', 'front'];
          setDirection(dirs[Math.floor(Math.random() * 4)]);
        } else {
          setDirection('front');
        }
        return next;
      });
    }, 3000);

    return () => clearInterval(interval);
  }, [type]);

  const spriteScale = mapScale * 1.5;

  return (
    <TouchableOpacity
      style={{
        position: 'absolute',
        left: x * mapScale - (32 * spriteScale) / 2,
        top: y * mapScale - (64 * spriteScale) / 2,
        zIndex: 10,
      }}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <SpriteAnimator
        source={SPRITE_SHEETS[type]}
        animation={currentAnim}
        direction={direction}
        scale={spriteScale}
        fps={6}
      />
    </TouchableOpacity>
  );
}
