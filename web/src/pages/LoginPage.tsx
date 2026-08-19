import { useState, type FormEvent } from 'react';
import {
  PASSWORD_RESET_NEEDS_EMAIL,
  PASSWORD_RESET_SENT,
  passwordResetError,
} from '@roloai/shared';
import { useAuth } from '../lib/AuthContext';

export default function LoginPage() {
  const { login, resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch {
      setError('Could not sign in. Check your email and password.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    const address = email.trim();
    setError(null);
    setNotice(null);
    if (!address) {
      setError(PASSWORD_RESET_NEEDS_EMAIL);
      return;
    }
    setResetting(true);
    try {
      await resetPassword(address);
      setNotice(PASSWORD_RESET_SENT);
    } catch (e) {
      const message = passwordResetError(e);
      if (message) setError(message);
      else setNotice(PASSWORD_RESET_SENT);
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-form" onSubmit={handleSubmit}>
        <h1>RoloAI</h1>
        {/* name + autoComplete are what let the browser and password managers offer to fill
            and save these — without them the one screen with any friction has none of it. */}
        <input
          type="email"
          name="email"
          autoComplete="username"
          placeholder="Email"
          autoCapitalize="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="error">{error}</p>}
        {notice && <p className="notice">{notice}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign In'}
        </button>
        {/* type="button" — inside a form, the default submit type would try to sign in with an
            empty password instead of sending the reset. */}
        <button
          type="button"
          className="link-button"
          onClick={handleForgotPassword}
          disabled={resetting}
        >
          {resetting ? 'Sending…' : 'Forgot password?'}
        </button>
        <p className="version">v{__APP_VERSION__}</p>
      </form>
    </div>
  );
}
