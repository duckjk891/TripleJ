/**
 * PANN 플랫폼 컬러 팔레트
 *
 * 컨셉: 황혼의 보라 (Pan의 밤 → Apollo의 금빛)
 * 신화: Pan(판)이 Apollo와 음악 대결을 벌인 서사
 *
 * 사용법:
 *   import { colors as C } from '../theme/colors';
 *   backgroundColor: C.bg.deepest
 *   color: C.text.primary
 */

export const colors = {
  // 기본 배경 (어두움 → 밝음)
  bg: {
    deepest: '#0d0820',    // 한밤의 보라 (메인 배경)
    surface1: '#1e1340',   // 밤의 피아노 (카드)
    surface2: '#2a1758',   // 황혼 보라 (선택/강조 카드)
    surface3: '#3a2569',   // 테두리/분리선 강조
  },

  // 포인트 컬러
  accent: {
    primary: '#a855f7',     // Pan 보라 (주 포인트)
    primaryDim: '#7c3aed',  // 눌림/비활성
    primaryGlow: '#c084fc', // 하이라이트/호버
    secondary: '#fbbf24',   // Apollo 금빛 (성과/보상/완료)
    secondaryDim: '#d97706',
  },

  // 텍스트
  text: {
    primary: '#ffffff',    // 기본 흰 텍스트
    secondary: '#a78bfa',  // 연보라 (보조)
    muted: '#6b5b8e',      // 약한 회보라 (tertiary)
    inverse: '#0d0820',    // 밝은 배경용
  },

  // 상태 컬러
  status: {
    error: '#f87171',
    success: '#34d399',
    warning: '#fbbf24',
    info: '#60a5fa',
  },

  // 보더
  border: {
    default: '#3a2569',  // 기본 보더
    subtle: '#2a1758',   // 약한 보더
    accent: '#a855f7',   // 강조 보더 (선택됨)
  },

  // 그라데이션 (LinearGradient에 바로 사용)
  gradient: {
    twilight: ['#4c1d95', '#c026d3', '#e879f9'],  // 메인 황혼
    dusk: ['#0d0820', '#2a1758'],                  // 배경 그라데이션
    dawn: ['#2a1758', '#fbbf24'],                  // Pan → Apollo
    pannPrimary: ['#7c3aed', '#a855f7', '#c084fc'], // 버튼/포인트
  },

  // 레거시 호환 (점진적 마이그레이션용, 다 바꾸면 삭제)
  legacy: {
    red: '#e94560',
    deepNavy: '#1a1a2e',
    midNavy: '#16213e',
    black: '#0a0a1a',
  },
};

// 편의 alias (짧게 쓰고 싶을 때)
export const C = colors;
