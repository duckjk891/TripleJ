import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiPlay, FiHeart, FiPlus, FiBookmark, FiImage } from 'react-icons/fi';
import { usePlayer } from '../contexts/PlayerContext';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../api';
import { getAlbumGradient } from '../utils';
import AddToPlaylistModal from './AddToPlaylistModal';
import TrackShareButton from './TrackShareButton';
import TrackDownloadButton from './TrackDownloadButton';
import './SongItem.css';

// v207 — onEditCover: 옵션 prop. 전달된 경우에만 「커버 수정」 버튼 렌더 (내 채널 본인 전용).
// 미전달 시 렌더 결과는 기존과 완전 동일 — 차트·플레이리스트 등 다른 사용처 무영향.
// v214 — showSourceBadge: 옵션 prop (기본 off — v207 선례). true 이고 출처 재료(source_meta,
// 폴백 user_character_snapshot.name)가 있을 때만 제목 밑 한 줄 뱃지 — resolve 호출 0(동봉 스냅샷 직행).
export default function SongItem({ song, rank, showAlbum = true, songs, isLiked, onToggleLike, queueAll = false, onPlay, onEditCover, showSourceBadge = false }) {
  const { play, addToPlaylist } = usePlayer();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [showAddModal, setShowAddModal] = useState(false);

  const handlePlay = () => {
    if (onPlay) onPlay(song); // v169 — 부모(검색 등) 클릭 로깅 훅, best-effort
    play(song, songs, { queueAll });
  };

  const handleLike = () => {
    if (!user) {
      navigate('/login');
      return;
    }
    if (onToggleLike) {
      onToggleLike(song.id);
    }
  };

  const handleAddToPlaylist = () => {
    if (!user) {
      navigate('/login');
      return;
    }
    addToPlaylist(song);
  };

  const handleSaveToPlaylist = () => {
    if (!user) { navigate('/login'); return; }
    if (import.meta.env.DEV) console.info('[SongItem] openAddToPlaylist', { track: song?.id });
    setShowAddModal(true);
  };

  return (
    <div className="song-item">
      {rank !== undefined && (
        <span className={`song-item__rank ${rank <= 3 ? 'song-item__rank--top3' : ''}`}>
          {rank}
        </span>
      )}

      <div
        className="song-item__art"
        style={!song.cover_image ? { background: getAlbumGradient(song.album_id || song.id) } : {}}
        onClick={handlePlay}
      >
        {song.cover_image ? (
          <img src={song.cover_image.startsWith('/api/') ? song.cover_image : api.coverPreviewUrl(song.cover_image)} alt="" className="song-item__art-img" />
        ) : (
          <span>♪</span>
        )}
        <div className="song-item__art-play">
          <FiPlay />
        </div>
      </div>

      <div className="song-item__info">
        <div className="song-item__title" onClick={handlePlay}>
          {song.title}
        </div>
        {/* v214 — 곡 출처 뱃지 (옵션·재료 없으면 행 자체 생략 → 기존 곡 자동 생략) */}
        {showSourceBadge && (() => {
          const sm = song.source_meta || {};
          const artistName = sm.artist_name || song.user_character_snapshot?.name || null;
          const voiceName = sm.persona_name || null;
          if (!artistName && !voiceName) return null;
          return (
            <div className="song-item__source-badge" style={{ fontSize: '11px', color: '#8a8a9a', marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {[artistName && `🧑‍🎤 ${artistName}`, voiceName && `🎤 ${voiceName}`].filter(Boolean).join(' · ')}
            </div>
          );
        })()}
        <div className="song-item__artist">
          <Link to={`/artist/${song.artist_id || song.uploader_id}`} title="채널 보기">{song.artist_name || song.uploader_nickname || 'AI'}</Link>
        </div>
      </div>

      {showAlbum && song.album_title && (
        <div className="song-item__album">
          <Link to={`/album/${song.album_id}`}>{song.album_title}</Link>
        </div>
      )}

      <div className="song-item__actions">
        <button className="song-item__action-btn" onClick={handlePlay} title="재생">
          <FiPlay />
        </button>
        <button
          className={`song-item__action-btn ${isLiked ? 'song-item__action-btn--liked' : ''}`}
          onClick={handleLike}
          title="좋아요"
        >
          <FiHeart style={isLiked ? { color: '#e74c3c', fill: '#e74c3c' } : {}} />
        </button>
        <button className="song-item__action-btn" onClick={handleAddToPlaylist} title="재생목록 추가">
          <FiPlus />
        </button>
        <button className="song-item__action-btn" onClick={handleSaveToPlaylist} title="플레이리스트에 추가">
          <FiBookmark />
        </button>
        {/* v129 — 다운로드: 자막 영상 4옵션 팝업 */}
        <TrackDownloadButton track={{ id: song.id, title: song.title }} />
        <TrackShareButton track={{ id: song.id, title: song.title }} />
        {/* v207 — 커버 수정 (onEditCover 전달 시에만 — 본인 채널 전용) */}
        {onEditCover && (
          <button
            className="song-item__action-btn"
            onClick={() => onEditCover(song)}
            title="커버 수정"
          >
            <FiImage />
          </button>
        )}
      </div>

      {showAddModal && (
        <AddToPlaylistModal songId={song.id} onClose={() => setShowAddModal(false)} />
      )}
    </div>
  );
}
