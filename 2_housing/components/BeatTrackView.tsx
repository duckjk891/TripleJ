/**
 * [BeatTrackView] v3.97(A-9) — MAIDOL BeatTrackView(v44) 이식(RN View 기반).
 * MAIDOL은 WaveSurfer 파형 + 비트 마커였지만, AIDOL은 신규 시각화 라이브러리 금지 —
 * RN View로 "움직이는 비트 스트립"을 그린다:
 *   - 현재 위치 앞뒤 8초 창([-2s, +6s])의 비트만 렌더(수백 개 전체 렌더 금지 — 성능)
 *   - 다운비트(마디 첫 박)는 길고 밝게 + 마디 번호, 일반 비트는 짧게
 *   - NOW 라인(창의 25% 지점) 고정, 비트가 좌로 흘러가며 방금 지난 비트가 점등
 * 상태 계약: services/beatsService.ts (pending|running → 3초 폴링, failed → 소유자만 재시도)
 * 메트로놈: MAIDOL은 WebAudio 오실레이터(에셋 없음) — AudioContext 있는 웹에서만 노출.
 * 위치 동기화: PlayerScreen의 positionMillis(expo-av status ~500ms)를 기준으로
 * 100ms 인터벌 보간(estMs) → 재생 UI(60fps)와 무관하게 이 컴포넌트만 10Hz 갱신.
 */
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  getTrackBeats,
  retryTrackBeats,
  BeatStatus,
} from '../services/beatsService';
import Metronome, { isMetronomeSupported } from '../utils/metronome';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { AppText } from './ui';

const POLL_INTERVAL_MS = 3000;
const TICK_MS = 100;              // 보간/메트로놈 틱 주기
const WINDOW_BEFORE_SEC = 2;      // NOW 라인 왼쪽(지난 비트) 구간
const WINDOW_AFTER_SEC = 6;       // NOW 라인 오른쪽(다가올 비트) 구간
const WINDOW_SEC = WINDOW_BEFORE_SEC + WINDOW_AFTER_SEC;
const NOW_PCT = (WINDOW_BEFORE_SEC / WINDOW_SEC) * 100; // 25%
const CURRENT_FLASH_SEC = 0.25;   // 방금 지난 비트 점등 유지 시간

interface Props {
  trackId: string;
  positionMillis: number;
  isPlaying: boolean;
  isOwner: boolean; // beats/retry는 소유자 전용(403) — 소유자에게만 재시도 버튼 노출
}

export default function BeatTrackView({ trackId, positionMillis, isPlaying, isOwner }: Props) {
  const [status, setStatus] = useState<BeatStatus>('pending');
  const [tempo, setTempo] = useState<number | null>(null);
  const [beats, setBeats] = useState<number[]>([]);
  const [downbeats, setDownbeats] = useState<number[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [pollEpoch, setPollEpoch] = useState(0); // 재시도 후 폴링 재시작 트리거

  const [estMs, setEstMs] = useState(positionMillis);
  const [metronomeOn, setMetronomeOn] = useState(false);
  const metronomeOnRef = useRef(false);
  const metronomeRef = useRef<Metronome | null>(null);
  const baseRef = useRef({ pos: positionMillis, at: Date.now() });
  const metronomeAvailable = isMetronomeSupported(); // 웹 전용(네이티브는 WebAudio 없음)

  // ── 상태 폴링 — completed/failed면 중단 (MAIDOL BeatTrackView.jsx 폴링 동작 동일) ──
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const poll = async () => {
      try {
        const data = await getTrackBeats(trackId);
        if (cancelled) return;
        setStatus(data.status);
        setTempo(data.tempo);
        setBeats(data.beats);
        setDownbeats(data.downbeats);
        setErrorMsg(data.error);
        if (data.status === 'completed' || data.status === 'failed') {
          if (timer) { clearInterval(timer); timer = null; }
        }
      } catch (err: any) {
        if (!cancelled) {
          console.error('[BeatTrackView] beats 조회 실패', { trackId, status: err?.response?.status });
          setErrorMsg(err?.response?.data?.error || '비트 정보를 불러오지 못했습니다.');
        }
      }
    };
    if (__DEV__) console.info('[BeatTrackView] 폴링 시작', { trackId, pollEpoch });
    poll(); // 즉시 1회
    timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [trackId, pollEpoch]);

  // ── 재생 위치 보간 — status 프롭(~500ms) 사이를 100ms 틱으로 메움 ──
  useEffect(() => {
    baseRef.current = { pos: positionMillis, at: Date.now() };
    setEstMs(positionMillis);
  }, [positionMillis]);

  useEffect(() => {
    if (!isPlaying || status !== 'completed') return;
    const id = setInterval(() => {
      const est = baseRef.current.pos + (Date.now() - baseRef.current.at);
      setEstMs(est);
      if (metronomeOnRef.current) metronomeRef.current?.tick(est / 1000);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [isPlaying, status]);

  // ── 메트로놈 수명주기(웹 전용) ──
  useEffect(() => {
    if (status !== 'completed' || !metronomeAvailable) return;
    const m = new Metronome();
    m.setBeats(beats, downbeats);
    m.setVolume(0.3); // MAIDOL 기본 볼륨
    metronomeRef.current = m;
    return () => {
      m.destroy();
      metronomeRef.current = null;
    };
  }, [status, beats, downbeats, metronomeAvailable]);

  useEffect(() => {
    metronomeOnRef.current = metronomeOn;
    const m = metronomeRef.current;
    if (!m) return;
    if (metronomeOn && isPlaying) m.start();
    else m.stop();
  }, [metronomeOn, isPlaying, status]);

  const handleRetry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await retryTrackBeats(trackId);
      setStatus('pending');
      setErrorMsg(null);
      setBeats([]);
      setDownbeats([]);
      setTempo(null);
      setPollEpoch((e) => e + 1); // 폴링 재시작
    } catch (err: any) {
      console.error('[BeatTrackView] 재시도 실패', { trackId, status: err?.response?.status });
      setErrorMsg(err?.response?.data?.error || '재시도에 실패했습니다.');
    } finally {
      setRetrying(false);
    }
  };

  // ── 렌더 분기 ──
  if (status === 'pending' || status === 'running') {
    return (
      <View style={styles.box}>
        <View style={styles.headRow}>
          <AppText variant="caption" tone="secondary" style={styles.headTitle}>비트 분석</AppText>
          <AppText variant="caption" tone="muted">비트 추출 중</AppText>
        </View>
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={colors.accent.primary} />
          <AppText variant="caption" tone="muted">비트 추출 중입니다… 약 15초 정도 소요됩니다.</AppText>
        </View>
      </View>
    );
  }

  if (status === 'failed') {
    return (
      <View style={styles.box}>
        <View style={styles.headRow}>
          <AppText variant="caption" tone="secondary" style={styles.headTitle}>비트 분석</AppText>
          <AppText variant="caption" tone="muted">실패</AppText>
        </View>
        <AppText variant="caption" tone="muted">
          비트 추출에 실패했습니다.{errorMsg ? ` (${errorMsg})` : ''}
        </AppText>
        {isOwner ? (
          <TouchableOpacity style={styles.retryBtn} onPress={handleRetry} disabled={retrying} accessibilityLabel="비트 재시도">
            <Feather name="refresh-cw" size={12} color={colors.text.primary} />
            <AppText variant="caption">{retrying ? '재시도 중…' : '다시 시도'}</AppText>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  // status === 'completed'
  if (!beats.length) {
    return (
      <View style={styles.box}>
        <View style={styles.headRow}>
          <AppText variant="caption" tone="secondary" style={styles.headTitle}>비트 분석</AppText>
        </View>
        <AppText variant="caption" tone="muted">이 곡은 비트 데이터가 없습니다.</AppText>
      </View>
    );
  }

  // ── 보이는 창의 비트만 렌더(성능: 전체 수백 개 중 창 안 것만) ──
  const estSec = Math.max(0, estMs / 1000);
  const winStart = estSec - WINDOW_BEFORE_SEC;
  const downSet = new Set(downbeats.map((t) => Number(t.toFixed(3))));
  const visible: { t: number; pct: number; isDown: boolean; barNo: number }[] = [];
  for (const t of beats) {
    if (t < winStart) continue;
    if (t > winStart + WINDOW_SEC) break; // beats는 정렬 — 이후는 전부 창 밖
    const isDown = downSet.has(Number(t.toFixed(3)));
    // 마디 번호 = 이 비트 이전(포함)의 다운비트 개수
    let barNo = 0;
    if (isDown) {
      for (const d of downbeats) { if (d <= t + 1e-6) barNo += 1; else break; }
    }
    visible.push({ t, pct: ((t - winStart) / WINDOW_SEC) * 100, isDown, barNo });
  }
  // 방금 지난 비트(0.25초 이내) 점등
  let flashTime: number | null = null;
  for (let i = beats.length - 1; i >= 0; i--) {
    if (beats[i] <= estSec) {
      if (estSec - beats[i] <= CURRENT_FLASH_SEC) flashTime = beats[i];
      break;
    }
  }

  return (
    <View style={styles.box}>
      <View style={styles.headRow}>
        <AppText variant="caption" tone="secondary" style={styles.headTitle}>비트 분석</AppText>
        <AppText variant="caption" tone="muted">
          {tempo != null ? `${tempo.toFixed(1)} BPM` : 'BPM —'} · 비트 {beats.length} / 다운비트 {downbeats.length}
        </AppText>
      </View>

      <View style={styles.strip}>
        {/* NOW 라인 — 창의 25% 지점 고정 */}
        <View style={[styles.nowLine, { left: `${NOW_PCT}%` }]} />
        {visible.map((m) => {
          const isFlash = flashTime != null && Math.abs(m.t - flashTime) < 1e-6;
          const passed = m.t <= estSec;
          return (
            <View key={m.t.toFixed(3)} style={[styles.markerWrap, { left: `${m.pct}%` }]}>
              <View
                style={[
                  m.isDown ? styles.markerDown : styles.markerRegular,
                  passed && styles.markerPassed,
                  isFlash && styles.markerFlash,
                ]}
              />
              {m.isDown && m.barNo > 0 ? (
                <AppText variant="caption" tone={isFlash ? 'accent' : 'muted'} style={styles.barLabel}>
                  {m.barNo}
                </AppText>
              ) : null}
            </View>
          );
        })}
      </View>

      {metronomeAvailable ? (
        <View style={styles.footRow}>
          <TouchableOpacity
            style={[styles.metroBtn, metronomeOn && styles.metroBtnOn]}
            onPress={() => {
              if (__DEV__) console.info('[BeatTrackView] 메트로놈 토글', { on: !metronomeOn });
              setMetronomeOn((v) => !v);
            }}
            accessibilityLabel="메트로놈"
          >
            <Feather name={metronomeOn ? 'volume-2' : 'volume-x'} size={13} color={metronomeOn ? colors.accent.primary : colors.text.muted} />
            <AppText variant="caption" tone={metronomeOn ? 'accent' : 'muted'}>메트로놈</AppText>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignSelf: 'stretch',
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  headTitle: { fontWeight: '700', letterSpacing: 0.3 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.bg.surface2,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  strip: {
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.bg.surface2,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  nowLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: colors.accent.secondary,
    opacity: 0.9,
  },
  markerWrap: {
    position: 'absolute',
    bottom: 0,
    alignItems: 'center',
    width: 10,
    marginLeft: -5,
  },
  markerRegular: {
    width: 2,
    height: 14,
    borderRadius: 1,
    backgroundColor: colors.text.muted,
    opacity: 0.7,
  },
  markerDown: {
    width: 3,
    height: 26,
    borderRadius: 1.5,
    backgroundColor: colors.text.secondary,
  },
  markerPassed: {
    backgroundColor: colors.accent.primary,
    opacity: 0.5,
  },
  markerFlash: {
    backgroundColor: colors.accent.primary,
    opacity: 1,
  },
  barLabel: { position: 'absolute', bottom: 28, fontSize: 9 },
  footRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: spacing.sm },
  metroBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  metroBtnOn: { borderColor: colors.accent.primary },
});
