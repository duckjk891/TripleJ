import {
  FiPlay, FiPause, FiSkipBack, FiSkipForward,
  FiVolume2, FiVolumeX,
} from 'react-icons/fi';
import { usePlayer } from '../contexts/PlayerContext';
import { getAlbumGradient } from '../utils';
import './MusicPlayer.css';

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function MusicPlayer() {
  const {
    currentSong, isPlaying, currentTime, duration, volume,
    togglePlay, next, prev, seekTo, changeVolume,
  } = usePlayer();

  const handleProgressClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    seekTo(ratio * duration);
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  if (!currentSong) {
    return (
      <div className="player">
        <div className="player__inner">
          <div className="player__empty">재생할 트랙을 선택하세요</div>
        </div>
      </div>
    );
  }

  return (
    <div className="player">
      <div className="player__inner">
        <div className="player__song-info">
          <div
            className="player__album-art"
            style={!(currentSong.cover_image && currentSong.cover_image.startsWith('/api/files')) ? { background: getAlbumGradient(currentSong.album_id || currentSong.id) } : {}}
          >
            {currentSong.cover_image && currentSong.cover_image.startsWith('/api/files') ? (
              <img src={currentSong.cover_image} alt="" className="player__album-img" />
            ) : (
              <span>♪</span>
            )}
          </div>
          <div className="player__text">
            <div className="player__title">{currentSong.title}</div>
            <div className="player__artist">{currentSong.artist_name}</div>
          </div>
        </div>

        <div className="player__controls">
          <div className="player__buttons">
            <button className="player__btn player__btn--prev" onClick={prev}>
              <FiSkipBack />
            </button>
            <button className="player__btn player__btn--play" onClick={togglePlay}>
              {isPlaying ? <FiPause /> : <FiPlay />}
            </button>
            <button className="player__btn player__btn--next" onClick={next}>
              <FiSkipForward />
            </button>
          </div>
          <div className="player__progress">
            <span className="player__time">{formatTime(currentTime)}</span>
            <div className="player__progress-bar" onClick={handleProgressClick}>
              <div
                className="player__progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="player__time">{formatTime(duration)}</span>
          </div>
        </div>

        <div className="player__volume">
          <button
            className="player__volume-btn"
            onClick={() => changeVolume(volume > 0 ? 0 : 80)}
          >
            {volume > 0 ? <FiVolume2 /> : <FiVolumeX />}
          </button>
          <input
            type="range"
            className="player__volume-slider"
            min="0"
            max="100"
            value={volume}
            onChange={(e) => changeVolume(Number(e.target.value))}
          />
        </div>
      </div>
    </div>
  );
}
