/**
 * Deciding which CamCard rows are the same person.
 *
 * Split out from import.mjs so the policy can be inspected on the export alone, before anything
 * is written to Firestore.
 */

import { identityKeys, isJapanese, scriptOf, sharedAddresses } from '../../shared/src/dedupe.ts';

// The identity policy (what counts as the same person) lives in shared/, where the apps use it
// too; this file only decides which of a group of duplicates to keep.
export { identityKeys, isJapanese, sharedAddresses };

/**
 * Groups cards that share any identity key.
 *
 * Union-find rather than a plain map: a card carrying two email addresses links two groups that
 * would otherwise look unrelated, and both have to end up in one bucket for "newest wins" to
 * mean anything.
 */
function groupByIdentity(cards, shared) {
  const parent = new Map();
  const find = (key) => {
    while (parent.get(key) !== key) {
      parent.set(key, parent.get(parent.get(key)));
      key = parent.get(key);
    }
    return key;
  };

  for (const card of cards) {
    const keys = identityKeys(card, shared);
    for (const key of keys) if (!parent.has(key)) parent.set(key, key);
    const [first, ...rest] = keys;
    for (const key of rest) parent.set(find(first), find(key));
  }

  const groups = new Map();
  const alone = [];
  for (const card of cards) {
    const [key] = identityKeys(card, shared);
    if (!key) {
      alone.push([card]);
      continue;
    }
    const root = find(key);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(card);
  }
  return [...groups.values(), ...alone];
}

/**
 * Keeps the newest card per person, and per language within that person.
 *
 * Returns the survivors, what was dropped and in favour of what, and the shared addresses it
 * decided to ignore — the caller needs the same set to compare against the existing library.
 */
export function dedupe(cards) {
  const shared = sharedAddresses(cards);
  const keep = [];
  const drop = [];
  for (const group of groupByIdentity(cards, shared)) {
    const byScript = new Map();
    for (const card of group) {
      const script = scriptOf(card);
      const best = byScript.get(script);
      if (!best || (card.createdAt ?? 0) > (best.createdAt ?? 0)) {
        if (best) drop.push({ card: best, insteadOf: card });
        byScript.set(script, card);
      } else {
        drop.push({ card, insteadOf: best });
      }
    }
    keep.push(...byScript.values());
  }
  keep.sort((a, b) => a.row - b.row);
  return { keep, drop, shared };
}
