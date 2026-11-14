import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Per-device settings. Kept on the device rather than in Firestore: whether this phone may use
 * location is a property of the phone, not of the library.
 */
export interface Preferences {
  /** Record where each card was scanned. Off until the owner turns it on in Settings. */
  recordLocation: boolean;
}

const KEY = 'roloai.preferences.v1';
const DEFAULTS: Preferences = { recordLocation: false };

let cache: Preferences | undefined;
const listeners = new Set<(p: Preferences) => void>();

export async function getPreferences(): Promise<Preferences> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = { ...DEFAULTS, ...(raw ? (JSON.parse(raw) as Partial<Preferences>) : {}) };
  } catch {
    cache = DEFAULTS;
  }
  return cache;
}

export async function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): Promise<void> {
  const next = { ...(await getPreferences()), [key]: value };
  cache = next;
  listeners.forEach((l) => l(next));
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
}

export function usePreferences(): Preferences | undefined {
  const [prefs, setPrefs] = useState<Preferences | undefined>(cache);
  useEffect(() => {
    getPreferences().then(setPrefs);
    listeners.add(setPrefs);
    return () => {
      listeners.delete(setPrefs);
    };
  }, []);
  return prefs;
}
