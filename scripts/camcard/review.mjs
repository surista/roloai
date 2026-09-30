/**
 * Which imported cards look misread, and what to write when Claude has read them again.
 *
 * Pure functions, kept apart from reextract.mjs so the policy can be exercised against the
 * exported cards.json without signing in or spending a Claude call.
 */

import { isJapanese } from './util.mjs';

const PLAUSIBLE_EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
/** Letters mid-word that a real name or address would not mix — `RrggrpsebaTgil`, `9XAQIH`. */
const OCR_NOISE = /[a-z]{2}[A-Z]{2}|[A-Z]{2}[a-z]{2}[A-Z]|[\\|@)(]{2,}|[a-zA-Z][0-9][a-zA-Z]{2}/;

const digitsOf = (number) => number.replace(/\D/g, '');
const plausiblePhone = (number) => {
  const digits = digitsOf(number).length;
  return digits >= 7 && digits <= 15;
};

/**
 * Claude's entries plus the card's own that it did not repeat, or undefined when that adds
 * nothing new.
 *
 * Claude reads the front of the card; CamCard may also have numbers entered by hand or read
 * from the back, so replacing the list would lose them. Entries are matched by number or
 * address rather than position or label — CamCard's mobile/work/fax layout never lines up with
 * Claude's — and an existing entry that fails the plausibility test is what Claude is there to
 * replace, so it is not carried over.
 */
function mergeEntries(existing, extracted, keyOf, plausible) {
  if (!extracted.length) return undefined;
  const seen = new Set(extracted.map(keyOf));
  const kept = existing.filter((entry) => plausible(entry) && !seen.has(keyOf(entry)));
  const merged = [...extracted, ...kept];
  const before = new Set(existing.map(keyOf));
  const after = new Set(merged.map(keyOf));
  const same = before.size === after.size && [...before].every((key) => after.has(key));
  return same ? undefined : merged;
}

/**
 * Why this card looks misread, or an empty list if it looks fine.
 *
 * Deliberately conservative: a card flagged here costs one Claude call and a review line, while
 * a garbled card left unflagged stays wrong forever. Japanese text is exempt from the noise
 * test, which only describes what mangled Latin script looks like.
 */
export function suspicions(card) {
  const reasons = [];
  const name = `${card.firstName ?? ''} ${card.lastName ?? ''}`.trim();
  if (!name) reasons.push('no name');

  for (const { address } of card.emails ?? []) {
    if (!PLAUSIBLE_EMAIL.test(address)) reasons.push(`bad email "${address}"`);
  }
  for (const { number } of card.phones ?? []) {
    if (!plausiblePhone(number)) reasons.push(`odd phone "${number}"`);
  }

  const latin = (text) => text && !isJapanese(text);
  if (latin(card.address) && OCR_NOISE.test(card.address)) reasons.push('garbled address');
  if (latin(name) && OCR_NOISE.test(name)) reasons.push('garbled name');
  if (card.website && /\s/.test(card.website.trim())) reasons.push(`odd website "${card.website}"`);

  return reasons;
}

const clean = (value) => (typeof value === 'string' ? value.trim() : value);

/**
 * What to write for one card, given what Claude read.
 *
 * Claude read the actual photo, so it wins every text field it has an answer for — but only then.
 * Phones and emails are merged rather than replaced (see mergeEntries).
 * An empty result means "not visible on this card", which is no reason to erase a value CamCard
 * did record. Notes are the exception: they hold the Company2/Department block the import put
 * there, which is real data from the export and not on the photo at all, so anything Claude
 * says is appended rather than substituted.
 */
export function merge(card, extraction) {
  const changes = {};
  const scalars = ['firstName', 'lastName', 'jobTitle', 'company', 'website', 'address'];
  for (const field of scalars) {
    const next = clean(extraction[field]);
    if (next && next !== card[field]) changes[field] = next;
  }
  const phones = mergeEntries(
    card.phones ?? [],
    extraction.phones ?? [],
    (p) => digitsOf(p.number),
    (p) => plausiblePhone(p.number)
  );
  if (phones) changes.phones = phones;
  const emails = mergeEntries(
    card.emails ?? [],
    extraction.emails ?? [],
    (e) => e.address.trim().toLowerCase(),
    (e) => PLAUSIBLE_EMAIL.test(e.address)
  );
  if (emails) changes.emails = emails;

  const extractedNotes = clean(extraction.notes);
  const existingNotes = clean(card.notes) ?? '';
  if (extractedNotes && !existingNotes.includes(extractedNotes)) {
    changes.notes = existingNotes ? `${existingNotes}\n${extractedNotes}` : extractedNotes;
  }

  // The full transcription the import had no source for. Worth keeping even when nothing else
  // changed: it is what the search box matches on for anything not in a structured field.
  if (extraction.rawText && extraction.rawText !== card.rawOcrText) {
    changes.rawOcrText = extraction.rawText;
  }

  // Tags stay as they are. Claude proposes its own ("finance", "consulting"), and a migration
  // is the wrong moment to grow a taxonomy across 400 cards without being asked.
  return changes;
}

