'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import PhotoGallery from '@/components/photo/PhotoGallery';
import { getHompiByUsername } from '@/lib/api';

export default function PhotoPage() {
  const params = useParams();
  const username = params.username as string;
  const [userId, setUserId] = useState<string>('');
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

  return <PhotoGallery userId={userId} />;
}
