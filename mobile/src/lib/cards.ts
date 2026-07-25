import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { stripUndefined, type Card, type CardDraft } from '@roloai/shared';
import { db, storage } from './firebase';

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
  await updateDoc(doc(db, 'cards', id), { ...stripUndefined(changes), updatedAt: serverTimestamp() });
}

export async function deleteCard(id: string): Promise<void> {
  await deleteDoc(doc(db, 'cards', id));
}
