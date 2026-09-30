import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { cardFromFirestore, stripUndefined, type Card, type CardDraft } from '@roloai/shared';
import { db, storage } from './firebase';
import { makeThumbnail, renderForUpload } from './documentScanner';

const cardsCollection = collection(db, 'cards');

/**
 * A field the user cleared arrives as `undefined`. A create has to strip those (Firestore
 * rejects undefined values), but an update has to turn them into deleteField() instead —
 * stripping them would leave the previous value in place and silently undo the edit.
 */
function toUpdatePayload(changes: Partial<CardDraft>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    payload[key] = value === undefined ? deleteField() : value;
  }
  return payload;
}

/** Best-effort removal of a Storage file by its download URL — never worth failing the caller over. */
async function deleteImageByUrl(url: string): Promise<void> {
  try {
    await deleteObject(ref(storage, url));
  } catch (e) {
    console.warn('Could not delete card image:', e);
  }
}

export function subscribeToCards(onChange: (cards: Card[]) => void): () => void {
  const q = query(cardsCollection, orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snapshot) => {
    onChange(snapshot.docs.map((d) => cardFromFirestore(d.id, d.data())));
  });
}

/** One-off read of the whole library, for checks that need every card at a single moment. */
export async function fetchAllCards(): Promise<Card[]> {
  const snapshot = await getDocs(cardsCollection);
  return snapshot.docs.map((d) => cardFromFirestore(d.id, d.data()));
}

async function uploadTo(path: string, localUri: string): Promise<string> {
  const response = await fetch(localUri);
  const blob = await response.blob();
  const imageRef = ref(storage, path);
  await uploadBytes(imageRef, blob);
  return getDownloadURL(imageRef);
}

export async function uploadCardImage(
  cardId: string,
  localUri: string,
  side: 'front' | 'back' = 'front'
): Promise<string> {
  return uploadTo(`cards/${cardId}/${side}-${Date.now()}.jpg`, localUri);
}

/** The url of whichever uploads landed, for the cleanup that follows a partial failure. */
function fulfilledUrls(results: PromiseSettledResult<unknown>[]): string[] {
  return results.flatMap((result) => {
    if (result.status === 'rejected') return [];
    const value = result.value as { imageUrl?: string; thumbUrl?: string } | string | undefined;
    if (typeof value === 'string') return [value];
    return [value?.imageUrl, value?.thumbUrl].filter((url): url is string => Boolean(url));
  });
}

/**
 * Uploads the front image plus a small copy for the list views.
 *
 * Rendering the thumbnail is CPU work on the same file with no dependency on the upload, so the
 * two overlap rather than running end to end. `allSettled` rather than `all`: `all` rejects while
 * the other half is still in flight, and a rejection here leaves the caller no url to clean up,
 * so whatever landed afterwards would sit in the bucket unreferenced forever.
 */
async function uploadFrontWithThumbnail(
  cardId: string,
  localUri: string
): Promise<{ imageUrl: string; thumbUrl: string }> {
  const stamp = Date.now();
  const settled = await Promise.allSettled([
    uploadTo(`cards/${cardId}/front-${stamp}.jpg`, localUri),
    makeThumbnail(localUri).then((uri) => uploadTo(`cards/${cardId}/thumb-${stamp}.jpg`, uri)),
  ]);
  const failure = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failure) {
    await Promise.all(fulfilledUrls(settled).map(deleteImageByUrl));
    throw failure.reason;
  }
  const [image, thumb] = settled as PromiseFulfilledResult<string>[];
  return { imageUrl: image.value, thumbUrl: thumb.value };
}

/**
 * Storage writes happen before the document is created so a failed upload leaves nothing behind.
 * The previous order — create the doc, then upload — surfaced an upload failure as a plain "Save
 * failed" even though the card had already been written, so retrying produced a duplicate,
 * photo-less card. The id has to exist first to key the storage path, so mint it up front rather
 * than letting addDoc allocate it.
 */
export async function createCard(
  draft: CardDraft,
  localImageUri?: string,
  localBackImageUri?: string
): Promise<string> {
  const docRef = doc(cardsCollection);

  // The two sides are independent uploads. Awaiting them in turn meant a two-sided card paid for
  // them end to end, which on a slow connection is most of what "Save" was waiting on.
  const settled = await Promise.allSettled([
    localImageUri ? uploadFrontWithThumbnail(docRef.id, localImageUri) : undefined,
    localBackImageUri ? uploadCardImage(docRef.id, localBackImageUri, 'back') : undefined,
  ]);
  const failure = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failure) {
    // Nothing has been written to Firestore yet, so the retry the caller prompts for starts
    // clean. Sweep any half-finished upload so it doesn't sit in the bucket unreferenced.
    await Promise.all(fulfilledUrls(settled).map(deleteImageByUrl));
    throw failure.reason;
  }
  const [frontResult, backResult] = settled as [
    PromiseFulfilledResult<{ imageUrl: string; thumbUrl: string } | undefined>,
    PromiseFulfilledResult<string | undefined>,
  ];
  const front = frontResult.value;
  const backUrl = backResult.value;

  await setDoc(docRef, {
    ...stripUndefined(draft),
    imageUrl: front?.imageUrl ?? '',
    ...(front ? { thumbUrl: front.thumbUrl } : {}),
    ...(backUrl ? { imageBackUrl: backUrl } : {}),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return docRef.id;
}

export async function updateCard(id: string, changes: Partial<CardDraft>): Promise<void> {
  await updateDoc(doc(db, 'cards', id), {
    ...toUpdatePayload(changes),
    updatedAt: serverTimestamp(),
  });
}

export async function updateCardImage(
  id: string,
  localUri: string,
  side: 'front' | 'back',
  previousUrl?: string,
  previousThumbUrl?: string
): Promise<string> {
  // The scanner writes its crop at full capture resolution; the scan path renders it down before
  // uploading, and a retake has to do the same or the card ends up with a several-megabyte image
  // that no view displays at that size.
  const uploadUri = await renderForUpload(localUri);

  // A front retake has to replace the thumbnail too, or the list keeps showing the old photo.
  if (side === 'front') {
    const { imageUrl, thumbUrl } = await uploadFrontWithThumbnail(id, uploadUri);
    await updateDoc(doc(db, 'cards', id), {
      imageUrl,
      thumbUrl,
      updatedAt: serverTimestamp(),
    });
    await Promise.all(
      [previousUrl, previousThumbUrl]
        .filter((url): url is string => Boolean(url))
        .map(deleteImageByUrl)
    );
    return imageUrl;
  }

  const url = await uploadCardImage(id, uploadUri, 'back');
  await updateDoc(doc(db, 'cards', id), {
    imageBackUrl: url,
    updatedAt: serverTimestamp(),
  });

  if (previousUrl) {
    await deleteImageByUrl(previousUrl);
  }

  return url;
}

/**
 * A retake already cleans up the file it replaced, so the URLs still on the card — see
 * `cardImageUrls` — are the only ones left to remove.
 *
 * Pass `pairedWith` when the card has a partner so the partner is released too; the pairing
 * reader ignores a one-sided link, but leaving it would strand a stale id on the survivor.
 */
export async function deleteCard(
  id: string,
  imageUrls: (string | undefined)[] = [],
  pairedWith?: string
): Promise<void> {
  await Promise.all(
    imageUrls.filter((url): url is string => Boolean(url)).map(deleteImageByUrl)
  );
  await deleteDoc(doc(db, 'cards', id));
  if (pairedWith) await clearLinkIfPointsAt(pairedWith, id);
}

/** Clears `cardId`'s pairedWith, but only if it still points at `expected` (and the card exists). */
async function clearLinkIfPointsAt(cardId: string, expected: string): Promise<void> {
  const snap = await getDoc(doc(db, 'cards', cardId));
  if (!snap.exists() || snap.data().pairedWith !== expected) return;
  await updateDoc(snap.ref, { pairedWith: deleteField() });
}

/**
 * Pairs two cards (a person's Japanese and English cards) by writing `pairedWith` on both in one
 * batch, so a failure can't leave a one-sided link.
 *
 * If either card was already paired with someone else, that old partner is released in the same
 * batch — otherwise it would keep pointing at a card that now points elsewhere.
 */
export async function linkCards(aId: string, bId: string): Promise<void> {
  const [a, b] = await Promise.all([
    getDoc(doc(db, 'cards', aId)),
    getDoc(doc(db, 'cards', bId)),
  ]);
  const batch = writeBatch(db);
  for (const [snap, otherId] of [[a, bId], [b, aId]] as const) {
    const old = snap.exists() ? (snap.data().pairedWith as string | undefined) : undefined;
    if (old && old !== otherId && old !== aId && old !== bId) {
      batch.update(doc(db, 'cards', old), { pairedWith: deleteField() });
    }
  }
  batch.update(doc(db, 'cards', aId), { pairedWith: bId });
  batch.update(doc(db, 'cards', bId), { pairedWith: aId });
  await batch.commit();
}

export async function unlinkCards(aId: string, bId: string): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'cards', aId), { pairedWith: deleteField() });
  batch.update(doc(db, 'cards', bId), { pairedWith: deleteField() });
  await batch.commit();
}

/** Firestore caps a batch at 500 writes, so anything larger goes up as consecutive batches. */
const BATCH_LIMIT = 500;

async function commitInBatches(
  count: number,
  write: (batch: ReturnType<typeof writeBatch>, index: number) => void
): Promise<number> {
  for (let start = 0; start < count; start += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (let i = start; i < Math.min(start + BATCH_LIMIT, count); i++) write(batch, i);
    await batch.commit();
  }
  return count;
}

/** Adds imported vCard contacts as new documents (no id to match against, as on web). */
export async function importCards(drafts: CardDraft[]): Promise<number> {
  return commitInBatches(drafts.length, (batch, i) => {
    batch.set(doc(cardsCollection), {
      ...stripUndefined(drafts[i]),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
}

/**
 * Restores backup cards under their original ids, overwriting any with the same id. Timestamps
 * go back as the exported millisecond numbers, which cardFromFirestore reads, so list order
 * survives the restore (same as web).
 */
export async function restoreCards(cards: Card[]): Promise<number> {
  return commitInBatches(cards.length, (batch, i) => {
    const { id, ...fields } = cards[i];
    batch.set(doc(db, 'cards', id), stripUndefined(fields));
  });
}
