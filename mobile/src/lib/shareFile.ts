import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/** The iOS type identifiers the share sheet uses to pick suggested apps for each format. */
export const FILE_UTI = {
  json: 'public.json',
  vcard: 'public.vcard',
  csv: 'public.comma-separated-values-text',
} as const;

/** Keeps a person's name usable as a file name: no path separators or characters iOS dislikes. */
export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().replace(/\s+/g, '-') || 'contact';
}

/**
 * Writes `content` to the cache directory and opens the share sheet on it.
 *
 * The cache rather than the document directory: this is a hand-off copy, and the system may
 * clear it once the share sheet is done. Overwrites a same-named file left by an earlier share.
 */
export async function shareTextFile(
  fileName: string,
  content: string,
  uti: (typeof FILE_UTI)[keyof typeof FILE_UTI]
): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(content);
  await Sharing.shareAsync(file.uri, { UTI: uti, mimeType: mimeFor(uti) });
}

function mimeFor(uti: string): string {
  return uti === FILE_UTI.json ? 'application/json' : uti === FILE_UTI.vcard ? 'text/vcard' : 'text/csv';
}
