import { Directory, File, Paths } from 'expo-file-system';

/**
 * Scans waiting to be read, for when there is no network at the moment of scanning.
 *
 * The photos are copied into the app's document directory (the scanner's own output lives in a
 * cache the system may clear) with a small JSON manifest beside them. Only file *names* are
 * stored: iOS can change the app container's path between launches and updates, so an absolute
 * uri saved today may not resolve tomorrow.
 */
export interface QueuedScan {
  id: string;
  queuedAt: number;
  frontFile: string;
  backFile?: string;
}

// Manifest operations are kept pure so they stay obvious; the file handling is below.
export const withEntry = (entries: QueuedScan[], entry: QueuedScan): QueuedScan[] => [
  ...entries,
  entry,
];
export const withoutEntry = (entries: QueuedScan[], id: string): QueuedScan[] =>
  entries.filter((e) => e.id !== id);
export const oldestEntry = (entries: QueuedScan[]): QueuedScan | undefined =>
  [...entries].sort((a, b) => a.queuedAt - b.queuedAt)[0];

function queueDir(): Directory {
  const dir = new Directory(Paths.document, 'scan-queue');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function manifestFile(): File {
  return new File(queueDir(), 'queue.json');
}

/** Every queued scan, oldest first. A missing or unreadable manifest reads as an empty queue. */
export async function listQueuedScans(): Promise<QueuedScan[]> {
  const file = manifestFile();
  if (!file.exists) return [];
  try {
    const parsed: unknown = JSON.parse(await file.text());
    return Array.isArray(parsed)
      ? (parsed as QueuedScan[]).sort((a, b) => a.queuedAt - b.queuedAt)
      : [];
  } catch (e) {
    console.warn('Scan queue manifest unreadable:', e);
    return [];
  }
}

async function saveManifest(entries: QueuedScan[]): Promise<void> {
  manifestFile().write(JSON.stringify(entries));
}

export async function countQueuedScans(): Promise<number> {
  return (await listQueuedScans()).length;
}

function copyIntoQueue(sourceUri: string, name: string): string {
  new File(sourceUri).copy(new File(queueDir(), name));
  return name;
}

/** Copies the photos into the queue and records them. Returns the new entry. */
export async function addQueuedScan(frontUri: string, backUri?: string): Promise<QueuedScan> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const entry: QueuedScan = {
    id,
    queuedAt: Date.now(),
    frontFile: copyIntoQueue(frontUri, `${id}-front.jpg`),
    backFile: backUri ? copyIntoQueue(backUri, `${id}-back.jpg`) : undefined,
  };
  // The manifest is written last, so a crash mid-copy leaves stray files but never an entry
  // that points at photos which are not there.
  await saveManifest(withEntry(await listQueuedScans(), entry));
  return entry;
}

/** The local uris of a queued scan's photos. */
export function queuedScanUris(entry: QueuedScan): { frontUri: string; backUri?: string } {
  const dir = queueDir();
  return {
    frontUri: new File(dir, entry.frontFile).uri,
    backUri: entry.backFile ? new File(dir, entry.backFile).uri : undefined,
  };
}

/** Removes the entry and deletes its photos. Removing an id that is already gone is a no-op. */
export async function removeQueuedScan(id: string): Promise<void> {
  const entries = await listQueuedScans();
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  // Manifest first: a crash before the deletes leaves orphan files, not a dangling entry.
  await saveManifest(withoutEntry(entries, id));
  for (const name of [entry.frontFile, entry.backFile]) {
    if (!name) continue;
    try {
      const file = new File(queueDir(), name);
      if (file.exists) file.delete();
    } catch (e) {
      console.warn('Could not delete queued photo:', e);
    }
  }
}
