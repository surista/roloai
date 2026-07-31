import {
  deleteDoc,
  deleteField,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  collection,
} from 'firebase/firestore';
import { deleteObject, ref } from 'firebase/storage';
import { cardFromFirestore, type Card, type CardDraft } from '@roloai/shared';
import { db, storage } from './firebase';

const cardsCollection = collection(db, 'cards');

/**
 * A field the user cleared arrives as `undefined`. Simply omitting it from the write would
 * leave the previous value in place and silently undo the edit, so it becomes deleteField().
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

export async function updateCard(id: string, changes: Partial<CardDraft>): Promise<void> {
  await updateDoc(doc(db, 'cards', id), {
    ...toUpdatePayload(changes),
    updatedAt: serverTimestamp(),
  });
}

/** Storage has no cascade delete, so the card's photos have to be removed explicitly. */
export async function deleteCard(id: string, imageUrls: (string | undefined)[] = []): Promise<void> {
  await Promise.all(
    imageUrls.filter((url): url is string => Boolean(url)).map(deleteImageByUrl)
  );
  await deleteDoc(doc(db, 'cards', id));
}
