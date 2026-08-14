import { getFunctions, httpsCallable, FunctionsError } from 'firebase/functions';
import type { CardDraft } from '@roloai/shared';

/**
 * Thrown with a message that is safe to show the user as-is. The function distinguishes
 * "too much text to read in one pass" from "couldn't parse" from a genuine network failure,
 * and each needs different advice — a blanket "check your connection" sends the user into a
 * retry loop that can't succeed.
 */
export class CardExtractionError extends Error {}

/** Codes the function raises deliberately, whose messages are written for the user. */
const USER_FACING_CODES = new Set([
  'functions/resource-exhausted',
  'functions/invalid-argument',
]);

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
  let data: CardExtractionResult;
  try {
    data = (await extractCardCallable({ frontImageBase64, backImageBase64 })).data;
  } catch (e) {
    if (e instanceof FunctionsError && USER_FACING_CODES.has(e.code)) {
      throw new CardExtractionError(e.message);
    }
    throw e;
  }

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
