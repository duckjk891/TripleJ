import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
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
import PlaylistPage from './pages/PlaylistPage';
import PlaylistDetailPage from './pages/PlaylistDetailPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import OAuthCallbackPage from './pages/OAuthCallbackPage';
import UploadPage from './pages/UploadPage';
import MyMusicPage from './pages/MyMusicPage';
import PlayerPage from './pages/PlayerPage';
import BusinessPage from './pages/BusinessPage';
import ItemSelectPage from './pages/ItemSelectPage';
import AdminDashboardPage from './pages/admin/AdminDashboardPage';
import AdminUsersPage from './pages/admin/AdminUsersPage';
import AdminTracksPage from './pages/admin/AdminTracksPage';
import './App.css';

function BusinessRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user || (user.role !== 'customer' && user.role !== 'admin')) {
    return <Navigate to="/" replace />;
  }
  return children;
}

function AdminRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user || user.role !== 'admin') {
    return <Navigate to="/" replace />;
  }
  return children;
}

function AppContent() {
  const location = useLocation();
  const isAdminPage = location.pathname.startsWith('/admin');

  return (
    <div className="app">
      {!isAdminPage && <Header />}
      <Routes>
        <Route path="/" element={<MainPage />} />
        <Route path="/chart" element={<ChartPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/album/:id" element={<AlbumDetailPage />} />
        <Route path="/artist/:id" element={<ArtistDetailPage />} />
        <Route path="/playlist" element={<PlaylistPage />} />
        <Route path="/playlist/:id" element={<PlaylistDetailPage />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/my-music" element={<MyMusicPage />} />
        <Route path="/items/:category" element={<ItemSelectPage />} />
        <Route path="/player" element={<PlayerPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
        <Route path="/business" element={<BusinessRoute><BusinessPage /></BusinessRoute>} />
        <Route path="/admin" element={<AdminRoute><AdminDashboardPage /></AdminRoute>} />
        <Route path="/admin/users" element={<AdminRoute><AdminUsersPage /></AdminRoute>} />
        <Route path="/admin/tracks" element={<AdminRoute><AdminTracksPage /></AdminRoute>} />
      </Routes>
      {!isAdminPage && <Footer />}
      {!isAdminPage && <MusicPlayer />}
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
