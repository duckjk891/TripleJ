import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import Header from './components/Header';
import Footer from './components/Footer';
import ProtectedRoute from './components/ProtectedRoute';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import StoryWizardPage from './pages/StoryWizardPage';
import GenerationStatusPage from './pages/GenerationStatusPage';
import MVPlayerPage from './pages/MVPlayerPage';
import MyWeddingMVPage from './pages/MyWeddingMVPage';
import OutfitSelectPage from './pages/OutfitSelectPage';
import ItemManagePage from './pages/ItemManagePage';
import './App.css';

export default function App() {
  return (
    <AuthProvider>
      <div className="app-shell">
        <Header />
        <main className="app-main">
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route
              path="/wizard"
              element={
                <ProtectedRoute>
                  <StoryWizardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/projects/:id"
              element={
                <ProtectedRoute>
                  <GenerationStatusPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/projects/:id/play"
              element={
                <ProtectedRoute>
                  <MVPlayerPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/my"
              element={
                <ProtectedRoute>
                  <MyWeddingMVPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/outfits/:role/:style/:category"
              element={
                <ProtectedRoute>
                  <OutfitSelectPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/items"
              element={
                <ProtectedRoute>
                  <ItemManagePage />
                </ProtectedRoute>
              }
            />
          </Routes>
        </main>
        <Footer />
      </div>
    </AuthProvider>
  );
}
