import type { Card } from './index';

/** The owner's own card, if one is set. */
export function myCardOf(cards: Card[]): Card | undefined {
  return cards.find((card) => card.isMine);
}

/** The library as shown in lists and searches: your own card is not one of the people you know. */
export function withoutMine(cards: Card[]): Card[] {
  return cards.filter((card) => !card.isMine);
}

/**
 * A file name for one side of a card's photo, e.g. `Ann-Lee-front.jpg`. Strips what file systems
 * and share targets dislike, and keeps non-Latin names (入江要-front.jpg) intact.
 */
export function cardImageFileName(card: Pick<Card, 'firstName' | 'lastName'>, side: 'front' | 'back'): string {
  const name = `${card.firstName} ${card.lastName}`
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return `${name || 'card'}-${side}.jpg`;
}
