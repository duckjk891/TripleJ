import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FiMusic, FiList, FiX, FiFilm } from 'react-icons/fi';
import { usePlayer } from '../contexts/PlayerContext';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../api';
import CharacterCoverCard from '../components/CharacterCoverCard';
import LyricSyncVideo from '../components/LyricSyncVideo';
import Avatar from '../components/Avatar';
import TrackShareButton from '../components/TrackShareButton';
import ReportModal from '../components/ReportModal';
import useTrackShare from '../hooks/useTrackShare';
import { detectPlatform, shortenSnsUrl } from '../utils/snsPlatform';
import './PlayerPage.css';

export default function PlayerPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
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
  // v149 — 가사 타임라인 (커버+가사 싱크). null=미로드, {has_timestamps, segments}
  const [lyricsTimeline, setLyricsTimeline] = useState(null);
  const localVideoRef = useRef(null);
  // v126 — SNS 공유 (v127: useTrackShare 훅으로 로직 이관)
  const [searchParams] = useSearchParams();
  const { shareTo, copyLink, sharingSns, message: shareNotice } = useTrackShare();
  const trackParamHandledRef = useRef(false);
  // v137 — 곡 신고 모달
  const [reportOpen, setReportOpen] = useState(false);

  // v126 — `?track={id}` 공유 링크 수신자 지원: 마운트 시 파라미터 트랙 로드·재생
  useEffect(() => {
    const trackId = searchParams.get('track');
    if (!trackId || trackParamHandledRef.current) return;
    trackParamHandledRef.current = true;
    if (currentSong?.id === trackId) return;
    (async () => {
      try {
        const { data: track } = await api.getTrackDetail(trackId);
        // TrackCard 매핑과 동일한 song 형태로 play() 호출 (단곡 큐잉)
        play({
          id: track.id,
          title: track.title,
          artist_name: track.uploader_nickname || track.artist_name || 'AI',
          cover_image: track.cover_image_url || track.cover_image || null,
          album_id: track.id,
        });
        if (import.meta.env.DEV) {
          console.info('[PlayerPage] loaded shared ?track param', { track: track.id });
        }
      } catch (err) {
        // 공유 링크 트랙 로드 실패는 조용히 무시 (비공개/삭제 등)
        console.warn('[PlayerPage] ?track load failed', err?.response?.status || err?.message);
      }
    })();
  }, [searchParams, currentSong?.id, play]);

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
        // (비로그인 시 skip — /generate/{id} 는 인증 필수라 anon 401 발생)
        if (track.generation_id && user) {
          try {
            const { data: gen } = await api.getGeneration(track.generation_id);
            setGenDetail(gen);
          } catch {
            setGenDetail(null);
          }
        } else {
          if (import.meta.env.DEV && track.generation_id && !user) {
            console.info('[PlayerPage] anon user, skip getGeneration');
          }
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
  }, [currentSong?.id, user]);

  // 업로더 SNS 링크 렌더 로깅 — 개수만 (URL 값 콘솔 출력 금지)
  useEffect(() => {
    const count = trackDetail?.uploader_sns_links?.length ?? 0;
    if (import.meta.env.DEV && count > 0) {
      console.info('[PlayerPage] uploader sns links', { track: trackDetail?.id ?? null, count });
    }
  }, [trackDetail]);

  // 곡이 바뀌면 미디어 탭을 "노래"로 초기화 (+ v149 가사 타임라인 재로드 대비 리셋)
  useEffect(() => {
    setMediaTab('song');
    setVideoMode(false);
    setLyricsTimeline(null);
  }, [currentSong?.id, setVideoMode]);

  // 노래 탭으로 복귀
  // - 실제 MV 재생 중이던 경우(videoMode)만 <video>→오디오 핸드오프
  // - 가사 싱크/none 모드에선 오디오를 애초에 건드리지 않았으므로 뷰만 전환
  //   (v149 음악 무중단: setVideoMode/오디오 조작 없음)
  const handleSongTabClick = useCallback(() => {
    if (mediaTab === 'song') return;

    if (videoMode && localVideoRef.current) {
      // 동영상(실 MV) -> 노래: 재생 위치를 오디오로 넘기고 오디오 재생
      const video = localVideoRef.current;
      const time = video.currentTime;
      video.pause();
      setMediaTab('song');
      setVideoMode(false);
      audioRef.current.currentTime = time;
      audioRef.current.play().catch((err) => {
        console.error('[PlayerPage] audio play failed', { err });
      });
    } else {
      // 가사 싱크/none: 오디오는 무중단 재생 중 — 뷰만 전환
      setMediaTab('song');
    }
  }, [mediaTab, videoMode, audioRef, setVideoMode]);

  // 동영상 탭 클릭: MV/가사 타임라인을 lazy load 한 뒤 모드를 결정
  // (v149) 모드 = 실 MV | 가사 싱크 | none. 실 MV 만 오디오 pause + videoMode(true).
  const handleVideoTabClick = useCallback(async () => {
    if (mediaTab === 'video') return;
    if (!currentSong) return;

    // 미로드 항목만 병렬 fetch (mvData 는 트랙 상세에서 이미 채워져 있을 수 있음)
    let mv = mvData;
    let timeline = lyricsTimeline;
    if (mv == null || timeline == null) {
      setMvLoading(true);
      try {
        const [mvRes, tlRes] = await Promise.all([
          mv == null ? api.getTrackMusicVideo(currentSong.id) : Promise.resolve({ data: mv }),
          timeline == null ? api.getTrackLyricsTimeline(currentSong.id) : Promise.resolve({ data: timeline }),
        ]);
        mv = mvRes.data;
        timeline = tlRes.data;
        setMvData(mv);
        setLyricsTimeline(timeline);
      } catch (err) {
        console.error('[PlayerPage] lyrics-timeline failed', { err, trackId: currentSong.id });
        if (mv == null) { mv = { has_music_video: false, music_video_url: null }; setMvData(mv); }
        if (timeline == null) { timeline = { has_timestamps: false, segments: [] }; setLyricsTimeline(timeline); }
      } finally {
        setMvLoading(false);
      }
    }

    const hasRealMv = mv?.has_music_video && mv?.music_video_url;
    const mode = hasRealMv ? 'mv' : (timeline?.has_timestamps ? 'lyric-sync' : 'none');
    if (import.meta.env.DEV) console.info('[PlayerPage] video tab mode', { mode });

    if (hasRealMv) {
      // 실 MV: 오디오 pause 후 <video> 로 재생 핸드오프
      const time = audioRef.current.currentTime;
      audioRef.current.pause();
      setMediaTab('video');
      setVideoMode(true);
      requestAnimationFrame(() => {
        const video = localVideoRef.current;
        if (video) {
          const doSync = () => {
            video.currentTime = time;
            video.play().catch((err) => {
              console.error('[PlayerPage] video play failed', { err });
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
      // 가사 싱크/none: 순수 시각 오버레이 — 오디오/videoMode 를 절대 건드리지 않음
      setMediaTab('video');
    }
  }, [mediaTab, currentSong, mvData, lyricsTimeline, audioRef, setVideoMode]);

  // v126 — SNS 공유 / 링크 복사 (v127: useTrackShare 훅 재사용 — 동작 불변)
  const handleSnsShare = useCallback((sns) => {
    if (!currentSong) return;
    shareTo(sns, { id: currentSong.id, title: currentSong.title });
  }, [currentSong, shareTo]);

  const handleCopyLink = useCallback(() => {
    if (!currentSong) return;
    copyLink({ id: currentSong.id, title: currentSong.title });
  }, [currentSong, copyLink]);

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
                onClick={handleSongTabClick}
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
                // 노래 탭: 기존 커버이미지 (+ v137 — AI 생성 뱃지: 플랫폼 특성 고지, 전 곡 공통)
                <>
                  {coverSrc ? (
                    <img src={coverSrc} alt="" className="player-page__cover-img" />
                  ) : (
                    <div className="player-page__cover-placeholder">♪</div>
                  )}
                  <span className="player-page__ai-badge">AI 생성</span>
                </>
              ) : (
                // 동영상 탭
                mvLoading ? (
                  <div className="player-page__mv-loading">뮤직비디오 정보를 불러오는 중...</div>
                ) : mvData?.has_music_video && mvData?.music_video_url ? (
                  // v151 — 동영상(MV) 화면에도 노래 탭과 동일한 AI 생성 뱃지 노출
                  <>
                    <video
                      ref={localVideoRef}
                      className="player-page__video"
                      src={mvData.music_video_url}
                      playsInline
                    />
                    <span className="player-page__ai-badge">AI 생성</span>
                  </>
                ) : lyricsTimeline?.has_timestamps ? (
                  // v149 — 실 MV 없음 + 가사 타임스탬프 존재: 커버+가사 싱크 오버레이
                  // v151 — 가사싱크 화면에도 AI 생성 뱃지 노출
                  <>
                    <LyricSyncVideo coverSrc={coverSrc} segments={lyricsTimeline.segments} />
                    <span className="player-page__ai-badge">AI 생성</span>
                  </>
                ) : (
                  <div className="player-page__mv-empty">
                    <FiFilm size={48} />
                    <p>MV나 가사 싱크가 준비되면 영상이 제공됩니다</p>
                  </div>
                )
              )}
            </div>

            <h1 className="player-page__title">{currentSong.title}</h1>
            <p className="player-page__artist">
              <Avatar
                src={trackDetail?.uploader_profile_image}
                name={currentSong.artist_name}
                size={20}
              />
              {currentSong.artist_name}
            </p>
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
                  {/* v126 — SNS 공유 버튼 행 (프롬프트 탭 최상단) */}
                  <div className="player-page__share-section">
                    <h3 className="player-page__share-title">SNS 공유</h3>
                    <div className="player-page__share-row">
                      <button
                        className="player-page__share-btn"
                        disabled={!!sharingSns}
                        onClick={() => handleSnsShare('youtube')}
                      >
                        ▶ YouTube 쇼츠
                      </button>
                      <button
                        className="player-page__share-btn"
                        disabled={!!sharingSns}
                        onClick={() => handleSnsShare('reels')}
                      >
                        📷 릴스
                      </button>
                      <button
                        className="player-page__share-btn"
                        disabled={!!sharingSns}
                        onClick={() => handleSnsShare('tiktok')}
                      >
                        🎵 틱톡
                      </button>
                      <button
                        className="player-page__share-btn"
                        disabled={!!sharingSns}
                        onClick={handleCopyLink}
                      >
                        🔗 링크
                      </button>
                      {/* v137 — 곡 신고 (본인 곡에는 미표시) */}
                      {!(user && trackDetail && trackDetail.uploader_id === user.id) && (
                        <button
                          className="player-page__share-btn player-page__report-btn"
                          onClick={() => setReportOpen(true)}
                        >
                          🚩 신고
                        </button>
                      )}
                    </div>
                    {sharingSns && (
                      <div className="player-page__share-loading">
                        <span className="player-page__share-spinner" />
                        공유 영상 생성 중...
                      </div>
                    )}
                    {!sharingSns && shareNotice && (
                      <div className="player-page__share-notice">{shareNotice}</div>
                    )}
                  </div>

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
                  <CharacterCoverCard
                    character={trackDetail?.cover_character ?? null}
                    trackId={trackDetail?.id ?? null}
                    source={trackDetail?.source_meta ?? null}
                  />
                </section>
              )}

              {/* 업로더 SNS 채널 — uploader_sns_links 가 1개 이상일 때만 (구응답엔 필드 없음 → 미표시) */}
              {activeTab === 'prompt' && (trackDetail?.uploader_sns_links?.length ?? 0) > 0 && (
                <section className="player-page__sns-section">
                  <h3 className="player-page__sns-title">스타의 SNS 채널</h3>
                  <div className="player-page__sns-list">
                    {trackDetail.uploader_sns_links.map((url, idx) => {
                      const platform = detectPlatform(url);
                      return (
                        <a
                          key={idx}
                          className="player-page__sns-link"
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <span className="player-page__sns-icon">{platform.icon}</span>
                          <span className="player-page__sns-label">{platform.label}</span>
                          <span className="player-page__sns-url">{shortenSnsUrl(url)}</span>
                        </a>
                      );
                    })}
                  </div>
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
                        onClick={() => play(song)}
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
                        <TrackShareButton track={{ id: song.id, title: song.title }} size={14} />
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

      {/* v137 — 곡 신고 모달 */}
      {reportOpen && (
        <ReportModal
          targetType="track"
          targetId={currentSong.id}
          onClose={() => setReportOpen(false)}
        />
      )}
    </div>
  );
}
