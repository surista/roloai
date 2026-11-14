import { useEffect } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { CardExtractionError } from './functions';
import { forgetPhotos, readCard } from './scanReader';
import { listQueuedScans, markQueuedScanRead, queuedScanUris } from './scanQueue';

/**
 * Reads queued scans in the background as soon as the phone is back online, so "Read Later"
 * really does mean later rather than "until you remember to tap Read Now".
 *
 * Nothing is saved without the owner seeing it: a read only fills in the queued entry's draft,
 * and the list's banner turns into "ready to review". Review then opens instantly, with no wait
 * on Claude.
 */

const listeners = new Set<() => void>();

/** Called whenever a queued scan changes state, so the list can refresh its banner. */
export function subscribeToQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let running = false;

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const entry of await listQueuedScans()) {
      if (entry.draft) continue;
      const state = await NetInfo.fetch();
      if (!state.isConnected || state.isInternetReachable === false) return;
      const { frontUri, backUri } = queuedScanUris(entry);
      try {
        const result = await readCard(frontUri, backUri);
        await markQueuedScanRead(entry.id, result.draft, result.front.uri, result.back?.uri);
        listeners.forEach((l) => l());
      } catch (e) {
        // A card Claude can't read won't read better later; leave it for a manual look. A
        // network failure stops the pass — the next reconnect starts another.
        console.warn('Background read failed:', e);
        if (!(e instanceof CardExtractionError)) return;
      } finally {
        forgetPhotos(frontUri, backUri);
      }
    }
  } finally {
    running = false;
  }
}

/** Mounted once for the signed-in session. */
export function useQueueAutoRead(): void {
  useEffect(() => {
    void drain();
    const unsubscribeNet = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) void drain();
    });
    const appState = AppState.addEventListener('change', (s) => {
      if (s === 'active') void drain();
    });
    return () => {
      unsubscribeNet();
      appState.remove();
    };
  }, []);
}

/** For the review screen's "Read Later", so a scan queued while online is read right away. */
export function kickQueueReader(): void {
  void drain();
}
