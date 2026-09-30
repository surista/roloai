import type { CardDraft } from '@roloai/shared';

export type RootStackParamList = {
  CardList: undefined;
  Scan: undefined;
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
  };
  CardDetail: { cardId: string };
};
