'use client';

import { useEffect, useState } from 'react';
import { getDiaries } from '@/lib/api';
import './DiaryList.css';

interface DiaryEntry {
  id: number;
  title: string;
  content: string;
  created_at: string;
}

interface DiaryListProps {
  userId: string;
  onWrite: () => void;
}

function DiaryList({ userId, onWrite }: DiaryListProps) {
  const [diaries, setDiaries] = useState<DiaryEntry[]>([]);

  useEffect(() => {
    const fetchDiaries = async () => {
      try {
        const res = await getDiaries(userId);
        setDiaries(res.data.diaries || res.data || []);
      } catch {
        // API not ready yet
      }
    };
    fetchDiaries();
  }, [userId]);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  return (
    <div className="diary-list">
      <div className="diary-header">
        <h3>Diary</h3>
        <button className="diary-write-btn" onClick={onWrite}>
          글쓰기
        </button>
      </div>

      {diaries.length === 0 ? (
        <div className="diary-empty">
          <p>아직 작성된 다이어리가 없습니다.</p>
          <p className="diary-empty-sub">첫 번째 이야기를 남겨보세요 ♥</p>
        </div>
      ) : (
        <div className="diary-entries">
          {diaries.map((entry) => (
            <div key={entry.id} className="diary-entry">
              <div className="diary-entry-date">{formatDate(entry.created_at)}</div>
              <div className="diary-entry-title">{entry.title}</div>
              <div className="diary-entry-content">{entry.content}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default DiaryList;
