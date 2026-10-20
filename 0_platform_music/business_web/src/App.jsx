import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { DialogHost, ToastHost } from './components/dialog';
import Layout from './components/Layout';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Items from './pages/Items';
import ItemDetail from './pages/ItemDetail';
import Profile from './pages/Profile';
import Password from './pages/Password';
import Upload from './pages/Upload';

function Private({ children }) {
  const { isAuthed, mustChange } = useAuth();
  const loc = useLocation();
  if (!isAuthed) return <Navigate to="/login" replace />;
  if (mustChange && loc.pathname !== '/password') return <Navigate to="/password" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route element={<Private><Layout /></Private>}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/items" element={<Items />} />
            <Route path="/items/upload" element={<Upload />} />
            <Route path="/items/:id" element={<ItemDetail />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/password" element={<Password />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
      <DialogHost />
      <ToastHost />
    </AuthProvider>
  );
}
