import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function ProtectedRoute({ children, adminOnly = false }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div style={{ padding: 24 }}>로딩 중...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (adminOnly && user.role !== 'admin') {
    console.warn('[ProtectedRoute] admin gate reject', { role: user.role });
    return <Navigate to="/" replace />;
  }

  return children;
}
