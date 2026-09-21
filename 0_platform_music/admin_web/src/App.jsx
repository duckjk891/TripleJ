import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import Layout from './components/Layout';
import { DialogHost } from './components/dialog';
import LoginPage from './pages/Login';
import DashboardPage from './pages/Dashboard';
import ReportsPage from './pages/Reports';
import TracksPage from './pages/Tracks';
import UsersPage from './pages/Users';
import ItemsPage from './pages/Items';
import BrandsPage from './pages/Brands';

function Protected({ children }) {
  const { isAuthed } = useAuth();
  if (!isAuthed) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <AuthProvider>
      <DialogHost />
      <HashRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<Protected><DashboardPage /></Protected>} />
          <Route path="/reports" element={<Protected><ReportsPage /></Protected>} />
          <Route path="/tracks" element={<Protected><TracksPage /></Protected>} />
          <Route path="/users" element={<Protected><UsersPage /></Protected>} />
          <Route path="/items" element={<Protected><ItemsPage /></Protected>} />
          <Route path="/brands" element={<Protected><BrandsPage /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}
