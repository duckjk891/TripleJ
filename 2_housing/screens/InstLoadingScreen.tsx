// [InstLoading] v3.222 ②: Inst.(보컬 제거) 생성 → 작곡 디렉터 진행 화면.
// 마이페이지 ⋮ [Inst. 버전 만들기] 202 수락(또는 409 진행 중 resume) 시 진입해
// 기존 MyMusicScreen 백그라운드 while 폴링을 이 화면이 이관받는다(5s 축·10분 타임아웃 문안 동일).
// 스텝 5종(제출→보컬 분리→오디오 받기→정규화→발매)은 서버 파이프라인 실순서를 표시용으로만 차용 —
// 서버 status는 pending→processing→completed/failed 3단뿐(실측)이라 시간 전진 + status 전이 점프.
// completed 시 result_track_id 미리듣기(stream-proxy 소스 = Range OK — 시크 포함, MusicResult
// v3.204 Slider 패턴) + [마이페이지에서 보기]. failed 시 환불 문안 + [돌아가기].
// 이탈 자유(gestureEnabled 기본 — 서버 백그라운드 진행, MusicLoading의 잠금과 달리 강제성 없음).
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Audio } from 'expo-av';
import Slider from '@react-native-community/slider';
import { Feather } from '@expo/vector-icons';
import { AppText } from '../components/ui';
import AppScreenLayout from '../components/AppScreenLayout';
import ComposerLoadingView, { ComposerLoadingStep } from '../components/ComposerLoadingView';
import { getInstrumentalStatus } from '../services/trackService';
import { applyPlaybackAudioMode } from '../services/audioMode';
import { BACKEND_BASE_URL } from '../services/api';
import { colors } from '../theme/colors';

const COMPOSER_PORTRAIT = require('../assets/portraits/composer_director.png');

// Inst 전용 스텝 문안(기본안) — 서버 파이프라인 실순서(제출→보컬 분리→다운로드→정규화→발매) 차용
const INST_STEPS: ComposerLoadingStep[] = [
  { label: '제출', message: 'Inst. 작업을 접수하고 있어요...' },
  { label: '보컬 분리', message: '보컬을 분리하고 있어요...' },
  { label: '오디오 받기', message: '연주 오디오를 받고 있어요...' },
  { label: '정규화', message: '음질을 다듬고 있어요...' },
  { label: '발매', message: '트랙으로 발매하고 있어요...' },
];

type Phase = 'loading' | 'done' | 'failed' | 'timeout';

type Props = NativeStackScreenProps<any, 'InstLoading'>;

export default function InstLoadingScreen({ navigation, route }: Props) {
  const trackId: string = String(route.params?.trackId ?? '');
  const title: string = String(route.params?.title ?? '');
  const resume: boolean = !!route.params?.resume;
  // v3.223 C-10: 요청마다 새 인스턴스(StudioStack getId=nonce) — 폴링 effect 재시작 키로도 사용
  const nonce: string = String(route.params?.nonce ?? '');

  const [phase, setPhase] = useState<Phase>('loading');
  const [messageIndex, setMessageIndex] = useState(0);
  const [resultTrackId, setResultTrackId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 완료 미리듣기 플레이어 — MusicResult v3.204 패턴(Slider + isSeekingRef + seekValue 버퍼)
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);
  const isSeekingRef = useRef(false);
  const soundRef = useRef<Audio.Sound | null>(null);

  // v3.223 C-9: RN7 navigate('Map')는 기존 Map으로 pop하지 않고 새 Map을 push(실측 Map>InstLoading>Map)
  // → popTo('Map')로 스택을 되감아 이 화면을 닫는다(헤더 ←·실패 [돌아가기] 공통).
  const backToMap = useCallback(() => {
    if (__DEV__) console.info('[InstLoading] ← popTo(Map)');
    navigation.popTo('Map');
  }, [navigation]);

  // v3.222 ①관행 동일 적용: focus 시 Tab 헤더 headerLeft ← 주입(Dialogue :105-120 1:1),
  // 목적지 = Map(작업실) 일원화. 클리어는 Map focus가 승계(v3.201 불변식 — blur 시 헤더는 건드리지 않음).
  // v3.223 C-9: blur(탭 전환 등) 시 미리듣기 사운드 pause — 화면 이탈 후 재생 지속 방지.
  useFocusEffect(
    useCallback(() => {
      if (__DEV__) console.info('[InstLoading] 헤더 ← 주입(→Map)');
      const parent = navigation.getParent();
      parent?.setOptions({
        headerLeft: () => (
          <TouchableOpacity
            onPress={backToMap}
            style={{ marginLeft: 12 }}
            accessibilityLabel="작업실로 돌아가기"
          >
            <Feather name="arrow-left" size={22} color={colors.text.primary} />
          </TouchableOpacity>
        ),
      });
      return () => {
        const s = soundRef.current;
        if (s) {
          if (__DEV__) console.info('[InstLoading] blur — 미리듣기 pause');
          s.pauseAsync().catch(() => {});
        }
        setIsPlaying(false);
      };
    }, [navigation, backToMap])
  );

  // 시간 기반 스텝 전진(MusicLoading 4s 관행) — 진행 중에만
  useEffect(() => {
    if (phase !== 'loading') return undefined;
    const interval = setInterval(() => {
      setMessageIndex((i) => Math.min(i + 1, INST_STEPS.length - 1));
    }, 4000);
    return () => clearInterval(interval);
  }, [phase]);

  // 상태 폴링 — MyMusicScreen 기존 pollInstrumental 축 이관(5s·10분 타임아웃·일시 오류 무시).
  // resume 모드 포함 즉시 1회 확인(이미 완료면 바로 완료 카드 — MusicLoading resume 관행).
  useEffect(() => {
    if (!trackId) return undefined;
    // v3.223 C-10 방어: 같은 인스턴스 재사용(params만 교체) 시에도 이전 요청 상태가 남지 않도록 초기화
    setPhase('loading');
    setResultTrackId(null);
    setErrorMsg(null);
    setMessageIndex(0);
    setIsPlaying(false);
    setPosition(0);
    setDuration(0);
    let mounted = true;
    let interval: ReturnType<typeof setInterval> | null = null;
    const startedAt = Date.now();
    if (__DEV__) console.info('[InstLoading] 폴링 시작', { trackId, nonce, resume });

    const pollOnce = async () => {
      if (Date.now() - startedAt > 10 * 60 * 1000) {
        if (interval) clearInterval(interval);
        if (!mounted) return;
        if (__DEV__) console.info('[InstLoading] 10분 타임아웃 — 수동 확인 안내', { trackId });
        setPhase('timeout');
        return;
      }
      try {
        const data = await getInstrumentalStatus(trackId);
        if (!mounted) return;
        const st = String(data?.status || '').toLowerCase();
        if (__DEV__) console.info('[InstLoading] 상태', { trackId, status: st });
        if (st === 'processing') {
          // status 전이 점프 — processing 진입 시 최소 2단계(보컬 분리)
          setMessageIndex((i) => Math.max(i, 1));
        } else if (st === 'completed' || st === 'success' || st === 'done') {
          if (interval) clearInterval(interval);
          setMessageIndex(INST_STEPS.length - 1);
          setResultTrackId(data?.result_track_id ? String(data.result_track_id) : null);
          setPhase('done');
        } else if (st === 'failed' || st === 'error') {
          if (interval) clearInterval(interval);
          setErrorMsg(data?.error || 'Inst. 생성에 실패했어요. 차감된 스타(⭐)는 환불됩니다.');
          setPhase('failed');
        }
      } catch (err: any) {
        // 일시 네트워크/서버 오류는 폴링 지속(생성 자체는 서버 백그라운드 진행 — 기존 관행)
        console.error('[InstLoading] 상태 조회 실패(계속 폴링)', { trackId, status: err?.response?.status });
      }
    };

    pollOnce();
    interval = setInterval(pollOnce, 5000);
    return () => {
      mounted = false;
      if (interval) clearInterval(interval);
    };
    // resume은 진입 시점 값만 로그에 사용(재시작 키 아님)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId, nonce]);

  // 완료 미리듣기 로드 — 소스 /tracks/stream-proxy/{result_track_id}(v193 Range 완비 = 시크 OK)
  useEffect(() => {
    if (phase !== 'done' || !resultTrackId) return undefined;
    let mounted = true;
    const loadAudio = async () => {
      const audioUrl = `${BACKEND_BASE_URL}/api/tracks/stream-proxy/${resultTrackId}`;
      if (__DEV__) console.info('[InstLoading] 미리듣기 로드', { resultTrackId });
      try {
        await applyPlaybackAudioMode();
        const { sound: newSound } = await Audio.Sound.createAsync(
          { uri: audioUrl },
          { shouldPlay: false },
          (status: any) => {
            if (!mounted) return;
            if (status.isLoaded) {
              // 드래그 중엔 재생바를 status로 덮어쓰지 않음(MusicResult :237 동일)
              if (!isSeekingRef.current) setPosition(status.positionMillis || 0);
              setDuration(status.durationMillis || 0);
              if (status.didJustFinish) setIsPlaying(false);
            }
          }
        );
        if (!mounted) {
          try { await newSound.unloadAsync(); } catch {}
          return;
        }
        soundRef.current = newSound;
        setSound(newSound);
      } catch (err: any) {
        console.error('[InstLoading] 미리듣기 로드 실패', { resultTrackId, message: err?.message });
      }
    };
    loadAudio();
    return () => {
      mounted = false;
      const s = soundRef.current;
      soundRef.current = null;
      if (s) { s.unloadAsync().catch(() => {}); }
    };
  }, [phase, resultTrackId]);

  const togglePlay = async () => {
    if (!sound) return;
    try {
      if (isPlaying) {
        await sound.pauseAsync();
        setIsPlaying(false);
      } else {
        await sound.playAsync();
        setIsPlaying(true);
      }
    } catch (err: any) {
      console.error('[InstLoading] 재생 토글 실패', { message: err?.message });
    }
  };

  const formatTime = (ms: number) => {
    if (!Number.isFinite(ms) || ms < 0) return '--:--';
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  const seekable = Number.isFinite(duration) && duration > 0;

  const handleSlidingStart = () => {
    isSeekingRef.current = true;
    setSeekValue(position);
    setIsSeeking(true);
  };

  const handleSeek = async (value: number) => {
    setPosition(value);
    isSeekingRef.current = false;
    setIsSeeking(false);
    if (__DEV__) console.info('[InstLoading] seek', { to_ms: Math.round(value) });
    try {
      if (sound) await sound.setPositionAsync(value);
    } catch (err: any) {
      console.error('[InstLoading] seek 실패', { message: err?.message });
    }
  };

  // [마이페이지에서 보기] — 사운드 정리 후 마이페이지(숨김 탭)로. focus 시 목록 갱신은 MyMusic 담당.
  const goMyPage = () => {
    if (__DEV__) console.info('[InstLoading] 마이페이지로 이동', { resultTrackId });
    const s = soundRef.current;
    soundRef.current = null;
    setSound(null);
    setIsPlaying(false);
    if (s) { s.unloadAsync().catch(() => {}); }
    navigation.getParent()?.navigate('MyMusic');
  };

  const instTitle = title ? `${title} (Inst.)` : 'Inst. 트랙';

  return (
    <AppScreenLayout scroll={false} insideTab avoidMiniPlayer={false}>
      {phase === 'loading' && (
        <ComposerLoadingView
          steps={INST_STEPS}
          messageIndex={messageIndex}
          portrait={COMPOSER_PORTRAIT}
          noteText={`작곡 디렉터가 ${Math.min(messageIndex + 1, INST_STEPS.length)}/${INST_STEPS.length} 단계를 진행 중이에요.\n완료되면 "${instTitle}" 트랙이 내 곡에 추가돼요.\n작업이 끝날 때까지 이 화면을 벗어나지 마세요.`}
        />
      )}

      {phase === 'done' && (
        <View style={styles.centerWrap}>
          <View style={styles.card}>
            <View style={styles.doneBadge}>
              <Feather name="check" size={28} color={colors.accent.primary} />
            </View>
            <AppText style={styles.cardTitle}>Inst. 버전 완성!</AppText>
            <AppText style={styles.cardSub}>{`"${instTitle}" 트랙이 내 곡에 추가됐어요.`}</AppText>

            {resultTrackId ? (
              <View style={styles.playerBox}>
                {/* 미리듣기 — MusicResult v3.204 Slider 패턴(stream-proxy = Range OK, 시크 포함) */}
                <Slider
                  style={styles.seekSlider}
                  minimumValue={0}
                  maximumValue={seekable ? duration : 1}
                  value={isSeeking ? seekValue : position}
                  onValueChange={(v) => { if (isSeekingRef.current) setSeekValue(v); }}
                  onSlidingStart={handleSlidingStart}
                  onSlidingComplete={handleSeek}
                  disabled={!seekable}
                  minimumTrackTintColor={colors.accent.primary}
                  maximumTrackTintColor={colors.border.subtle}
                  thumbTintColor={colors.accent.primary}
                />
                <View style={styles.timeRow}>
                  <AppText style={styles.timeText}>{formatTime(isSeeking ? seekValue : position)}</AppText>
                  <AppText style={styles.timeText}>{formatTime(duration)}</AppText>
                </View>
                <TouchableOpacity
                  style={styles.playButton}
                  onPress={togglePlay}
                  accessibilityLabel={isPlaying ? '일시정지' : '미리듣기 재생'}
                >
                  <AppText style={styles.playButtonText}>{isPlaying ? '일시정지' : '미리듣기'}</AppText>
                </TouchableOpacity>
              </View>
            ) : null}

            <TouchableOpacity style={styles.primaryBtn} onPress={goMyPage} accessibilityLabel="마이페이지에서 보기">
              <AppText style={styles.primaryBtnText}>마이페이지에서 보기</AppText>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {phase === 'failed' && (
        <View style={styles.centerWrap}>
          <View style={styles.card}>
            <View style={[styles.doneBadge, styles.failBadge]}>
              <Feather name="x" size={28} color={colors.status.error} />
            </View>
            <AppText style={styles.cardTitle}>Inst. 생성 실패</AppText>
            <AppText style={styles.cardSub}>
              {errorMsg || 'Inst. 생성에 실패했어요. 차감된 스타(⭐)는 환불됩니다.'}
            </AppText>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={backToMap}
              accessibilityLabel="돌아가기"
            >
              <AppText style={styles.primaryBtnText}>돌아가기</AppText>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {phase === 'timeout' && (
        <View style={styles.centerWrap}>
          <View style={styles.card}>
            <View style={styles.doneBadge}>
              <Feather name="clock" size={28} color={colors.accent.primary} />
            </View>
            <AppText style={styles.cardTitle}>조금만 기다려주세요</AppText>
            <AppText style={styles.cardSub}>
              Inst. 생성이 오래 걸리고 있어요. 잠시 후 내 곡 목록을 새로고침해 확인해주세요.
            </AppText>
            <TouchableOpacity style={styles.primaryBtn} onPress={goMyPage} accessibilityLabel="마이페이지에서 보기">
              <AppText style={styles.primaryBtnText}>마이페이지에서 보기</AppText>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </AppScreenLayout>
  );
}

const styles = StyleSheet.create({
  centerWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    backgroundColor: colors.bg.surface1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: 24,
    alignItems: 'center',
  },
  doneBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.bg.surface2,
    borderWidth: 2,
    borderColor: colors.accent.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  failBadge: {
    borderColor: colors.status.error,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text.primary,
    marginBottom: 8,
    textAlign: 'center',
  },
  cardSub: {
    fontSize: 13,
    color: colors.text.secondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
  },
  playerBox: {
    width: '100%',
    marginBottom: 16,
  },
  seekSlider: {
    width: '100%',
    height: 32,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  timeText: {
    fontSize: 11,
    color: colors.text.muted,
  },
  playButton: {
    alignSelf: 'center',
    backgroundColor: colors.bg.surface2,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.accent.primary,
    paddingHorizontal: 24,
    paddingVertical: 8,
  },
  playButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.accent.primary,
  },
  primaryBtn: {
    width: '100%',
    backgroundColor: colors.accent.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text.primary,
  },
});
