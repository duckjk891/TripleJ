import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import API from '../api';
import { recordPlay, getRelatedTracks } from '../api';

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
  }, []);

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
