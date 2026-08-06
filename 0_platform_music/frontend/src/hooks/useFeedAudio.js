import { useState, useRef, useCallback, useEffect } from 'react';
import API, { recordPlay, notifyPointsRefresh, PLAY_RECORD_RATIO } from '../api';
import { usePlayer } from '../contexts/PlayerContext';

/**
 * v131 — 피드 전용 오디오 훅 (전역 PlayerContext 와 별개의 Audio 1개).
 *
 * 규칙:
 * - BGM 자동재생 시도 → NotAllowedError(모바일 정책) 시 'blocked'(재생 대기) 폴백.
 * - 삽입곡 ▶ → BGM 일시정지(위치 저장) → 삽입곡 재생 → ended 시 BGM 복귀.
 * - 피드 오디오 시작 시 전역 플레이어 pause(), 전역 재생 감지 시 피드 오디오 정지.
 * - 언마운트 시 정지 + src 해제.
 *
 * 상태 머신:
 * - modeRef: 'idle' | 'bgm' | 'track' — Audio 엘리먼트가 지금 무엇을 재생 중인지.
 * - bgmStatus: 'idle'(off) | 'loading' | 'playing' | 'paused' | 'blocked'(자동재생 차단, 제스처 대기)
 * - trackStatus: 'idle' | 'loading' | 'playing' | 'paused'
 * - activeKey: 재생 중(또는 일시정지 중)인 삽입곡 카드 식별 키 (feedId:blockIndex)
 * - bgmOwnerId: 현재 BGM 이 속한 피드 id (여러 카드 간 활성 배너 판별용)
 */
export default function useFeedAudio() {
  const { pause: globalPause, isPlaying: globalIsPlaying } = usePlayer();

  const [bgmTrack, setBgmTrack] = useState(null);
  const [bgmOwnerId, setBgmOwnerId] = useState(null);
  const [bgmStatus, setBgmStatus] = useState('idle');
  const [activeKey, setActiveKey] = useState(null);
  const [trackStatus, setTrackStatus] = useState('idle');

  const audioRef = useRef(null);
  const modeRef = useRef('idle');
  const bgmTrackRef = useRef(null);
  const bgmUrlRef = useRef(null); // { trackId, url } — presigned URL 캐시
  const bgmPosRef = useRef(0);
  const resumeBgmRef = useRef(false); // 삽입곡 종료 시 BGM 복귀 여부
  const activeKeyRef = useRef(null);
  const trackStatusRef = useRef('idle');
  const bgmStatusRef = useRef('idle');
  const opRef = useRef(0); // async race guard — 새 조작마다 증가

  // v160 — 70% 청취 시 재생 기록(A안, track 모드 한정 — BGM 은 기존에도 미기록).
  // playFeedTrack(새 로드)마다 리셋, timeupdate 70% 판정 / ended 폴백이 공유.
  const feedTrackIdRef = useRef(null);
  const trackRecordedRef = useRef(false);
  const recordFeedPlayOnce = useCallback((trackId, reason) => {
    if (trackRecordedRef.current) return;
    trackRecordedRef.current = true;
    recordPlay(trackId)
      .then(() => {
        // ④ 별 적립 → 헤더 ⭐배지 실시간 갱신 (성공 시에만, 실패는 조용히 무시)
        notifyPointsRefresh();
        if (import.meta.env.DEV) {
          console.info(`[useFeedAudio] play recorded (${reason})`, { track_id: trackId });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => { activeKeyRef.current = activeKey; }, [activeKey]);
  useEffect(() => { trackStatusRef.current = trackStatus; }, [trackStatus]);
  useEffect(() => { bgmStatusRef.current = bgmStatus; }, [bgmStatus]);

  const globalPauseRef = useRef(globalPause);
  useEffect(() => { globalPauseRef.current = globalPause; }, [globalPause]);

  const getAudio = useCallback(() => {
    if (!audioRef.current) audioRef.current = new Audio();
    return audioRef.current;
  }, []);

  const fetchStreamUrl = useCallback(async (trackId) => {
    const res = await API.get(`/tracks/stream/${trackId}`);
    return res.data?.stream_url;
  }, []);

  // BGM 재생 시작/복귀 (fromPos > 0 이면 저장 위치에서 이어재생)
  const startBgmPlayback = useCallback(async (track, { fromPos = 0 } = {}) => {
    const audio = getAudio();
    const op = ++opRef.current;
    bgmTrackRef.current = track;
    setBgmStatus('loading');
    if (import.meta.env.DEV) {
      console.info('[useFeedAudio] bgm play start', { track_id: track.id, fromPos });
    }
    try {
      if (bgmUrlRef.current?.trackId !== track.id) {
        const url = await fetchStreamUrl(track.id);
        bgmUrlRef.current = { trackId: track.id, url };
      }
      if (op !== opRef.current) return;
      modeRef.current = 'bgm';
      audio.src = bgmUrlRef.current.url;
      if (fromPos > 0) {
        const onMeta = () => {
          try { audio.currentTime = fromPos; } catch { /* ignore */ }
          audio.removeEventListener('loadedmetadata', onMeta);
        };
        audio.addEventListener('loadedmetadata', onMeta);
      }
      await audio.play();
      if (op !== opRef.current) return;
      setBgmStatus('playing');
    } catch (err) {
      if (op !== opRef.current) return;
      if (err?.name === 'NotAllowedError') {
        // 모바일 등 사용자 제스처 없는 자동재생 차단 — 버그 아님(정책), 재생 대기 폴백
        if (import.meta.env.DEV) {
          console.info('[useFeedAudio] bgm autoplay blocked, waiting for gesture', { track_id: track.id });
        }
        setBgmStatus('blocked');
      } else {
        console.error('[useFeedAudio] bgm play failed', { err, track_id: track?.id });
        setBgmStatus('idle');
      }
    }
  }, [fetchStreamUrl, getAudio]);

  // BGM 재생/재개 — resume=true 면 저장된 위치에서 이어재생 (같은 피드 배너 토글용)
  const playBgm = useCallback((track, ownerFeedId, { resume = false } = {}) => {
    if (!track?.id || track.deleted) return;
    globalPauseRef.current?.();
    resumeBgmRef.current = false;
    setActiveKey(null);
    setTrackStatus('idle');
    setBgmTrack(track);
    setBgmOwnerId(ownerFeedId ?? null);
    if (!resume) bgmPosRef.current = 0;
    startBgmPlayback(track, { fromPos: resume ? bgmPosRef.current : 0 });
  }, [startBgmPlayback]);

  const pauseBgm = useCallback(() => {
    const audio = audioRef.current;
    if (modeRef.current === 'bgm' && audio) {
      bgmPosRef.current = audio.currentTime || 0;
      audio.pause();
    }
    opRef.current += 1;
    setBgmStatus('paused');
  }, []);

  // BGM 끄기 — 배너의 [끄기]. 상태 전체 초기화.
  const stopBgm = useCallback(() => {
    const audio = audioRef.current;
    if (modeRef.current === 'bgm' && audio) {
      audio.pause();
      modeRef.current = 'idle';
    }
    opRef.current += 1;
    resumeBgmRef.current = false;
    bgmTrackRef.current = null;
    bgmUrlRef.current = null;
    bgmPosRef.current = 0;
    setBgmTrack(null);
    setBgmOwnerId(null);
    setBgmStatus('idle');
    if (import.meta.env.DEV) console.info('[useFeedAudio] bgm off');
  }, []);

  // 삽입곡 재생/일시정지 토글 — key 는 카드 식별자(feedId:blockIndex)
  const playFeedTrack = useCallback(async (track, key) => {
    if (!track?.id || track.deleted) return;
    const audio = getAudio();

    // 같은 카드 재클릭 → 일시정지/재개
    if (activeKeyRef.current === key && modeRef.current === 'track') {
      if (trackStatusRef.current === 'playing') {
        audio.pause();
        setTrackStatus('paused');
        return;
      }
      if (trackStatusRef.current === 'paused') {
        globalPauseRef.current?.();
        try {
          await audio.play();
          setTrackStatus('playing');
        } catch (err) {
          console.error('[useFeedAudio] track resume failed', { err, track_id: track.id });
        }
        return;
      }
    }

    const op = ++opRef.current;
    globalPauseRef.current?.();
    // BGM 재생 중이면 위치 저장 후 일시정지 — 삽입곡 종료 시 복귀
    if (modeRef.current === 'bgm' && bgmStatusRef.current === 'playing') {
      bgmPosRef.current = audio.currentTime || 0;
      audio.pause();
      resumeBgmRef.current = true;
      setBgmStatus('paused');
    }
    setActiveKey(key);
    setTrackStatus('loading');
    // v160 — 새 삽입곡 로드 = 기록 플래그 리셋 (즉시 recordPlay 는 70% 게이트로 대체 — A안)
    feedTrackIdRef.current = track.id;
    trackRecordedRef.current = false;
    if (import.meta.env.DEV) {
      console.info('[useFeedAudio] track play start', { track_id: track.id, key });
    }
    try {
      const url = await fetchStreamUrl(track.id);
      if (op !== opRef.current) return;
      modeRef.current = 'track';
      audio.src = url;
      await audio.play();
      if (op !== opRef.current) return;
      setTrackStatus('playing');
    } catch (err) {
      if (op !== opRef.current) return;
      console.error('[useFeedAudio] track play failed', { err, track_id: track.id });
      setTrackStatus('idle');
      setActiveKey(null);
      if (modeRef.current === 'track') modeRef.current = 'idle';
    }
  }, [fetchStreamUrl, getAudio]);

  // ended — 삽입곡 종료 시 BGM 복귀 / BGM 종료 시 정지. 언마운트 시 정지+src 해제.
  useEffect(() => {
    const audio = getAudio();
    // v160 — track 모드 한정 70% 청취 판정 (PlayerContext 와 동일 게이트, PLAY_RECORD_RATIO 공유)
    const onTimeUpdate = () => {
      if (modeRef.current !== 'track' || trackRecordedRef.current) return;
      const trackId = feedTrackIdRef.current;
      const dur = audio.duration;
      if (
        trackId != null &&
        dur > 0 &&
        isFinite(dur) &&
        audio.currentTime >= dur * PLAY_RECORD_RATIO
      ) {
        recordFeedPlayOnce(trackId, '70%');
      }
    };
    const onEnded = () => {
      if (modeRef.current === 'track') {
        // v160 — duration 미확정으로 70% 판정이 못 뛴 곡의 완주 폴백 기록(플래그 공유 — 중복 없음)
        if (feedTrackIdRef.current != null && !trackRecordedRef.current) {
          recordFeedPlayOnce(feedTrackIdRef.current, 'ended fallback');
        }
        setTrackStatus('idle');
        setActiveKey(null);
        if (resumeBgmRef.current && bgmTrackRef.current) {
          resumeBgmRef.current = false;
          if (import.meta.env.DEV) console.info('[useFeedAudio] track ended, resuming bgm');
          startBgmPlayback(bgmTrackRef.current, { fromPos: bgmPosRef.current });
        } else {
          modeRef.current = 'idle';
        }
      } else if (modeRef.current === 'bgm') {
        // BGM 곡 종료 — 처음부터 다시 재생 가능하도록 paused 로
        bgmPosRef.current = 0;
        modeRef.current = 'idle';
        setBgmStatus('paused');
      }
    };
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
      opRef.current += 1;
      audio.pause();
      audio.src = '';
      if (import.meta.env.DEV) console.info('[useFeedAudio] unmounted, audio released');
    };
  }, [getAudio, startBgmPlayback, recordFeedPlayOnce]);

  // 전역 플레이어 재생 시작 감지 → 피드 오디오 정지
  useEffect(() => {
    if (!globalIsPlaying) return undefined;
    const audio = audioRef.current;
    if (!audio || modeRef.current === 'idle') return undefined;
    opRef.current += 1;
    if (modeRef.current === 'bgm') bgmPosRef.current = audio.currentTime || 0;
    audio.pause();
    resumeBgmRef.current = false;
    // 상태 반영은 다음 틱으로 (effect 본문 동기 setState 회피 — cascading render 방지)
    const timer = setTimeout(() => {
      setBgmStatus((s) => (s === 'playing' || s === 'loading' || s === 'blocked' ? 'paused' : s));
      setTrackStatus((s) => (s === 'playing' || s === 'loading' ? 'paused' : s));
    }, 0);
    if (import.meta.env.DEV) console.info('[useFeedAudio] global player started, feed audio paused');
    return () => clearTimeout(timer);
  }, [globalIsPlaying]);

  return {
    bgmTrack,
    bgmOwnerId,
    bgmStatus,
    activeKey,
    trackStatus,
    playBgm,
    pauseBgm,
    stopBgm,
    playFeedTrack,
  };
}
