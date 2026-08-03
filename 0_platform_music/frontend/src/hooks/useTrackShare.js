import { useState, useRef, useCallback, useEffect } from 'react';
import * as api from '../api';

// v127 — SNS 공유 폴백용 업로드 페이지 (Web Share 미지원 환경) — PlayerPage(v126)에서 추출
const SNS_UPLOAD_URLS = {
  youtube: 'https://www.youtube.com/upload',
  reels: 'https://www.instagram.com/',
  tiktok: 'https://www.tiktok.com/upload',
};

/**
 * v127 — 트랙 SNS 공유 공용 훅 (PlayerPage v126 로직 추출)
 * track 최소 형태: { id, title }
 * 반환: { shareTo(sns, track), copyLink(track), sharingSns, message, clearMessage }
 */
export default function useTrackShare() {
  const [sharingSns, setSharingSns] = useState(null); // null | 'youtube' | 'reels' | 'tiktok'
  const [message, setMessage] = useState('');
  const messageTimerRef = useRef(null);

  const showMessage = useCallback((msg) => {
    setMessage(msg);
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setMessage(''), 5000);
  }, []);

  const clearMessage = useCallback(() => {
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    setMessage('');
  }, []);

  useEffect(() => {
    return () => {
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    };
  }, []);

  // 공유영상 생성 → Web Share(파일) or 다운로드+업로드 페이지 폴백
  const shareTo = useCallback(async (sns, track) => {
    if (!track?.id || sharingSns) return;
    setSharingSns(sns);
    setMessage('');
    try {
      const { data } = await api.createShareVideo(track.id);
      if (import.meta.env.DEV) {
        console.info('[TrackShare] video ready', { sns, cached: !!data?.cached });
      }
      const res = await fetch(api.shareVideoFileUrl(track.id));
      if (!res.ok) throw new Error(`share video fetch failed: ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], 'maidol_share.mp4', { type: 'video/mp4' });
      if (import.meta.env.DEV) {
        console.info('[TrackShare] blob', { sns, size: blob.size });
      }

      if (navigator.canShare?.({ files: [file] })) {
        // 모바일 등 Web Share Level 2 지원 → 공유 시트
        try {
          await navigator.share({
            files: [file],
            title: track.title,
            text: `${track.title} — MAIDOL에서 만든 곡을 들어보세요!`,
          });
          if (import.meta.env.DEV) {
            console.info('[TrackShare] share sheet completed', { sns });
          }
        } catch (err) {
          // 사용자가 공유 시트를 취소한 경우는 조용히 무시
          if (err?.name !== 'AbortError') throw err;
        }
      } else {
        // 미지원(데스크톱 등) → 다운로드 + SNS 업로드 페이지 새창
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = 'maidol_share.mp4';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
        window.open(SNS_UPLOAD_URLS[sns], '_blank', 'noopener');
        showMessage('영상이 다운로드되었습니다. 열린 페이지에서 업로드해주세요.');
        if (import.meta.env.DEV) {
          console.info('[TrackShare] fallback: download + upload page', { sns });
        }
      }
    } catch (err) {
      const status = err?.response?.status;
      console.warn('[TrackShare] share failed', status || err?.message);
      if (status === 404) {
        // 비공개 곡 등 — share-video 는 공개 트랙만 지원
        showMessage('공개된 곡만 공유할 수 있습니다.');
      } else if (status === 400) {
        showMessage('커버 이미지가 없어 공유 영상을 만들 수 없습니다.');
      } else {
        showMessage('공유 영상 생성에 실패했습니다. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      setSharingSns(null);
    }
  }, [sharingSns, showMessage]);

  // 곡 링크 복사
  const copyLink = useCallback(async (track) => {
    if (!track?.id) return;
    const link = `${window.location.origin}/player?track=${track.id}`;
    let copied = false;
    try {
      await navigator.clipboard.writeText(link);
      copied = true;
    } catch {
      // clipboard API 실패(권한/비보안 컨텍스트) → execCommand 폴백
      try {
        const ta = document.createElement('textarea');
        ta.value = link;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        copied = document.execCommand('copy');
        ta.remove();
      } catch {
        copied = false;
      }
    }
    if (import.meta.env.DEV) {
      console.info('[TrackShare] copy link', { copied });
    }
    showMessage(copied ? '링크가 복사되었습니다' : '링크 복사에 실패했습니다.');
  }, [showMessage]);

  return { shareTo, copyLink, sharingSns, message, clearMessage };
}
