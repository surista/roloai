import { cardImageFileName, cardToVCard, type Card } from '@roloai/shared';
import { downloadFile } from './backup';

export type ShareKind = 'contact' | 'front' | 'back' | 'both';

/**
 * What actually happened, so the UI can say so:
 *  - shared: handed to the OS share sheet (or the user dismissed it — not an error)
 *  - downloaded: saved as file(s) because this browser cannot share files
 *  - opened: the photo could not be fetched as data, so its URL was opened instead
 */
export type ShareOutcome = 'shared' | 'downloaded' | 'opened';

const displayName = (card: Card): string => `${card.firstName} ${card.lastName}`.trim();

/** Which share options a card can offer — a side it has no photo for is simply not listed. */
export function shareOptions(card: Card): { kind: ShareKind; label: string }[] {
  const options: { kind: ShareKind; label: string }[] = [{ kind: 'contact', label: 'Contact (.vcf)' }];
  if (card.imageUrl) options.push({ kind: 'front', label: 'Front photo' });
  if (card.imageBackUrl) options.push({ kind: 'back', label: 'Back photo' });
  if (card.imageUrl && card.imageBackUrl) options.push({ kind: 'both', label: 'Both photos' });
  return options;
}

/**
 * Dismissing the share sheet rejects with AbortError; that is not a failure.
 */
async function shareFiles(files: File[], title: string): Promise<void> {
  try {
    await navigator.share({ files, title });
  } catch (e) {
    if ((e as Error).name !== 'AbortError') throw e;
  }
}

function downloadBlob(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke later: revoking straight away can cancel the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Lets the browser start one download before the next, which it otherwise tends to drop. */
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetches the photo as a File. Storage buckets only answer cross-origin reads when CORS is
 * configured on the bucket (it is not set up in this repo), so this can reject with a
 * network/CORS error — callers fall back to opening the URL.
 */
async function fetchImage(url: string, name: string): Promise<File> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Photo request failed (${response.status})`);
  const blob = await response.blob();
  return new File([blob], name, { type: blob.type || 'image/jpeg' });
}

/** Last resort when the photo bytes are unreachable: let the browser show/save the image itself. */
function openUrls(urls: string[]): void {
  for (const url of urls) {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

/**
 * Shares or saves part of a card: its .vcf, one photo, or both photos as two separate files.
 * Where the browser has no file sharing (desktop Chrome/Firefox) the files are downloaded.
 */
export async function shareCard(card: Card, kind: ShareKind): Promise<ShareOutcome> {
  const title = displayName(card) || 'Card';

  if (kind === 'contact') {
    const fileName = `${(displayName(card).replace(/[\\/:*?"<>|\s]+/g, '-') || 'contact')}.vcf`;
    const vcf = cardToVCard(card);
    const file = new File([vcf], fileName, { type: 'text/vcard' });
    if (navigator.canShare?.({ files: [file] })) {
      await shareFiles([file], title);
      return 'shared';
    }
    downloadFile(fileName, vcf, 'text/vcard');
    return 'downloaded';
  }

  const wanted: { url: string; name: string }[] = [];
  if ((kind === 'front' || kind === 'both') && card.imageUrl) {
    wanted.push({ url: card.imageUrl, name: cardImageFileName(card, 'front') });
  }
  if ((kind === 'back' || kind === 'both') && card.imageBackUrl) {
    wanted.push({ url: card.imageBackUrl, name: cardImageFileName(card, 'back') });
  }
  if (wanted.length === 0) throw new Error('This card has no photo to share.');

  let files: File[];
  try {
    files = await Promise.all(wanted.map((w) => fetchImage(w.url, w.name)));
  } catch (e) {
    console.warn('Could not fetch card photo (CORS?); opening it instead:', e);
    openUrls(wanted.map((w) => w.url));
    return 'opened';
  }

  // Two separate files in one share, not a merged image — receivers keep them distinct.
  if (navigator.canShare?.({ files })) {
    await shareFiles(files, title);
    return 'shared';
  }
  for (const file of files) {
    downloadBlob(file);
    await pause(300);
  }
  return 'downloaded';
}

/** The sentence to show after a share, or null when nothing needs saying. */
export function outcomeMessage(outcome: ShareOutcome): string | null {
  if (outcome === 'downloaded') return 'Saved to your downloads — this browser cannot open a share sheet.';
  if (outcome === 'opened') {
    return 'The photo could not be fetched for sharing here, so it was opened instead — save it from there.';
  }
  return null;
}
