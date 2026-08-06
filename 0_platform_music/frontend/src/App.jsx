import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { PlayerProvider } from './contexts/PlayerContext';
import { useAuth } from './contexts/AuthContext';
import Header from './components/Header';
import Footer from './components/Footer';
import MusicPlayer from './components/MusicPlayer';
import MainPage from './pages/MainPage';
import ChartPage from './pages/ChartPage';
import SearchPage from './pages/SearchPage';
import AlbumDetailPage from './pages/AlbumDetailPage';
import ArtistDetailPage from './pages/ArtistDetailPage';
import FeedDetailPage from './pages/FeedDetailPage';
import TimelinePage from './pages/TimelinePage';
import PlaylistPage from './pages/PlaylistPage';
import PlaylistDetailPage from './pages/PlaylistDetailPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import OAuthCallbackPage from './pages/OAuthCallbackPage';
import GuardianConsentPage from './pages/GuardianConsentPage';
import InvitePage from './pages/InvitePage';
import UploadPage from './pages/UploadPage';
import MyMusicPage from './pages/MyMusicPage';
import PlayerPage from './pages/PlayerPage';
import DmInboxPage from './pages/DmInboxPage';
import BusinessPage from './pages/BusinessPage';
import ItemSelectPage from './pages/ItemSelectPage';
import TermsPage from './pages/TermsPage';
import PrivacyPage from './pages/PrivacyPage';
import './App.css';

function BusinessRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user || (user.role !== 'customer' && user.role !== 'admin')) {
    return <Navigate to="/" replace />;
  }
  return children;
}

// v162 — 관리자 페이지는 독립 앱(frontend_admin, 포트 4001)으로 완전 이사.
// 관리자 라우트 가드·경로 분기 제거 — Header/Footer/MusicPlayer 무조건 렌더.
function AppContent() {
  return (
    <div className="app">
      <Header />
      <Routes>
        <Route path="/" element={<MainPage />} />
        <Route path="/chart" element={<ChartPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/album/:id" element={<AlbumDetailPage />} />
        <Route path="/artist/:id" element={<ArtistDetailPage />} />
        {/* v131 — 피드 단건(공유 링크 착지, 비로그인 열람) */}
        <Route path="/feed/:feedId" element={<FeedDetailPage />} />
        {/* v134 — 타임라인 (혼합 랭킹 노출, 비로그인 열람) */}
        <Route path="/timeline" element={<TimelinePage />} />
        <Route path="/playlist" element={<PlaylistPage />} />
        <Route path="/playlist/:id" element={<PlaylistDetailPage />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/my-music" element={<MyMusicPage />} />
        <Route path="/items/:category" element={<ItemSelectPage />} />
        <Route path="/player" element={<PlayerPage />} />
        {/* v152 — 실시간 1:1 DM함 (본인인증 게이트, 로그인 필요) */}
        <Route path="/dm" element={<DmInboxPage />} />
        <Route path="/dm/:cid" element={<DmInboxPage />} />
        {/* v146 — 법적 고지 문서 (비로그인 상시 열람) */}
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
        {/* v123 — 보호자(법정대리인) 동의 페이지: 무로그인 접근(토큰 링크 경유) */}
        <Route path="/guardian-consent/:token" element={<GuardianConsentPage />} />
        {/* v154 — 앱 추천(리퍼럴) 초대 착지 페이지 (비로그인 열람) */}
        <Route path="/invite/:code" element={<InvitePage />} />
        <Route path="/business" element={<BusinessRoute><BusinessPage /></BusinessRoute>} />
        {/* v162 — catch-all: 미정의 경로(구 /admin 포함)는 홈으로 (빈 화면 방지) */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Footer />
      <MusicPlayer />
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <PlayerProvider>
        <AppContent />
      </PlayerProvider>
    </AuthProvider>
  );
}

export default App;
