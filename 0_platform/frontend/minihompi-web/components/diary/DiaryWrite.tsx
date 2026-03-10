'use client';

import { useState } from 'react';
import { createDiary } from '@/lib/api';
import './DiaryWrite.css';

interface DiaryWriteProps {
  userId: string;
  onCancel: () => void;
  onSaved: () => void;
}

function DiaryWrite({ userId, onCancel, onSaved }: DiaryWriteProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    try {
      await createDiary(userId, title, content);
      onSaved();
    } catch {
      alert('저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="diary-write">
      <div className="diary-write-header">
        <h3>다이어리 쓰기</h3>
      </div>
      <form onSubmit={handleSubmit} className="diary-write-form">
        <input
          type="text"
          placeholder="제목을 입력하세요"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="diary-write-title"
          required
        />
        <textarea
          placeholder="오늘의 이야기를 적어보세요..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="diary-write-content"
          rows={10}
          required
        />
        <div className="diary-write-actions">
          <button type="button" className="diary-cancel-btn" onClick={onCancel}>
            취소
          </button>
          <button type="submit" className="diary-save-btn" disabled={saving}>
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default DiaryWrite;
