import type { CardDraft } from '@roloai/shared';

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const URL_RE = /(https?:\/\/)?(www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\/\S*)?/;
const PHONE_RE = /(\+?\d[\d().\-\s]{6,}\d)/;

function emptyDraft(source: CardDraft['source']): CardDraft {
  return {
    firstName: '',
    lastName: '',
    jobTitle: undefined,
    company: undefined,
    phones: [],
    emails: [],
    website: undefined,
    address: undefined,
    notes: undefined,
    tags: [],
    imageUrl: '',
    source,
    rawOcrText: undefined,
  };
}

/**
 * Best-effort heuristic parse of raw OCR text into card fields. The user always
 * reviews/corrects the result on the Review & Edit screen, so this only needs
 * to save typing in the common case, not be perfect.
 */
export function parseOcrText(rawText: string): CardDraft {
  const draft = emptyDraft('scan');
  draft.rawOcrText = rawText;

  const lines = rawText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const leftoverLines: string[] = [];

  for (const line of lines) {
    const emailMatch = line.match(EMAIL_RE);
    if (emailMatch) {
      draft.emails.push({ label: 'work', address: emailMatch[0] });
      continue;
    }

    const phoneMatch = line.match(PHONE_RE);
    if (phoneMatch && phoneMatch[0].replace(/\D/g, '').length >= 7) {
      draft.phones.push({ label: 'work', number: phoneMatch[0].trim() });
      continue;
    }

    // Only treat as a URL if it's not just leftover text that happens to contain a dot.
    if (URL_RE.test(line) && /\.(com|org|net|io|co|ai|dev)\b/i.test(line)) {
      draft.website = line.replace(/^https?:\/\//, '');
      continue;
    }

    leftoverLines.push(line);
  }

  // First remaining line is usually the name, second is often title or company.
  if (leftoverLines[0]) {
    const parts = leftoverLines[0].split(/\s+/);
    draft.firstName = parts[0] ?? '';
    draft.lastName = parts.slice(1).join(' ');
  }
  if (leftoverLines[1]) {
    draft.jobTitle = leftoverLines[1];
  }
  if (leftoverLines[2]) {
    draft.company = leftoverLines[2];
  }
  if (leftoverLines.length > 3) {
    draft.address = leftoverLines.slice(3).join(', ');
  }

  return draft;
}

/** Parses vCard (VCARD:) or MECARD: payloads commonly encoded in business-card QR codes. */
export function parseQrPayload(data: string): CardDraft {
  const draft = emptyDraft('qr');
  draft.rawOcrText = data;

  if (data.startsWith('BEGIN:VCARD')) {
    return { ...draft, ...parseVCard(data) };
  }
  if (data.startsWith('MECARD:')) {
    return { ...draft, ...parseMeCard(data) };
  }

  // Unknown QR format — fall back to treating the raw payload as notes so nothing is lost.
  draft.notes = data;
  return draft;
}

function parseVCard(data: string): Partial<CardDraft> {
  const result: Partial<CardDraft> = { phones: [], emails: [] };
  const lines = data.split(/\r?\n/);

  for (const line of lines) {
    const [rawKey, ...rest] = line.split(':');
    const value = rest.join(':').trim();
    if (!value) continue;
    const key = rawKey.split(';')[0].toUpperCase();

    switch (key) {
      case 'N': {
        const [lastName, firstName] = value.split(';');
        result.firstName = firstName?.trim() || '';
        result.lastName = lastName?.trim() || '';
        break;
      }
      case 'FN':
        if (!result.firstName && !result.lastName) {
          const parts = value.split(/\s+/);
          result.firstName = parts[0] ?? '';
          result.lastName = parts.slice(1).join(' ');
        }
        break;
      case 'TITLE':
        result.jobTitle = value;
        break;
      case 'ORG':
        result.company = value.split(';')[0];
        break;
      case 'TEL':
        result.phones!.push({ label: 'work', number: value });
        break;
      case 'EMAIL':
        result.emails!.push({ label: 'work', address: value });
        break;
      case 'URL':
        result.website = value;
        break;
      case 'ADR': {
        const addr = value.split(';').filter(Boolean).join(', ');
        if (addr) result.address = addr;
        break;
      }
      default:
        break;
    }
  }

  return result;
}

function parseMeCard(data: string): Partial<CardDraft> {
  const result: Partial<CardDraft> = { phones: [], emails: [] };
  const body = data.replace(/^MECARD:/, '').replace(/;$/, '');
  const fields = body.split(';');

  for (const field of fields) {
    const [rawKey, ...rest] = field.split(':');
    const value = rest.join(':').trim();
    if (!value) continue;
    const key = rawKey.toUpperCase();

    switch (key) {
      case 'N': {
        const parts = value.split(',');
        result.lastName = parts[0]?.trim() || '';
        result.firstName = parts[1]?.trim() || '';
        break;
      }
      case 'ORG':
        result.company = value;
        break;
      case 'TEL':
        result.phones!.push({ label: 'work', number: value });
        break;
      case 'EMAIL':
        result.emails!.push({ label: 'work', address: value });
        break;
      case 'URL':
        result.website = value;
        break;
      case 'ADR':
        result.address = value;
        break;
      case 'NOTE':
        result.notes = value;
        break;
      default:
        break;
    }
  }

  return result;
}
