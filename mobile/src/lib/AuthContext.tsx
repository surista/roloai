import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from '@firebase/auth';
import { auth, usingEmulators } from './firebase';
import { clearSpotlight } from './spotlight';
import { cancelAllFollowUps } from './reminders';

interface AuthContextValue {
  user: User | null;
  initializing: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, (nextUser) => {
      // Development against the local emulators only: sign in to the throwaway emulator account
      // so the signed-in screens can be exercised without anyone's real password.
      const devEmail = process.env.EXPO_PUBLIC_EMULATOR_EMAIL;
      const devPassword = process.env.EXPO_PUBLIC_EMULATOR_PASSWORD;
      if (!nextUser && usingEmulators && devEmail && devPassword) {
        void signInWithEmailAndPassword(auth, devEmail, devPassword).catch((e) =>
          console.warn('Emulator sign-in failed:', e)
        );
      }
      setUser(nextUser);
      setInitializing(false);
    });
  }, []);

  const login = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const logout = async () => {
    await clearSpotlight();
    await cancelAllFollowUps();
    await signOut(auth);
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  };

  return (
    <AuthContext.Provider value={{ user, initializing, login, logout, resetPassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
