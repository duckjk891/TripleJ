import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { FiDownload } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../api';
import './TrackDownloadButton.css';

// v129 — 다운로드 버튼 → 자막 영상 4옵션 팝업
// (일반 16:9 / SNS 9:16 / 카톡 프로필 배경 15초 / 음원 mp3)
// 팝업은 TrackShareButton 의 v128fix 포털(fixed) 패턴을 복제:
// 목록 컨테이너 overflow:hidden 잘림·하단 플레이어 바(z-index 1001) 가림 회피,
// 스크롤/리사이즈 시 닫아서 위치 어긋남 방지.
const VIDEO_OPTIONS = [
  { key: 'wide', label: '🖥 일반 화질 (가로 16:9)' },
  { key: 'sns', label: '📱 SNS용 (세로 9:16)' },
  { key: 'kakao', label: '💬 카톡 프로필 배경 (15초)' },
];

// 팝업 대략 높이(위/아래 펼침 판정용) — 4옵션 + 상태 행
const POPUP_EST_HEIGHT = 240;
const POPUP_WIDTH = 220;
// 하단 고정 플레이어 바 높이(--player-height 80px) + 여유
const BOTTOM_BAR_HEIGHT = 90;

export default function TrackDownloadButton({ track, size = 16 }) {
  const [open, setOpen] = useState(false);
  // 포털 팝업의 화면 고정 좌표 { top, left } (dropUp 시 top 은 팝업 하단 기준 bottom 값)
  const [pos, setPos] = useState(null);
  // null | 'wide' | 'sns' | 'kakao' | 'mp3'
  const [downloading, setDownloading] = useState(null);
  const [message, setMessage] = useState('');
  const wrapRef = useRef(null);
  const popupRef = useRef(null);
  const messageTimerRef = useRef(null);
  const { user } = useAuth();
  const navigate = useNavigate();

  const showMessage = useCallback((msg) => {
    setMessage(msg);
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setMessage(''), 5000);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setPos(null);
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    setMessage('');
  }, []);

  useEffect(() => {
    return () => {
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    };
  }, []);

  // 외부 클릭 / ESC / 스크롤·리사이즈 닫힘 (포털이라 스크롤 시 좌표가 어긋나므로 닫음)
  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      if (popupRef.current?.contains(e.target)) return;
      close();
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') close();
    };
    const onScroll = () => close();
    document.addEventListener('mousedown', onDocPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDocPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, close]);

  const handleToggle = (e) => {
    e.stopPropagation();
    if (open) {
      close();
      return;
    }
    if (!wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    // 좌우: 버튼 우측 끝 정렬, 화면 밖으로 나가면 보정
    let left = rect.right - POPUP_WIDTH;
    if (left < 8) left = 8;
    if (left + POPUP_WIDTH > window.innerWidth - 8) {
      left = window.innerWidth - POPUP_WIDTH - 8;
    }
    // 상하: 아래 공간(플레이어 바 제외) 부족하면 위로
    const spaceBelow = window.innerHeight - BOTTOM_BAR_HEIGHT - rect.bottom;
    if (spaceBelow < POPUP_EST_HEIGHT) {
      setPos({ bottom: window.innerHeight - rect.top + 6, left });
    } else {
      setPos({ top: rect.bottom + 6, left });
    }
    setOpen(true);
  };

  // 자막 영상 3종: 생성(최초 1~2분) → blob fetch → a[download]
  const handleVideoDownload = useCallback(async (format) => {
    if (!track?.id || downloading) return;
    setDownloading(format);
    setMessage('');
    try {
      const { data } = await api.createShareVideo(track.id, format);
      if (import.meta.env.DEV) {
        console.info('[TrackDownload] video ready', { format, cached: !!data?.cached });
      }
      const res = await fetch(api.shareVideoFileUrl(track.id, format));
      if (!res.ok) {
        const err = new Error(`share video fetch failed: ${res.status}`);
        err.status = res.status;
        throw err;
      }
      const blob = await res.blob();
      if (import.meta.env.DEV) {
        console.info('[TrackDownload] blob', { format, size: blob.size });
      }
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `maidol_${format}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
      showMessage('다운로드되었습니다');
    } catch (err) {
      const status = err?.response?.status ?? err?.status;
      console.error('[TrackDownload] video download failed', status || err?.message, err);
      if (status === 404) {
        // 비공개 곡 등 — share-video 는 공개 트랙만 지원 (useTrackShare 와 동일 문구)
        showMessage('공개된 곡만 공유할 수 있습니다.');
      } else if (status === 400) {
        showMessage('커버 이미지가 없어 공유 영상을 만들 수 없습니다.');
      } else {
        showMessage('영상 생성에 실패했습니다. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      setDownloading(null);
    }
  }, [track, downloading, showMessage]);

  // 음원 mp3 — 기존 SongItem.handleDownload 흐름 이관(로그인 필요, download_url 직접 다운로드)
  const handleMp3Download = useCallback(async () => {
    if (!track?.id || downloading) return;
    if (!user) {
      navigate('/login');
      return;
    }
    setDownloading('mp3');
    setMessage('');
    try {
      const { data } = await api.downloadTrackFile(track.id);
      if (import.meta.env.DEV) {
        console.info('[TrackDownload] mp3 ready', { track: track.id, filename: data?.filename });
      }
      const a = document.createElement('a');
      a.href = data.download_url;
      a.download = data.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showMessage('다운로드되었습니다');
    } catch (err) {
      console.error('[TrackDownload] mp3 download failed', err);
      showMessage('다운로드에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setDownloading(null);
    }
  }, [track, downloading, user, navigate, showMessage]);

  if (!track?.id) return null;

  const popup = open && pos && createPortal(
    <div
      ref={popupRef}
      className="track-download__popup"
      style={{
        position: 'fixed',
        left: pos.left,
        ...(pos.top != null ? { top: pos.top } : { bottom: pos.bottom }),
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {VIDEO_OPTIONS.map((opt) => (
        <button
          key={opt.key}
          type="button"
          className="track-download__option"
          disabled={!!downloading}
          onClick={(e) => {
            e.stopPropagation();
            handleVideoDownload(opt.key);
          }}
        >
          {opt.label}
        </button>
      ))}
      <button
        type="button"
        className="track-download__option"
        disabled={!!downloading}
        onClick={(e) => {
          e.stopPropagation();
          handleMp3Download();
        }}
      >
        🎵 음원만 (mp3)
      </button>

      {downloading && (
        <div className="track-download__status">
          <span className="track-download__spinner" />
          {downloading === 'mp3' ? '다운로드 중...' : '영상 생성 중... 최초 1~2분'}
        </div>
      )}
      {!downloading && message && (
        <div className="track-download__message">{message}</div>
      )}
    </div>,
    document.body
  );

  return (
    <div
      className="track-download"
      ref={wrapRef}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="track-download__btn"
        onClick={handleToggle}
        title="다운로드"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <FiDownload size={size} />
      </button>
      {popup}
    </div>
  );
}
