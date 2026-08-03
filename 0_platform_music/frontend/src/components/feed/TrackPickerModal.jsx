import { useState, useEffect } from 'react';
import { FiSearch } from 'react-icons/fi';
import * as api from '../../api';
import { getAlbumGradient } from '../../utils';
import './TrackPickerModal.css';

const LIST_LIMIT = 30;

function coverSrc(cover) {
  if (!cover) return null;
  return cover.startsWith('/api/') || cover.startsWith('http')
    ? cover
    : api.coverPreviewUrl(cover);
}

/**
 * v131 — 곡 선택 모달 (블록 삽입곡/BGM 겸용, 단일 선택).
 * 탭: [내 트랙](비공개 포함, 뱃지+안내) / [전체 곡 검색](미입력 시 인기순, 입력 시 검색 300ms 디바운스).
 * onSelect(track) — 선택 시 호출. 닫기는 onClose.
 */
export default function TrackPickerModal({ title = '곡 선택', onSelect, onClose }) {
  const [tab, setTab] = useState('my'); // 'my' | 'all'
  const [myTracks, setMyTracks] = useState(null); // null=미로드
  const [myLoading, setMyLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [allTracks, setAllTracks] = useState([]);
  const [allLoading, setAllLoading] = useState(false);

  // [내 트랙] 탭 — 최초 진입 시 1회 로드 (비공개 포함)
  useEffect(() => {
    if (tab !== 'my' || myTracks !== null) return;
    let cancelled = false;
    setMyLoading(true);
    if (import.meta.env.DEV) console.info('[TrackPickerModal] getMyTracks start');
    api.getMyTracks({ limit: 50 })
      .then((res) => {
        if (cancelled) return;
        setMyTracks(res.data?.tracks || []);
        if (import.meta.env.DEV) {
          console.info('[TrackPickerModal] getMyTracks done', { count: res.data?.tracks?.length ?? 0 });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[TrackPickerModal] getMyTracks failed', { err });
        setMyTracks([]);
      })
      .finally(() => { if (!cancelled) setMyLoading(false); });
    return () => { cancelled = true; };
    // myLoading 을 deps 에서 제외 — 포함 시 로딩 토글이 효과를 재실행해
    // 자기 요청을 취소하고 로딩이 영구 고착됨(v131 회귀 수정, 2026-07-29).
  }, [tab, myTracks]);

  // [전체 곡 검색] 탭 — 미입력 시 인기순, 입력 시 검색 (300ms 디바운스)
  useEffect(() => {
    if (tab !== 'all') return;
    let cancelled = false;
    const q = query.trim();
    setAllLoading(true);
    const timer = setTimeout(async () => {
      if (import.meta.env.DEV) {
        console.info('[TrackPickerModal] all-tracks fetch start', { mode: q ? 'search' : 'popular', q_len: q.length });
      }
      try {
        const res = q
          ? await api.searchTracks(q, { limit: LIST_LIMIT })
          : await api.getTracks({ limit: LIST_LIMIT, sort: 'play_count' });
        if (cancelled) return;
        setAllTracks(res.data?.tracks || []);
        if (import.meta.env.DEV) {
          console.info('[TrackPickerModal] all-tracks fetch done', { count: res.data?.tracks?.length ?? 0 });
        }
      } catch (err) {
        if (cancelled) return;
        console.error('[TrackPickerModal] all-tracks fetch failed', { err, q_len: q.length });
        setAllTracks([]);
      } finally {
        if (!cancelled) setAllLoading(false);
      }
    }, q ? 300 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [tab, query]);

  const handleSelect = (track) => {
    if (import.meta.env.DEV) console.info('[TrackPickerModal] selected', { track_id: track.id });
    onSelect?.(track);
  };

  const renderRow = (track) => {
    const cover = coverSrc(track.cover_image);
    return (
      <button
        type="button"
        key={track.id}
        className="track-picker__row"
        onClick={() => handleSelect(track)}
      >
        <div
          className="track-picker__row-art"
          style={!cover ? { background: getAlbumGradient(track.id) } : {}}
        >
          {cover ? <img src={cover} alt="" /> : <span>♪</span>}
        </div>
        <div className="track-picker__row-info">
          <div className="track-picker__row-title">
            {track.title}
            {track.is_public === false && <span className="track-picker__badge">비공개</span>}
          </div>
          <div className="track-picker__row-artist">{track.artist_name || track.uploader_nickname || 'AI'}</div>
        </div>
      </button>
    );
  };

  const list = tab === 'my' ? (myTracks || []) : allTracks;
  const loading = tab === 'my' ? myLoading : allLoading;

  return (
    <div className="track-picker-overlay" onClick={onClose}>
      <div className="track-picker" onClick={(e) => e.stopPropagation()}>
        <h2 className="track-picker__title">{title}</h2>

        <div className="track-picker__tabs">
          <button
            type="button"
            className={`track-picker__tab ${tab === 'my' ? 'track-picker__tab--active' : ''}`}
            onClick={() => setTab('my')}
          >
            내 트랙
          </button>
          <button
            type="button"
            className={`track-picker__tab ${tab === 'all' ? 'track-picker__tab--active' : ''}`}
            onClick={() => setTab('all')}
          >
            전체 곡 검색
          </button>
        </div>

        {tab === 'my' && (
          <div className="track-picker__notice">비공개 곡은 다른 사람에게 재생되지 않아요</div>
        )}

        {tab === 'all' && (
          <div className="track-picker__search">
            <FiSearch className="track-picker__search-icon" />
            <input
              type="text"
              className="track-picker__search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="곡명·태그·아티스트 검색 (미입력 시 인기순)"
              autoFocus
            />
          </div>
        )}

        <div className="track-picker__list">
          {loading ? (
            <div className="track-picker__empty">불러오는 중...</div>
          ) : list.length === 0 ? (
            <div className="track-picker__empty">
              {tab === 'my' ? '아직 업로드한 곡이 없습니다.' : '검색 결과가 없습니다.'}
            </div>
          ) : (
            list.map(renderRow)
          )}
        </div>

        <button type="button" className="track-picker__close" onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}
