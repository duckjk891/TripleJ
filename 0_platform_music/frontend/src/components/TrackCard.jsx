import { FiPlay } from 'react-icons/fi';
import { usePlayer } from '../contexts/PlayerContext';
import { getAlbumGradient } from '../utils';
import './AlbumCard.css';

export default function TrackCard({ track, tracks }) {
  const { play } = usePlayer();

  const handleClick = () => {
    const song = {
      id: track.id,
      title: track.title,
      artist_name: track.uploader_nickname || 'AI',
      cover_image: track.cover_image_url,
      album_id: track.id,
    };
    const songList = tracks?.map(t => ({
      id: t.id,
      title: t.title,
      artist_name: t.uploader_nickname || 'AI',
      cover_image: t.cover_image_url,
      album_id: t.id,
    }));
    play(song, songList);
  };

  return (
    <div className="album-card" onClick={handleClick}>
      <div
        className="album-card__cover"
        style={{ background: getAlbumGradient(track.id) }}
      >
        <span>♪</span>
        <div className="album-card__play-overlay">
          <div className="album-card__play-btn">
            <FiPlay />
          </div>
        </div>
      </div>
      <div className="album-card__title" title={track.title}>{track.title}</div>
      <div className="album-card__artist" title={track.uploader_nickname}>{track.uploader_nickname || 'AI'}</div>
    </div>
  );
}
