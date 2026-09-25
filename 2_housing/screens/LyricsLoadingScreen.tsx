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
import { showAlert } from '../utils/appAlert';
// v3.228 W3: 작사 job 전역 추적(자동 도착 알림·중복 차단·재시작 환불 정리) — lyrics 어댑터는 import 시 등록
import {
  registerGenJob,
  adoptGenJob,
  markGenJobDone,
  discardGenJob,
  endGenRequest,
  ackGenJob,
  guardGeneration,
  newRequestId,
  setViewerJob,
  releaseViewerJob,
} from '../services/generationTracker';
import { parseGenInProgress, genLedgerFields } from '../services/genJobsService';
import { failureBody } from '../services/genJobs';
import { LYRICS_TEXT, hydrateLyricsFromResult } from '../services/genJobs/lyrics';
import { useGenerationJobStore, useTrackedJob } from '../stores/generationJobStore';
import { applyLyricsResult, lyricsTextOf } from '../utils/lyricsHydrate';
import { useGenerationLeaveGuard } from '../hooks/useGenerationLeaveGuard';
import { confirmStarSpend } from '../utils/starSpendConfirm';

const LYRICIST_PORTRAIT = require('../assets/portraits/lyricist_director.png');

type Props = NativeStackScreenProps<any, 'LyricsLoading'>;

const LOADING_STEPS = [
  { label: '영감 수집', message: '영감을 모으고 있어요...' },
  { label: '가사 작성', message: '가사를 쓰고 있어요...' },
  { label: '운율 정리', message: '운율을 맞추고 있어요...' },
  { label: '마무리', message: '마무리 중이에요...' },
];

export default function LyricsLoadingScreen({ navigation, route }: Props) {
  const store = useLyricsStore();
  // v3.228 W3: resume 모드(route.params.jobId — 작업실 말풍선·[진행 상황 보기]) = POST 없이 추적 레코드 구독.
  // 새 요청도 응답 유실(ERR_NETWORK·timeout·5xx)·409 편입 시 같은 구독 모드로 전환한다.
  const resumeJobId: string | null = route.params?.jobId ? String(route.params.jobId) : null;
  const [watchKey, setWatchKey] = useState<string | null>(resumeJobId);
  const watched = useTrackedJob(watchKey);
  const outcomeHandledRef = useRef(false);
  const [messageIndex, setMessageIndex] = useState(0);
  const dotAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  // v3.230 A1-1(D1): 진행 중 이탈 가드 — 휴식·중복 안내 다이얼로그가 떠 있는 동안은 비활성(이중 팝업 방지)
  const [guardActive, setGuardActive] = useState(true);
  const { allowLeave } = useGenerationLeaveGuard(navigation, { screen: 'LyricsLoading', active: guardActive });
  const leaveBack = () => {
    allowLeave();
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Map' as any);
  };

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

  // v3.228 W3: 구독 모드 — 뷰어 등록(작업실 알림 대신 이 화면이 결과 표시)
  useEffect(() => {
    if (!watchKey) return undefined;
    setViewerJob(watchKey);
    return () => releaseViewerJob(watchKey);
  }, [watchKey]);

  // v3.228 W3: 구독 모드 결과 처리 — 추적기가 원장(GET /jobs/req/{rid})으로 갱신한 레코드를 따른다.
  // 네트워크 오류는 추적기가 상태 유지·백오프(실패 표시 없음). 서버 확정 실패만 실패 화면.
  useEffect(() => {
    if (!watchKey || outcomeHandledRef.current) return;
    if (!watched) {
      if (!useGenerationJobStore.persist.hasHydrated()) return;
      // 레코드 없음 = 이미 확인됨 또는 404 유예 경과 정리(추적기가 뷰어에 중립 안내) → 이전 화면
      outcomeHandledRef.current = true;
      console.info('[LyricsLoading] 추적 레코드 없음 — 복귀', { watchKey });
      store.setIsLoading(false);
      leaveBack();
      return;
    }
    if (watched.lastStatus === 'done') {
      outcomeHandledRef.current = true;
      const key = watchKey;
      void (async () => {
        const ok = await hydrateLyricsFromResult(watched.genResult);
        console.info('[LyricsLoading] 원장 완성 수신', { jobId: key, hydrated: ok });
        if (!ok) {
          store.setError('가사를 불러오지 못했어요. 가사 보관함에서 확인해 주세요.');
          store.setIsLoading(false);
        }
        ackGenJob(key);
        navigation.replace('LyricsResult');
      })();
    } else if (watched.lastStatus === 'failed') {
      outcomeHandledRef.current = true;
      console.info('[LyricsLoading] 원장 실패 확정', { jobId: watchKey, refunded: watched.refunded ?? null });
      // X-K1: 환불 안내는 서버 refunded=true(또는 서버 확정 문장)일 때만
      store.setError(failureBody(watched.error || '가사 생성에 실패했습니다.', watched.refunded, watched.notCharged));
      store.setIsLoading(false);
      ackGenJob(watchKey);
      navigation.replace('LyricsResult');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchKey, watched?.lastStatus, !!watched]);

  // Call API
  useEffect(() => {
    let isMounted = true;
    // v3.228 W3: 이 화면이 보낸 요청의 추적 레코드 키(뷰어 해제용)
    let requestKey: string | null = null;

    // v3.228 W3: resume 모드 — 새 생성(과금) 없이 위 구독 effect가 결과를 처리
    if (resumeJobId) {
      console.info('[LyricsLoading] 진행 중 작사 이어보기(POST 없음)', { jobId: resumeJobId });
      store.setIsLoading(true);
      store.setError(null);
      return () => {
        isMounted = false;
      };
    }

    const doGenerate = async () => {
      // v3.228: 중복 생성 최종 방어(사용자당 진행 중 1건 — 미확인 완성본은 비차단)
      if (guardGeneration('lyrics', { navigation, where: 'LyricsLoading', onDismiss: () => leaveBack() })) {
        if (isMounted) setGuardActive(false);
        return;
      }
      if (isMounted) setGuardActive(true);
      // v3.228: 요청 원장 — POST 직전 기록(응답을 잃어도 /jobs/req/{rid}로 정확히 회수)
      const rid = newRequestId();
      const key = registerGenJob({ kind: 'lyrics', requestId: rid, meta: { save: true } });
      requestKey = key;
      setViewerJob(key);
      store.setIsLoading(true);
      store.setError(null);

      try {
        // v3.110 — 수집 답변을 백엔드 계약(prompt+구조화 필드)으로 조립해 전송.
        // 장르·분위기·스타일·길이는 별도 필드로만 보내고(prompt 중복 제거),
        // duet=true 시 백엔드 듀엣 전용 시스템 프롬프트([Female]/[Male] 라벨)가 활성화된다.
        const payload: any = buildLyricsRequest(useLyricsStore.getState());
        // v3.131 (B-2): 작사 성공 시 서버 가사 자산 자동 저장 — "작사 DB" 자동 축적.
        // (비로그인은 서버가 401이므로 애초에 생성 자체가 로그인 필요 — save 무해)
        payload.save = true;
        // console.info 여야 원격 로그(frontend.log)로 수집됨 — 전송 본문 실측용(v3.117.2)
        console.info('[LyricsLoading] 전송 payload', JSON.stringify(payload));
        const result = await generateLyrics(payload, { requestId: rid });
        const ledger = genLedgerFields(result);

        if (isMounted) {
          // v3.228 W3: store 반영은 utils/lyricsHydrate로 추출(동작 불변 — 원장 회수 경로와 공용)
          applyLyricsResult(result);
          store.setIsLoading(false);
          // 캐시 보상 지급
          useGemsStore.getState().earn(GEM_REWARDS.TRACK_LYRICS_DONE, 'track_lyrics_done');
          // v3.79 UX-2: 가사 생성은 ⭐차감 — 헤더 별 배지 즉시 갱신
          usePointsStore.getState().fetchBalance();
          // v3.228: 결과를 이 화면이 직접 받음 → 확인 처리(추적 정리 + 서버 ack)
          markGenJobDone(key, { lyrics_id: result.lyrics_id ?? null, title: result.title ?? null }, {
            acked: true,
            serverJobId: ledger.genJobId,
          });
          navigation.replace('LyricsResult');
        } else {
          // v3.228: 화면을 벗어난 뒤 도착한 결과 — 추적 레코드에 남겨 작업실 도착 알림으로 회수
          markGenJobDone(
            key,
            { lyrics_id: result.lyrics_id ?? null, title: result.title ?? null, lyrics: lyricsTextOf(result) },
            { serverJobId: ledger.genJobId }
          );
        }
      } catch (err: any) {
        const status = err?.response?.status;
        // v3.228: 서버 409 — 이미 진행 중인 작사(다른 창·기기 포함)를 편입(같은 요청이면 같은 레코드)
        const busySnap = parseGenInProgress(err, 'lyrics');
        if (busySnap) {
          const adoptedKey = adoptGenJob(busySnap, { replaceKey: key });
          if (!isMounted) return;
          store.setIsLoading(false);
          setGuardActive(false);
          console.info('[LyricsLoading] 409 진행 중인 작사 — 편입', { jobId: adoptedKey });
          showAlert(LYRICS_TEXT.busyTitle, LYRICS_TEXT.busyBody, [
            { text: '닫기', style: 'cancel', onPress: () => leaveBack() },
            { text: '진행 상황 보기', onPress: () => { if (isMounted) { setGuardActive(true); setWatchKey(adoptedKey); } } },
          ]);
          return;
        }
        // v3.228: 응답 유실(네트워크·timeout·5xx)은 실패로 표시하지 않는다 — 원장 추적(구독 모드)으로 전환
        if (!err?.response || (typeof status === 'number' && status >= 500)) {
          endGenRequest(key);
          console.warn('[LyricsLoading] 응답 유실 — 원장 추적 전환', { status: status ?? null, message: err?.message });
          if (isMounted) setWatchKey(key);
          return;
        }
        // v3.228: 원장 전 거절(400·401·402·403·429 등 — 서버 원장 없음) → 추적 레코드 폐기
        discardGenJob(key, String(status));
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
            setGuardActive(false); // 휴식 다이얼로그와 가드 이중 팝업 방지
            showFatigueCooldownDialog({
              status: fatigueStatus,
              remainingSec: Math.max(gateRemain, Math.floor(fatigueStatus?.cooldown_remaining_sec ?? 0)),
              director: 'lyricist',
              cancelText: '돌아가기',
              onCancel: () => leaveBack(),
              onCleared: async () => {
                // 스킵으로 쿨다운 해제 — v3.230 A5-4: 확인 없는 자동 재요청 금지 → ⭐ 확인 1회 후 재시도
                const ok = await confirmStarSpend({
                  source: 'LyricsLoading',
                  costKey: 'lyrics',
                  action: '가사 만들기',
                  variant: 'fatigue-chain',
                });
                if (!isMounted) return;
                if (ok) doGenerate();
                else leaveBack(); // 입력은 store에 보존 — 요청서 화면으로 복귀
              },
            });
            return;
          }
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
      releaseViewerJob(requestKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            작사 디렉터가 {messageIndex + 1}/{LOADING_STEPS.length} 단계를 진행 중이에요.{'\n'}작업이 끝날 때까지 이 화면을 벗어나지 마세요.
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
