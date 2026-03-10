'use client';

import { useEffect, useState } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getHompiByUsername, visitHompiByUsername } from '@/lib/api';
import BgmPlayer from '@/components/common/BgmPlayer';
import '@/styles/UserProfile.css';

interface UserData {
  userId: string;
  username: string;
  nickname: string;
  statusMessage: string;
  profileImage: string;
  title: string;
  todayCount: number;
  totalCount: number;
  followerCount: number;
  followingCount: number;
}

const tabs = [
  { key: 'diary', label: '다이어리' },
  { key: 'photo', label: '사진첩' },
  { key: 'guestbook', label: '방명록' },
  { key: 'office', label: '사무실' },
];

export default function ProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const username = params.username as string;

  const [userData, setUserData] = useState<UserData>({
    userId: '',
    username: username || '',
    nickname: '',
    statusMessage: '',
    profileImage: '',
    title: '',
    todayCount: 0,
    totalCount: 0,
    followerCount: 0,
    followingCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string>('');

  const isOwner = userData.userId === currentUserId;

  const getActiveTab = (): string => {
    if (pathname.includes('/diary')) return 'diary';
    if (pathname.includes('/photo')) return 'photo';
    if (pathname.includes('/guestbook')) return 'guestbook';
    if (pathname.includes('/office')) return 'office';
    if (pathname.includes('/settings')) return 'settings';
    return 'diary';
  };

  const activeTab = getActiveTab();

  useEffect(() => {
    const userId = localStorage.getItem('userId');
    setCurrentUserId(userId || '');
  }, []);

  useEffect(() => {
    if (!username) return;

    const fetchUserData = async () => {
      setLoading(true);
      try {
        const res = await getHompiByUsername(username);
        setUserData({
          userId: res.data.id?.toString() || res.data.user_id?.toString() || '',
          username: res.data.username || username,
          nickname: res.data.nickname || username,
          statusMessage: res.data.status_message || res.data.statusMessage || '안녕하세요!',
          profileImage: res.data.profile_image || res.data.profileImage || '',
          title: res.data.title || `${res.data.nickname || username}'s MiniHompi`,
          todayCount: res.data.today_count || res.data.todayCount || 0,
          totalCount: res.data.total_count || res.data.totalCount || 0,
          followerCount: res.data.follower_count || 0,
          followingCount: res.data.following_count || 0,
        });
        await visitHompiByUsername(username);
      } catch {
        setUserData((prev) => ({
          ...prev,
          username: username,
          nickname: username,
          statusMessage: '안녕하세요!',
          title: `${username}'s MiniHompi`,
        }));
      } finally {
        setLoading(false);
      }
    };

    fetchUserData();
  }, [username]);

  const handleTabChange = (tabKey: string) => {
    router.push(`/${username}/${tabKey}`);
  };

  const allTabs = isOwner ? [...tabs, { key: 'settings', label: '설정' }] : tabs;

  if (loading) {
    return (
      <div className="user-profile-page">
        <div className="loading-state">로딩 중...</div>
      </div>
    );
  }

  return (
    <div className="user-profile-page">
      {/* Top Navigation Bar */}
      <nav className="user-profile-navbar">
        <Link href="/home" className="navbar-logo">ONECOMPANY</Link>
        <div className="navbar-right">
          {currentUserId ? (
            <button
              className="navbar-btn login"
              onClick={() => router.push('/home')}
            >
              홈으로
            </button>
          ) : (
            <>
              <button
                className="navbar-btn login"
                onClick={() => router.push('/')}
              >
                로그인
              </button>
              <button
                className="navbar-btn signup"
                onClick={() => router.push('/')}
              >
                회원가입
              </button>
            </>
          )}
        </div>
      </nav>

      {/* Main Content */}
      <main className="user-profile-main">
        {/* Profile Header */}
        <header className="user-profile-header">
          <div className="profile-avatar-large">
            {userData.profileImage ? (
              <img src={userData.profileImage} alt={userData.nickname} />
            ) : (
              <span className="avatar-placeholder">👤</span>
            )}
          </div>

          <div className="profile-info">
            <h1 className="profile-nickname-large">{userData.nickname || username}</h1>
            <p className="profile-username-large">@{username}</p>
            <p className="profile-status-large">{userData.statusMessage}</p>
            <div className="profile-stats-row">
              <span className="profile-stat">
                <strong>{userData.followerCount}</strong> 팔로워
              </span>
              <span className="profile-stat">
                <strong>{userData.followingCount}</strong> 팔로잉
              </span>
              <span className="profile-stat">
                TODAY <strong>{userData.todayCount}</strong>
              </span>
              <span className="profile-stat">
                TOTAL <strong>{userData.totalCount}</strong>
              </span>
            </div>
          </div>

          <div className="profile-actions">
            {isOwner ? (
              <button
                className="profile-action-btn"
                onClick={() => router.push(`/${username}/settings`)}
              >
                프로필 수정
              </button>
            ) : (
              <>
                <button className="profile-action-btn primary">팔로우</button>
                <button className="profile-action-btn">메시지</button>
              </>
            )}
          </div>
        </header>

        {/* Tabs */}
        <nav className="user-profile-tabs">
          {allTabs.map((tab) => (
            <button
              key={tab.key}
              className={`profile-tab ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => handleTabChange(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="user-profile-content">
          <div className="content-area">{children}</div>
        </div>

        {/* Footer - BGM Player */}
        <footer className="user-profile-footer">
          <BgmPlayer />
        </footer>
      </main>
    </div>
  );
}
