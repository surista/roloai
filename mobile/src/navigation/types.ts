import type { CardDraft } from '@roloai/shared';

export type RootStackParamList = {
  CardList: undefined;
  Scan: undefined;
  Settings: undefined;
  ReviewEdit: { draft: CardDraft; localImageUri?: string; localBackImageUri?: string };
  CardDetail: { cardId: string };
};
