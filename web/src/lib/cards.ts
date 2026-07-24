import {
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  collection,
} from 'firebase/firestore';
import type { Card, CardDraft } from '@roloai/shared';
import { db } from './firebase';

const cardsCollection = collection(db, 'cards');

function fromFirestore(id: string, data: Record<string, unknown>): Card {
  const createdAt = data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : Date.now();
  const updatedAt = data.updatedAt instanceof Timestamp ? data.updatedAt.toMillis() : createdAt;
  return { id, ...data, createdAt, updatedAt } as Card;
}

export function subscribeToCards(onChange: (cards: Card[]) => void): () => void {
  const q = query(cardsCollection, orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snapshot) => {
    onChange(snapshot.docs.map((d) => fromFirestore(d.id, d.data())));
  });
}

export async function updateCard(id: string, changes: Partial<CardDraft>): Promise<void> {
  await updateDoc(doc(db, 'cards', id), { ...changes, updatedAt: serverTimestamp() });
}

export async function deleteCard(id: string): Promise<void> {
  await deleteDoc(doc(db, 'cards', id));
}
