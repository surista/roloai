import { getFunctions, httpsCallable } from 'firebase/functions';
import type { CardDraft } from '@roloai/shared';

export interface CardExtractionResult {
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  company: string | null;
  phones: { label: string; number: string }[];
  emails: { label: string; address: string }[];
  website: string | null;
  address: string | null;
  notes: string | null;
  tags: string[];
  rawText: string;
}

const functions = getFunctions();
const extractCardCallable = httpsCallable<
  { frontImageBase64: string; backImageBase64?: string },
  CardExtractionResult
>(functions, 'extractCard');

export async function extractCard(
  frontImageBase64: string,
  backImageBase64?: string
): Promise<CardDraft> {
  const result = await extractCardCallable({ frontImageBase64, backImageBase64 });
  const data = result.data;

  return {
    firstName: data.firstName,
    lastName: data.lastName,
    jobTitle: data.jobTitle ?? undefined,
    company: data.company ?? undefined,
    phones: data.phones,
    emails: data.emails,
    website: data.website ?? undefined,
    address: data.address ?? undefined,
    notes: data.notes ?? undefined,
    tags: data.tags,
    imageUrl: '',
    source: 'scan',
    rawOcrText: data.rawText,
  };
}
