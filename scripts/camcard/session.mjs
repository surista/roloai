/**
 * Signing a script in as the owner account.
 *
 * These scripts use the same public client SDK the apps do, so the deployed Firestore, Storage
 * and function-side owner checks apply to them exactly as they do to a scan from the phone —
 * no service-account key to mint, hold, or leak for jobs that run once.
 */
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const OWNER_EMAIL = process.env.ROLOAI_EMAIL ?? 'surista@gmail.com';

/** The web app's config is the one already checked into web/.env — no second copy to drift. */
function firebaseConfig() {
  const env = readFileSync(path.join(REPO, 'web/.env'), 'utf8');
  const read = (key) => env.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1].trim();
  return {
    apiKey: read('VITE_FIREBASE_API_KEY'),
    authDomain: read('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: read('VITE_FIREBASE_PROJECT_ID'),
    storageBucket: read('VITE_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: read('VITE_FIREBASE_MESSAGING_SENDER_ID'),
    appId: read('VITE_FIREBASE_APP_ID'),
  };
}

/** Reads the password without echoing it, so it never lands in the terminal or shell history. */
function promptPassword() {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.question(`Password for ${OWNER_EMAIL}: `, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    rl._writeToOutput = () => {};
  });
}

/** Signs in and hands back the services. The password comes from ROLOAI_PASSWORD or a prompt. */
export async function signIn() {
  const app = initializeApp(firebaseConfig());
  const auth = getAuth(app);
  const password = process.env.ROLOAI_PASSWORD ?? (await promptPassword());
  await signInWithEmailAndPassword(auth, OWNER_EMAIL, password);
  console.log(`signed in as ${auth.currentUser.email}`);
  return {
    app,
    auth,
    db: getFirestore(app),
    storage: getStorage(app),
    // The function is deployed to us-central1; getFunctions() alone would look elsewhere.
    functions: getFunctions(app, 'us-central1'),
  };
}
