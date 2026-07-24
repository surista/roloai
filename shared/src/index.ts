export type CardSource = 'scan' | 'qr' | 'manual';

export interface CardPhone {
  label: string;
  number: string;
}

export interface CardEmail {
  label: string;
  address: string;
}

export interface Card {
  id: string;
  firstName: string;
  lastName: string;
  jobTitle?: string;
  company?: string;
  phones: CardPhone[];
  emails: CardEmail[];
  website?: string;
  address?: string;
  notes?: string;
  tags: string[];
  imageUrl: string;
  imageBackUrl?: string;
  source: CardSource;
  rawOcrText?: string;
  createdAt: number;
  updatedAt: number;
}

/** Shape used while building a Card in the review/edit form, before it has an id or timestamps. */
export type CardDraft = Omit<Card, 'id' | 'createdAt' | 'updatedAt'>;
