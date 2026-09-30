import type { CardDraft } from './index';

/**
 * Combines what Claude read off the front of a card with what it read off the back.
 *
 * Front and back are read separately (so the front can be read while the user scans the back),
 * and this stands in for the single two-image call. Front wins every single-value field; where
 * the back says something different for a field the front already has — the Japanese side of a
 * bilingual card — it goes to notes rather than being lost. Phones, emails and tags are unions.
 */
export function mergeFrontBack(front: CardDraft, back: CardDraft): CardDraft {
  const scalars = ['firstName', 'lastName', 'jobTitle', 'company', 'website', 'address'] as const;
  const merged: CardDraft = { ...front };
  const extra: string[] = [];

  for (const key of scalars) {
    const a = front[key]?.trim();
    const b = back[key]?.trim();
    if (!a && b) merged[key] = b;
    else if (a && b && a.toLowerCase() !== b.toLowerCase() && key !== 'website') {
      extra.push(`Back — ${key}: ${b}`);
    }
  }

  const seenPhones = new Set(front.phones.map((p) => p.number.replace(/\D/g, '')));
  merged.phones = [
    ...front.phones,
    ...back.phones.filter((p) => !seenPhones.has(p.number.replace(/\D/g, ''))),
  ];
  const seenEmails = new Set(front.emails.map((e) => e.address.toLowerCase()));
  merged.emails = [
    ...front.emails,
    ...back.emails.filter((e) => !seenEmails.has(e.address.toLowerCase())),
  ];
  merged.tags = [...new Set([...front.tags, ...back.tags])];

  const notes = [front.notes, back.notes, ...extra].filter(Boolean).join('\n');
  merged.notes = notes || undefined;
  merged.rawOcrText = [front.rawOcrText, back.rawOcrText].filter(Boolean).join('\n\n') || undefined;
  return merged;
}
