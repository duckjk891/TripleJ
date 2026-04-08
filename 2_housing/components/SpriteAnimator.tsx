import { useEffect, useRef, useState } from 'react';
import { View, Image, ImageSourcePropType, StyleSheet } from 'react-native';

const FRAME_W = 32;
const FRAME_H = 64; // 캐릭터 1프레임 = 32x64 (머리+몸통 2행)
const SHEET_WIDTH = 1792;
const SHEET_HEIGHT = 1280;

// 방향 순서: 오른-뒤-왼-앞
export type Direction = 'right' | 'back' | 'left' | 'front';
const DIR_INDEX: Record<Direction, number> = { right: 0, back: 1, left: 2, front: 3 };

// 애니메이션 정의
export type AnimationType = 'idle' | 'walk' | 'drink' | 'read' | 'color_white' | 'color_red' | 'color_none';

interface AnimConfig {
  row: number;        // 시작 행 (2행 단위, 0-based → 실제 y = row * FRAME_H)
  framesPerDir: number; // 방향당 프레임 수
  totalFrames: number;  // 총 프레임 수
  directional: boolean; // 방향별 분리 여부
}

const ANIMATIONS: Record<AnimationType, AnimConfig> = {
  idle: { row: 0, framesPerDir: 1, totalFrames: 4, directional: true },
  walk: { row: 2, framesPerDir: 5, totalFrames: 20, directional: true },
  drink: { row: 6, framesPerDir: 12, totalFrames: 12, directional: false },
  read: { row: 7, framesPerDir: 12, totalFrames: 12, directional: false },
  color_white: { row: 19, framesPerDir: 1, totalFrames: 12, directional: true },
  color_red: { row: 19, framesPerDir: 1, totalFrames: 12, directional: true },
  color_none: { row: 19, framesPerDir: 1, totalFrames: 12, directional: true },
};

// 컬러 변형에서 방향별 시작 오프셋
function getFrameOffset(anim: AnimationType, direction: Direction): number {
  const dirIdx = DIR_INDEX[direction];
  if (anim === 'color_white') return dirIdx * 3 + 0;
  if (anim === 'color_red') return dirIdx * 3 + 1;
  if (anim === 'color_none') return dirIdx * 3 + 2;
  return 0;
}

interface Props {
  source: ImageSourcePropType;
  animation: AnimationType;
  direction: Direction;
  scale: number;
  fps?: number;
  playing?: boolean;
}

export default function SpriteAnimator({
  source,
  animation,
  direction,
  scale,
  fps = 6,
  playing = true,
}: Props) {
  const [frame, setFrame] = useState(0);
  const config = ANIMATIONS[animation];

  useEffect(() => {
    if (!playing) {
      setFrame(0);
      return;
    }

    const frameCount = config.directional ? config.framesPerDir : config.totalFrames;
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % frameCount);
    }, 1000 / fps);

    return () => clearInterval(interval);
  }, [animation, playing, fps]);

  // 프레임 좌표 계산
  let col: number;
  if (animation.startsWith('color_')) {
    col = getFrameOffset(animation, direction);
  } else if (config.directional) {
    const dirIdx = DIR_INDEX[direction];
    col = dirIdx * config.framesPerDir + frame;
  } else {
    col = frame;
  }
  const row = config.row;

  const displayW = FRAME_W * scale;
  const displayH = FRAME_H * scale;

  return (
    <View style={{ width: displayW, height: displayH, overflow: 'hidden' }}>
      <Image
        source={source}
        style={{
          width: SHEET_WIDTH * scale,
          height: SHEET_HEIGHT * scale,
          position: 'absolute',
          left: -col * displayW,
          top: -row * displayH,
        }}
        resizeMode="stretch"
      />
    </View>
  );
}
