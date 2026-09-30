import { mergeFrontBack, type CardDraft } from '@roloai/shared';
import { prepareImageForUpload } from './documentScanner';
import { extractCard } from './functions';

export interface PhotoRead {
  /** The upload-size render of the photo — what Save stores, not the scanner's full-size crop. */
  uri: string;
  base64: string;
  draft: CardDraft;
}

/**
 * One read per photo, keyed by the photo's uri and held as a promise.
 *
 * Reading a card is a ~30s Claude call. Doing front and back in one call meant the user waited
 * for the whole thing after the last photo; reading each photo on its own lets the front be read
 * while the user is still deciding about (or scanning) the back. Caching the *promise* rather
 * than the result means a second caller — the review screen arriving while the read is still in
 * flight — joins it instead of starting another.
 */
const reads = new Map<string, Promise<PhotoRead>>();

export function readPhoto(uri: string): Promise<PhotoRead> {
  const cached = reads.get(uri);
  if (cached) return cached;

  const read = prepareImageForUpload(uri).then(async ({ uri: rendered, base64 }) => ({
    uri: rendered,
    base64,
    draft: await extractCard(base64),
  }));
  reads.set(uri, read);
  // A failed read must not stay cached, or "Try again" would just re-deliver the same failure.
  // The identity check keeps a late rejection from evicting a newer read of the same photo.
  read.catch(() => {
    if (reads.get(uri) === read) reads.delete(uri);
  });
  return read;
}

/**
 * Starts reading a photo in the background. The rejection is swallowed here because nobody is
 * awaiting it yet; whoever calls readPhoto later gets the same rejected promise (until it evicts
 * itself above) or a fresh attempt, and reports the error then.
 */
export function prefetchPhoto(uri: string): void {
  readPhoto(uri).catch(() => {});
}

/** Drops finished (or abandoned) reads so the cache does not hold every photo taken this session. */
export function forgetPhotos(...uris: (string | undefined)[]): void {
  for (const uri of uris) if (uri) reads.delete(uri);
}

export interface CardRead {
  front: { uri: string };
  back?: { uri: string };
  draft: CardDraft;
}

/** Reads both sides in parallel and combines them; a front-only card is just the front's read. */
export async function readCard(frontUri: string, backUri?: string): Promise<CardRead> {
  const [front, back] = await Promise.all([
    readPhoto(frontUri),
    backUri ? readPhoto(backUri) : undefined,
  ]);
  return {
    front: { uri: front.uri },
    back: back ? { uri: back.uri } : undefined,
    draft: back ? mergeFrontBack(front.draft, back.draft) : front.draft,
  };
}
