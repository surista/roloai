import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

const anthropicApiKey = defineSecret('ANTHROPIC_API_KEY');

/**
 * Single-user app — mirrors the owner check in firestore.rules / storage.rules. Without it,
 * anyone who self-registers with the public client API key could spend this project's
 * Anthropic budget.
 */
const OWNER_EMAIL = 'surista@gmail.com';

const CardExtractionSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  jobTitle: z.string().nullable(),
  company: z.string().nullable(),
  phones: z.array(z.object({ label: z.string(), number: z.string() })),
  emails: z.array(z.object({ label: z.string(), address: z.string() })),
  website: z.string().nullable(),
  address: z.string().nullable(),
  notes: z.string().nullable(),
  tags: z.array(z.string()),
  rawText: z.string(),
});

interface ExtractCardRequest {
  frontImageBase64: string;
  backImageBase64?: string;
}

export const extractCard = onCall<ExtractCardRequest>(
  // A two-image vision call can take a while; 30s was tight enough to surface as a spurious
  // "check your connection" on the client.
  { secrets: [anthropicApiKey], region: 'us-central1', timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    if (request.auth.token.email !== OWNER_EMAIL) {
      throw new HttpsError('permission-denied', 'Not authorized.');
    }

    const { frontImageBase64, backImageBase64 } = request.data;
    if (!frontImageBase64 || typeof frontImageBase64 !== 'string') {
      throw new HttpsError('invalid-argument', 'frontImageBase64 is required.');
    }

    const client = new Anthropic({ apiKey: anthropicApiKey.value() });

    const content: Array<Anthropic.ImageBlockParam | Anthropic.TextBlockParam> = [
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: frontImageBase64 },
      },
    ];
    if (backImageBase64 && typeof backImageBase64 === 'string') {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: backImageBase64 },
      });
    }
    content.push({
      type: 'text',
      text: backImageBase64
        ? 'These are the front and back of a business card, which may be in different languages (e.g. English on one side, Japanese on the other). Extract the contact details as one merged record, preferring the clearest/most complete version of each field across both sides. Also include a rawText field with a full transcription of all text on both sides.'
        : 'This is a business card. Extract the contact details. Also include a rawText field with a full transcription of all text on the card.',
    });

    const response = await client.messages.parse({
      model: 'claude-sonnet-5',
      max_tokens: 2048,
      output_config: { format: zodOutputFormat(CardExtractionSchema) },
      messages: [{ role: 'user', content }],
    });

    if (!response.parsed_output) {
      throw new HttpsError('internal', 'Could not extract card details from the image.');
    }

    return response.parsed_output;
  }
);
