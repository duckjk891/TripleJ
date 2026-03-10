import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';

const PlayerContext = createContext(null);

export function PlayerProvider({ children }) {
  const [playlist, setPlaylist] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(80);
  const intervalRef = useRef(null);

  const currentSong = currentIndex >= 0 ? playlist[currentIndex] : null;
  const duration = currentSong?.duration || 240; // 기본 4분

  // 재생 시뮬레이션
  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        setCurrentTime((prev) => {
          if (prev >= duration) {
            // 자동 다음 곡
            setCurrentIndex((idx) => {
              if (idx < playlist.length - 1) {
                return idx + 1;
              }
              setIsPlaying(false);
              return idx;
            });
            return 0;
          }
          return prev + 1;
        });
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isPlaying, duration, playlist.length]);

  const play = useCallback((song, songs) => {
    if (song) {
      if (songs) {
        setPlaylist(songs);
        const idx = songs.findIndex((s) => s.id === song.id);
        setCurrentIndex(idx >= 0 ? idx : 0);
      } else {
        // 단일 곡 재생
        const existIdx = playlist.findIndex((s) => s.id === song.id);
        if (existIdx >= 0) {
          setCurrentIndex(existIdx);
        } else {
          setPlaylist((prev) => [...prev, song]);
          setCurrentIndex(playlist.length);
        }
      }
      setCurrentTime(0);
      setIsPlaying(true);
    } else {
      setIsPlaying(true);
    }
  }, [playlist]);

  const pause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const togglePlay = useCallback(() => {
    if (currentSong) {
      setIsPlaying((prev) => !prev);
    }
  }, [currentSong]);

  const next = useCallback(() => {
    if (currentIndex < playlist.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setCurrentTime(0);
      setIsPlaying(true);
    }
  }, [currentIndex, playlist.length]);

  const prev = useCallback(() => {
    if (currentTime > 3) {
      // 3초 이상 지났으면 처음부터
      setCurrentTime(0);
    } else if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setCurrentTime(0);
      setIsPlaying(true);
    }
  }, [currentIndex, currentTime]);

  const seekTo = useCallback((time) => {
    setCurrentTime(Math.max(0, Math.min(time, duration)));
  }, [duration]);

  const changeVolume = useCallback((vol) => {
    setVolume(Math.max(0, Math.min(100, vol)));
  }, []);

  const addToPlaylist = useCallback((song) => {
    setPlaylist((prev) => {
      if (prev.find((s) => s.id === song.id)) return prev;
      return [...prev, song];
    });
  }, []);

  const clearPlaylist = useCallback(() => {
    setPlaylist([]);
    setCurrentIndex(-1);
    setIsPlaying(false);
    setCurrentTime(0);
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
        clearPlaylist,
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
