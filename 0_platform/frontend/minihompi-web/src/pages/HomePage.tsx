import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getUsers, getUser, getFriends } from '../api';
import './HomePage.css';

interface UserInfo {
  id: number;
  nickname: string;
  username?: string;
  profile_image?: string;
}

interface FriendInfo {
  id: number;
  userId: number;
  nickname: string;
  username?: string;
  relationName: string;
}

function HomePage() {
  const navigate = useNavigate();
  const [myUserId, setMyUserId] = useState('');
  const [myNickname, setMyNickname] = useState('');
  const [myUsername, setMyUsername] = useState('');
  const [allUsers, setAllUsers] = useState<UserInfo[]>([]);
  const [friends, setFriends] = useState<FriendInfo[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const userId = localStorage.getItem('userId');
    const nickname = localStorage.getItem('nickname');
    if (!userId) {
      navigate('/');
      return;
    }
    setMyUserId(userId);
    setMyNickname(nickname || '');
    // username은 nickname을 기반으로 설정 (실제로는 API에서 가져와야 함)
    setMyUsername(nickname || userId);

    const fetchData = async () => {
      try {
        const usersRes = await getUsers();
        setAllUsers(usersRes.data || []);
      } catch { /* */ }

      try {
        const friendsRes = await getFriends(Number(userId));
        const friendList = friendsRes.data || [];
        const enriched: FriendInfo[] = [];
        for (const f of friendList) {
          if (f.status !== 'accepted') continue;
          const friendUserId = f.user_id === Number(userId) ? f.friend_id : f.user_id;
          try {
            const userRes = await getUser(String(friendUserId));
            enriched.push({
              id: f.id,
              userId: friendUserId,
              nickname: userRes.data.nickname,
              username: userRes.data.username || userRes.data.nickname,
              relationName: f.relation_name || '일촌',
            });
          } catch { /* */ }
        }
        setFriends(enriched);
      } catch { /* */ }
    };
    fetchData();
  }, [navigate]);

  // 페이지 이동으로 변경 (팝업 대신)
  const goToMiniHompi = (username: string) => {
    navigate(`/${username}/diary`);
  };

  // 내 미니홈피로 이동
  const goToMyMiniHompi = () => {
    navigate(`/${myUsername}/diary`);
  };

  const handleLogout = () => {
    localStorage.removeItem('userId');
    localStorage.removeItem('nickname');
    navigate('/');
  };

  const filteredUsers = searchQuery.trim()
    ? allUsers.filter(u =>
        u.nickname.toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(u.id) === searchQuery
      )
    : [];

  const popularUsers = [...allUsers]
    .filter(u => String(u.id) !== myUserId)
    .slice(0, 6);

  return (
    <div className="home-page">
      <header className="home-header">
        <div className="home-header-inner">
          <div className="home-logo" onClick={() => navigate('/home')}>
            <h1>ONECOMPANY</h1>
          </div>
          <div className="home-search">
            <input
              type="text"
              placeholder="미니홈피 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="home-user-info">
            <span className="home-user-name">{myNickname}님</span>
            <button className="home-btn-primary" onClick={goToMyMiniHompi}>
              내 미니홈피
            </button>
            <button className="home-btn-secondary" onClick={handleLogout}>
              로그아웃
            </button>
          </div>
        </div>
      </header>

      <main className="home-main">
        <aside className="home-sidebar-left">
          <div className="home-my-profile">
            <div className="my-profile-avatar">
              {myNickname.charAt(0)}
            </div>
            <div className="my-profile-name">{myNickname}</div>
            <button className="home-btn-mini" onClick={goToMyMiniHompi}>
              내 미니홈피 가기
            </button>
          </div>

          <div className="home-friends-section">
            <h3>내 일촌 ({friends.length})</h3>
            {friends.length === 0 ? (
              <p className="friends-empty">아직 일촌이 없습니다</p>
            ) : (
              <div className="friends-list">
                {friends.map((f) => (
                  <div
                    key={f.id}
                    className="friend-item"
                    onClick={() => goToMiniHompi(f.username || f.nickname)}
                  >
                    <span className="friend-avatar">{f.nickname.charAt(0)}</span>
                    <div className="friend-info">
                      <span className="friend-name">{f.nickname}</span>
                      <span className="friend-relation">{f.relationName}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        <section className="home-content-center">
          {searchQuery.trim() && (
            <div className="home-search-results">
              <h3>검색 결과</h3>
              {filteredUsers.length === 0 ? (
                <p className="search-empty">검색 결과가 없습니다</p>
              ) : (
                <div className="search-grid">
                  {filteredUsers.map((user) => (
                    <div
                      key={user.id}
                      className="user-card"
                      onClick={() => goToMiniHompi(user.username || user.nickname)}
                    >
                      <div className="user-card-avatar">{user.nickname.charAt(0)}</div>
                      <div className="user-card-name">{user.nickname}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="home-popular">
            <h3>미니홈피 둘러보기</h3>
            {popularUsers.length === 0 ? (
              <div className="popular-empty">
                <p>아직 다른 유저가 없습니다</p>
                <p className="popular-empty-sub">친구를 초대해보세요!</p>
              </div>
            ) : (
              <div className="popular-grid">
                {popularUsers.map((user) => (
                  <div
                    key={user.id}
                    className="popular-card"
                    onClick={() => goToMiniHompi(user.username || user.nickname)}
                  >
                    <div className="popular-avatar">{user.nickname.charAt(0)}</div>
                    <div className="popular-name">{user.nickname}</div>
                    <div className="popular-action">방문하기</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="home-my-hompi-banner" onClick={goToMyMiniHompi}>
            <div className="banner-text">
              <h3>{myNickname}의 미니홈피</h3>
              <p>나만의 작은 세상을 꾸며보세요</p>
            </div>
            <span className="banner-arrow">→</span>
          </div>
        </section>

        <aside className="home-sidebar-right">
          <div className="home-notice">
            <h3>공지사항</h3>
            <ul>
              <li>ONECOMPANY에 오신 것을 환영합니다!</li>
              <li>미니홈피를 꾸며보세요</li>
              <li>일촌을 만들어보세요</li>
            </ul>
          </div>

          <div className="home-quick-links">
            <h3>바로가기</h3>
            <button onClick={() => navigate(`/${myUsername}/diary`)}>내 다이어리</button>
            <button onClick={() => navigate(`/${myUsername}/photo`)}>내 사진첩</button>
            <button onClick={() => navigate(`/${myUsername}/office`)}>내 사무실</button>
          </div>
        </aside>
      </main>

      <footer className="home-footer">
        <p>Welcome to ONECOMPANY ♪</p>
      </footer>
    </div>
  );
}

export default HomePage;
