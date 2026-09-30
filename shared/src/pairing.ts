import type { Card } from './index';
import { scriptOf, sharedAddresses } from './dedupe';

/**
 * Linking a person's Japanese card to their English one.
 *
 * The link is stored as `pairedWith` on both cards. A pair only counts when each card points at
 * the other — if one side is deleted or re-paired, the survivor reads as unpaired instead of
 * pointing at a stranger.
 */

const digits = (number: string): string => number.replace(/\D/g, '');

/** The card `card` is validly paired with, if any. */
export function partnerOf(card: Card, byId: Map<string, Card>): Card | undefined {
  if (!card.pairedWith) return undefined;
  const partner = byId.get(card.pairedWith);
  return partner && partner.pairedWith === card.id ? partner : undefined;
}

/**
 * Cards in the other script that look like the same person: they share a personal email
 * address (role addresses and addresses several people print don't count) or a phone number.
 * Cards that already have a partner are left out.
 */
export function pairCandidates(card: Card, cards: Card[]): Card[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  if (partnerOf(card, byId)) return [];
  const shared = sharedAddresses(cards);
  const script = scriptOf(card);
  const emails = new Set(
    card.emails.map((e) => e.address.trim().toLowerCase()).filter((a) => a && !shared.has(a))
  );
  const phones = new Set(card.phones.map((p) => digits(p.number)).filter((d) => d.length >= 7));

  return cards.filter((other) => {
    if (other.id === card.id || scriptOf(other) === script || partnerOf(other, byId)) return false;
    return (
      other.emails.some((e) => emails.has(e.address.trim().toLowerCase())) ||
      other.phones.some((p) => phones.has(digits(p.number)))
    );
  });
}

export interface ListEntry {
  card: Card;
  /** The paired card, shown together with `card` instead of as its own row. */
  partner?: Card;
}

/**
 * Collapses each valid pair into one entry, at the position of whichever half comes first in
 * `cards` (so the list order the caller sorted by is kept).
 */
export function groupPairs(cards: Card[]): ListEntry[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const placed = new Set<string>();
  const entries: ListEntry[] = [];
  for (const card of cards) {
    if (placed.has(card.id)) continue;
    const partner = partnerOf(card, byId);
    placed.add(card.id);
    if (partner) placed.add(partner.id);
    entries.push({ card, partner });
  }
  return entries;
}
