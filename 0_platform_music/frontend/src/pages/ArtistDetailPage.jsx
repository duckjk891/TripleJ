import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FiDisc, FiMusic } from 'react-icons/fi';
import SongItem from '../components/SongItem';
import AlbumCard from '../components/AlbumCard';
import Avatar from '../components/Avatar';
import FeedList from '../components/feed/FeedList';
import CoverEditModal from '../components/CoverEditModal';
import { useAuth } from '../contexts/AuthContext';
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
  // 팔로우 — summary 는 무인증 조회 가능, null 이면 아직 로딩 전/실패
  const [followSummary, setFollowSummary] = useState(null);
  const [followBusy, setFollowBusy] = useState(false);
  // v131 — 채널 탭: 'music'(곡·앨범, 기존 콘텐츠) | 'feed'(음악 피드) | v133 'community'(공지)
  const [tab, setTab] = useState('music');
  // v207 — 커버 수정 모달 대상 곡 (본인 채널에서만 진입)
  const [editCoverSong, setEditCoverSong] = useState(null);

  // 본인 페이지 여부 (id 는 URL 파라미터 문자열 — 타입 불일치 방지 위해 String 비교)
  const isSelf = !!user && String(user.id) === String(id);

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

  useEffect(() => {
    let cancelled = false;
    const fetchFollowSummary = async () => {
      if (import.meta.env.DEV) {
        console.info('[ArtistDetail] getFollowSummary start', { id });
      }
      try {
        const { data } = await api.getFollowSummary(id);
        if (cancelled) return;
        setFollowSummary({
          follower_count: data?.follower_count ?? 0,
          is_following: !!data?.is_following,
        });
        if (import.meta.env.DEV) {
          console.info('[ArtistDetail] getFollowSummary done', {
            id,
            follower_count: data?.follower_count ?? 0,
            is_following: !!data?.is_following,
          });
        }
      } catch (err) {
        console.error('[ArtistDetail] getFollowSummary failed', { err, id });
      }
    };
    fetchFollowSummary();
    return () => { cancelled = true; };
  }, [id, user]);

  const handleToggleFollow = async () => {
    if (!user) {
      alert('로그인 후 이용할 수 있습니다.');
      return;
    }
    if (!followSummary || followBusy) return;
    const prev = followSummary;
    const next = {
      follower_count: Math.max(0, prev.follower_count + (prev.is_following ? -1 : 1)),
      is_following: !prev.is_following,
    };
    // 낙관적 토글 — 실패 시 롤백
    setFollowSummary(next);
    setFollowBusy(true);
    if (import.meta.env.DEV) {
      console.info('[ArtistDetail] toggleFollow start', { id, to: next.is_following });
    }
    try {
      if (prev.is_following) {
        await api.unfollowUser(id);
      } else {
        await api.followUser(id);
      }
      if (import.meta.env.DEV) {
        console.info('[ArtistDetail] toggleFollow done', { id, is_following: next.is_following });
      }
    } catch (err) {
      console.error('[ArtistDetail] toggleFollow failed', { err, id, to: next.is_following });
      setFollowSummary(prev);
    } finally {
      setFollowBusy(false);
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
          <div className="artist-detail__loading">크리에이터 정보를 불러오는 중...</div>
        </div>
      </div>
    );
  }

  if (!artist) {
    return (
      <div className="page-content">
        <div className="container">
          <div className="artist-detail__loading">크리에이터를 찾을 수 없습니다.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="container artist-detail">
        <div className="artist-detail__header">
          <Avatar
            src={artist.image}
            name={artist.name}
            size={null}
            className="artist-detail__avatar"
          />
          <div className="artist-detail__info">
            {/* v132 — 페이지 명칭 "채널" 통일 (유튜브식, 사용자 확정) */}
            <div className="artist-detail__page-label">{isSelf ? '내 채널' : '채널'}</div>
            <h1>{artist.name}</h1>
            <div className="artist-detail__meta">
              {artist.genre && <span><FiDisc /> {artist.genre}</span>}
              {artist.debut_date && <span>활동 시작: {artist.debut_date}</span>}
            </div>
            <div className="artist-detail__stats">
              <div className="artist-detail__stat">
                <div className="artist-detail__stat-value">{artist.album_count || albums.length}</div>
                <div className="artist-detail__stat-label">앨범</div>
              </div>
              <div className="artist-detail__stat">
                <div className="artist-detail__stat-value">{artist.track_count || songs.length}</div>
                <div className="artist-detail__stat-label">트랙</div>
              </div>
              <div className="artist-detail__stat">
                <div className="artist-detail__stat-value">
                  {(followSummary?.follower_count ?? 0).toLocaleString()}
                </div>
                <div className="artist-detail__stat-label">팔로워</div>
              </div>
            </div>
            {!isSelf && (
              <div className="artist-detail__follow">
                <button
                  type="button"
                  className={`artist-detail__follow-btn ${followSummary?.is_following ? 'artist-detail__follow-btn--following' : ''}`}
                  onClick={handleToggleFollow}
                  disabled={followBusy}
                >
                  {followSummary?.is_following ? '팔로잉' : '팔로우'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* v131 — 탭 바: [곡·앨범](기존 콘텐츠) / [피드] · v133 — [커뮤니티](공지) */}
        <div className="artist-detail__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'music'}
            className={`artist-detail__tab ${tab === 'music' ? 'artist-detail__tab--active' : ''}`}
            onClick={() => setTab('music')}
          >
            곡·앨범
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'feed'}
            className={`artist-detail__tab ${tab === 'feed' ? 'artist-detail__tab--active' : ''}`}
            onClick={() => setTab('feed')}
          >
            피드
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'community'}
            className={`artist-detail__tab ${tab === 'community' ? 'artist-detail__tab--active' : ''}`}
            onClick={() => setTab('community')}
          >
            커뮤니티
          </button>
        </div>

        {tab === 'feed' && <FeedList authorId={id} isSelf={isSelf} />}

        {tab === 'community' && <FeedList authorId={id} isSelf={isSelf} kind="community" />}

        {tab === 'music' && songs.length > 0 && (
          <div className="artist-detail__section">
            <h2 className="artist-detail__section-title">
              <FiMusic style={{ verticalAlign: 'middle', marginRight: 8 }} />
              인기 트랙
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
                  onEditCover={isSelf ? setEditCoverSong : undefined}
                />
              ))}
            </div>
          </div>
        )}

        {tab === 'music' && albums.length > 0 && (
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

        {/* v207 — 커버 수정 모달 (내 채널 진입점, 본인만) */}
        {editCoverSong && isSelf && (
          <CoverEditModal
            track={editCoverSong}
            onClose={() => setEditCoverSong(null)}
            onUpdated={(newCoverUrl) => {
              setSongs((prev) => prev.map((s) => (
                s.id === editCoverSong.id ? { ...s, cover_image: newCoverUrl } : s
              )));
            }}
          />
        )}
      </div>
    </div>
  );
}
