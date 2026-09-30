import type { Card, CardDraft } from './index';

/**
 * Deciding which cards are the same person. Shared by both apps (duplicate warning on save) and
 * the CamCard import scripts, which run this file directly under Node — so it imports only types
 * and uses no syntax that needs a compile step.
 */

/** The fields identity is judged on; both a saved Card and a draft satisfy it. */
export interface Identifiable {
  firstName?: string;
  lastName?: string;
  company?: string;
  emails?: { address: string }[];
}

/** Company switchboard addresses, which identify an employer rather than a person. */
const ROLE_ADDRESS = /^(info|support|sales|contact|office|admin|inquiry|enquiries|help|mail)@/i;

/**
 * True when the text contains Japanese script.
 *
 * A person's English card and their Japanese card share an email address but are two different
 * physical cards, each with its own photo, so they are not duplicates of one another.
 */
export function isJapanese(text: string | undefined): boolean {
  return /[぀-ヿ㐀-䶿一-鿿]/.test(text ?? '');
}

const normalize = (text: string): string => text.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * A comparable form of a card's name, or '' when it has none.
 *
 * Word order is ignored for Latin names ('Kaname Irie' and 'Irie Kaname' are one person, and
 * OCR does not settle on an order), and spacing for Japanese ones ('山田 太郎' and '山田太郎').
 */
export function nameKey(card: Identifiable): string {
  const name = normalize(`${card.firstName ?? ''} ${card.lastName ?? ''}`);
  if (isJapanese(name)) return name.replace(/\s+/g, '');
  return name.split(' ').filter(Boolean).sort().join(' ');
}

/** 'ja' or 'latin', by the script the card's name is written in. */
export function scriptOf(card: Identifiable): 'ja' | 'latin' {
  return isJapanese(`${card.firstName ?? ''}${card.lastName ?? ''}`) ? 'ja' : 'latin';
}

/**
 * Addresses that appear on cards belonging to demonstrably different people.
 *
 * Four employees may print `support@company.com` on their cards alongside their own address.
 * Treating every address as identifying would merge all four into one person, so an address is
 * only an identity if the cards carrying it agree on whose it is. Names are compared per script
 * (a person's Japanese and English cards differ on purpose), and blank names abstain.
 */
export function sharedAddresses(cards: Identifiable[]): Set<string> {
  const names = new Map<string, { ja: Set<string>; latin: Set<string> }>();
  for (const card of cards) {
    const name = nameKey(card);
    const script = scriptOf(card);
    for (const { address } of card.emails ?? []) {
      const key = normalize(address);
      if (!names.has(key)) names.set(key, { ja: new Set(), latin: new Set() });
      if (name) names.get(key)![script].add(name);
    }
  }
  const shared = new Set<string>();
  for (const [address, byScript] of names) {
    if (byScript.ja.size > 1 || byScript.latin.size > 1 || ROLE_ADDRESS.test(address)) {
      shared.add(address);
    }
  }
  return shared;
}

/**
 * The keys a card can collide on: the email addresses that identify it personally, or — when it
 * has none the caller can vouch for — its name and company. A card with no name has no key: it
 * is not the same person as another nameless card at the same company.
 */
export function identityKeys(card: Identifiable, shared: Set<string> = new Set()): string[] {
  const emails = (card.emails ?? [])
    .map((e) => normalize(e.address))
    .filter((address) => address && !shared.has(address));
  if (emails.length) return emails.map((address) => `email:${address}`);
  const name = nameKey(card);
  if (!name) return [];
  return [`name:${name} ${normalize(card.company ?? '')}`.trim()];
}

export interface DuplicateMatch {
  card: Card;
  /** The key both cards collided on, e.g. `email:a@b.com`. */
  key: string;
}

/**
 * Saved cards that look like the same person as `draft`.
 *
 * A card in the other script (Japanese vs English) is never a duplicate — those are two real
 * cards — and `ignoreId` lets an edit skip the card being edited.
 */
export function findDuplicates(
  draft: Identifiable | CardDraft,
  cards: Card[],
  ignoreId?: string
): DuplicateMatch[] {
  // From the saved cards alone: the draft's name is OCR and may be spelled a little differently,
  // which must not stop its email from matching the card it duplicates.
  const shared = sharedAddresses(cards);
  const mine = identityKeys(draft, shared);
  if (!mine.length) return [];
  const script = scriptOf(draft);
  const matches: DuplicateMatch[] = [];
  for (const card of cards) {
    if (card.id === ignoreId || scriptOf(card) !== script) continue;
    const key = identityKeys(card, shared).find((k) => mine.includes(k));
    if (key) matches.push({ card, key });
  }
  return matches;
}
