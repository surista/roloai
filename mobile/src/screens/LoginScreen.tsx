import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
} from 'react-native';
import {
  PASSWORD_RESET_NEEDS_EMAIL,
  PASSWORD_RESET_SENT,
  passwordResetError,
} from '@roloai/shared';
import Button from '../components/Button';
import { useAuth } from '../lib/AuthContext';
import { APP_VERSION } from '../lib/version';

export default function LoginScreen() {
  const { login, resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  const handleLogin = async () => {
    if (loading) return;
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (e) {
      setError('Could not sign in. Check your email and password.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (resetting) return;
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
    // The content is vertically centred, so on a shorter device the keyboard covers the Sign In
    // button outright. Padding the view and letting it scroll keeps the whole form reachable.
    <KeyboardAvoidingView style={styles.flex} behavior="padding">
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>RoloAI</Text>
        <TextInput
          style={styles.input}
          placeholder="Email"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          // Without these, iOS Keychain and third-party password managers won't offer to fill
          // or save — on a single-screen sign-in that is most of the login experience.
          textContentType="username"
          autoComplete="email"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          submitBehavior="submit"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          ref={passwordRef}
          style={styles.input}
          placeholder="Password"
          secureTextEntry
          textContentType="password"
          autoComplete="current-password"
          returnKeyType="go"
          onSubmitEditing={handleLogin}
          value={password}
          onChangeText={setPassword}
        />
        {error && <Text style={styles.error}>{error}</Text>}
        {notice && <Text style={styles.notice}>{notice}</Text>}
        <Button
          style={styles.button}
          onPress={handleLogin}
          disabled={loading}
          accessibilityLabel="Sign In"
          accessibilityState={{ busy: loading }}
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign In</Text>}
        </Button>
        <Button
          style={styles.linkButton}
          onPress={handleForgotPassword}
          disabled={resetting}
          accessibilityLabel="Forgot password"
          accessibilityState={{ busy: resetting }}
        >
          <Text style={styles.linkButtonText}>
            {resetting ? 'Sending…' : 'Forgot password?'}
          </Text>
        </Button>
        <Text style={styles.version}>v{APP_VERSION}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 32, fontWeight: '700', textAlign: 'center', marginBottom: 24 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  button: {
    backgroundColor: '#111',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  linkButton: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 12 },
  linkButtonText: { color: '#0a7cff', fontWeight: '600', fontSize: 15 },
  error: { color: '#c00', textAlign: 'center' },
  notice: { color: '#1a7f37', textAlign: 'center' },
  version: { color: '#888', fontSize: 12, textAlign: 'center', marginTop: 8 },
});
