import { File, Paths } from 'expo-file-system';
import { cardToVCard, type Card } from '@roloai/shared';

/**
 * The owner's own contact details, for the My Card screen.
 *
 * Kept in a JSON file on the device and nowhere else — not in Firestore, so it never sits beside
 * the library of other people's cards and needs no security-rule changes.
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

const file = () => new File(Paths.document, 'my-card.json');

export async function loadMyCard(): Promise<MyCard> {
  try {
    const f = file();
    if (!f.exists) return EMPTY_MY_CARD;
    return { ...EMPTY_MY_CARD, ...(JSON.parse(await f.text()) as Partial<MyCard>) };
  } catch (e) {
    console.warn('My Card unreadable:', e);
    return EMPTY_MY_CARD;
  }
}

export function saveMyCard(card: MyCard): void {
  const f = file();
  if (!f.exists) f.create();
  f.write(JSON.stringify(card));
}

/** True when there is enough to put on a card. */
export const hasMyCardContent = (c: MyCard): boolean =>
  Boolean(c.firstName.trim() || c.lastName.trim() || c.company.trim());

/** The vCard for the QR code and the share button. */
export function myCardToVCard(c: MyCard): string {
  const card: Card = {
    id: 'me',
    firstName: c.firstName.trim(),
    lastName: c.lastName.trim(),
    jobTitle: c.jobTitle.trim() || undefined,
    company: c.company.trim() || undefined,
    phones: c.phone.trim() ? [{ label: 'work', number: c.phone.trim() }] : [],
    emails: c.email.trim() ? [{ label: 'work', address: c.email.trim() }] : [],
    website: c.website.trim() || undefined,
    address: c.address.trim() || undefined,
    tags: [],
    imageUrl: '',
    source: 'manual',
    createdAt: 0,
    updatedAt: 0,
  };
  return cardToVCard(card);
}
