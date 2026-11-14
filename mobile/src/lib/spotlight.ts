import { useEffect, useRef } from 'react';
import { displayName } from '@roloai/shared';
import CardScanner from '../../modules/card-scanner';
import { useCards } from './CardsContext';

/**
 * Keeps the system Spotlight index in step with the library, so searching the Home Screen for a
 * name or company finds the card, and tapping the result opens it here.
 */
export function useSpotlightIndex(onOpenCard: (cardId: string) => void): void {
  const { all, loaded, error } = useCards();
  const open = useRef(onOpenCard);
  open.current = onOpenCard;

  // Re-indexed a moment after the library settles: a restore or import lands as many snapshots
  // in quick succession, and each full re-index is not free.
  useEffect(() => {
    if (!loaded || error) return;
    const timer = setTimeout(() => {
      CardScanner.indexCards(
        all.map((card) => ({
          id: card.id,
          title: displayName(card),
          subtitle: [card.jobTitle, card.company].filter(Boolean).join(' · ') || undefined,
          keywords: [card.company, card.event, ...card.tags, ...card.emails.map((e) => e.address)]
            .filter(Boolean)
            .join('\n'),
        }))
      ).catch((e) => console.warn('Spotlight indexing failed:', e));
    }, 2_000);
    return () => clearTimeout(timer);
  }, [all, loaded, error]);

  useEffect(() => {
    const pending = CardScanner.takePendingCardId();
    if (pending) open.current(pending);
    const sub = CardScanner.addListener('onOpenCard', ({ id }) => open.current(id));
    return () => sub.remove();
  }, []);
}

export function removeFromSpotlight(cardId: string): void {
  CardScanner.removeFromSpotlight([cardId]).catch(() => {});
}

/** On sign-out: another account's cards must not stay searchable on this phone. */
export function clearSpotlight(): Promise<void> {
  return CardScanner.clearSpotlight().catch(() => {});
}
