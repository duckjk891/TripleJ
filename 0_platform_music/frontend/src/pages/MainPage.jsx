import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FiChevronRight } from 'react-icons/fi';
import SongItem from '../components/SongItem';
import AlbumCard from '../components/AlbumCard';
import * as api from '../api';
import './MainPage.css';

export default function MainPage() {
  const [chartSongs, setChartSongs] = useState([]);
  const [latestAlbums, setLatestAlbums] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [chartRes, albumRes] = await Promise.all([
          api.getTop100(),
          api.getLatestAlbums(10),
        ]);
        setChartSongs(chartRes.data.slice(0, 10));
        setLatestAlbums(albumRes.data);
      } catch (err) {
        console.error('Failed to load main page data:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

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
          <div className="main-banner__title">멜론 차트 TOP 100</div>
          <div className="main-banner__sub">
            지금 가장 많이 듣는 음악을 확인하세요
          </div>
          <Link to="/chart" className="main-banner__btn">
            차트 보러가기
          </Link>
        </div>

        {/* TOP 100 */}
        <div className="main-section">
          <div className="main-section__header">
            <h2 className="main-section__title">멜론 차트 TOP 10</h2>
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
              />
            ))}
          </div>
        </div>

        {/* Latest Albums */}
        <div className="main-section">
          <div className="main-section__header">
            <h2 className="main-section__title">최신 앨범</h2>
          </div>
          <div className="main-albums">
            {latestAlbums.map((album) => (
              <AlbumCard key={album.id} album={album} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
