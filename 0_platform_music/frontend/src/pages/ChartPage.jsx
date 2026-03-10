import { useState, useEffect } from 'react';
import SongItem from '../components/SongItem';
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
];

export default function ChartPage() {
  const [activeTab, setActiveTab] = useState('top100');
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);

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
        setSongs(res.data);
      } catch (err) {
        console.error('Failed to load chart:', err);
        setSongs([]);
      } finally {
        setLoading(false);
      }
    };
    fetchChart();
  }, [activeTab]);

  return (
    <div className="page-content">
      <div className="container chart-page">
        <h1 className="chart-page__title">멜론 차트</h1>

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
              <span className="chart-list__header-rank">순위</span>
              <span className="chart-list__header-art" />
              <span className="chart-list__header-info">곡/아티스트</span>
              <span className="chart-list__header-album">앨범</span>
              <span className="chart-list__header-actions">듣기/좋아요</span>
            </div>
            {songs.map((song, idx) => (
              <SongItem
                key={song.id}
                song={song}
                rank={song.rank || idx + 1}
                songs={songs}
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
