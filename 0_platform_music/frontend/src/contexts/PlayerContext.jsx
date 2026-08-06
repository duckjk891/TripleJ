import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import API from '../api';
import { recordPlay, getRelatedTracks, notifyPointsRefresh, PLAY_RECORD_RATIO } from '../api';
import { useAuth } from './AuthContext';

const PlayerContext = createContext(null);

export function PlayerProvider({ children }) {
  const [playlist, setPlaylist] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [volume, setVolume] = useState(80);
  const audioRef = useRef(new Audio());
  // Video mode: when active, seekTo/togglePlay/time updates target video instead of audio
  const [videoMode, setVideoMode] = useState(false);
  const videoRef = useRef(null);

  const currentSong = currentIndex >= 0 ? playlist[currentIndex] : null;
  const duration = audioDuration || currentSong?.duration || 240;

  // Refs mirroring state so the ended handler never reads stale closures
  const playlistRef = useRef(playlist);
  const currentIndexRef = useRef(currentIndex);
  useEffect(() => { playlistRef.current = playlist; }, [playlist]);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
  // Guard against duplicate related-track fetches on ended
  const fetchingRelatedRef = useRef(false);

  // v160 — 70% 청취 시 재생 기록(A안): 현재 로드된 곡의 기록 완료 플래그.
  // 곡 로드 effect 에서 리셋, 70% 판정 effect / ended 폴백이 공유(중복 기록 방지).
  const playRecordedRef = useRef(false);
  const recordPlayOnce = useCallback((trackId, reason) => {
    if (playRecordedRef.current) return;
    playRecordedRef.current = true;
    recordPlay(trackId)
      .then(() => {
        // ④ 별 적립 → 헤더 ⭐배지 실시간 갱신 (성공 시에만, 실패는 기존처럼 조용히 무시)
        notifyPointsRefresh();
        if (import.meta.env.DEV) {
          console.info(`[PlayerContext] play recorded (${reason})`, { track_id: trackId });
        }
      })
      .catch(() => {});
  }, []);

  // Audio 이벤트 리스너
  useEffect(() => {
    const audio = audioRef.current;

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const onLoadedMetadata = () => {
      setAudioDuration(audio.duration);
    };

    const onEnded = () => {
      const list = playlistRef.current;
      const idx = currentIndexRef.current;
      // v160 — duration 미확정(Infinity 등)으로 70% 판정이 못 뛴 곡의 완주 폴백 기록
      // (완주 = 100% ≥ 70%). playRecordedRef 공유로 중복 기록 없음.
      const endedForRecord = list[idx];
      if (endedForRecord && !playRecordedRef.current) {
        recordPlayOnce(endedForRecord.id, 'ended fallback');
      }
      if (idx < list.length - 1) {
        setCurrentIndex(idx + 1);
        return;
      }
      // Last song ended: fetch one related track and continue (option 3, YouTube Music style)
      const endedSong = list[idx];
      if (!endedSong || fetchingRelatedRef.current) {
        setIsPlaying(false);
        return;
      }
      fetchingRelatedRef.current = true;
      const excludeIds = list.map((s) => s.id);
      if (import.meta.env.DEV) {
        console.info('[PlayerContext] fetching related track', { track_id: endedSong.id, exclude_count: excludeIds.length });
      }
      getRelatedTracks(endedSong.id, excludeIds, 1)
        .then((res) => {
          const tracks = res.data?.tracks || [];
          if (tracks.length === 0) {
            console.warn('[PlayerContext] no related track found, stopping playback');
            setIsPlaying(false);
            return;
          }
          const t = tracks[0];
          const nextSong = {
            id: t.id,
            title: t.title,
            artist_name: t.uploader_nickname || 'AI',
            cover_image: t.cover_image_url,
            album_id: t.id,
          };
          if (import.meta.env.DEV) {
            console.info('[PlayerContext] related track appended', { queue_size: list.length + 1, source: res.data?.source });
          }
          setPlaylist((prev) => [...prev, nextSong]);
          setCurrentIndex(idx + 1);
        })
        .catch((err) => {
          console.error('[PlayerContext] related track fetch failed:', err);
          setIsPlaying(false);
        })
        .finally(() => {
          fetchingRelatedRef.current = false;
        });
    };

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.pause();
    };
  }, [recordPlayOnce]);

  // currentIndex 변경 시 새 곡 로드
  useEffect(() => {
    const audio = audioRef.current;
    if (currentIndex >= 0 && playlist[currentIndex]) {
      const song = playlist[currentIndex];
      // v160 — 새 곡 로드 = 기록 플래그 리셋 지점 (즉시 recordPlay 는 70% 게이트로 대체 — A안)
      playRecordedRef.current = false;
      setCurrentTime(0);
      setAudioDuration(0);
      // Fetch presigned stream URL from backend
      API.get(`/tracks/stream/${song.id}`)
        .then((res) => {
          audio.src = res.data.stream_url;
          audio.play()
            .catch((err) => {
              console.error('Audio play failed:', err);
            });
        })
        .catch((err) => {
          console.error('Failed to get stream URL:', err);
        });
    }
  }, [currentIndex, playlist]);

  // v160 — 70% 청취 판정(A안): context 의 currentTime/audioDuration state 기준이라
  // 오디오 재생은 물론 MV 모드(PlayerPage 가 video timeupdate 를 setCurrentTime 으로 동기화)도 자동 커버.
  useEffect(() => {
    if (
      currentSong &&
      !playRecordedRef.current &&
      audioDuration > 0 &&
      isFinite(audioDuration) &&
      currentTime >= audioDuration * PLAY_RECORD_RATIO
    ) {
      recordPlayOnce(currentSong.id, '70%');
    }
  }, [currentTime, audioDuration, currentSong, recordPlayOnce]);

  // 볼륨 동기화
  useEffect(() => {
    audioRef.current.volume = volume / 100;
  }, [volume]);

  const play = useCallback((song, songs, opts = {}) => {
    if (song) {
      if (opts.queueAll === true && songs) {
        // Collection playback (playlist/album): replace queue with the full list
        setPlaylist(songs);
        const idx = songs.findIndex((s) => s.id === song.id);
        setCurrentIndex(idx >= 0 ? idx : 0);
        if (import.meta.env.DEV) console.info('[PlayerContext] queue replaced (queueAll)', { queue_size: songs.length });
      } else {
        const existIdx = playlist.findIndex((s) => s.id === song.id);
        if (existIdx >= 0) {
          // Already in queue (e.g. queue click on PlayerPage): just move to it
          setCurrentIndex(existIdx);
        } else {
          // Single-track playback (option 3): queue becomes just this song
          setPlaylist([song]);
          setCurrentIndex(0);
          if (import.meta.env.DEV) console.info('[PlayerContext] queue replaced with single track', { queue_size: 1 });
        }
      }
    } else {
      audioRef.current.play().catch((err) => {
        console.error('Audio play failed:', err);
      });
    }
  }, [playlist]);

  const pause = useCallback(() => {
    if (videoMode && videoRef.current) {
      videoRef.current.pause();
    } else {
      audioRef.current.pause();
    }
  }, [videoMode]);

  const togglePlay = useCallback(() => {
    if (currentSong) {
      if (videoMode && videoRef.current) {
        if (isPlaying) {
          videoRef.current.pause();
        } else {
          videoRef.current.play().catch((err) => {
            console.error('Video play failed:', err);
          });
        }
      } else {
        if (isPlaying) {
          audioRef.current.pause();
        } else {
          audioRef.current.play().catch((err) => {
            console.error('Audio play failed:', err);
          });
        }
      }
    }
  }, [currentSong, isPlaying, videoMode]);

  const next = useCallback(() => {
    if (currentIndex < playlist.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  }, [currentIndex, playlist.length]);

  const prev = useCallback(() => {
    const activeTime = (videoMode && videoRef.current) ? videoRef.current.currentTime : audioRef.current.currentTime;
    if (activeTime > 3) {
      if (videoMode && videoRef.current) {
        videoRef.current.currentTime = 0;
      } else {
        audioRef.current.currentTime = 0;
      }
    } else if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  }, [currentIndex, videoMode]);

  const seekTo = useCallback((time) => {
    const clampedTime = Math.max(0, Math.min(time, duration));
    if (videoMode && videoRef.current) {
      videoRef.current.currentTime = clampedTime;
    } else {
      audioRef.current.currentTime = clampedTime;
    }
    setCurrentTime(clampedTime);
  }, [duration, videoMode]);

  const changeVolume = useCallback((vol) => {
    setVolume(Math.max(0, Math.min(100, vol)));
  }, []);

  const addToPlaylist = useCallback((song) => {
    setPlaylist((prev) => {
      if (prev.find((s) => s.id === song.id)) return prev;
      return [...prev, song];
    });
  }, []);

  const removeFromPlaylist = useCallback((songId) => {
    setPlaylist((prev) => {
      const idx = prev.findIndex((s) => s.id === songId);
      if (idx < 0) return prev;
      const next = [...prev.slice(0, idx), ...prev.slice(idx + 1)];
      // Adjust currentIndex if needed
      setCurrentIndex((ci) => {
        if (next.length === 0) return -1;
        if (idx < ci) return ci - 1;
        if (idx === ci) return Math.min(ci, next.length - 1);
        return ci;
      });
      return next;
    });
  }, []);

  const clearPlaylist = useCallback(() => {
    audioRef.current.pause();
    audioRef.current.src = '';
    videoRef.current?.pause();
    playRecordedRef.current = false; // v160 — 로그아웃 클리어 시 기록 플래그도 초기화
    setVideoMode(false);
    setPlaylist([]);
    setCurrentIndex(-1);
    setIsPlaying(false);
    setCurrentTime(0);
    setAudioDuration(0);
    if (import.meta.env.DEV) console.info('[PlayerContext] clearPlaylist');
  }, []);

  // 로그인 사용자 전이 감지: 직전 user id 가 존재했고 새 id 와 다를 때만(로그아웃 null 전이,
  // A→B 계정 교체 포함) 플레이어를 정지·초기화한다. null→id 전이(초기 복원, 비로그인 재생 중
  // 로그인)는 비로그인 재생이 정식 흐름이므로 절대 클리어하지 않는다.
  const { user } = useAuth();
  const prevUserIdRef = useRef(undefined);
  useEffect(() => {
    const newId = user?.id ?? null;
    const prevId = prevUserIdRef.current;
    // 마운트 직후 첫 실행(prev=undefined)과 null→id 전이는 미발화 (StrictMode 이중 실행에도 멱등)
    if (prevId !== undefined && prevId !== null && prevId !== newId) {
      // auth 전이(외부 상태) 구독에 대한 정리 반응 — 렌더 중 조정 불가(오디오 pause 부수효과 포함)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      clearPlaylist();
      if (import.meta.env.DEV) console.info('[PlayerContext] cleared on auth change', { hadPrev: true, hasNew: !!newId });
    }
    prevUserIdRef.current = newId;
  }, [user, clearPlaylist]);

  return (
    <PlayerContext.Provider
      value={{
        playlist,
        currentSong,
        currentIndex,
        isPlaying,
        currentTime,
        duration,
        volume,
        play,
        pause,
        togglePlay,
        next,
        prev,
        seekTo,
        changeVolume,
        addToPlaylist,
        removeFromPlaylist,
        clearPlaylist,
        audioRef,
        videoRef,
        videoMode,
        setVideoMode,
        setCurrentTime,
        setAudioDuration,
        setIsPlaying,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const context = useContext(PlayerContext);
  if (!context) {
    throw new Error('usePlayer must be used within PlayerProvider');
  }
  return context;
}
