import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/AuthContext';
import LoginPage from './pages/LoginPage';
import CardListPage from './pages/CardListPage';
import CardDetailPage from './pages/CardDetailPage';
import SettingsPage from './pages/SettingsPage';

function AuthGate() {
  const { user, initializing } = useAuth();

  if (initializing) return <p className="empty">Loading…</p>;
  if (!user) return <LoginPage />;

  return (
    <Routes>
      <Route path="/" element={<CardListPage />} />
      <Route path="/cards/:cardId" element={<CardDetailPage />} />
      <Route path="/settings" element={<SettingsPage />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AuthGate />
      </BrowserRouter>
    </AuthProvider>
  );
}
