import type { Card, CardDraft } from './index';

/**
 * vCard 3.0 serialisation and parsing.
 *
 * 3.0 rather than 4.0 because it is what Apple Contacts, Google Contacts, and CamCard itself all
 * read without complaint — 4.0 support is patchier in exactly the places an export is likely to
 * be taken. The format is line-oriented but not line-safe: values carry escapes, long lines are
 * folded, and a parser that splits on newlines alone silently truncates addresses and notes.
 */

const CRLF = '\r\n';

/** `;` `,` `\` and newlines are structural in a value and have to be escaped. RFC 6350 §3.4. */
function escapeValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function unescapeValue(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== '\\') {
      out += value[i];
      continue;
    }
    const next = value[++i];
    if (next === undefined) break;
    out += next === 'n' || next === 'N' ? '\n' : next;
  }
  return out;
}

/**
 * Splits on unescaped separators only, so `Acme\, Inc.` stays one field.
 *
 * A plain `split(sep)` is the single most common way to mangle a vCard: it cuts company names,
 * street addresses, and notes at the first comma the writer deliberately escaped.
 */
function splitUnescaped(value: string, separator: ',' | ';'): string[] {
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\') {
      current += value[i] + (value[++i] ?? '');
      continue;
    }
    if (value[i] === separator) {
      parts.push(current);
      current = '';
      continue;
    }
    current += value[i];
  }
  parts.push(current);
  return parts;
}

/** Lines must not exceed 75 octets; continuations start with a single space. RFC 6350 §3.2. */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) chunks.push(line.slice(i, i + 74));
  return chunks.join(`${CRLF} `);
}

function emit(lines: string[], name: string, value: string | undefined) {
  if (!value) return;
  lines.push(foldLine(`${name}:${escapeValue(value)}`));
}

/**
 * The label a card carries ("mobile", "fax", "direct") becomes the TYPE parameter. Only a fixed
 * vocabulary is meaningful to consumers, so anything else falls back to a bare property rather
 * than emitting a TYPE that Contacts would show verbatim as a junk label.
 */
const KNOWN_TYPES = new Set(['work', 'home', 'cell', 'mobile', 'fax', 'pager', 'main', 'other']);

function typeParam(label: string): string {
  const normalised = label.trim().toLowerCase();
  if (!KNOWN_TYPES.has(normalised)) return '';
  // "mobile" is what the app calls it; CELL is what the format calls it.
  return `;TYPE=${normalised === 'mobile' ? 'cell' : normalised}`;
}

export function cardToVCard(card: Card): string {
  const lines: string[] = ['BEGIN:VCARD', 'VERSION:3.0'];

  const full = [card.firstName, card.lastName].filter(Boolean).join(' ');
  lines.push(
    foldLine(`N:${escapeValue(card.lastName)};${escapeValue(card.firstName)};;;`)
  );
  emit(lines, 'FN', full || card.company || 'Unnamed');
  emit(lines, 'ORG', card.company);
  emit(lines, 'TITLE', card.jobTitle);

  for (const phone of card.phones) {
    if (phone.number) {
      lines.push(foldLine(`TEL${typeParam(phone.label)}:${escapeValue(phone.number)}`));
    }
  }
  for (const email of card.emails) {
    if (email.address) {
      lines.push(foldLine(`EMAIL${typeParam(email.label)}:${escapeValue(email.address)}`));
    }
  }

  emit(lines, 'URL', card.website);
  // ADR is seven semicolon-separated components; the app keeps the address as one blob, so it
  // goes in the street slot rather than being guessed apart into fields that would be wrong.
  if (card.address) {
    lines.push(foldLine(`ADR;TYPE=work:;;${escapeValue(card.address)};;;;`));
  }
  emit(lines, 'NOTE', card.notes);
  if (card.tags.length) {
    lines.push(foldLine(`CATEGORIES:${card.tags.map(escapeValue).join(',')}`));
  }
  // A URI photo rather than an inline one: the export carries links, and a base64 PHOTO would
  // multiply the file size by the whole card library.
  if (card.imageUrl) lines.push(foldLine(`PHOTO;VALUE=URI:${card.imageUrl}`));

  lines.push('END:VCARD');
  return lines.join(CRLF) + CRLF;
}

export function cardsToVCard(cards: Card[]): string {
  return cards.map(cardToVCard).join('');
}

interface ParsedLine {
  name: string;
  params: string[];
  value: string;
}

/** Undoes RFC 6350 line folding, then splits each line into name, parameters, and value. */
function parseLines(text: string): ParsedLine[] {
  const unfolded = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const parsed: ParsedLine[] = [];
  for (const raw of unfolded.split(/\r\n|\n|\r/)) {
    const line = raw.trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const [name, ...params] = line.slice(0, colon).split(';');
    parsed.push({
      name: name.toUpperCase(),
      params: params.map((p) => p.toUpperCase()),
      value: line.slice(colon + 1),
    });
  }
  return parsed;
}

/** The app-side label for a property, read back out of its TYPE parameter. */
function labelFrom(params: string[], fallback: string): string {
  for (const param of params) {
    const value = param.startsWith('TYPE=') ? param.slice(5) : param;
    // TYPE is comma-separated when a property carries more than one, e.g. TYPE=CELL,VOICE.
    for (const part of value.split(',')) {
      const lower = part.toLowerCase();
      if (lower === 'cell') return 'mobile';
      if (KNOWN_TYPES.has(lower)) return lower;
    }
  }
  return fallback;
}

/**
 * Parses a .vcf file into drafts, one per VCARD block.
 *
 * Anything the format carries that the app has no field for is dropped rather than guessed at.
 * A block with no name at all is skipped: it would import as a blank row that is hard to find
 * and harder to explain.
 */
export function parseVCards(text: string): CardDraft[] {
  const drafts: CardDraft[] = [];
  let current: CardDraft | null = null;

  for (const { name, params, value } of parseLines(text)) {
    if (name === 'BEGIN') {
      current = {
        firstName: '',
        lastName: '',
        phones: [],
        emails: [],
        tags: [],
        imageUrl: '',
        source: 'manual',
      };
      continue;
    }
    if (!current) continue;
    if (name === 'END') {
      if (current.firstName || current.lastName || current.company) drafts.push(current);
      current = null;
      continue;
    }

    switch (name) {
      case 'N': {
        const [last, first] = splitUnescaped(value, ';').map(unescapeValue);
        current.lastName = last?.trim() ?? '';
        current.firstName = first?.trim() ?? '';
        break;
      }
      case 'FN': {
        // Only as a fallback: N is structured, FN is a display string, and splitting a display
        // string on whitespace gets "van der Berg" wrong.
        if (!current.firstName && !current.lastName) {
          const parts = unescapeValue(value).trim().split(/\s+/);
          current.firstName = parts.shift() ?? '';
          current.lastName = parts.join(' ');
        }
        break;
      }
      case 'ORG':
        // ORG is company;department;… — the app has one field, so keep the company.
        current.company = unescapeValue(splitUnescaped(value, ';')[0]).trim() || undefined;
        break;
      case 'TITLE':
        current.jobTitle = unescapeValue(value).trim() || undefined;
        break;
      case 'TEL':
        current.phones.push({ label: labelFrom(params, 'work'), number: unescapeValue(value).trim() });
        break;
      case 'EMAIL':
        current.emails.push({
          label: labelFrom(params, 'work'),
          address: unescapeValue(value).trim(),
        });
        break;
      case 'URL':
        current.website = unescapeValue(value).trim() || undefined;
        break;
      case 'ADR': {
        // Reassemble the seven components into the single blob the app keeps, dropping the empty
        // slots so a street-only address does not import as ", , , ,".
        const joined = splitUnescaped(value, ';')
          .map((part) => unescapeValue(part).trim())
          .filter(Boolean)
          .join(', ');
        if (joined) current.address = joined;
        break;
      }
      case 'NOTE':
        current.notes = unescapeValue(value).trim() || undefined;
        break;
      case 'CATEGORIES':
        current.tags = splitUnescaped(value, ',')
          .map((tag) => unescapeValue(tag).trim())
          .filter(Boolean);
        break;
      case 'PHOTO':
        // Only a URI is usable as-is; an inline base64 photo has nowhere to go without uploading
        // it to Storage, which import deliberately does not do.
        if (/^https?:\/\//i.test(value)) current.imageUrl = value.trim();
        break;
    }
  }

  return drafts;
}
