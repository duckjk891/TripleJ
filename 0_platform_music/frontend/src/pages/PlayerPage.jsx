import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiMusic, FiList, FiX, FiFilm } from 'react-icons/fi';
import { usePlayer } from '../contexts/PlayerContext';
import * as api from '../api';
import CharacterCoverCard from '../components/CharacterCoverCard';
import './PlayerPage.css';

export default function PlayerPage() {
  const navigate = useNavigate();
  const {
    currentSong, playlist, currentIndex, play, isPlaying,
    removeFromPlaylist, audioRef, videoRef, videoMode, setVideoMode,
    setCurrentTime: ctxSetCurrentTime, setAudioDuration: ctxSetDuration,
    setIsPlaying: ctxSetIsPlaying,
  } = usePlayer();
  const [activeTab, setActiveTab] = useState('prompt');
  const [mediaTab, setMediaTab] = useState('song'); // 'song' | 'video'
  const [trackDetail, setTrackDetail] = useState(null);
  const [genDetail, setGenDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [mvData, setMvData] = useState(null); // { has_music_video, music_video_url }
  const [mvLoading, setMvLoading] = useState(false);
  const localVideoRef = useRef(null);

  // Sync local videoRef with context videoRef
  useEffect(() => {
    videoRef.current = localVideoRef.current;
    return () => {
      videoRef.current = null;
    };
  });

  // 페이지 언마운트 시 videoMode 해제 + 오디오 복원
  useEffect(() => {
    return () => {
      setVideoMode(false);
    };
  }, [setVideoMode]);

  // Fetch track + generation details when current song changes
  useEffect(() => {
    if (!currentSong) return;
    const fetchDetail = async () => {
      setLoadingDetail(true);
      try {
        const { data: track } = await api.getTrackDetail(currentSong.id);
        setTrackDetail(track);

        // v68 — cover_character 존재 여부 로깅 (PII 제외)
        if (import.meta.env.DEV) {
          console.info('[PlayerPage] cover_character', {
            track: currentSong?.id ?? null,
            has: !!track?.cover_character,
            items: track?.cover_character?.used_items?.length ?? 0,
          });
        }

        // MV 정보도 트랙 상세에서 가져옴
        setMvData({
          has_music_video: track.has_music_video || false,
          music_video_url: track.music_video_url || null,
        });

        // generation_id가 있으면 세밀한 생성 파라미터도 가져오기
        if (track.generation_id) {
          try {
            const { data: gen } = await api.getGeneration(track.generation_id);
            setGenDetail(gen);
          } catch {
            setGenDetail(null);
          }
        } else {
          setGenDetail(null);
        }
      } catch (err) {
        console.error('Failed to load track detail:', err);
        setTrackDetail(null);
        setGenDetail(null);
        setMvData(null);
      } finally {
        setLoadingDetail(false);
      }
    };
    fetchDetail();
  }, [currentSong?.id]);

  // 곡이 바뀌면 미디어 탭을 "노래"로 초기화
  useEffect(() => {
    setMediaTab('song');
    setVideoMode(false);
  }, [currentSong?.id, setVideoMode]);

  // 미디어 탭 전환 핸들러
  const handleMediaTabChange = useCallback((tab) => {
    if (tab === mediaTab) return;

    if (tab === 'video') {
      // 노래 -> 동영상 전환
      const time = audioRef.current.currentTime;
      audioRef.current.pause();
      setMediaTab('video');
      setVideoMode(true);

      // video가 렌더링된 후 시간 동기화 (requestAnimationFrame으로 대기)
      requestAnimationFrame(() => {
        const video = localVideoRef.current;
        if (video) {
          const doSync = () => {
            video.currentTime = time;
            video.play().catch((err) => {
              console.error('Video play failed:', err);
            });
          };
          if (video.readyState >= 1) {
            doSync();
          } else {
            video.addEventListener('loadedmetadata', doSync, { once: true });
          }
        }
      });
    } else {
      // 동영상 -> 노래 전환
      const video = localVideoRef.current;
      const time = video ? video.currentTime : 0;
      if (video) video.pause();

      setMediaTab('song');
      setVideoMode(false);
      audioRef.current.currentTime = time;
      audioRef.current.play().catch((err) => {
        console.error('Audio play failed:', err);
      });
    }
  }, [mediaTab, audioRef, setVideoMode]);

  // MV 데이터를 lazy load (동영상 탭 클릭 시 mvData가 없으면 fetch)
  const handleVideoTabClick = useCallback(async () => {
    if (!mvData && currentSong) {
      setMvLoading(true);
      try {
        const { data } = await api.getTrackMusicVideo(currentSong.id);
        setMvData(data);
      } catch (err) {
        console.error('Failed to load MV data:', err);
        setMvData({ has_music_video: false, music_video_url: null });
      } finally {
        setMvLoading(false);
      }
    }
    handleMediaTabChange('video');
  }, [mvData, currentSong, handleMediaTabChange]);

  // Video 이벤트로 PlayerContext의 currentTime/duration/isPlaying 동기화
  useEffect(() => {
    const video = localVideoRef.current;
    if (!video || !videoMode) return;

    const onTimeUpdate = () => ctxSetCurrentTime(video.currentTime);
    const onLoadedMetadata = () => ctxSetDuration(video.duration);
    const onPlay = () => ctxSetIsPlaying(true);
    const onPause = () => ctxSetIsPlaying(false);

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);

    // duration이 이미 로드되어 있을 수 있음
    if (video.duration && !isNaN(video.duration)) {
      ctxSetDuration(video.duration);
    }

    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
    };
  }, [videoMode, mediaTab, ctxSetCurrentTime, ctxSetDuration, ctxSetIsPlaying]);

  // Empty state if no song is playing
  if (!currentSong) {
    return (
      <div className="page-content">
        <div className="container player-page">
          <div className="player-page__empty">
            <FiMusic size={48} />
            <p>재생 중인 곡이 없습니다</p>
            <button onClick={() => navigate('/chart')} className="player-page__go-chart">차트로 이동</button>
          </div>
        </div>
      </div>
    );
  }

  const coverSrc = currentSong.cover_image
    ? (currentSong.cover_image.startsWith('/api/') ? currentSong.cover_image : api.coverPreviewUrl(currentSong.cover_image))
    : null;

  return (
    <div className="page-content">
      <div className="container player-page">
        <div className="player-page__layout">
          {/* Left: Cover art / Video + song info */}
          <div className="player-page__left">
            {/* 노래/동영상 미디어 탭 */}
            <div className="player-page__media-tabs">
              <button
                className={`player-page__media-tab ${mediaTab === 'song' ? 'player-page__media-tab--active' : ''}`}
                onClick={() => handleMediaTabChange('song')}
              >
                <FiMusic /> 노래
              </button>
              <button
                className={`player-page__media-tab ${mediaTab === 'video' ? 'player-page__media-tab--active' : ''}`}
                onClick={handleVideoTabClick}
              >
                <FiFilm /> 동영상
              </button>
            </div>

            {/* 미디어 영역 */}
            <div className="player-page__cover">
              {mediaTab === 'song' ? (
                // 노래 탭: 기존 커버이미지
                coverSrc ? (
                  <img src={coverSrc} alt="" className="player-page__cover-img" />
                ) : (
                  <div className="player-page__cover-placeholder">♪</div>
                )
              ) : (
                // 동영상 탭
                mvLoading ? (
                  <div className="player-page__mv-loading">뮤직비디오 정보를 불러오는 중...</div>
                ) : mvData?.has_music_video && mvData?.music_video_url ? (
                  <video
                    ref={localVideoRef}
                    className="player-page__video"
                    src={mvData.music_video_url}
                    playsInline
                  />
                ) : (
                  <div className="player-page__mv-empty">
                    <FiFilm size={48} />
                    <p>뮤직비디오가 없는 음악입니다</p>
                  </div>
                )
              )}
            </div>

            <h1 className="player-page__title">{currentSong.title}</h1>
            <p className="player-page__artist">{currentSong.artist_name}</p>
          </div>

          {/* Right: Tabs */}
          <div className="player-page__right">
            <div className="player-page__tabs">
              <button
                className={`player-page__tab ${activeTab === 'prompt' ? 'player-page__tab--active' : ''}`}
                onClick={() => setActiveTab('prompt')}
              >
                <FiMusic /> 프롬프트 정보
              </button>
              <button
                className={`player-page__tab ${activeTab === 'playlist' ? 'player-page__tab--active' : ''}`}
                onClick={() => setActiveTab('playlist')}
              >
                <FiList /> 플레이리스트
              </button>
            </div>

            <div className="player-page__tab-content">
              {activeTab === 'prompt' && (
                <div className="player-page__prompt-info">
                  {loadingDetail ? (
                    <div className="player-page__loading">정보를 불러오는 중...</div>
                  ) : trackDetail ? (
                    <>
                      <div className="player-page__info-section">
                        <h3>음악 생성 프롬프트</h3>
                        <p className="player-page__info-text">{trackDetail.prompt || '-'}</p>
                      </div>

                      <div className="player-page__info-grid">
                        <div className="player-page__info-item">
                          <span className="player-page__info-label">장르</span>
                          <span className="player-page__info-value">{Array.isArray(trackDetail.genre) && trackDetail.genre.length > 0 ? trackDetail.genre.join(', ') : '-'}</span>
                        </div>
                        <div className="player-page__info-item">
                          <span className="player-page__info-label">분위기</span>
                          <span className="player-page__info-value">{Array.isArray(trackDetail.mood) && trackDetail.mood.length > 0 ? trackDetail.mood.join(', ') : '-'}</span>
                        </div>
                        <div className="player-page__info-item">
                          <span className="player-page__info-label">AI 모델</span>
                          <span className="player-page__info-value">{trackDetail.ai_model || '-'}</span>
                        </div>
                        <div className="player-page__info-item">
                          <span className="player-page__info-label">길이</span>
                          <span className="player-page__info-value">{trackDetail.duration_sec ? `${Math.floor(trackDetail.duration_sec / 60)}분 ${trackDetail.duration_sec % 60}초` : '-'}</span>
                        </div>
                        <div className="player-page__info-item">
                          <span className="player-page__info-label">보컬</span>
                          <span className="player-page__info-value">{genDetail?.vocal || trackDetail.vocal || '-'}</span>
                        </div>
                        <div className="player-page__info-item">
                          <span className="player-page__info-label">BPM</span>
                          <span className="player-page__info-value">{genDetail?.bpm || trackDetail.bpm || '-'}</span>
                        </div>
                        <div className="player-page__info-item">
                          <span className="player-page__info-label">Key (조성)</span>
                          <span className="player-page__info-value">{genDetail?.key || trackDetail.key || '-'}</span>
                        </div>
                        <div className="player-page__info-item">
                          <span className="player-page__info-label">스타일</span>
                          <span className="player-page__info-value">{genDetail?.style || '-'}</span>
                        </div>
                        <div className="player-page__info-item">
                          <span className="player-page__info-label">제외 스타일</span>
                          <span className="player-page__info-value">{genDetail?.negative_tags || '-'}</span>
                        </div>
                        <div className="player-page__info-item">
                          <span className="player-page__info-label">스타일 강도</span>
                          <span className="player-page__info-value">{genDetail?.style_weight != null ? genDetail.style_weight : '-'}</span>
                        </div>
                        <div className="player-page__info-item">
                          <span className="player-page__info-label">실험성</span>
                          <span className="player-page__info-value">{genDetail?.weirdness != null ? genDetail.weirdness : '-'}</span>
                        </div>
                        <div className="player-page__info-item">
                          <span className="player-page__info-label">오디오 영향도</span>
                          <span className="player-page__info-value">{genDetail?.audio_weight != null ? genDetail.audio_weight : '-'}</span>
                        </div>
                        <div className="player-page__info-item">
                          <span className="player-page__info-label">페르소나</span>
                          <span className="player-page__info-value">{genDetail?.persona_id || '-'}</span>
                        </div>
                        <div className="player-page__info-item">
                          <span className="player-page__info-label">페르소나 타입</span>
                          <span className="player-page__info-value">{genDetail?.persona_model || '-'}</span>
                        </div>
                        <div className="player-page__info-item">
                          <span className="player-page__info-label">참조 스타일</span>
                          <span className="player-page__info-value">{genDetail?.reference_style || '-'}</span>
                        </div>
                        <div className="player-page__info-item">
                          <span className="player-page__info-label">재생 수</span>
                          <span className="player-page__info-value">{trackDetail.play_count ?? '-'}</span>
                        </div>
                        <div className="player-page__info-item">
                          <span className="player-page__info-label">좋아요 수</span>
                          <span className="player-page__info-value">{trackDetail.like_count ?? '-'}</span>
                        </div>
                        <div className="player-page__info-item">
                          <span className="player-page__info-label">다운로드 수</span>
                          <span className="player-page__info-value">{trackDetail.download_count ?? '-'}</span>
                        </div>
                      </div>

                      <div className="player-page__info-section">
                        <h3>가사</h3>
                        <pre className="player-page__lyrics">{trackDetail.lyrics || '-'}</pre>
                      </div>
                    </>
                  ) : (
                    <div className="player-page__loading">프롬프트 정보가 없습니다</div>
                  )}
                </div>
              )}

              {activeTab === 'prompt' && trackDetail && (
                <section className="player-page__character-section">
                  <CharacterCoverCard character={trackDetail?.cover_character ?? null} />
                </section>
              )}

              {activeTab === 'playlist' && (
                <div className="player-page__playlist">
                  {playlist.length === 0 ? (
                    <div className="player-page__loading">재생 목록이 비어있습니다</div>
                  ) : (
                    playlist.map((song, idx) => (
                      <div
                        key={song.id + '-' + idx}
                        className={`player-page__queue-item ${idx === currentIndex ? 'player-page__queue-item--active' : ''}`}
                        onClick={() => play(song, playlist)}
                      >
                        <span className="player-page__queue-num">{idx + 1}</span>
                        <div className="player-page__queue-cover">
                          {song.cover_image ? (
                            <img src={song.cover_image.startsWith('/api/') ? song.cover_image : api.coverPreviewUrl(song.cover_image)} alt="" />
                          ) : (
                            <span>♪</span>
                          )}
                        </div>
                        <div className="player-page__queue-info">
                          <div className="player-page__queue-title">{song.title}</div>
                          <div className="player-page__queue-artist">{song.artist_name}</div>
                        </div>
                        {idx === currentIndex && isPlaying && (
                          <span className="player-page__queue-playing">재생중</span>
                        )}
                        <button
                          className="player-page__queue-remove"
                          onClick={(e) => { e.stopPropagation(); removeFromPlaylist(song.id); }}
                          title="목록에서 제거"
                        >
                          <FiX />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
