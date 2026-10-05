import {
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
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
export async function deleteCard(
  id: string,
  imageUrls: (string | undefined)[] = [],
  partnerId?: string
): Promise<void> {
  await Promise.all(
    imageUrls.filter((url): url is string => Boolean(url)).map(deleteImageByUrl)
  );
  if (!partnerId) {
    await deleteDoc(doc(db, 'cards', id));
    return;
  }
  // One batch, so the partner is never left pointing at a card that no longer exists. Pass
  // partnerId only for a *valid* partner: updating a missing document fails the whole batch.
  const batch = writeBatch(db);
  batch.delete(doc(db, 'cards', id));
  batch.update(doc(db, 'cards', partnerId), {
    pairedWith: deleteField(),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}

/**
 * Links a person's Japanese and English cards. Both sides are written in one batch because a
 * pair only counts when each card points at the other (see pairing.ts) — a half-written link
 * would silently read as "unpaired".
 */
export async function linkCards(aId: string, bId: string): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'cards', aId), { pairedWith: bId, updatedAt: serverTimestamp() });
  batch.update(doc(db, 'cards', bId), { pairedWith: aId, updatedAt: serverTimestamp() });
  await batch.commit();
}

/** Removes the link from both cards. */
export async function unlinkCards(aId: string, bId: string): Promise<void> {
  const batch = writeBatch(db);
  for (const id of [aId, bId]) {
    batch.update(doc(db, 'cards', id), { pairedWith: deleteField(), updatedAt: serverTimestamp() });
  }
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

/** The details My Card edits — the contact fields only; photos come from the phone app. */
export type MyCardFields = Pick<
  CardDraft,
  'firstName' | 'lastName' | 'jobTitle' | 'company' | 'phones' | 'emails' | 'website' | 'address'
>;

/**
 * Saves the owner's own card: updates the card flagged isMine, or creates it on first save.
 * It is a real card document (not local state) so it syncs with the phone and keeps its photos.
 * The lookup is a query rather than a passed-in id so a second tab can't create a duplicate.
 */
export async function saveMyCard(fields: MyCardFields): Promise<void> {
  const existing = await getDocs(query(cardsCollection, where('isMine', '==', true)));
  if (!existing.empty) {
    await updateCard(existing.docs[0].id, fields);
    return;
  }
  await setDoc(doc(cardsCollection), {
    ...stripUndefined(fields),
    tags: [],
    imageUrl: '',
    source: 'manual',
    isMine: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Makes a card the owner's own. There is at most one, so the flag is cleared from every other
 * card in the same batch — otherwise a crash in between could leave two.
 */
export async function setMyCard(id: string): Promise<void> {
  const flagged = await getDocs(query(cardsCollection, where('isMine', '==', true)));
  const batch = writeBatch(db);
  for (const d of flagged.docs) {
    if (d.id !== id) batch.update(d.ref, { isMine: deleteField(), updatedAt: serverTimestamp() });
  }
  batch.update(doc(db, 'cards', id), { isMine: true, updatedAt: serverTimestamp() });
  await batch.commit();
}

/** Turns a card back into an ordinary one; it then appears in the main list again. */
export async function clearMyCard(id: string): Promise<void> {
  await updateDoc(doc(db, 'cards', id), { isMine: deleteField(), updatedAt: serverTimestamp() });
}
