import { initializeApp, getApps, getApp } from 'firebase/app';
// `firebase/auth`'s package exports map dropped the React Native condition as of
// firebase@12, so getReactNativePersistence must come from the underlying @firebase/auth
// package directly, which still declares it correctly.
import { initializeAuth, getAuth, getReactNativePersistence, connectAuthEmulator, type Auth } from '@firebase/auth';
import { getFirestore, initializeFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// initializeAuth throws if called more than once on the same app (e.g. Fast Refresh in dev).
let auth: Auth;
try {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch {
  auth = getAuth(app);
}

export { auth };
// React Native's streaming connection to Firestore can stall for many seconds before it gives up
// and retries, which shows up as a long wait on launch. Auto-detect switches to long polling when
// the stream does not come up, and costs nothing when it does. initializeFirestore throws if the
// instance already exists (Fast Refresh), so fall back to the existing one.
let firestore: Firestore;
try {
  firestore = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
} catch {
  firestore = getFirestore(app);
}
export const db = firestore;
export const storage = getStorage(app);

/**
 * Development only: `EXPO_PUBLIC_USE_EMULATORS=1 npx expo start` points the app at the local
 * Firebase emulators (`firebase emulators:start`), so signed-in screens can be exercised against
 * throwaway data instead of the real library. Never true in a release build.
 */
export const usingEmulators = __DEV__ && process.env.EXPO_PUBLIC_USE_EMULATORS === '1';
if (usingEmulators && !(globalThis as { __rolo_emu?: boolean }).__rolo_emu) {
  (globalThis as { __rolo_emu?: boolean }).__rolo_emu = true;
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  connectFunctionsEmulator(getFunctions(app), '127.0.0.1', 5001);
}
