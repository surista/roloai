import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { withoutMine, myCardOf, type Card } from '@roloai/shared';
import { subscribeToCards } from './cards';

interface CardsValue {
  /** Every card, including the owner's own. */
  all: Card[];
  /** The library as shown in lists: everything except the owner's own card. */
  cards: Card[];
  myCard: Card | undefined;
  /** False until the first snapshot arrives, so "no cards" can be told from "not loaded yet". */
  loaded: boolean;
}

const CardsContext = createContext<CardsValue | undefined>(undefined);

/**
 * The one live subscription to the library, shared by every screen.
 *
 * Each screen used to open its own listener, so opening a card re-downloaded and re-processed the
 * whole library (the detail screen only wanted to look for a pairing partner). Firestore keeps no
 * cache here once a listener closes, so each of those was a full round trip. One listener for the
 * life of the signed-in session means a card opens from memory.
 */
export function CardsProvider({ children }: { children: React.ReactNode }) {
  const [all, setAll] = useState<Card[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(
    () =>
      subscribeToCards((next) => {
        setAll(next);
        setLoaded(true);
      }),
    []
  );

  const value = useMemo(
    () => ({ all, cards: withoutMine(all), myCard: myCardOf(all), loaded }),
    [all, loaded]
  );
  return <CardsContext.Provider value={value}>{children}</CardsContext.Provider>;
}

export function useCards(): CardsValue {
  const value = useContext(CardsContext);
  if (!value) throw new Error('useCards must be used within a CardsProvider');
  return value;
}
