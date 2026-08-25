import { parseVCards, type CardDraft } from '@roloai/shared';

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
    // Delegates to the shared RFC 6350 parser (used for .vcf import too) rather than a second,
    // simpler implementation here — that one unescapes values and splits multi-valued TYPE
    // params correctly, which a from-scratch parser is easy to get subtly wrong.
    const [parsed] = parseVCards(data);
    return parsed ? { ...draft, ...parsed, source: 'qr' } : draft;
  }
  if (data.startsWith('MECARD:')) {
    return { ...draft, ...parseMeCard(data) };
  }

  // Unknown QR format — fall back to treating the raw payload as notes so nothing is lost.
  draft.notes = data;
  return draft;
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
