import { createBrowserRouter, Outlet, RouterProvider } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/AuthContext';
import LoginPage from './pages/LoginPage';
import CardListPage from './pages/CardListPage';
import CardDetailPage from './pages/CardDetailPage';
import SettingsPage from './pages/SettingsPage';
import MyCardPage from './pages/MyCardPage';

function AuthGate() {
  const { user, initializing } = useAuth();

  if (initializing) return <p className="empty">Loading…</p>;
  if (!user) return <LoginPage />;
  return <Outlet />;
}

// A data router rather than <BrowserRouter>: only it supports useBlocker, which the edit pages
// use to stop unsaved changes being dropped by a link or the browser's Back button.
const router = createBrowserRouter([
  {
    element: <AuthGate />,
    children: [
      { path: '/', element: <CardListPage /> },
      { path: '/cards/:cardId', element: <CardDetailPage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '/my-card', element: <MyCardPage /> },
    ],
  },
]);

export default function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
