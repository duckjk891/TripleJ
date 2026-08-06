import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import AdminLoginPage from './pages/AdminLoginPage';
import AdminDashboardPage from './pages/AdminDashboardPage';
import AdminUsersPage from './pages/AdminUsersPage';
import AdminTracksPage from './pages/AdminTracksPage';
import AdminReportsPage from './pages/AdminReportsPage';
import AdminCsPage from './pages/AdminCsPage';

// v162 — 관리자 독립 앱: /login 이 유일한 공개 라우트.
// 미로그인/비관리자는 항상 /login 으로 리다이렉트한다.
function AdminRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user || user.role !== 'admin') {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<AdminLoginPage />} />
        <Route path="/" element={<AdminRoute><AdminDashboardPage /></AdminRoute>} />
        <Route path="/users" element={<AdminRoute><AdminUsersPage /></AdminRoute>} />
        <Route path="/tracks" element={<AdminRoute><AdminTracksPage /></AdminRoute>} />
        <Route path="/reports" element={<AdminRoute><AdminReportsPage /></AdminRoute>} />
        <Route path="/cs" element={<AdminRoute><AdminCsPage /></AdminRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;
