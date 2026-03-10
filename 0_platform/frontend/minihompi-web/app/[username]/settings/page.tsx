'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Settings from '@/components/settings/Settings';
import { getHompiByUsername } from '@/lib/api';

export default function SettingsPage() {
  const params = useParams();
  const router = useRouter();
  const username = params.username as string;
  const [userId, setUserId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [isOwner, setIsOwner] = useState(false);

  useEffect(() => {
    const currentUserId = localStorage.getItem('userId');

    const fetchUserId = async () => {
      try {
        const res = await getHompiByUsername(username);
        const profileUserId = res.data.id?.toString() || res.data.user_id?.toString() || '';
        setUserId(profileUserId || username);
        setIsOwner(profileUserId === currentUserId);
      } catch {
        setUserId(username);
        setIsOwner(false);
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

  if (!isOwner) {
    return (
      <div className="error-state">
        <p>접근 권한이 없습니다</p>
        <button
          onClick={() => router.push(`/${username}/diary`)}
          style={{
            marginTop: '1rem',
            padding: '0.5rem 1rem',
            borderRadius: '4px',
            border: 'none',
            background: '#007bff',
            color: 'white',
            cursor: 'pointer',
          }}
        >
          다이어리로 이동
        </button>
      </div>
    );
  }

  return <Settings username={username} />;
}
