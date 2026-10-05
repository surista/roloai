import type { CardDraft } from '@roloai/shared';

export type RootStackParamList = {
  CardList: undefined;
  /** `mine` scans the owner's own card: the result replaces My Card instead of joining the library. */
  Scan: { mine?: boolean } | undefined;
  Settings: undefined;
  MyCard: undefined;
  /**
   * Either a finished `draft` (a QR code, which needs no reading), or `scan` — the accepted
   * photos, which the screen reads itself so the card can be on screen while Claude works.
   */
  ReviewEdit: {
    draft?: CardDraft;
    scan?: { frontUri: string; backUri?: string };
    localImageUri?: string;
    localBackImageUri?: string;
    /** Set when reading a scan from the offline queue; the item is removed once it is saved or discarded. */
    queuedId?: string;
    /** The scan is the owner's own card; Save replaces My Card. */
    mine?: boolean;
  };
  CardDetail: { cardId: string };
};
