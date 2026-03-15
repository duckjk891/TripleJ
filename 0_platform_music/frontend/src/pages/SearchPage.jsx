import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { FiSearch } from 'react-icons/fi';
import SongItem from '../components/SongItem';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../api';
import './SearchPage.css';

export default function SearchPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const query = searchParams.get('q') || '';
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [likedIds, setLikedIds] = useState(new Set());

  useEffect(() => {
    if (!query) {
      setTracks([]);
      setLikedIds(new Set());
      return;
    }

    const fetchResults = async () => {
      setLoading(true);
      try {
        const res = await api.searchTracks(query, { limit: 50 });
        const fetchedTracks = (res.data.tracks || []).map(t => ({
          ...t,
          artist_name: t.artist_name || t.uploader_nickname || 'AI',
          cover_image: t.cover_image || t.cover_image_url,
        }));
        setTracks(fetchedTracks);

        if (user && fetchedTracks.length > 0) {
          const { data } = await api.checkLikes(fetchedTracks.map(s => s.id).join(','));
          setLikedIds(new Set(data.liked_ids));
        }
      } catch (err) {
        console.error('Search failed:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchResults();
  }, [query, user]);

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

  if (!query) {
    return (
      <div className="page-content">
        <div className="container search-page">
          <div className="search-intro">
            <div className="search-intro__icon">
              <FiSearch />
            </div>
            <div className="search-intro__text">
              AI 음악을 검색해보세요
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="container search-page">
        <h1 className="search-page__title">
          <span className="search-page__keyword">"{query}"</span> 검색 결과
        </h1>

        {loading ? (
          <div className="search-loading">검색 중...</div>
        ) : (
          <div className="search-results">
            {tracks.length > 0 ? (
              tracks.map((track) => (
                <SongItem
                  key={track.id}
                  song={track}
                  songs={tracks}
                  isLiked={likedIds.has(track.id)}
                  onToggleLike={handleToggleLike}
                />
              ))
            ) : (
              <div className="search-empty">검색 결과가 없습니다.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
