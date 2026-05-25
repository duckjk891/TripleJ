import { useState, useEffect, useMemo } from 'react';
import { FiX, FiImage, FiMove } from 'react-icons/fi';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import * as api from '../api';
import './AlbumCreateModal.css';

function SortableTrackRow({ track, index }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: String(track.id) });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <li ref={setNodeRef} style={style} className="album-modal__sortable-row">
      <span className="album-modal__sortable-index">{index + 1}</span>
      <span className="album-modal__sortable-title" title={track.title}>
        {track.title}
      </span>
      <button
        type="button"
        className="album-modal__sortable-handle"
        {...attributes}
        {...listeners}
        aria-label="순서 변경"
      >
        <FiMove />
      </button>
    </li>
  );
}

export default function AlbumCreateModal({
  mode = 'create',
  album = null,
  myTracks = [],
  onClose,
  onSaved,
}) {
  const isEdit = mode === 'edit';

  // ── 메타 ──
  const [title, setTitle] = useState(album?.title || '');
  const [description, setDescription] = useState(album?.description || '');
  const [isPublic, setIsPublic] = useState(
    album?.is_public !== undefined ? !!album.is_public : true,
  );

  // ── 트랙 선택/순서 ──
  // 초기 ordered list: edit 면 album.tracks 순서, create 면 [].
  const [orderedTrackIds, setOrderedTrackIds] = useState(() => {
    if (isEdit && album?.tracks) return album.tracks.map((t) => t.id);
    return [];
  });

  // ── 커버 옵션 ──
  const [coverSource, setCoverSource] = useState(album?.cover_source || 'auto');
  const [coverFile, setCoverFile] = useState(null);
  const [coverFilePreview, setCoverFilePreview] = useState(null);
  const [aiGender, setAiGender] = useState('neutral');
  const [aiModel, setAiModel] = useState('nb_pro');
  const [aiUseCharacter, setAiUseCharacter] = useState(false);
  const [aiCoverObjectName, setAiCoverObjectName] = useState(null);
  const [aiCoverPreview, setAiCoverPreview] = useState(null);
  const [aiCoverLoading, setAiCoverLoading] = useState(false);

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // myTracks 초기 정렬 (created_at desc) — 단순 정렬
  const sortedMyTracks = useMemo(() => {
    const list = [...(myTracks || [])];
    list.sort((a, b) => {
      const da = a.created_at ? new Date(a.created_at).getTime() : 0;
      const db = b.created_at ? new Date(b.created_at).getTime() : 0;
      return db - da;
    });
    return list;
  }, [myTracks]);

  // 트랙 맵
  const trackMap = useMemo(() => {
    const m = new Map();
    (myTracks || []).forEach((t) => m.set(t.id, t));
    // edit 모드: 앨범 트랙도 fallback
    if (isEdit && album?.tracks) {
      album.tracks.forEach((t) => {
        if (!m.has(t.id)) m.set(t.id, t);
      });
    }
    return m;
  }, [myTracks, album, isEdit]);

  useEffect(() => {
    console.info(
      `[AlbumCreateModal] step=open mode=${mode} album_id=${album?.id ?? 'new'} track_count=${orderedTrackIds.length}`,
    );
    // PII (title/description 본문) 출력하지 않음
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrderedTrackIds((items) => {
      const oldIndex = items.findIndex((id) => String(id) === String(active.id));
      const newIndex = items.findIndex((id) => String(id) === String(over.id));
      if (oldIndex < 0 || newIndex < 0) return items;
      return arrayMove(items, oldIndex, newIndex);
    });
  };

  const toggleTrack = (trackId) => {
    setOrderedTrackIds((prev) => {
      if (prev.includes(trackId)) {
        return prev.filter((id) => id !== trackId);
      }
      return [...prev, trackId];
    });
  };

  const handleCoverFileChange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setCoverFile(f);
    const url = URL.createObjectURL(f);
    setCoverFilePreview(url);
  };

  const handleAiPreview = async () => {
    setAiCoverLoading(true);
    setErrorMsg('');
    try {
      const { data } = await api.generateAlbumCover({
        gender: aiGender,
        image_model: aiModel,
        use_character: aiUseCharacter,
        title: title || undefined,
      });
      const objectName = data?.cover_object_name || data?.object_name || null;
      const previewUrl = data?.cover_url || api.albumCoverPreviewUrl(objectName);
      setAiCoverObjectName(objectName);
      setAiCoverPreview(previewUrl);
      console.info(
        `[AlbumCreateModal] step=ai_preview album_id=${album?.id ?? 'new'} cover_source=ai ok=${!!objectName}`,
      );
    } catch (err) {
      console.warn('[AlbumCreateModal] ai_preview failed', {
        status: err.response?.status,
      });
      setErrorMsg('AI 커버 생성에 실패했습니다.');
    } finally {
      setAiCoverLoading(false);
    }
  };

  // ── 검증 ──
  const titleOk = title.trim().length > 0;
  const tracksOk = orderedTrackIds.length >= 1;
  const coverOk = (() => {
    if (coverSource === 'upload') return !!coverFile || (isEdit && album?.cover_image);
    if (coverSource === 'ai') return !!aiCoverObjectName || (isEdit && album?.cover_image);
    return true; // auto
  })();
  const canSubmit = titleOk && tracksOk && coverOk && !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setErrorMsg('');
    try {
      if (isEdit) {
        console.info(
          `[AlbumCreateModal] step=submit_edit album_id=${album.id} track_count=${orderedTrackIds.length} cover_source=${coverSource} desc_len=${description.length}`,
        );
        // 1) 메타/속성 patch
        await api.updateAlbum(album.id, {
          title: title.trim(),
          description,
          is_public: isPublic,
          track_ids: orderedTrackIds,
          cover_source: coverSource,
        });
        // 2) 순서 (track_ids 가 patch 에 포함됐지만 명시적으로 한 번 더)
        await api.reorderAlbumTracks(album.id, orderedTrackIds);
        // 3) 커버
        if (coverSource === 'upload' && coverFile) {
          const fd = new FormData();
          fd.append('cover_source', 'upload');
          fd.append('cover_file', coverFile);
          await api.updateAlbumCover(album.id, fd);
        } else if (coverSource === 'ai' && aiCoverObjectName) {
          const fd = new FormData();
          fd.append('cover_source', 'ai');
          fd.append('cover_object_name', aiCoverObjectName);
          await api.updateAlbumCover(album.id, fd);
        } else if (coverSource === 'auto') {
          const fd = new FormData();
          fd.append('cover_source', 'auto');
          await api.updateAlbumCover(album.id, fd);
        }
        // 최신 정보 재조회
        const { data: updated } = await api.getAlbum(album.id);
        console.info(
          `[AlbumCreateModal] step=submit_edit_done album_id=${updated.id} track_count=${updated.track_count ?? updated.tracks?.length ?? 0}`,
        );
        onSaved && onSaved(updated);
      } else {
        // create
        console.info(
          `[AlbumCreateModal] step=submit_create track_count=${orderedTrackIds.length} cover_source=${coverSource} desc_len=${description.length}`,
        );
        const fd = new FormData();
        fd.append('title', title.trim());
        fd.append('description', description || '');
        fd.append('is_public', String(isPublic));
        fd.append('cover_source', coverSource);
        fd.append('track_ids', JSON.stringify(orderedTrackIds.map(String)));
        if (coverSource === 'upload' && coverFile) {
          fd.append('cover_file', coverFile);
        } else if (coverSource === 'ai' && aiCoverObjectName) {
          fd.append('cover_object_name', aiCoverObjectName);
        }
        const { data: created } = await api.createAlbum(fd);
        console.info(
          `[AlbumCreateModal] step=submit_create_done album_id=${created.id} track_count=${created.track_count ?? created.tracks?.length ?? 0}`,
        );
        onSaved && onSaved(created);
      }
      onClose && onClose();
    } catch (err) {
      console.warn('[AlbumCreateModal] submit failed', {
        status: err.response?.status,
        album_id: album?.id ?? null,
      });
      setErrorMsg(err.response?.data?.error || '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="album-modal__overlay" onClick={onClose}>
      <div className="album-modal" onClick={(e) => e.stopPropagation()}>
        <div className="album-modal__header">
          <h2 className="album-modal__title">{isEdit ? '앨범 수정' : '앨범 생성'}</h2>
          <button className="album-modal__close" onClick={onClose} aria-label="닫기">
            <FiX />
          </button>
        </div>

        <div className="album-modal__body">
          {/* 메타 */}
          <section className="album-modal__section">
            <label className="album-modal__label">제목 *</label>
            <input
              type="text"
              className="album-modal__input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="앨범 제목"
              maxLength={200}
            />

            <label className="album-modal__label">설명</label>
            <textarea
              className="album-modal__textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="앨범 설명 (선택)"
            />

            <label className="album-modal__checkbox">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
              />
              <span>공개 앨범으로 게시</span>
            </label>
          </section>

          {/* 트랙 선택 */}
          <section className="album-modal__section">
            <h3 className="album-modal__subtitle">
              트랙 선택{' '}
              <span className="album-modal__counter">
                ({orderedTrackIds.length}곡 선택됨)
              </span>
            </h3>
            {sortedMyTracks.length === 0 ? (
              <div className="album-modal__empty">선택 가능한 트랙이 없습니다.</div>
            ) : (
              <div className="album-modal__track-picker">
                {sortedMyTracks.map((t) => {
                  const checked = orderedTrackIds.includes(t.id);
                  return (
                    <label
                      key={t.id}
                      className={`album-modal__track-item ${checked ? 'album-modal__track-item--active' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleTrack(t.id)}
                      />
                      <span className="album-modal__track-title" title={t.title}>
                        {t.title}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </section>

          {/* 트랙 순서 */}
          {orderedTrackIds.length > 0 && (
            <section className="album-modal__section">
              <h3 className="album-modal__subtitle">
                트랙 순서 <span className="album-modal__hint">(드래그로 재정렬)</span>
              </h3>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={orderedTrackIds.map(String)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className="album-modal__sortable">
                    {orderedTrackIds.map((tid, idx) => {
                      const t = trackMap.get(tid);
                      if (!t) return null;
                      return <SortableTrackRow key={tid} track={t} index={idx} />;
                    })}
                  </ul>
                </SortableContext>
              </DndContext>
            </section>
          )}

          {/* 커버 옵션 */}
          <section className="album-modal__section">
            <h3 className="album-modal__subtitle">앨범 커버</h3>
            <div className="album-modal__radio-group">
              <label className="album-modal__radio">
                <input
                  type="radio"
                  name="cover_source"
                  value="auto"
                  checked={coverSource === 'auto'}
                  onChange={() => setCoverSource('auto')}
                />
                <span>자동 (첫 곡 커버)</span>
              </label>
              <label className="album-modal__radio">
                <input
                  type="radio"
                  name="cover_source"
                  value="upload"
                  checked={coverSource === 'upload'}
                  onChange={() => setCoverSource('upload')}
                />
                <span>직접 업로드</span>
              </label>
              <label className="album-modal__radio">
                <input
                  type="radio"
                  name="cover_source"
                  value="ai"
                  checked={coverSource === 'ai'}
                  onChange={() => setCoverSource('ai')}
                />
                <span>AI 생성</span>
              </label>
            </div>

            {coverSource === 'auto' && (
              <div className="album-modal__cover-auto">
                <FiImage /> 첫 곡 커버가 자동 적용됩니다.
              </div>
            )}

            {coverSource === 'upload' && (
              <div className="album-modal__cover-upload">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleCoverFileChange}
                />
                {coverFilePreview ? (
                  <img
                    className="album-modal__cover-preview"
                    src={coverFilePreview}
                    alt="cover preview"
                  />
                ) : isEdit && album?.cover_image ? (
                  <img
                    className="album-modal__cover-preview"
                    src={album.cover_image}
                    alt="current cover"
                  />
                ) : null}
              </div>
            )}

            {coverSource === 'ai' && (
              <div className="album-modal__cover-ai">
                <div className="album-modal__field-row">
                  <span className="album-modal__field-label">성별</span>
                  {['female', 'male', 'neutral'].map((g) => (
                    <label key={g} className="album-modal__radio">
                      <input
                        type="radio"
                        name="ai_gender"
                        value={g}
                        checked={aiGender === g}
                        onChange={() => setAiGender(g)}
                      />
                      <span>{g === 'female' ? '여성' : g === 'male' ? '남성' : '중성'}</span>
                    </label>
                  ))}
                </div>
                <div className="album-modal__field-row">
                  <span className="album-modal__field-label">이미지 모델</span>
                  {['nb_pro', 'gpt_image_2'].map((m) => (
                    <label key={m} className="album-modal__radio">
                      <input
                        type="radio"
                        name="ai_model"
                        value={m}
                        checked={aiModel === m}
                        onChange={() => setAiModel(m)}
                      />
                      <span>{m}</span>
                    </label>
                  ))}
                </div>
                <label className="album-modal__checkbox">
                  <input
                    type="checkbox"
                    checked={aiUseCharacter}
                    onChange={(e) => setAiUseCharacter(e.target.checked)}
                  />
                  <span>내 캐릭터 포함</span>
                </label>
                <button
                  type="button"
                  className="album-modal__btn album-modal__btn--secondary"
                  onClick={handleAiPreview}
                  disabled={aiCoverLoading}
                >
                  {aiCoverLoading ? '생성 중...' : '미리보기'}
                </button>
                {aiCoverPreview && (
                  <img
                    className="album-modal__cover-preview"
                    src={aiCoverPreview}
                    alt="ai cover preview"
                  />
                )}
              </div>
            )}
          </section>

          {errorMsg && <div className="album-modal__error">{errorMsg}</div>}
        </div>

        <div className="album-modal__footer">
          <button
            type="button"
            className="album-modal__btn album-modal__btn--ghost"
            onClick={onClose}
            disabled={saving}
          >
            취소
          </button>
          <button
            type="button"
            className="album-modal__btn album-modal__btn--primary"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {saving ? '저장 중...' : isEdit ? '저장' : '생성'}
          </button>
        </div>
      </div>
    </div>
  );
}
