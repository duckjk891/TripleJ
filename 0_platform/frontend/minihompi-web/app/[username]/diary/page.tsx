'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import DiaryList from '@/components/diary/DiaryList';
import DiaryWrite from '@/components/diary/DiaryWrite';
import { getHompiByUsername } from '@/lib/api';

export default function DiaryPage() {
  const params = useParams();
  const username = params.username as string;
  const [userId, setUserId] = useState<string>('');
  const [showDiaryWrite, setShowDiaryWrite] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUserId = async () => {
      try {
        const res = await getHompiByUsername(username);
        setUserId(res.data.id?.toString() || res.data.user_id?.toString() || username);
      } catch {
        setUserId(username);
      } finally {
        setLoading(false);
      }
    };

    if (username) {
      fetchUserId();
    }
  }, [username]);

  if (loading) {
    return <div className="loading-state">로딩 중...</div>;
  }

  if (showDiaryWrite) {
    return (
      <DiaryWrite
        userId={userId}
        onCancel={() => setShowDiaryWrite(false)}
        onSaved={() => setShowDiaryWrite(false)}
      />
    );
  }

  return (
    <DiaryList
      userId={userId}
      onWrite={() => setShowDiaryWrite(true)}
    />
  );
}
