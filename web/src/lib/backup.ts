import type { Card } from '@roloai/shared';

/**
 * The JSON backup envelope.
 *
 * Versioned from the start: a bare array of cards would leave a future format change with no way
 * to tell old files from new ones, and no way to refuse a file that is not a RoloAI backup at all
 * (a stray .json picked in the file dialog would otherwise import as zero cards and look like it
 * worked).
 */
export const BACKUP_FORMAT_VERSION = 1;

interface Backup {
  app: 'roloai';
  version: number;
  exportedAt: string;
  cards: Card[];
}

export function cardsToBackup(cards: Card[], exportedAt: Date): string {
  const backup: Backup = {
    app: 'roloai',
    version: BACKUP_FORMAT_VERSION,
    exportedAt: exportedAt.toISOString(),
    cards,
  };
  return JSON.stringify(backup, null, 2);
}

export class BackupFormatError extends Error {}

/** Reads a backup file, rejecting anything that is not one rather than silently importing zero cards. */
export function parseBackup(text: string): Card[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupFormatError('That file is not valid JSON.');
  }

  const backup = parsed as Partial<Backup>;
  if (!backup || backup.app !== 'roloai' || !Array.isArray(backup.cards)) {
    throw new BackupFormatError('That does not look like a RoloAI backup file.');
  }
  if (typeof backup.version !== 'number' || backup.version > BACKUP_FORMAT_VERSION) {
    throw new BackupFormatError(
      `That backup was written by a newer version of RoloAI (format ${String(backup.version)}).`
    );
  }

  // A card with no id cannot be restored to a document, and one that is not an object at all
  // would fail deep inside a batch write with an unreadable error. Check here instead.
  const invalid = backup.cards.findIndex(
    (card) => !card || typeof card !== 'object' || typeof card.id !== 'string' || !card.id
  );
  if (invalid !== -1) {
    throw new BackupFormatError(`Card ${invalid + 1} in that file is missing its id.`);
  }

  return backup.cards;
}

/** `YYYY-MM-DD`, for file names — locale formatting would put slashes in them. */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function backupFileName(date: Date): string {
  return `roloai-backup-${isoDate(date)}.json`;
}

export function vCardFileName(date: Date): string {
  return `roloai-contacts-${isoDate(date)}.vcf`;
}

/**
 * Hands the file to the browser's download flow.
 *
 * The object URL is revoked on the next tick rather than immediately: revoking synchronously
 * after click() races the download in Safari and produces an empty file.
 */
export function downloadFile(fileName: string, contents: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
