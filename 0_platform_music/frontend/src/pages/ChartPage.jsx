import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { FiPlay, FiHeart, FiPlus, FiDownload } from 'react-icons/fi';
import { usePlayer } from '../contexts/PlayerContext';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../api';
import './ChartPage.css';

const CHART_TABS = [
  { key: 'top100', label: 'TOP 100' },
  { key: 'hot100', label: 'HOT 100' },
  { key: 'daily', label: '일간' },
  { key: 'weekly', label: '주간' },
  { key: 'monthly', label: '월간' },
];

function RankChange({ change }) {
  if (change === null || change === undefined) {
    return <span className="rank-change rank-change--new">NEW</span>;
  }
  if (change > 0) {
    return <span className="rank-change rank-change--up">▲ {change}</span>;
  }
  if (change < 0) {
    return <span className="rank-change rank-change--down">▼ {Math.abs(change)}</span>;
  }
  return <span className="rank-change rank-change--same">-</span>;
}

export default function ChartPage() {
  const { user } = useAuth();
  const { play, addToPlaylist } = usePlayer();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('top100');
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [likedIds, setLikedIds] = useState(new Set());
  const [updateTime, setUpdateTime] = useState('');

  useEffect(() => {
    const fetchChart = async () => {
      setLoading(true);
      try {
        const res = await api.getChart(activeTab);
        const fetched = res.data;
        setTracks(Array.isArray(fetched) ? fetched : []);

        // Extract update time from first track
        if (fetched.length > 0 && fetched[0].chart_update_time) {
          setUpdateTime(fetched[0].chart_update_time);
        } else {
          setUpdateTime('');
        }

        if (user && fetched.length > 0) {
          const { data } = await api.checkLikes(fetched.map((t) => t.id).join(','));
          setLikedIds(new Set(data.liked_ids));
        }
      } catch (err) {
        console.error('Failed to load chart:', err);
        setTracks([]);
        setUpdateTime('');
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
        setLikedIds((prev) => { const s = new Set(prev); s.delete(songId); return s; });
      } else {
        await api.likeSong(songId);
        setLikedIds((prev) => new Set([...prev, songId]));
      }
    } catch (err) { console.error(err); }
  };

  const handlePlay = (track) => {
    play(track, tracks);
  };

  const handleAddToPlaylist = (track) => {
    if (!user) { navigate('/login'); return; }
    addToPlaylist(track);
  };

  const handleDownload = async (trackId) => {
    if (!user) { navigate('/login'); return; }
    try {
      const { data } = await api.downloadTrackFile(trackId);
      const a = document.createElement('a');
      a.href = data.download_url;
      a.download = data.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error('Download failed:', err);
    }
  };

  const formatUpdateTime = (timeStr) => {
    if (!timeStr) return '';
    try {
      const d = new Date(timeStr);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      return `${yyyy}.${mm}.${dd} ${hh}:${min} 기준`;
    } catch {
      return timeStr;
    }
  };

  const coverUrl = (track) => {
    if (!track.cover_image) return null;
    if (track.cover_image.startsWith('/api/')) return track.cover_image;
    return api.coverPreviewUrl(track.cover_image);
  };

  return (
    <div className="page-content">
      <div className="container chart-page">
        <h1 className="chart-page__title">AIMU 차트</h1>

        <div className="chart-tabs">
          {CHART_TABS.map((tab) => (
            <button
              key={tab.key}
              className={`chart-tab ${activeTab === tab.key ? 'chart-tab--active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {updateTime && (
          <div className="chart-update-time">{formatUpdateTime(updateTime)}</div>
        )}

        {loading ? (
          <div className="chart-loading">차트를 불러오는 중...</div>
        ) : (
          <div className={`chart-list ${activeTab === 'top100' ? '' : 'chart-list--2col'}`}>
            <div className="chart-list__header">
              <span className="chart-list__col-rank">순위</span>
              <span className="chart-list__col-change" />
              <span className="chart-list__col-cover" />
              <span className="chart-list__col-info">곡/아티스트</span>
              {activeTab === 'top100' && <span className="chart-list__col-stat">24h 청취</span>}
              {activeTab === 'top100' && <span className="chart-list__col-stat">1h 청취</span>}
              {activeTab === 'hot100' && <span className="chart-list__col-stat">1h 청취</span>}
              {(activeTab === 'daily' || activeTab === 'weekly' || activeTab === 'monthly') && <span className="chart-list__col-stat">청취자</span>}
              <span className="chart-list__col-stat">다운로드</span>
              <span className="chart-list__col-actions" />
            </div>

            {tracks.map((track, idx) => {
              const rank = track.rank || idx + 1;
              const isTop3 = rank <= 3;
              const img = coverUrl(track);

              return (
                <div key={track.id} className={`chart-item ${isTop3 ? 'chart-item--top3' : ''}`}>
                  <span className={`chart-item__rank ${isTop3 ? `chart-item__rank--r${rank}` : ''}`}>
                    {rank}
                  </span>

                  <span className="chart-item__change">
                    <RankChange change={track.change} />
                  </span>

                  <div className="chart-item__cover" onClick={() => handlePlay(track)}>
                    {img ? (
                      <img src={img} alt="" className="chart-item__cover-img" />
                    ) : (
                      <div className="chart-item__cover-placeholder">♪</div>
                    )}
                    <div className="chart-item__cover-play"><FiPlay /></div>
                  </div>

                  <div className="chart-item__info">
                    <div className="chart-item__title" onClick={() => handlePlay(track)}>
                      {track.title}
                    </div>
                    <div className="chart-item__artist">
                      <Link
                        to={user && user.id === track.uploader_id ? '/my-music' : `/artist/${track.uploader_id}`}
                        className="chart-item__artist-link"
                      >
                        {track.artist_name}
                      </Link>
                    </div>
                  </div>

                  {activeTab === 'top100' && <span className="chart-item__stat">{(track.listeners_24h || 0).toLocaleString()}</span>}
                  {activeTab === 'top100' && <span className="chart-item__stat">{(track.listeners_1h || 0).toLocaleString()}</span>}
                  {activeTab === 'hot100' && <span className="chart-item__stat">{(track.listeners_1h || 0).toLocaleString()}</span>}
                  {(activeTab === 'daily' || activeTab === 'weekly' || activeTab === 'monthly') && <span className="chart-item__stat">{(track.listeners_24h || 0).toLocaleString()}</span>}
                  <span className="chart-item__stat">{(track.downloads || 0).toLocaleString()}</span>

                  <div className="chart-item__actions">
                    <button className="chart-item__btn" onClick={() => handlePlay(track)} title="재생">
                      <FiPlay />
                    </button>
                    <button
                      className={`chart-item__btn ${likedIds.has(track.id) ? 'chart-item__btn--liked' : ''}`}
                      onClick={() => handleToggleLike(track.id)}
                      title="좋아요"
                    >
                      <FiHeart style={likedIds.has(track.id) ? { color: '#e74c3c', fill: '#e74c3c' } : {}} />
                    </button>
                    <button className="chart-item__btn" onClick={() => handleAddToPlaylist(track)} title="플레이리스트 추가">
                      <FiPlus />
                    </button>
                    <button className="chart-item__btn" onClick={() => handleDownload(track.id)} title="다운로드">
                      <FiDownload />
                    </button>
                  </div>
                </div>
              );
            })}

            {tracks.length === 0 && (
              <div className="chart-loading">차트 데이터가 없습니다.</div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}
