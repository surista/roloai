import type { Card } from './index';

let next = 0;

/** A saved card with sensible blanks, for tests. */
export function card(overrides: Partial<Card> = {}): Card {
  next += 1;
  return {
    id: `c${next}`,
    firstName: '',
    lastName: '',
    phones: [],
    emails: [],
    tags: [],
    imageUrl: '',
    source: 'scan',
    createdAt: 1_000 * next,
    updatedAt: 1_000 * next,
    ...overrides,
  };
}
