import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
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
 */
export async function deleteCard(id: string, imageUrls: (string | undefined)[] = []): Promise<void> {
  await Promise.all(
    imageUrls.filter((url): url is string => Boolean(url)).map(deleteImageByUrl)
  );
  await deleteDoc(doc(db, 'cards', id));
}
