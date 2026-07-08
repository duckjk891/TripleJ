import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiChevronRight } from 'react-icons/fi';
import SongItem from '../components/SongItem';
import TrackCard from '../components/TrackCard';
import AlbumCard from '../components/AlbumCard';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../api';
import './MainPage.css';

export default function MainPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [chartSongs, setChartSongs] = useState([]);
  const [latestTracks, setLatestTracks] = useState([]);
  const [latestAlbums, setLatestAlbums] = useState([]);
  const [loading, setLoading] = useState(true);
  const [likedIds, setLikedIds] = useState(new Set());

  // 느낌 카테고리 바 + 필터 뷰
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState(null);
  const [categoryTracks, setCategoryTracks] = useState([]);
  const [categoryLoading, setCategoryLoading] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [chartRes, trackRes, albumRes] = await Promise.all([
          api.getTop100(),
          api.getLatestTracks(10),
          api.getLatestAlbums(10).catch((err) => {
            console.warn('[MainPage] latest albums fetch failed', { status: err.response?.status });
            return { data: { albums: [] } };
          }),
        ]);
        const songs = chartRes.data.slice(0, 10);
        setChartSongs(songs);
        setLatestTracks(trackRes.data.tracks || []);
        const albums = Array.isArray(albumRes.data)
          ? albumRes.data
          : albumRes.data.albums || [];
        setLatestAlbums(albums);

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

  // 느낌 카테고리 목록 로드 (고정 10종 — 백엔드가 목록 제공)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (import.meta.env.DEV) console.info('[CategoryBar] calling getCategories');
        const { data } = await api.getCategories();
        if (cancelled) return;
        const list = Array.isArray(data?.categories) ? data.categories : [];
        setCategories(list);
        if (import.meta.env.DEV) console.info('[CategoryBar] categories loaded', { count: list.length });
      } catch (err) {
        if (!cancelled) {
          console.error('[CategoryBar] getCategories failed', { err, status: err.response?.status });
          setCategories([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSelectCategory = async (category) => {
    // 같은 카테고리 다시 누르면 필터 해제
    if (activeCategory === category) {
      setActiveCategory(null);
      setCategoryTracks([]);
      return;
    }
    setActiveCategory(category);
    setCategoryLoading(true);
    try {
      if (import.meta.env.DEV) console.info('[CategoryView] calling getCategoryChart', { category });
      const { data } = await api.getCategoryChart(category);
      const list = Array.isArray(data) ? data : (data?.tracks || []);
      setCategoryTracks(list);
      if (import.meta.env.DEV) console.info('[CategoryView] category tracks loaded', { category, count: list.length });
      if (user && list.length > 0) {
        try {
          const { data: likeData } = await api.checkLikes(list.map((t) => t.id).join(','));
          setLikedIds((prev) => new Set([...prev, ...(likeData.liked_ids || [])]));
        } catch (likeErr) {
          console.warn('[CategoryView] checkLikes failed', { status: likeErr.response?.status });
        }
      }
    } catch (err) {
      console.error('[CategoryView] getCategoryChart failed', { err, category, status: err.response?.status });
      setCategoryTracks([]);
    } finally {
      setCategoryLoading(false);
    }
  };

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

        {/* 느낌 카테고리 바 */}
        {categories.length > 0 && (
          <div className="main-section">
            <div className="main-section__header">
              <h2 className="main-section__title">느낌별 음악</h2>
            </div>
            <div className="category-bar">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`category-chip ${activeCategory === cat ? 'category-chip--active' : ''}`}
                  onClick={() => handleSelectCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* 선택된 카테고리 필터 뷰 */}
            {activeCategory && (
              <div className="category-view">
                {categoryLoading ? (
                  <div className="main-loading">'{activeCategory}' 곡을 불러오는 중...</div>
                ) : categoryTracks.length > 0 ? (
                  <div className="main-chart">
                    {categoryTracks.map((song, idx) => (
                      <SongItem
                        key={song.id}
                        song={song}
                        rank={song.rank || idx + 1}
                        songs={categoryTracks}
                        isLiked={likedIds.has(song.id)}
                        onToggleLike={handleToggleLike}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="main-loading">'{activeCategory}' 카테고리 곡이 없습니다.</div>
                )}
              </div>
            )}
          </div>
        )}

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

        {/* Latest Tracks */}
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

        {/* Latest Albums (v69) */}
        {latestAlbums.length > 0 && (
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
        )}
      </div>
    </div>
  );
}
