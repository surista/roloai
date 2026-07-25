import type { CardDraft } from '@roloai/shared';

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
