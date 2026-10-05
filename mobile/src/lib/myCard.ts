import { File, Paths } from 'expo-file-system';
import { type Card } from '@roloai/shared';

/**
 * The text fields of the owner's own card, as edited on the My Card screen. The card itself is a
 * real Firestore doc flagged isMine (see cards.ts saveMyCard), so it syncs between devices and
 * can carry photos.
 */
export interface MyCard {
  firstName: string;
  lastName: string;
  jobTitle: string;
  company: string;
  phone: string;
  email: string;
  website: string;
  address: string;
}

export const EMPTY_MY_CARD: MyCard = {
  firstName: '',
  lastName: '',
  jobTitle: '',
  company: '',
  phone: '',
  email: '',
  website: '',
  address: '',
};

/** The form values for a stored card (first phone and email; the form has one of each). */
export function myCardFromCard(card: Card): MyCard {
  return {
    firstName: card.firstName,
    lastName: card.lastName,
    jobTitle: card.jobTitle ?? '',
    company: card.company ?? '',
    phone: card.phones[0]?.number ?? '',
    email: card.emails[0]?.address ?? '',
    website: card.website ?? '',
    address: card.address ?? '',
  };
}

/**
 * Card fields from the form. Starts from the existing card, if any, so extra phones/emails and
 * the labels, notes and photos on it survive a save; only the first phone and email are edited.
 */
export function myCardToFields(c: MyCard, existing?: Card) {
  const phone = c.phone.trim();
  const email = c.email.trim();
  return {
    firstName: c.firstName.trim(),
    lastName: c.lastName.trim(),
    jobTitle: c.jobTitle.trim() || undefined,
    company: c.company.trim() || undefined,
    phones: phone
      ? [{ label: existing?.phones[0]?.label ?? 'work', number: phone }, ...(existing?.phones.slice(1) ?? [])]
      : (existing?.phones.slice(1) ?? []),
    emails: email
      ? [{ label: existing?.emails[0]?.label ?? 'work', address: email }, ...(existing?.emails.slice(1) ?? [])]
      : (existing?.emails.slice(1) ?? []),
    website: c.website.trim() || undefined,
    address: c.address.trim() || undefined,
  };
}

/**
 * The details from the old device-only My Card (my-card.json), for a one-time prefill when the
 * Firestore card does not exist yet. Read only — the file is never deleted, so nothing is lost
 * if the migration is abandoned.
 */
export async function loadLegacyMyCard(): Promise<MyCard | undefined> {
  try {
    const f = new File(Paths.document, 'my-card.json');
    if (!f.exists) return undefined;
    return { ...EMPTY_MY_CARD, ...(JSON.parse(await f.text()) as Partial<MyCard>) };
  } catch (e) {
    console.warn('Old My Card unreadable:', e);
    return undefined;
  }
}

/** True when there is enough to put on a card. */
export const hasMyCardContent = (c: MyCard): boolean =>
  Boolean(c.firstName.trim() || c.lastName.trim() || c.company.trim());
