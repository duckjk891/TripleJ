import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import API from '../api';
import { recordPlay } from '../api';

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
      setCurrentIndex((idx) => {
        if (idx < playlist.length - 1) {
          return idx + 1;
        }
        setIsPlaying(false);
        return idx;
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
  }, [playlist.length]);

  // currentIndex 변경 시 새 곡 로드
  useEffect(() => {
    const audio = audioRef.current;
    if (currentIndex >= 0 && playlist[currentIndex]) {
      const song = playlist[currentIndex];
      setCurrentTime(0);
      setAudioDuration(0);
      // Fetch presigned stream URL from backend
      API.get(`/tracks/stream/${song.id}`)
        .then((res) => {
          audio.src = res.data.stream_url;
          audio.play()
            .then(() => {
              // Fire-and-forget: record play for chart scoring
              recordPlay(song.id).catch(() => {});
            })
            .catch((err) => {
              console.error('Audio play failed:', err);
            });
        })
        .catch((err) => {
          console.error('Failed to get stream URL:', err);
        });
    }
  }, [currentIndex, playlist]);

  // 볼륨 동기화
  useEffect(() => {
    audioRef.current.volume = volume / 100;
  }, [volume]);

  const play = useCallback((song, songs) => {
    if (song) {
      if (songs) {
        setPlaylist(songs);
        const idx = songs.findIndex((s) => s.id === song.id);
        setCurrentIndex(idx >= 0 ? idx : 0);
      } else {
        const existIdx = playlist.findIndex((s) => s.id === song.id);
        if (existIdx >= 0) {
          setCurrentIndex(existIdx);
        } else {
          setPlaylist((prev) => [...prev, song]);
          setCurrentIndex(playlist.length);
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
    setPlaylist([]);
    setCurrentIndex(-1);
    setIsPlaying(false);
    setCurrentTime(0);
    setAudioDuration(0);
  }, []);

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
