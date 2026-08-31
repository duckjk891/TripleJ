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
import { AppText } from '../components/ui';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useLyricsStore } from '../stores/lyricsStore';
import { useMusicStore } from '../stores/musicStore';
import { generateLyrics } from '../services/lyricsService';
import { getFatigueStatus, isDirectorFatigued } from '../services/fatigueService';
import { showFatigueCooldownDialog } from '../utils/fatigueGate';
import { FatigueStatus } from '../types';
import { buildLyricsRequest } from '../utils/lyricsPrompt';
import { useGemsStore } from '../stores/gemsStore';
import { usePointsStore } from '../stores/pointsStore';
import { GEM_REWARDS } from '../data/directors';
import AppScreenLayout from '../components/AppScreenLayout';
import { colors } from '../theme/colors';

const LYRICIST_PORTRAIT = require('../assets/portraits/lyricist_director.png');

type Props = NativeStackScreenProps<any, 'LyricsLoading'>;

const LOADING_STEPS = [
  { label: '영감 수집', message: '영감을 모으고 있어요...' },
  { label: '가사 작성', message: '가사를 쓰고 있어요...' },
  { label: '운율 정리', message: '운율을 맞추고 있어요...' },
  { label: '마무리', message: '마무리 중이에요...' },
];

export default function LyricsLoadingScreen({ navigation }: Props) {
  const store = useLyricsStore();
  const [messageIndex, setMessageIndex] = useState(0);
  const dotAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Advance loading step (cap at last step, API finish will navigate away)
  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex((i) => Math.min(i + 1, LOADING_STEPS.length - 1));
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
        // v3.110 — 수집 답변을 백엔드 계약(prompt+구조화 필드)으로 조립해 전송.
        // 장르·분위기·스타일·길이는 별도 필드로만 보내고(prompt 중복 제거),
        // duet=true 시 백엔드 듀엣 전용 시스템 프롬프트([Female]/[Male] 라벨)가 활성화된다.
        const payload = buildLyricsRequest(useLyricsStore.getState());
        // console.info 여야 원격 로그(frontend.log)로 수집됨 — 전송 본문 실측용(v3.117.2)
        console.info('[LyricsLoading] 전송 payload', JSON.stringify(payload));
        const result = await generateLyrics(payload);

        if (isMounted) {
          const lyrics =
            result.lyrics || result.generated_lyrics || result.text || result.result || '';
          const title = result.title || '';
          store.setGeneratedTitle(title);
          store.setGeneratedLyrics(lyrics);
          // v3.102(B-4): 새로 작사한 가사 — 이전 가사 보관함 출처 스냅샷이 남아있지 않게 정리
          useMusicStore.getState().setLyricsSource(null);
          store.setIsLoading(false);
          // 캐시 보상 지급
          useGemsStore.getState().earn(GEM_REWARDS.TRACK_LYRICS_DONE, 'track_lyrics_done');
          // v3.79 UX-2: 가사 생성은 ⭐차감 — 헤더 별 배지 즉시 갱신
          usePointsStore.getState().fetchBalance();
          navigation.replace('LyricsResult');
        }
      } catch (err: any) {
        if (isMounted) {
          // v3.118: 작사 디렉터 피로 429 — 실패 화면(LyricsResult 에러) 미진입·무과금
          // (서버는 ⭐5 차감 *전* 게이트 — generate.py /lyrics/). 동일 다이얼로그로
          // 남은 시간 + ⭐/광고권 스킵 안내, 해제되면 생성 재시도 (MusicLoading v3.94 패턴).
          if (isDirectorFatigued(err)) {
            const gateRemain = Math.max(0, Math.floor(err?.response?.data?.cooldown_remaining_sec ?? 0));
            console.log('[LyricsLoading] [fatigue:lyricist] 429 게이트 — 남은', gateRemain, '초 (과금 없음)');
            store.setIsLoading(false);
            let fatigueStatus: FatigueStatus | null = null;
            try {
              fatigueStatus = await getFatigueStatus('lyricist'); // 스킵 비용·광고권 잔량 표시용 (실패해도 기본값 안내)
            } catch (statusErr: any) {
              console.warn('[LyricsLoading] [fatigue:lyricist] 상태 조회 실패:', statusErr?.response?.status);
            }
            if (!isMounted) return;
            showFatigueCooldownDialog({
              status: fatigueStatus,
              remainingSec: Math.max(gateRemain, Math.floor(fatigueStatus?.cooldown_remaining_sec ?? 0)),
              director: 'lyricist',
              cancelText: '돌아가기',
              onCancel: () => navigation.goBack(),
              onCleared: () => {
                // 스킵으로 쿨다운 해제 — 생성 재시도 (⭐ 작사 비용은 이 재시도에서 정상 차감)
                doGenerate();
              },
            });
            return;
          }
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
    <AppScreenLayout scroll={false} insideTab avoidMiniPlayer={false}>
      <View style={styles.content}>
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <View style={styles.portraitContainer}>
            <Image source={LYRICIST_PORTRAIT} style={styles.portraitImage} />
          </View>
        </Animated.View>

        <AppText style={styles.loadingText}>{LOADING_STEPS[messageIndex].message}</AppText>

        <ActivityIndicator size="large" color={colors.accent.primary} style={styles.spinner} />

        {/* 스텝 인디케이터 */}
        <View style={styles.stepRow}>
          {LOADING_STEPS.map((s, i) => {
            const state = i < messageIndex ? 'done' : i === messageIndex ? 'active' : 'pending';
            return (
              <View key={s.label} style={styles.stepItem}>
                <View
                  style={[
                    styles.stepDot,
                    state === 'active' && styles.stepDotActive,
                    state === 'done' && styles.stepDotDone,
                  ]}
                >
                  <AppText style={styles.stepDotText}>
                    {state === 'done' ? '✓' : i + 1}
                  </AppText>
                </View>
                <AppText
                  style={[
                    styles.stepLabel,
                    state === 'active' && styles.stepLabelActive,
                    state === 'done' && styles.stepLabelDone,
                  ]}
                  numberOfLines={1}
                >
                  {s.label}
                </AppText>
              </View>
            );
          })}
        </View>

        <View style={styles.noteContainer}>
          <AppText style={styles.noteText}>
            작사 디렉터가 {messageIndex + 1}/{LOADING_STEPS.length} 단계를 진행 중이에요.{'\n'}잠시만 기다려주세요...
          </AppText>
        </View>
      </View>
    </AppScreenLayout>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.deepest,
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
    borderColor: colors.accent.primary,
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
    color: colors.text.primary,
    marginBottom: 24,
    textAlign: 'center',
  },
  spinner: {
    marginBottom: 24,
  },
  stepRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 24,
    paddingHorizontal: 4,
  },
  stepItem: {
    alignItems: 'center',
    flex: 1,
  },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.bg.surface1,
    borderWidth: 1.5,
    borderColor: colors.border.subtle,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  stepDotActive: {
    backgroundColor: colors.accent.primary,
    borderColor: colors.accent.primary,
  },
  stepDotDone: {
    backgroundColor: colors.bg.surface2,
    borderColor: colors.accent.primary,
  },
  stepDotText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text.primary,
  },
  stepLabel: {
    fontSize: 10,
    color: colors.text.muted,
    textAlign: 'center',
  },
  stepLabelActive: {
    color: colors.accent.primary,
    fontWeight: '700',
  },
  stepLabelDone: {
    color: colors.text.secondary,
  },
  noteContainer: {
    backgroundColor: colors.bg.surface1,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  noteText: {
    fontSize: 13,
    color: colors.text.secondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
