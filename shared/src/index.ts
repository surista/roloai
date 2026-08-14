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
