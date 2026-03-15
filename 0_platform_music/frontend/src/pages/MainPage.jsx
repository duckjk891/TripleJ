import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiChevronRight } from 'react-icons/fi';
import SongItem from '../components/SongItem';
import TrackCard from '../components/TrackCard';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../api';
import './MainPage.css';

export default function MainPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [chartSongs, setChartSongs] = useState([]);
  const [latestTracks, setLatestTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [likedIds, setLikedIds] = useState(new Set());

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [chartRes, trackRes] = await Promise.all([
          api.getTop100(),
          api.getLatestTracks(10),
        ]);
        const songs = chartRes.data.slice(0, 10);
        setChartSongs(songs);
        setLatestTracks(trackRes.data.tracks || []);

        if (user && songs.length > 0) {
          const { data } = await api.checkLikes(songs.map(s => s.id).join(','));
          setLikedIds(new Set(data.liked_ids));
        }
      } catch (err) {
        console.error('Failed to load main page data:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [user]);

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
          <div className="main-loading">로딩 중...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="container main-page">
        {/* Banner */}
        <div className="main-banner">
          <div className="main-banner__title">AIMU 인기 차트</div>
          <div className="main-banner__sub">
            AI가 만든 음악을 발견하세요
          </div>
          <Link to="/chart" className="main-banner__btn">
            차트 보러가기
          </Link>
        </div>

        {/* TOP 100 */}
        <div className="main-section">
          <div className="main-section__header">
            <h2 className="main-section__title">AI Music TOP 10</h2>
            <Link to="/chart" className="main-section__more">
              더보기 <FiChevronRight />
            </Link>
          </div>
          <div className="main-chart">
            {chartSongs.map((song, idx) => (
              <SongItem
                key={song.id}
                song={song}
                rank={song.rank || idx + 1}
                songs={chartSongs}
                isLiked={likedIds.has(song.id)}
                onToggleLike={handleToggleLike}
              />
            ))}
          </div>
        </div>

        {/* Latest Albums */}
        <div className="main-section">
          <div className="main-section__header">
            <h2 className="main-section__title">신규 AI 트랙</h2>
          </div>
          <div className="main-albums">
            {latestTracks.map((track) => (
              <TrackCard key={track.id} track={track} tracks={latestTracks} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
