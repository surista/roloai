import {
  deleteDoc,
  deleteField,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
  collection,
} from 'firebase/firestore';
import { deleteObject, ref } from 'firebase/storage';
import { cardFromFirestore, stripUndefined, type Card, type CardDraft } from '@roloai/shared';
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

/**
 * Adds imported cards as new documents.
 *
 * Used for vCard import, which carries no id — there is nothing to match an incoming contact
 * against, so re-importing the same file genuinely does mean "add these again" rather than
 * "update what is there".
 */
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
 * Restores cards under the ids they were exported with, so re-running a restore converges
 * instead of multiplying the library. A card edited since the backup was taken is overwritten —
 * that is what restoring a backup means, and the caller warns before calling.
 *
 * createdAt/updatedAt go back as the millisecond numbers the export holds rather than as fresh
 * server timestamps: `cardFromFirestore` reads either, and keeping them preserves the list's
 * ordering across a restore.
 */
export async function restoreCards(cards: Card[]): Promise<number> {
  return commitInBatches(cards.length, (batch, i) => {
    const { id, ...fields } = cards[i];
    batch.set(doc(db, 'cards', id), stripUndefined(fields));
  });
}
