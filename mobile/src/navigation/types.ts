import type { CardDraft } from '@roloai/shared';

export type RootStackParamList = {
  CardList: undefined;
  Scan: undefined;
  ReviewEdit: { draft: CardDraft; localImageUri?: string };
  CardDetail: { cardId: string };
};
