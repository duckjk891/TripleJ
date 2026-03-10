import { Link } from 'react-router-dom';
import { FiPlay, FiHeart, FiPlus } from 'react-icons/fi';
import { usePlayer } from '../contexts/PlayerContext';
import { getAlbumGradient } from '../utils';
import './SongItem.css';

export default function SongItem({ song, rank, showAlbum = true, songs }) {
  const { play } = usePlayer();

  const handlePlay = () => {
    play(song, songs);
  };

  return (
    <div className="song-item">
      {rank !== undefined && (
        <span className={`song-item__rank ${rank <= 3 ? 'song-item__rank--top3' : ''}`}>
          {rank}
        </span>
      )}

      <div
        className="song-item__art"
        style={{ background: getAlbumGradient(song.album_id || song.id) }}
        onClick={handlePlay}
      >
        ♪
        <div className="song-item__art-play">
          <FiPlay />
        </div>
      </div>

      <div className="song-item__info">
        <div className="song-item__title" onClick={handlePlay}>
          {song.title}
        </div>
        <div className="song-item__artist">
          <Link to={`/artist/${song.artist_id}`}>{song.artist_name}</Link>
        </div>
      </div>

      {showAlbum && song.album_title && (
        <div className="song-item__album">
          <Link to={`/album/${song.album_id}`}>{song.album_title}</Link>
        </div>
      )}

      <div className="song-item__actions">
        <button className="song-item__action-btn" onClick={handlePlay} title="재생">
          <FiPlay />
        </button>
        <button className="song-item__action-btn" title="좋아요">
          <FiHeart />
        </button>
        <button className="song-item__action-btn" title="플레이리스트 추가">
          <FiPlus />
        </button>
      </div>
    </div>
  );
}
