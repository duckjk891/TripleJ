import { useState } from 'react';
import './BgmPlayer.css';

function BgmPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);

  return (
    <div className="bgm-player">
      <span className="bgm-icon">&#x266B;</span>
      <span className="bgm-title">BGM - Memories...</span>
      <div className="bgm-controls">
        <button
          className="bgm-btn"
          onClick={() => setIsPlaying(!isPlaying)}
        >
          {isPlaying ? '||' : '\u25B6'}
        </button>
      </div>
      <div className="bgm-bar">
        <div className={`bgm-bar-fill ${isPlaying ? 'playing' : ''}`} />
      </div>
    </div>
  );
}

export default BgmPlayer;
