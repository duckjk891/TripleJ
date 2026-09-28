import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLevelUpQueueStore } from './levelUpQueueStore';
import { showArtistTierDialog } from '../components/LevelUpModal';
import {
  normalizeRecognition,
  RECOGNITION_MAX_STEP,
  RECOGNITION_STEPS,
} from '../data/levels';

// v3.251 [Recog]:
//  · 신규 = 서버 인지도(recognition) 캐시(characterId→step, AsyncStorage 영속) + 승급 감지.
//    /character/list 응답을 applyRecognitionSnapshot 으로 넘기면 이전 step과 비교해
//    세부 단계 승급 = levelUpQueue 토스트, 티어 승급 = 휘장 공개 다이얼로그.
//    첫 관측(캐시 없음)은 연출 없이 기준만 저장 — 기존 아티스트 소급 25명 폭죽 방지.
//  · 레거시 exp/level(유저당 1개, 구 이모지 등급표 연동)은 미사용화 — 토스트·젬 보너스
//    사이드이펙트 제거(연출은 recognition으로 이관), 수치 누적만 유지(fanSimulationStore의
//    가상 팬덤 페이스 계산이 level·songsReleased를 읽음 — Phase 2 서버 이관 시 삭제).

/** 레거시 exp 곡선 — 구 data/levels.artistExpForNextLevel 이관(미사용화 유지분) */
const legacyExpForNextLevel = (currentLevel: number): number =>
  Math.max(100, currentLevel * 100);

export interface RecognitionSnapshotItem {
  characterId: string;
  recognition: unknown;
}

interface ArtistState {
  // ── 레거시(미사용화 — 삭제는 후속) ─────────────────────────
  exp: number;
  level: number;
  songsReleased: number;
  totalPlays: number;
  /**
   * 레거시 EXP 누적 — v3.251부터 수치만 갱신(레벨업 토스트·젬 보너스 없음).
   * 호출부(PlayerScreen·playback·MusicResult·fanSimulation) 시그니처 호환 유지.
   */
  addExp: (delta: number, source: 'release' | 'play') => { leveledUp: boolean; newLevel: number };

  // ── v3.251 인지도 캐시 ────────────────────────────────────
  /** characterId → 마지막으로 본 25스텝 step (승급 감지 기준) */
  recognitionSteps: Record<string, number>;
  /** /character/list 응답 반영 — 비교 후 토스트/다이얼로그 enqueue + 캐시 갱신 */
  applyRecognitionSnapshot: (items: RecognitionSnapshotItem[]) => void;
}

export const useArtistStore = create<ArtistState>()(
  persist(
    (set, get) => ({
      exp: 0,
      level: 1,
      songsReleased: 0,
      totalPlays: 0,
      recognitionSteps: {},

      addExp: (delta, source) => {
        if (delta <= 0) return { leveledUp: false, newLevel: get().level };

        let { exp, level } = get();
        exp += delta;
        let leveledUp = false;

        while (exp >= legacyExpForNextLevel(level)) {
          exp -= legacyExpForNextLevel(level);
          level += 1;
          leveledUp = true;
          // v3.251: 레거시 레벨업 토스트·젬 보너스 제거 — 승급 연출은 recognition(서버) 기준으로 일원화
        }

        const songsInc = source === 'release' ? 1 : 0;
        const playsInc = source === 'play' ? 1 : 0;

        set((state) => ({
          exp,
          level,
          songsReleased: state.songsReleased + songsInc,
          totalPlays: state.totalPlays + playsInc,
        }));

        return { leveledUp, newLevel: level };
      },

      applyRecognitionSnapshot: (items) => {
        if (!Array.isArray(items) || items.length === 0) return;
        const next = { ...get().recognitionSteps };
        let baselines = 0;
        let toasts = 0;
        let dialogs = 0;
        for (const it of items) {
          const cid = it?.characterId ? String(it.characterId) : '';
          if (!cid) continue;
          const rec = normalizeRecognition(it.recognition);
          const prev = next[cid];
          next[cid] = rec.step;
          if (typeof prev !== 'number') {
            // 첫 관측(캐시 없음) — 연출 없이 기준만 저장(소급 계정 폭죽 방지)
            baselines += 1;
            continue;
          }
          if (rec.step <= prev) {
            if (rec.step < prev && __DEV__) {
              console.info('[Recog] step 하향 보정(무연출)', { cid, prev, step: rec.step });
            }
            continue;
          }
          const prevStep = RECOGNITION_STEPS[Math.min(Math.max(prev, 1), RECOGNITION_MAX_STEP) - 1];
          if (prevStep && prevStep.tier !== rec.tier) {
            // 티어 승급(연습생→신인 등) — 휘장 공개 다이얼로그(여러 티어 점프도 최종 티어 1회)
            dialogs += 1;
            showArtistTierDialog(rec);
          } else {
            // 같은 티어 내 세부 단계 승급 — 토스트(여러 스텝 점프도 최종 라벨 1회)
            toasts += 1;
            useLevelUpQueueStore.getState().enqueue({
              kind: 'artist',
              newLevel: rec.step,
              rankLabel: rec.label,
              emoji: '',
              bonus: 0,
              tier: rec.tier,
              sub: rec.sub,
              message: '인지도가 올랐어요!',
            });
          }
        }
        set({ recognitionSteps: next });
        if (__DEV__) {
          console.info('[Recog] snapshot 반영', {
            artists: items.length, baselines, toasts, dialogs,
          });
        }
      },
    }),
    {
      name: 'artist-storage-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        exp: state.exp,
        level: state.level,
        songsReleased: state.songsReleased,
        totalPlays: state.totalPlays,
        // v3.251: 인지도 step 캐시 영속 — 앱 재시작 후에도 첫 관측 연출 억제 유지
        recognitionSteps: state.recognitionSteps,
      }),
    }
  )
);
