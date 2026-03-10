import { useEffect, useState } from 'react';
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom';
import DiaryList from '../components/DiaryList';
import DiaryWrite from '../components/DiaryWrite';
import PhotoGallery from '../components/PhotoGallery';
import GuestBook from '../components/GuestBook';
import Office from '../components/Office';
import Settings from '../components/Settings';
import BgmPlayer from '../components/BgmPlayer';
import { getHompiByUsername, visitHompiByUsername } from '../api';
import './UserProfile.css';

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

function UserProfile() {
  const { username } = useParams<{ username: string }>();
  const location = useLocation();
  const navigate = useNavigate();

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
  const [error, setError] = useState<string | null>(null);
  const [showDiaryWrite, setShowDiaryWrite] = useState(false);

  // TODO: Get current user from auth context
  const currentUserId = '1';
  const isOwner = userData.userId === currentUserId;

  const getActiveTab = (): string => {
    const path = location.pathname;
    if (path.includes('/diary')) return 'diary';
    if (path.includes('/photo')) return 'photo';
    if (path.includes('/guestbook')) return 'guestbook';
    if (path.includes('/office')) return 'office';
    if (path.includes('/settings')) return 'settings';
    return 'diary';
  };

  const activeTab = getActiveTab();

  useEffect(() => {
    if (!username) return;

    if (location.pathname === `/${username}`) {
      navigate(`/${username}/diary`, { replace: true });
      return;
    }

    const fetchUserData = async () => {
      setLoading(true);
      setError(null);
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
  }, [username, location.pathname, navigate]);

  const handleTabChange = (tabKey: string) => {
    setShowDiaryWrite(false);
    navigate(`/${username}/${tabKey}`);
  };

  const renderContent = () => {
    if (loading) {
      return <div className="loading-state">로딩 중...</div>;
    }

    if (error) {
      return <div className="error-state">{error}</div>;
    }

    if (showDiaryWrite) {
      return (
        <DiaryWrite
          userId={userData.userId || username || ''}
          onCancel={() => setShowDiaryWrite(false)}
          onSaved={() => setShowDiaryWrite(false)}
        />
      );
    }

    switch (activeTab) {
      case 'diary':
        return (
          <DiaryList
            userId={userData.userId || username || ''}
            onWrite={() => setShowDiaryWrite(true)}
          />
        );
      case 'photo':
        return <PhotoGallery userId={userData.userId || username || ''} />;
      case 'guestbook':
        return <GuestBook userId={userData.userId || username || ''} />;
      case 'office':
        return <Office userId={userData.userId || username || ''} />;
      case 'settings':
        if (!isOwner) {
          return <div className="error-state">접근 권한이 없습니다</div>;
        }
        return <Settings username={username || ''} />;
      default:
        return (
          <DiaryList
            userId={userData.userId || username || ''}
            onWrite={() => setShowDiaryWrite(true)}
          />
        );
    }
  };

  const allTabs = isOwner ? [...tabs, { key: 'settings', label: '설정' }] : tabs;

  return (
    <div className="user-profile-page">
      {/* Top Navigation Bar */}
      <nav className="user-profile-navbar">
        <Link to="/" className="navbar-logo">ONECOMPANY</Link>
        <div className="navbar-right">
          <button className="navbar-btn login">로그인</button>
          <button className="navbar-btn signup">회원가입</button>
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
                onClick={() => navigate(`/${username}/settings`)}
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
          <div className="content-area">{renderContent()}</div>
        </div>

        {/* Footer - BGM Player */}
        <footer className="user-profile-footer">
          <BgmPlayer />
        </footer>
      </main>
    </div>
  );
}

export default UserProfile;
