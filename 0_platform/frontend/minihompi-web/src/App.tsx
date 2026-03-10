import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import MainPage from './pages/MainPage';
import HomePage from './pages/HomePage';
import UserProfile from './pages/UserProfile';
import './App.css';

// Legacy redirect component for /hompi/:userId/* routes
function LegacyRedirect() {
  const { userId, '*': rest } = useParams<{ userId: string; '*': string }>();
  const path = rest ? `/${userId}/${rest}` : `/${userId}`;
  return <Navigate to={path} replace />;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Main page */}
        <Route path="/" element={<MainPage />} />
        <Route path="/home" element={<HomePage />} />

        {/* User profile routes */}
        <Route path="/:username" element={<UserProfile />} />
        <Route path="/:username/diary" element={<UserProfile />} />
        <Route path="/:username/photo" element={<UserProfile />} />
        <Route path="/:username/guestbook" element={<UserProfile />} />
        <Route path="/:username/office" element={<UserProfile />} />
        <Route path="/:username/settings" element={<UserProfile />} />

        {/* Legacy support: redirect /hompi/:userId/* to /:username/* */}
        <Route path="/hompi/:userId/*" element={<LegacyRedirect />} />
        <Route path="/hompi/:userId" element={<LegacyRedirect />} />

        {/* Catch-all redirect */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
