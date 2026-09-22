// [AudioSpikeScreen] v3.211 — expo-audio 백그라운드 재생 스파이크(검증 하네스)
//
// 목적(PLAN v3.211 "확정 스펙 (1)"): 기존 재생 시스템(services/playback.ts + expo-av)을
// 일절 건드리지 않고, expo-audio 기반 최소 재생 경로를 별도로 만들어 실기기에서
//   (a) 화면 꺼짐 연속 재생(포그라운드 서비스 — FGS)
//   (b) 백그라운드 곡 자동 연쇄 전환(didJustFinish → replace)
//   (c) 잠금화면/미디어 세션 메타데이터(제목·아티스트) + 재생 컨트롤
//   (d) BT 연결 시 차량/기기 UI 메타데이터
// 를 검증한다. 스파이크 합격 시 전면 이관은 별도 사이클 — 이 화면·설정 진입 행은
// 스파이크 기간 한정이며 이관 완료 후 제거 예정.
//
// expo-audio v1.1.1(SDK 54 동봉) 실측 API(node_modules 타입/네이티브 소스 확인):
// - setAudioModeAsync({ shouldPlayInBackground, playsInSilentMode, interruptionMode })
// - createAudioPlayer(source, { updateInterval }) / player.replace(source) / play/pause/remove
// - player.setActiveForLockScreen(active, metadata?, options?) — Android에서
//   AudioControlsService(MediaSessionService, foregroundServiceType="mediaPlayback")를
//   startForeground로 기동(= FGS + 미디어 알림 확보). iOS는 Now Playing Info.
// - player.updateLockScreenMetadata(metadata) / clearLockScreenControls()
// - 이벤트: player.addListener('playbackStatusUpdate', (status) => ...) — status.didJustFinish
// - [실측 한계] v1.1.1 잠금화면 컨트롤 = 재생/일시정지 + (옵션) 10초 앞/뒤 탐색만.
//   다음/이전 곡 버튼은 세션 커맨드에서 명시적으로 제거되어 있음
//   (AudioMediaSessionCallback.kt: COMMAND_SEEK_TO_NEXT/PREVIOUS 제거) — 원격 다음/이전
//   이벤트는 이 버전에서 검증 불가. 곡 전환은 didJustFinish 리스너 기반 자동 연쇄로 검증.
//
// 기존 재생과의 간섭 방지:
// - 진입 시: invalidatePlayback()(진행 중 로드·프리로드 무효화) + playerStore.cleanup()
//   (expo-av 사운드 unload, 미니플레이어 소멸) — expo-av 쪽 오디오 포커스 점유 해제.
// - 이탈 시: 스파이크 플레이어 해제(remove) + 잠금화면 컨트롤 해제. expo-av의 audioMode는
//   여기서 복원하지 않는다 — 기존 경로는 "재생 직전" applyPlaybackAudioMode()를 항상 다시
//   호출하므로(playback.ts:467·:425, PlayerScreen) 다음 expo-av 재생이 스스로 정합화한다.
//
// 원격 로깅: [AudioSpike] prefix, console.warn 레벨 고정 — remoteLogger는 프로덕션에서
// error/warn만 후킹(utils/remoteLogger.ts:217-222, info는 DEV 전용)하므로 릴리즈 빌드
// 로그 수집은 warn이어야 한다([BTDebug] 관행과 동일 근거 — playback.ts 헤더 주석).
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AudioPlayer,
  AudioStatus,
  createAudioPlayer,
  setAudioModeAsync,
} from 'expo-audio';
import api, { BACKEND_BASE_URL } from '../services/api';
import { invalidatePlayback } from '../services/playback';
import { usePlayerStore } from '../stores/playerStore';
import { colors } from '../theme/colors';
import { AppText } from '../components/ui';

interface SpikeTrack {
  id: string;
  title: string;
  artist: string;
  artworkUrl?: string;
}

const MAX_LOG_LINES = 120;
const STATUS_UPDATE_INTERVAL_MS = 1000;

/** 스트림 URL — 기존 재생 경로와 동일한 공개 프록시(playback.ts:465 관행) */
function streamUrl(trackId: string): string {
  return `${BACKEND_BASE_URL}/api/tracks/stream-proxy/${trackId}`;
}

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function AudioSpikeScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const [tracks, setTracks] = useState<SpikeTrack[]>([]);
  const [trackIdx, setTrackIdx] = useState(-1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [status, setStatus] = useState<AudioStatus | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);

  const playerRef = useRef<AudioPlayer | null>(null);
  // didJustFinish는 STATE_ENDED 동안 매 상태 업데이트마다 true로 반복 보고됨(네이티브
  // AudioPlayer.kt currentStatus 실측) — 엣지(false→true) 1회만 전환 트리거
  const prevFinishedRef = useRef(false);
  const lockScreenActiveRef = useRef(false);
  const trackIdxRef = useRef(-1);
  const tracksRef = useRef<SpikeTrack[]>([]);

  /** 화면 로그 + 서버 원격 로그(릴리즈 수집: warn 레벨 — 파일 헤더 주석 참조) 동시 기록 */
  const slog = useCallback((msg: string, ctx?: Record<string, unknown>) => {
    console.warn(`[AudioSpike] ${msg}`, ctx ?? {});
    const time = new Date().toTimeString().slice(0, 8);
    const line = `${time} ${msg}${ctx ? ' ' + JSON.stringify(ctx) : ''}`;
    setLogLines((prev) => [line, ...prev].slice(0, MAX_LOG_LINES));
  }, []);

  /** 잠금화면 활성/메타데이터 갱신 — v1.1.1 실측 API. 실패해도 재생은 계속(스파이크 계측 목적) */
  const applyLockScreen = useCallback((player: AudioPlayer, track: SpikeTrack) => {
    const metadata = {
      title: track.title,
      artist: track.artist,
      albumTitle: 'MAIDOL',
      ...(track.artworkUrl && /^https?:\/\//.test(track.artworkUrl)
        ? { artworkUrl: track.artworkUrl }
        : {}),
    };
    try {
      if (!lockScreenActiveRef.current) {
        // Android: AudioControlsService(FGS, mediaPlayback) 기동 + 미디어 알림/잠금화면 노출
        player.setActiveForLockScreen(true, metadata, { showSeekForward: true, showSeekBackward: true });
        lockScreenActiveRef.current = true;
        slog('lockScreen activate', { trackId: track.id, title: track.title });
      } else {
        player.updateLockScreenMetadata(metadata);
        slog('lockScreen metadata update', { trackId: track.id, title: track.title });
      }
    } catch (err: any) {
      slog('lockScreen fail', { message: err?.message });
    }
  }, [slog]);

  /** idx번 곡 재생(초회 로드·수동 다음·자동 연쇄 공용) — replace로 동일 플레이어 유지
   *  (플레이어 교체 시 미디어 세션이 끊기므로 반드시 replace — AudioControlsService는
   *   생성 시점의 player.ref(ExoPlayer)에 세션을 바인딩한다) */
  const playTrackAt = useCallback((idx: number, reason: string) => {
    const list = tracksRef.current;
    const track = list[idx];
    const player = playerRef.current;
    if (!track || !player) return;
    trackIdxRef.current = idx;
    setTrackIdx(idx);
    prevFinishedRef.current = false;
    slog('play track', { idx, trackId: track.id, title: track.title, reason, appState: AppState.currentState });
    try {
      player.replace({ uri: streamUrl(track.id) });
      player.play();
      applyLockScreen(player, track);
    } catch (err: any) {
      slog('play fail', { idx, trackId: track.id, message: err?.message });
    }
  }, [applyLockScreen, slog]);

  // ── 마운트: 기존 재생 정지 → 오디오 모드 → 플레이어 생성 → 트랙 로드 ────────────
  useEffect(() => {
    // (1) 기존 expo-av 재생 경로 정지 — 오디오 포커스·죽은 참조 간섭 제거
    invalidatePlayback();
    usePlayerStore.getState().cleanup(); // async지만 스토어 타입은 void — 완료 대기 불필요(내부 unload try/catch)
    slog('enter — 기존 playback 정지 완료', { platform: Platform.OS });

    // (2) expo-audio 전역 모드 — 백그라운드 유지 + 무음 스위치 재생 + 배타 포커스
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    })
      .then(() => slog('setAudioModeAsync ok', { shouldPlayInBackground: true }))
      .catch((err: any) => slog('setAudioModeAsync fail', { message: err?.message }));

    // (3) 플레이어 1개 생성(소스는 replace로 주입) + 상태 리스너
    const player = createAudioPlayer(null, { updateInterval: STATUS_UPDATE_INTERVAL_MS });
    playerRef.current = player;
    const sub = player.addListener('playbackStatusUpdate', (st: AudioStatus) => {
      setStatus(st);
      const finished = !!st.didJustFinish;
      if (finished && !prevFinishedRef.current) {
        // 곡 종료 엣지 — 다음 곡 자동 연쇄(3곡 순환: 백그라운드 30분 연속 재생 검증용)
        const list = tracksRef.current;
        if (list.length > 0) {
          const nextIdx = (trackIdxRef.current + 1) % list.length;
          slog('didJustFinish → auto next', {
            from: trackIdxRef.current, to: nextIdx, appState: AppState.currentState,
          });
          playTrackAt(nextIdx, 'auto-advance');
        }
      }
      prevFinishedRef.current = finished;
    });

    // (4) AppState 전환 계측 — 화면 꺼짐/복귀 시점을 로그 타임라인에 남긴다
    const appStateSub = AppState.addEventListener('change', (state) => {
      slog('appState', { state });
    });

    // (5) 실서버 차트 신곡 API에서 공개 트랙 3곡 로드(ChartScreen '신곡' 탭과 동일 endpoint)
    (async () => {
      try {
        const res = await api.get('/tracks/', { params: { sort: 'created_at', limit: 20 } });
        const data: any[] = Array.isArray(res.data) ? res.data : res.data?.tracks || [];
        const picked: SpikeTrack[] = data.slice(0, 3).map((t: any) => ({
          id: String(t.id),
          title: t.title || '(제목 없음)',
          artist: t.artist_name || t.uploader_nickname || 'MAIDOL',
          artworkUrl: t.cover_image || t.cover_image_url || undefined,
        }));
        tracksRef.current = picked;
        setTracks(picked);
        setLoading(false);
        if (picked.length === 0) {
          setLoadError('공개 트랙이 없습니다.');
          slog('track load empty');
        } else {
          slog('tracks loaded', { count: picked.length, ids: picked.map((t) => t.id) });
        }
      } catch (err: any) {
        setLoading(false);
        setLoadError('트랙 목록을 불러오지 못했습니다.');
        slog('track load fail', { status: err?.response?.status, message: err?.message });
      }
    })();

    // ── 이탈: 스파이크 플레이어 완전 해제 — 기존 재생 경로로 복귀 가능 상태로 ──────
    return () => {
      slog('leave — spike player 해제');
      try { sub.remove(); } catch {}
      try { appStateSub.remove(); } catch {}
      const p = playerRef.current;
      playerRef.current = null;
      if (p) {
        try { if (lockScreenActiveRef.current) p.clearLockScreenControls(); } catch {}
        try { p.pause(); } catch {}
        try { p.remove(); } catch {}
      }
      lockScreenActiveRef.current = false;
      // expo-av audioMode 복원은 불필요 — 기존 경로가 재생 직전마다 자체 모드를 재적용
      // (applyPlaybackAudioMode, 파일 헤더 "간섭 방지" 주석 참조)
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 조작부 핸들러 ──────────────────────────────────────────────────────────
  const handlePlayPause = () => {
    const player = playerRef.current;
    if (!player) return;
    if (trackIdxRef.current < 0) {
      // 첫 재생 — 1번 곡부터
      playTrackAt(0, 'first-play');
      return;
    }
    try {
      if (player.playing) {
        player.pause();
        slog('pause (button)');
      } else {
        player.play();
        slog('play (button)');
      }
    } catch (err: any) {
      slog('toggle fail', { message: err?.message });
    }
  };

  const handleNext = () => {
    if (tracksRef.current.length === 0) return;
    const nextIdx = trackIdxRef.current < 0 ? 0 : (trackIdxRef.current + 1) % tracksRef.current.length;
    playTrackAt(nextIdx, 'manual-next');
  };

  const currentTrack = trackIdx >= 0 ? tracks[trackIdx] : null;
  const playing = !!status?.playing;

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 12 }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* 안내 */}
        <View style={styles.noticeBox}>
          <AppText style={styles.noticeText}>
            expo-audio 백그라운드 재생 검증 화면입니다(스파이크 기간 한정). 재생 시작 후 화면을
            끄거나 다른 앱으로 전환해 ① 재생 지속 ② 곡 자동 전환 ③ 잠금화면 제목·아티스트 표시
            ④ 블루투스(차량) 기기 표시를 확인해 주세요. 이 버전의 잠금화면 버튼은
            재생/일시정지·10초 탐색만 지원합니다(다음곡 버튼 없음 — 곡 전환은 자동).
          </AppText>
        </View>

        {/* 현재 상태 */}
        <AppText variant="callout" style={styles.sectionTitle}>현재 상태</AppText>
        <View style={styles.card}>
          {loading ? (
            <AppText style={styles.stateText}>트랙 목록 불러오는 중...</AppText>
          ) : loadError ? (
            <AppText style={[styles.stateText, { color: colors.status.error }]}>{loadError}</AppText>
          ) : (
            <>
              <AppText style={styles.trackTitle}>
                {currentTrack ? currentTrack.title : '(재생 전 — 재생 버튼을 눌러주세요)'}
              </AppText>
              {currentTrack ? (
                <AppText style={styles.trackArtist}>{currentTrack.artist}</AppText>
              ) : null}
              <AppText style={styles.stateText}>
                곡 {trackIdx >= 0 ? trackIdx + 1 : '-'}/{tracks.length} · {playing ? '재생 중' : '정지'} ·{' '}
                {fmtTime(status?.currentTime ?? 0)} / {fmtTime(status?.duration ?? 0)}
                {status?.isBuffering ? ' · 버퍼링' : ''}
              </AppText>
            </>
          )}
        </View>

        {/* 조작부 */}
        <View style={styles.controlRow}>
          <TouchableOpacity
            style={[styles.controlBtn, tracks.length === 0 && styles.controlBtnDisabled]}
            onPress={handlePlayPause}
            disabled={tracks.length === 0}
          >
            <AppText style={styles.controlBtnText}>{playing ? '일시정지' : '재생'}</AppText>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.controlBtn, styles.controlBtnSecondary, tracks.length === 0 && styles.controlBtnDisabled]}
            onPress={handleNext}
            disabled={tracks.length === 0}
          >
            <AppText style={styles.controlBtnSecondaryText}>다음 곡</AppText>
          </TouchableOpacity>
        </View>

        {/* 재생 목록(3곡) */}
        <AppText variant="callout" style={styles.sectionTitle}>검증 트랙(신곡 3곡 순환)</AppText>
        <View style={styles.card}>
          {tracks.map((t, i) => (
            <AppText
              key={t.id}
              style={[styles.queueLine, i === trackIdx && styles.queueLineActive]}
              numberOfLines={1}
            >
              {i + 1}. {t.title} — {t.artist}
            </AppText>
          ))}
          {!loading && tracks.length === 0 ? (
            <AppText style={styles.stateText}>트랙 없음</AppText>
          ) : null}
        </View>

        {/* 이벤트 로그 — 실기기 육안 확인용(서버 frontend.log에도 [AudioSpike]로 동시 적재) */}
        <AppText variant="callout" style={styles.sectionTitle}>이벤트 로그 (최신순)</AppText>
        <View style={[styles.card, styles.logBox]}>
          {logLines.length === 0 ? (
            <AppText style={styles.logLine}>로그 없음</AppText>
          ) : (
            logLines.map((line, i) => (
              <AppText key={`${i}-${line.slice(0, 12)}`} style={styles.logLine}>
                {line}
              </AppText>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.deepest,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
  },
  noticeBox: {
    backgroundColor: colors.bg.surface1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: 12,
  },
  noticeText: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.text.secondary,
  },
  sectionTitle: {
    marginTop: 20,
    marginBottom: 10,
  },
  card: {
    backgroundColor: colors.bg.surface1,
    borderRadius: 12,
    padding: 14,
  },
  trackTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text.primary,
    marginBottom: 2,
  },
  trackArtist: {
    fontSize: 13,
    color: colors.text.secondary,
    marginBottom: 8,
  },
  stateText: {
    fontSize: 13,
    color: colors.text.secondary,
  },
  controlRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  controlBtn: {
    flex: 1,
    backgroundColor: colors.accent.primary,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  controlBtnSecondary: {
    backgroundColor: colors.bg.surface2,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  controlBtnDisabled: {
    opacity: 0.4,
  },
  controlBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text.primary,
  },
  controlBtnSecondaryText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text.secondary,
  },
  queueLine: {
    fontSize: 13,
    color: colors.text.secondary,
    paddingVertical: 3,
  },
  queueLineActive: {
    color: colors.accent.primaryGlow,
    fontWeight: '700',
  },
  logBox: {
    minHeight: 120,
  },
  logLine: {
    fontSize: 11,
    lineHeight: 16,
    color: colors.text.muted,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});
