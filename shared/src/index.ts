export type CardSource = 'scan' | 'qr' | 'manual';

export interface CardPhone {
  label: string;
  number: string;
}

export interface CardEmail {
  label: string;
  address: string;
}

export interface Card {
  id: string;
  firstName: string;
  lastName: string;
  jobTitle?: string;
  company?: string;
  phones: CardPhone[];
  emails: CardEmail[];
  website?: string;
  address?: string;
  notes?: string;
  tags: string[];
  imageUrl: string;
  imageBackUrl?: string;
  /**
   * Small front-of-card image for list views. The full-size `imageUrl` is a multi-megabyte JPEG,
   * and rendering it at 48pt (mobile) or 220px (web) meant downloading and decoding the whole
   * thing per row. Absent on cards saved before thumbnails existed — fall back to `imageUrl`.
   */
  thumbUrl?: string;
  source: CardSource;
  rawOcrText?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Every Storage file a card owns. Storage has no cascade delete, so deleting a card has to
 * remove these explicitly or they stay in the bucket forever — and both apps have to agree on
 * the list, which is why it lives here rather than being spelled out at each delete site.
 */
export function cardImageUrls(card: Pick<Card, 'imageUrl' | 'imageBackUrl' | 'thumbUrl'>): string[] {
  return [card.imageUrl, card.imageBackUrl, card.thumbUrl].filter(
    (url): url is string => Boolean(url)
  );
}

/** The image to show in a card list tile: the thumbnail if one exists, else the full image. */
export function cardThumbUrl(card: Pick<Card, 'imageUrl' | 'thumbUrl'>): string | undefined {
  return card.thumbUrl || card.imageUrl || undefined;
}

/** Shape used while building a Card in the review/edit form, before it has an id or timestamps. */
export type CardDraft = Omit<Card, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * Looks up the label previously attached to each value, keyed by the value itself.
 *
 * `shift()` rather than a peek, so two entries that share a value each keep their own label
 * instead of both taking the first one.
 */
function labelLookup<T extends { label: string }>(
  entries: T[],
  valueOf: (entry: T) => string
): (value: string, fallback: string) => string {
  const unclaimed = new Map<string, string[]>();
  for (const entry of entries) {
    const value = valueOf(entry);
    const existing = unclaimed.get(value);
    if (existing) existing.push(entry.label);
    else unclaimed.set(value, [entry.label]);
  }
  return (value: string, fallback: string) => unclaimed.get(value)?.shift() ?? fallback;
}

/**
 * Re-attaches the labels Claude extracted ("mobile", "fax", "direct") to a comma-separated list
 * the user has been editing.
 *
 * The forms edit phones as a single text field, so labels have nowhere to live while editing.
 * Rebuilding every entry as "work" on save discarded real data on the very first save of every
 * scanned card — the label is the only thing distinguishing a mobile from a fax. Matching on the
 * value survives reordering, insertion, and deletion; only an edited number loses its label,
 * which is the one case where the old label may genuinely no longer apply.
 */
export function relabelPhones(numbers: string[], previous: CardPhone[]): CardPhone[] {
  const labelFor = labelLookup(previous, (p) => p.number);
  return numbers.map((number) => ({ label: labelFor(number, 'work'), number }));
}

/** As {@link relabelPhones}, for email addresses. */
export function relabelEmails(addresses: string[], previous: CardEmail[]): CardEmail[] {
  const labelFor = labelLookup(previous, (e) => e.address);
  return addresses.map((address) => ({ label: labelFor(address, 'work'), address }));
}

/** Firestore rejects any field whose value is `undefined` (as opposed to simply absent) — strip them before a write. */
export function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const key in obj) {
    if (obj[key] !== undefined) result[key] = obj[key];
  }
  return result;
}

/**
 * Firestore Timestamps are recognised structurally (by their `toMillis()`) rather than with
 * `instanceof`, so this package can stay dependency-free and be shared by both apps.
 */
function toMillis(value: unknown): number | undefined {
  if (value && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  return typeof value === 'number' ? value : undefined;
}

/** Converts a Firestore document into a Card, normalising its server timestamps to millis. */
export function cardFromFirestore(id: string, data: Record<string, unknown>): Card {
  const createdAt = toMillis(data.createdAt) ?? Date.now();
  const updatedAt = toMillis(data.updatedAt) ?? createdAt;
  return { ...data, id, createdAt, updatedAt } as Card;
}

/**
 * Firebase deliberately refuses to reveal whether an address has an account: with email
 * enumeration protection on, a reset request for an unknown address resolves exactly as a real
 * one does. Both apps therefore say the same thing either way, and only report a failure when it
 * is about the address the user typed or about reaching Firebase at all — anything else
 * (`auth/user-not-found` above all) has to stay indistinguishable from success.
 */
export const PASSWORD_RESET_SENT =
  'If that address has an account, a reset link is on its way. Check your inbox.';

export const PASSWORD_RESET_NEEDS_EMAIL =
  'Enter your email address first, then use Forgot password.';

/** The message to show for a failed reset, or `null` when it should read as sent. */
export function passwordResetError(error: unknown): string | null {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
  switch (code) {
    case 'auth/invalid-email':
    case 'auth/missing-email':
      return "That doesn't look like a valid email address.";
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a minute, then try again.';
    case 'auth/network-request-failed':
      return 'Could not reach the server. Check your connection and try again.';
    default:
      return null;
  }
}

export type CardSort = 'recent' | 'firstName' | 'lastName' | 'company';

export const CARD_SORT_OPTIONS: { value: CardSort; label: string }[] = [
  { value: 'recent', label: 'Recently added' },
  { value: 'firstName', label: 'First name' },
  { value: 'lastName', label: 'Last name' },
  { value: 'company', label: 'Company' },
];

/**
 * Compares two optional text fields for sorting.
 *
 * Blank sorts last in every case: a card with no company belongs at the bottom of a
 * company-ordered list, not the top, and `''` would otherwise win every comparison.
 * `sensitivity: 'base'` puts "acme" and "Acme" together rather than in separate case runs, and
 * localeCompare (not `<`) is what orders accented and non-Latin names the way a reader expects
 * — `'Ø' < 'A'` is true by code point and wrong by every other measure.
 */
function compareText(a: string | undefined, b: string | undefined): number {
  const left = (a ?? '').trim();
  const right = (b ?? '').trim();
  if (!left || !right) return left ? -1 : right ? 1 : 0;
  return left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true });
}

/**
 * The fields each sort compares, in order. The trailing entries are tie-breakers: two people
 * with the same first name order by surname rather than by whatever order Firestore happened to
 * return them in, which would otherwise shuffle on every snapshot.
 */
const SORT_FIELDS: Record<Exclude<CardSort, 'recent'>, (card: Card) => (string | undefined)[]> = {
  firstName: (card) => [card.firstName, card.lastName, card.company],
  lastName: (card) => [card.lastName, card.firstName, card.company],
  company: (card) => [card.company, card.lastName, card.firstName],
};

/** Sorts a card list. `recent` is returned untouched — the Firestore query already orders by createdAt desc. */
export function sortCards(cards: Card[], sort: CardSort): Card[] {
  if (sort === 'recent') return cards;
  const fieldsOf = SORT_FIELDS[sort];
  return [...cards].sort((a, b) => {
    const left = fieldsOf(a);
    const right = fieldsOf(b);
    for (let i = 0; i < left.length; i++) {
      const result = compareText(left[i], right[i]);
      if (result !== 0) return result;
    }
    // Everything compared equal, so fall back to the default order rather than leaving it to
    // sort stability across two different engines.
    return b.createdAt - a.createdAt;
  });
}

export { cardToVCard, cardsToVCard, parseVCards } from './vcard';
