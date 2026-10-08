import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

// Ring signs every webhook: X-Signature = "sha256=" + lowercase hex HMAC-SHA256 of the
// raw request body, keyed with the HMAC signing key as UTF-8 bytes (not Base64-decoded).
// Nonces use the same key but URL-safe Base64; never mix the two encodings.

export const SIGNATURE_HEADER = 'x-signature';

export function signWebhookBody(rawBody: string | Uint8Array, signingKey: string): string {
  return `sha256=${createHmac('sha256', Buffer.from(signingKey, 'utf8')).update(rawBody).digest('hex')}`;
}

/**
 * Checks a webhook signature against the exact bytes received. Pass the raw body,
 * never re-serialised JSON: whitespace changes break the HMAC.
 */
export function verifyWebhookSignature(
  rawBody: string | Uint8Array,
  signatureHeader: string | null | undefined,
  signingKey: string,
): boolean {
  if (!signatureHeader || !signingKey) return false;
  const expected = Buffer.from(signWebhookBody(rawBody, signingKey), 'utf8');
  const received = Buffer.from(signatureHeader.trim(), 'utf8');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export const WebhookPayloadSchema = z
  .object({
    meta: z
      .object({
        version: z.string().optional(),
        time: z.string().optional(),
        request_id: z.string(),
        account_id: z.string().optional(),
      })
      .loose(),
    data: z
      .object({
        id: z.string(),
        type: z.string(),
        subType: z.string().optional(),
        attributes: z
          .object({
            source: z.string(),
            source_type: z.string().optional(),
            timestamp: z.number(),
          })
          .loose(),
      })
      .loose(),
  })
  .loose();

export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;
