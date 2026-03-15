import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import SongItem from '../components/SongItem';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../api';
import './ChartPage.css';

const GENRES = [
  { key: 'top100', label: 'TOP 100' },
  { key: '발라드', label: '발라드' },
  { key: '댄스', label: '댄스' },
  { key: '힙합', label: '힙합' },
  { key: 'R&B', label: 'R&B' },
  { key: '인디', label: '인디' },
  { key: '록', label: '록' },
  { key: 'Electronic', label: 'Electronic' },
  { key: 'Ambient', label: 'Ambient' },
  { key: 'Lo-fi', label: 'Lo-fi' },
  { key: 'Cinematic', label: 'Cinematic' },
];

export default function ChartPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('top100');
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [likedIds, setLikedIds] = useState(new Set());

  useEffect(() => {
    const fetchChart = async () => {
      setLoading(true);
      try {
        let res;
        if (activeTab === 'top100') {
          res = await api.getTop100();
        } else {
          res = await api.getGenreChart(activeTab);
        }
        const fetchedSongs = res.data;
        setSongs(fetchedSongs);

        if (user && fetchedSongs.length > 0) {
          const { data } = await api.checkLikes(fetchedSongs.map(s => s.id).join(','));
          setLikedIds(new Set(data.liked_ids));
        }
      } catch (err) {
        console.error('Failed to load chart:', err);
        setSongs([]);
      } finally {
        setLoading(false);
      }
    };
    fetchChart();
  }, [activeTab, user]);

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

  return (
    <div className="page-content">
      <div className="container chart-page">
        <h1 className="chart-page__title">AI Music Chart</h1>

        <div className="chart-tabs">
          {GENRES.map((g) => (
            <button
              key={g.key}
              className={`chart-tab ${activeTab === g.key ? 'chart-tab--active' : ''}`}
              onClick={() => setActiveTab(g.key)}
            >
              {g.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="chart-loading">차트를 불러오는 중...</div>
        ) : (
          <div className="chart-list">
            <div className="chart-list__header">
              <span className="chart-list__header-rank">#</span>
              <span className="chart-list__header-art" />
              <span className="chart-list__header-info">트랙/크리에이터</span>
              <span className="chart-list__header-album">앨범</span>
              <span className="chart-list__header-actions">Actions</span>
            </div>
            {songs.map((song, idx) => (
              <SongItem
                key={song.id}
                song={song}
                rank={song.rank || idx + 1}
                songs={songs}
                isLiked={likedIds.has(song.id)}
                onToggleLike={handleToggleLike}
              />
            ))}
            {songs.length === 0 && (
              <div className="chart-loading">차트 데이터가 없습니다.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
