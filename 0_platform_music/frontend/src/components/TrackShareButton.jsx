import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { FiShare2 } from 'react-icons/fi';
import useTrackShare from '../hooks/useTrackShare';
import './TrackShareButton.css';

// v127 — 트랙 리스트 전역 공유 버튼 + 팝업(쇼츠/릴스/틱톡/링크)
// v128fix — 팝업을 body 포털(fixed)로 띄움: 목록 컨테이너의 overflow:hidden
// (예: 메인 .main-chart)에 잘리던 문제와 하단 플레이어 바(z-index 1001)에
// 가려지던 문제를 동시에 해결. 스크롤/리사이즈 시에는 닫아서 위치 어긋남 방지.
const SNS_OPTIONS = [
  { key: 'youtube', label: '▶ YouTube 쇼츠' },
  { key: 'reels', label: '📷 릴스' },
  { key: 'tiktok', label: '🎵 틱톡' },
];

// 팝업 대략 높이(위/아래 펼침 판정용) — 4옵션 + 상태 행
const POPUP_EST_HEIGHT = 220;
const POPUP_WIDTH = 184;
// 하단 고정 플레이어 바 높이(--player-height 80px) + 여유
const BOTTOM_BAR_HEIGHT = 90;

export default function TrackShareButton({ track, size = 16 }) {
  const [open, setOpen] = useState(false);
  // 포털 팝업의 화면 고정 좌표 { top, left } (dropUp 시 top 은 팝업 하단 기준 bottom 값)
  const [pos, setPos] = useState(null);
  const wrapRef = useRef(null);
  const popupRef = useRef(null);
  const { shareTo, copyLink, sharingSns, message, clearMessage } = useTrackShare();

  const close = useCallback(() => {
    setOpen(false);
    setPos(null);
    clearMessage();
  }, [clearMessage]);

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

  if (!track?.id) return null;

  const popup = open && pos && createPortal(
    <div
      ref={popupRef}
      className="track-share__popup"
      style={{
        position: 'fixed',
        left: pos.left,
        ...(pos.top != null ? { top: pos.top } : { bottom: pos.bottom }),
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {SNS_OPTIONS.map((opt) => (
        <button
          key={opt.key}
          type="button"
          className="track-share__option"
          disabled={!!sharingSns}
          onClick={(e) => {
            e.stopPropagation();
            shareTo(opt.key, track);
          }}
        >
          {opt.label}
        </button>
      ))}
      <button
        type="button"
        className="track-share__option"
        disabled={!!sharingSns}
        onClick={(e) => {
          e.stopPropagation();
          copyLink(track);
        }}
      >
        🔗 링크 복사
      </button>

      {sharingSns && (
        <div className="track-share__status">
          <span className="track-share__spinner" />
          공유 영상 생성 중...
        </div>
      )}
      {!sharingSns && message && (
        <div className="track-share__message">{message}</div>
      )}
    </div>,
    document.body
  );

  return (
    <div
      className="track-share"
      ref={wrapRef}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="track-share__btn"
        onClick={handleToggle}
        title="공유"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <FiShare2 size={size} />
      </button>
      {popup}
    </div>
  );
}
