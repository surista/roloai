import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { cardFromFirestore, stripUndefined, type Card, type CardDraft } from '@roloai/shared';
import { db, storage } from './firebase';

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

export async function uploadCardImage(
  cardId: string,
  localUri: string,
  side: 'front' | 'back' = 'front'
): Promise<string> {
  const response = await fetch(localUri);
  const blob = await response.blob();
  const imageRef = ref(storage, `cards/${cardId}/${side}-${Date.now()}.jpg`);
  await uploadBytes(imageRef, blob);
  return getDownloadURL(imageRef);
}

export async function createCard(
  draft: CardDraft,
  localImageUri?: string,
  localBackImageUri?: string
): Promise<string> {
  const docRef = await addDoc(cardsCollection, {
    ...stripUndefined(draft),
    imageUrl: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const updates: Partial<Card> = {};
  if (localImageUri) {
    updates.imageUrl = await uploadCardImage(docRef.id, localImageUri, 'front');
  }
  if (localBackImageUri) {
    updates.imageBackUrl = await uploadCardImage(docRef.id, localBackImageUri, 'back');
  }
  if (Object.keys(updates).length > 0) {
    await updateDoc(doc(db, 'cards', docRef.id), { ...updates, updatedAt: serverTimestamp() });
  }

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
  previousUrl?: string
): Promise<string> {
  const url = await uploadCardImage(id, localUri, side);
  await updateDoc(doc(db, 'cards', id), {
    [side === 'front' ? 'imageUrl' : 'imageBackUrl']: url,
    updatedAt: serverTimestamp(),
  });

  if (previousUrl) {
    await deleteImageByUrl(previousUrl);
  }

  return url;
}

/**
 * Storage has no cascade delete, so the card's photos have to go explicitly or they stay in
 * the bucket forever. A retake already cleans up the file it replaced, so the URLs still on
 * the card are the only ones left to remove.
 */
export async function deleteCard(id: string, imageUrls: (string | undefined)[] = []): Promise<void> {
  await Promise.all(
    imageUrls.filter((url): url is string => Boolean(url)).map(deleteImageByUrl)
  );
  await deleteDoc(doc(db, 'cards', id));
}
