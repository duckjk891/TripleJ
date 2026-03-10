import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { FiSearch } from 'react-icons/fi';
import SongItem from '../components/SongItem';
import AlbumCard from '../components/AlbumCard';
import { getAvatarColor, getInitial } from '../utils';
import * as api from '../api';
import './SearchPage.css';

export default function SearchPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const query = searchParams.get('q') || '';
  const [activeTab, setActiveTab] = useState('songs');
  const [songs, setSongs] = useState([]);
  const [albums, setAlbums] = useState([]);
  const [artists, setArtists] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query) {
      setSongs([]);
      setAlbums([]);
      setArtists([]);
      return;
    }

    const fetchResults = async () => {
      setLoading(true);
      try {
        const [songsRes, albumsRes, artistsRes] = await Promise.all([
          api.searchSongs(query, { limit: 50 }),
          api.getAlbums({ limit: 50 }),
          api.getArtists({ limit: 50 }),
        ]);

        setSongs(songsRes.data.songs || []);

        // 앨범 클라이언트 필터링
        const filteredAlbums = (albumsRes.data.albums || []).filter(
          (a) =>
            a.title.toLowerCase().includes(query.toLowerCase()) ||
            a.artist_name.toLowerCase().includes(query.toLowerCase())
        );
        setAlbums(filteredAlbums);

        // 아티스트 클라이언트 필터링
        const filteredArtists = (artistsRes.data.artists || []).filter(
          (a) => a.name.toLowerCase().includes(query.toLowerCase())
        );
        setArtists(filteredArtists);
      } catch (err) {
        console.error('Search failed:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchResults();
  }, [query]);

  if (!query) {
    return (
      <div className="page-content">
        <div className="container search-page">
          <div className="search-intro">
            <div className="search-intro__icon">
              <FiSearch />
            </div>
            <div className="search-intro__text">
              검색어를 입력하여 음악을 찾아보세요
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

        <div className="search-tabs">
          <button
            className={`search-tab ${activeTab === 'songs' ? 'search-tab--active' : ''}`}
            onClick={() => setActiveTab('songs')}
          >
            곡 ({songs.length})
          </button>
          <button
            className={`search-tab ${activeTab === 'albums' ? 'search-tab--active' : ''}`}
            onClick={() => setActiveTab('albums')}
          >
            앨범 ({albums.length})
          </button>
          <button
            className={`search-tab ${activeTab === 'artists' ? 'search-tab--active' : ''}`}
            onClick={() => setActiveTab('artists')}
          >
            아티스트 ({artists.length})
          </button>
        </div>

        {loading ? (
          <div className="search-loading">검색 중...</div>
        ) : (
          <>
            {activeTab === 'songs' && (
              <div className="search-results">
                {songs.length > 0 ? (
                  songs.map((song) => (
                    <SongItem key={song.id} song={song} songs={songs} />
                  ))
                ) : (
                  <div className="search-empty">검색 결과가 없습니다.</div>
                )}
              </div>
            )}

            {activeTab === 'albums' && (
              <div className="search-results">
                {albums.length > 0 ? (
                  <div className="search-albums-grid">
                    {albums.map((album) => (
                      <AlbumCard key={album.id} album={album} />
                    ))}
                  </div>
                ) : (
                  <div className="search-empty">검색 결과가 없습니다.</div>
                )}
              </div>
            )}

            {activeTab === 'artists' && (
              <div className="search-results">
                {artists.length > 0 ? (
                  <div className="search-artists-grid">
                    {artists.map((artist) => (
                      <div
                        key={artist.id}
                        className="search-artist-item"
                        onClick={() => navigate(`/artist/${artist.id}`)}
                      >
                        <div
                          className="search-artist-item__avatar"
                          style={{ background: getAvatarColor(artist.id) }}
                        >
                          {getInitial(artist.name)}
                        </div>
                        <div className="search-artist-item__name">{artist.name}</div>
                        <div className="search-artist-item__genre">{artist.genre}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="search-empty">검색 결과가 없습니다.</div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
