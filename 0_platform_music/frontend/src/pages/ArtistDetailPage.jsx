import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FiDisc, FiMusic } from 'react-icons/fi';
import SongItem from '../components/SongItem';
import AlbumCard from '../components/AlbumCard';
import { useAuth } from '../contexts/AuthContext';
import { getAvatarColor, getInitial } from '../utils';
import * as api from '../api';
import './ArtistDetailPage.css';

export default function ArtistDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [artist, setArtist] = useState(null);
  const [songs, setSongs] = useState([]);
  const [albums, setAlbums] = useState([]);
  const [loading, setLoading] = useState(true);
  const [likedIds, setLikedIds] = useState(new Set());

  useEffect(() => {
    const fetchArtist = async () => {
      setLoading(true);
      try {
        const [artistRes, songsRes, albumsRes] = await Promise.all([
          api.getArtist(id),
          api.getArtistSongs(id, 10),
          api.getArtistAlbums(id),
        ]);
        setArtist(artistRes.data);
        const fetchedSongs = songsRes.data;
        setSongs(fetchedSongs);
        setAlbums(albumsRes.data);

        if (user && fetchedSongs.length > 0) {
          const { data } = await api.checkLikes(fetchedSongs.map(s => s.id).join(','));
          setLikedIds(new Set(data.liked_ids));
        }
      } catch (err) {
        console.error('Failed to load artist:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchArtist();
  }, [id, user]);

  const handleToggleLike = async (songId) => {
    if (!user) { navigate('/login'); return; }
    try {
      if (likedIds.has(songId)) {
        await api.unlikeSong(songId);
        setLikedIds(prev => { const s = new Set(prev); s.delete(songId); return s; });
      } else {
        await api.likeSong(songId);
        setLikedIds(prev => new Set([...prev, songId]));
      }
    } catch (err) { console.error(err); }
  };

  if (loading) {
    return (
      <div className="page-content">
        <div className="container">
          <div className="artist-detail__loading">아티스트 정보를 불러오는 중...</div>
        </div>
      </div>
    );
  }

  if (!artist) {
    return (
      <div className="page-content">
        <div className="container">
          <div className="artist-detail__loading">아티스트를 찾을 수 없습니다.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="container artist-detail">
        <div className="artist-detail__header">
          <div
            className="artist-detail__avatar"
            style={{ background: getAvatarColor(artist.id) }}
          >
            {getInitial(artist.name)}
          </div>
          <div className="artist-detail__info">
            <h1>{artist.name}</h1>
            <div className="artist-detail__meta">
              {artist.genre && <span><FiDisc /> {artist.genre}</span>}
              {artist.debut_date && <span>데뷔: {artist.debut_date}</span>}
            </div>
            <div className="artist-detail__stats">
              <div className="artist-detail__stat">
                <div className="artist-detail__stat-value">{artist.album_count || albums.length}</div>
                <div className="artist-detail__stat-label">앨범</div>
              </div>
              <div className="artist-detail__stat">
                <div className="artist-detail__stat-value">{artist.song_count || songs.length}</div>
                <div className="artist-detail__stat-label">곡</div>
              </div>
            </div>
          </div>
        </div>

        {songs.length > 0 && (
          <div className="artist-detail__section">
            <h2 className="artist-detail__section-title">
              <FiMusic style={{ verticalAlign: 'middle', marginRight: 8 }} />
              인기곡
            </h2>
            <div className="artist-detail__songs">
              {songs.map((song, idx) => (
                <SongItem
                  key={song.id}
                  song={song}
                  rank={idx + 1}
                  songs={songs}
                  isLiked={likedIds.has(song.id)}
                  onToggleLike={handleToggleLike}
                />
              ))}
            </div>
          </div>
        )}

        {albums.length > 0 && (
          <div className="artist-detail__section">
            <h2 className="artist-detail__section-title">
              <FiDisc style={{ verticalAlign: 'middle', marginRight: 8 }} />
              앨범
            </h2>
            <div className="artist-detail__albums">
              {albums.map((album) => (
                <AlbumCard key={album.id} album={album} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
