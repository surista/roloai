import type { Card } from './index';

/**
 * Lower-cases and strips accents and width variants, so "José" matches "jose" and full-width
 * "ＡＣＭＥ" matches "acme". NFKC also folds half-width katakana to full-width.
 */
export function foldText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .normalize('NFKC')
    .toLowerCase();
}

/** Everything about a card the search box should be able to find, folded once. */
function haystack(card: Card): string {
  return foldText(
    [
      card.firstName,
      card.lastName,
      `${card.firstName} ${card.lastName}`,
      card.company,
      card.jobTitle,
      card.address,
      card.website,
      card.notes,
      card.rawOcrText,
      ...card.tags,
      ...card.emails.map((e) => e.address),
      // Digits only as well, so "5551234" finds "(555) 123-4".
      ...card.phones.flatMap((p) => [p.number, p.number.replace(/\D/g, '')]),
    ]
      .filter(Boolean)
      .join('\n')
  );
}

/** Every whitespace-separated word must appear somewhere on the card (in any field). */
export function matchesSearch(card: Card, query: string): boolean {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = haystack(card);
  return words.every((word) => text.includes(word));
}

export interface CardFilter {
  search?: string;
  tag?: string;
  company?: string;
}

export function filterCards(cards: Card[], filter: CardFilter): Card[] {
  const company = filter.company ? foldText(filter.company.trim()) : '';
  return cards.filter((card) => {
    if (filter.tag && !card.tags.includes(filter.tag)) return false;
    if (company && foldText((card.company ?? '').trim()) !== company) return false;
    return matchesSearch(card, filter.search ?? '');
  });
}

/** Distinct tags across the library, alphabetical. */
export function allTags(cards: Card[]): string[] {
  return [...new Set(cards.flatMap((card) => card.tags))].sort((a, b) => a.localeCompare(b));
}

/** Distinct companies with how many cards each has, most cards first. */
export function companyCounts(cards: Card[]): { company: string; count: number }[] {
  const counts = new Map<string, { company: string; count: number }>();
  for (const card of cards) {
    const company = (card.company ?? '').trim();
    if (!company) continue;
    const key = foldText(company);
    const entry = counts.get(key) ?? { company, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.company.localeCompare(b.company)
  );
}
