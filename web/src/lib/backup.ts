export {
  BACKUP_FORMAT_VERSION,
  BackupFormatError,
  backupFileName,
  cardsToBackup,
  parseBackup,
  vCardFileName,
} from '@roloai/shared';

/** `YYYY-MM-DD` like the shared file names — locale formatting would put slashes in them. */
export function csvFileName(date: Date): string {
  return `roloai-cards-${date.toISOString().slice(0, 10)}.csv`;
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
