import { useState } from 'react';
import {
  FiArrowUp, FiArrowDown, FiX, FiType, FiMusic, FiPlusCircle,
} from 'react-icons/fi';
import * as api from '../../api';
import { getAlbumGradient } from '../../utils';
import TrackPickerModal from './TrackPickerModal';
import './FeedComposer.css';

let blockSeq = 0;
const makeKey = () => `blk_${Date.now()}_${blockSeq++}`;

function coverSrc(cover) {
  if (!cover) return null;
  return cover.startsWith('/api/') || cover.startsWith('http')
    ? cover
    : api.coverPreviewUrl(cover);
}

// 기존 피드(하이드레이션 블록) → 편집용 블록 상태로 변환
function toEditableBlocks(feed) {
  if (!feed?.blocks?.length) return [{ key: makeKey(), type: 'text', text: '' }];
  return feed.blocks.map((b) => (
    b.type === 'text'
      ? { key: makeKey(), type: 'text', text: b.text || '' }
      : { key: makeKey(), type: 'track', track: b.track || null }
  ));
}

/**
 * v131 — 피드 작성/수정 겸용 에디터.
 * 제목(선택) + 블록 리스트(텍스트 textarea / 곡 카드) 편집 — 블록 ↑↓/삭제,
 * [+텍스트][+곡 삽입][BGM 설정/해제]. 저장 시 빈 텍스트 블록 제거, 전부 비면 안내.
 * initialFeed 있으면 수정 모드(PUT), 없으면 생성(POST). onSaved(하이드레이션 피드).
 * v133 — kind prop: 'feed'(기본) | 'community'(공지 — 텍스트 블록만, 제목·곡·BGM 없음).
 */
export default function FeedComposer({ initialFeed = null, kind = 'feed', onSaved, onCancel }) {
  const isEdit = !!initialFeed;
  // 수정 시 저장된 kind 우선 (서버도 kind 변경 불가 — 기존 유지)
  const feedKind = initialFeed?.kind || kind;
  const isCommunity = feedKind === 'community';
  const [title, setTitle] = useState(initialFeed?.title || '');
  const [blocks, setBlocks] = useState(() => toEditableBlocks(initialFeed));
  const [bgmTrack, setBgmTrack] = useState(
    initialFeed?.bgm_track && !initialFeed.bgm_track.deleted ? initialFeed.bgm_track : null
  );
  const [pickerMode, setPickerMode] = useState(null); // null | 'block' | 'bgm'
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const updateBlock = (key, patch) => {
    setBlocks((prev) => prev.map((b) => (b.key === key ? { ...b, ...patch } : b)));
  };

  const removeBlock = (key) => {
    setBlocks((prev) => prev.filter((b) => b.key !== key));
  };

  const moveBlock = (key, dir) => {
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.key === key);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[to]] = [next[to], next[idx]];
      return next;
    });
  };

  const addTextBlock = () => {
    setBlocks((prev) => [...prev, { key: makeKey(), type: 'text', text: '' }]);
  };

  const handlePickTrack = (track) => {
    if (pickerMode === 'bgm') {
      setBgmTrack(track);
      if (import.meta.env.DEV) console.info('[FeedComposer] bgm set', { track_id: track.id });
    } else {
      setBlocks((prev) => [...prev, { key: makeKey(), type: 'track', track }]);
      if (import.meta.env.DEV) console.info('[FeedComposer] track block added', { track_id: track.id });
    }
    setPickerMode(null);
  };

  const handleSave = async () => {
    if (saving) return;
    setError('');
    // 빈 텍스트 블록 제거 + 삭제/무효 트랙 블록 제외
    const payloadBlocks = blocks
      .map((b) => {
        if (b.type === 'text') {
          return b.text.trim() ? { type: 'text', text: b.text } : null;
        }
        if (b.track?.id && !b.track.deleted) {
          return { type: 'track', track_id: b.track.id };
        }
        return null;
      })
      .filter(Boolean);

    if (payloadBlocks.length === 0) {
      setError(isCommunity ? '내용을 입력해주세요.' : '내용을 입력하거나 곡을 추가해주세요.');
      return;
    }

    // v133 — community 는 텍스트 블록만·제목/BGM 불가 (서버 400 방지)
    const payload = isCommunity
      ? {
          kind: 'community',
          title: null,
          blocks: payloadBlocks.filter((b) => b.type === 'text'),
          bgm_track_id: null,
        }
      : {
          kind: 'feed',
          title: title.trim() || null,
          blocks: payloadBlocks,
          bgm_track_id: bgmTrack?.id || null,
        };

    setSaving(true);
    if (import.meta.env.DEV) {
      console.info('[FeedComposer] save start', {
        mode: isEdit ? 'edit' : 'create',
        kind: feedKind,
        blocks: payload.blocks.length,
        has_bgm: !!payload.bgm_track_id,
      });
    }
    try {
      const { data } = isEdit
        ? await api.updateFeed(initialFeed.id, payload)
        : await api.createFeed(payload);
      const savedFeed = data?.feed ?? data;
      if (import.meta.env.DEV) {
        console.info('[FeedComposer] save done', { feed_id: savedFeed?.id, mode: isEdit ? 'edit' : 'create' });
      }
      onSaved?.(savedFeed);
    } catch (err) {
      console.error('[FeedComposer] save failed', { err, mode: isEdit ? 'edit' : 'create' });
      const detail = err?.response?.data?.detail || err?.response?.data?.error;
      setError(typeof detail === 'string' ? detail : '저장에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="feed-composer">
      <h3 className="feed-composer__heading">
        {isCommunity
          ? (isEdit ? '공지 수정' : '새 공지 작성')
          : (isEdit ? '피드 수정' : '새 피드 작성')}
      </h3>

      {!isCommunity && (
        <input
          type="text"
          className="feed-composer__title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="제목 (선택)"
          maxLength={100}
        />
      )}

      <div className="feed-composer__blocks">
        {blocks.map((block, idx) => (
          <div key={block.key} className="feed-composer__block">
            {block.type === 'text' ? (
              <textarea
                className="feed-composer__textarea"
                value={block.text}
                onChange={(e) => updateBlock(block.key, { text: e.target.value })}
                placeholder="시·일기·이야기를 적어보세요"
                rows={3}
              />
            ) : block.track && !block.track.deleted ? (
              <div className="feed-composer__track">
                <div
                  className="feed-composer__track-art"
                  style={!coverSrc(block.track.cover_image) ? { background: getAlbumGradient(block.track.id) } : {}}
                >
                  {coverSrc(block.track.cover_image)
                    ? <img src={coverSrc(block.track.cover_image)} alt="" />
                    : <span>♪</span>}
                </div>
                <div className="feed-composer__track-info">
                  <div className="feed-composer__track-title">
                    {block.track.title}
                    {block.track.is_public === false && (
                      <span className="feed-composer__badge">비공개</span>
                    )}
                  </div>
                  <div className="feed-composer__track-artist">{block.track.artist_name || 'AI'}</div>
                </div>
              </div>
            ) : (
              <div className="feed-composer__track feed-composer__track--deleted">
                삭제된 곡 (저장 시 제외됩니다)
              </div>
            )}

            <div className="feed-composer__block-controls">
              <button
                type="button"
                onClick={() => moveBlock(block.key, -1)}
                disabled={idx === 0}
                title="위로"
              >
                <FiArrowUp />
              </button>
              <button
                type="button"
                onClick={() => moveBlock(block.key, 1)}
                disabled={idx === blocks.length - 1}
                title="아래로"
              >
                <FiArrowDown />
              </button>
              <button type="button" onClick={() => removeBlock(block.key)} title="블록 삭제">
                <FiX />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="feed-composer__add-bar">
        <button type="button" className="feed-composer__add-btn" onClick={addTextBlock}>
          <FiType /> 텍스트
        </button>
        {!isCommunity && (
          <>
            <button type="button" className="feed-composer__add-btn" onClick={() => setPickerMode('block')}>
              <FiPlusCircle /> 곡 삽입
            </button>
            {bgmTrack ? (
              <span className="feed-composer__bgm-chip">
                <FiMusic /> BGM: {bgmTrack.title}
                <button type="button" onClick={() => setBgmTrack(null)} title="BGM 해제">
                  <FiX />
                </button>
              </span>
            ) : (
              <button type="button" className="feed-composer__add-btn" onClick={() => setPickerMode('bgm')}>
                <FiMusic /> BGM 설정
              </button>
            )}
          </>
        )}
      </div>

      {error && <div className="feed-composer__error">{error}</div>}

      <div className="feed-composer__footer">
        <button type="button" className="feed-composer__cancel" onClick={onCancel} disabled={saving}>
          취소
        </button>
        <button type="button" className="feed-composer__save" onClick={handleSave} disabled={saving}>
          {saving ? '저장 중...' : isEdit ? '수정 완료' : '게시'}
        </button>
      </div>

      {pickerMode && (
        <TrackPickerModal
          title={pickerMode === 'bgm' ? 'BGM 곡 선택' : '삽입할 곡 선택'}
          onSelect={handlePickTrack}
          onClose={() => setPickerMode(null)}
        />
      )}
    </div>
  );
}
