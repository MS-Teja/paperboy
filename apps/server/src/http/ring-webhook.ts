import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { fromWebhook, SIGNATURE_HEADER, verifyWebhookSignature, WebhookPayloadSchema } from 'ring-partner-kit';
import type { Db } from '../db/client.ts';
import { webhookDeliveries } from '../db/schema.ts';
import { storeEvents } from '../intake/intake.ts';

export type WebhookOutcome = 'stored' | 'duplicate_delivery' | 'duplicate_event' | 'unknown_device' | 'invalid_payload';

/**
 * Handles one verified delivery: skips redelivered `meta.request_id`s, then stores
 * the event under its device. Separate from the route so it can run after the 200.
 */
export function processWebhook(db: Db, rawBody: Buffer, now = new Date()): WebhookOutcome {
  let json: unknown;
  try {
    json = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return 'invalid_payload';
  }
  const parsed = WebhookPayloadSchema.safeParse(json);
  if (!parsed.success) return 'invalid_payload';

  const delivery = db
    .insert(webhookDeliveries)
    .values({ requestId: parsed.data.meta.request_id, receivedAt: now })
    .onConflictDoNothing()
    .run();
  if (delivery.changes === 0) return 'duplicate_delivery';

  const stored = storeEvents(db, [fromWebhook(parsed.data)], 'webhook');
  if (stored.unknownDevice) return 'unknown_device';
  return stored.inserted ? 'stored' : 'duplicate_event';
}

export interface RingWebhookOptions {
  db: Db;
  signingKey: string;
  /** Runs processing after the response is sent. Tests pass a synchronous runner. */
  defer?: (task: () => void) => void;
}

/**
 * POST /webhooks/ring. Verifies `X-Signature` over the raw body, answers 200 at
 * once (Ring expects a reply within 5 s), and processes asynchronously.
 */
export const ringWebhookRoutes: FastifyPluginAsync<RingWebhookOptions> = async (app: FastifyInstance, options) => {
  const defer = options.defer ?? ((task) => setImmediate(task));

  // Keep the exact bytes: re-serialised JSON would not match the HMAC.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  app.post('/webhooks/ring', async (req, reply) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const signature = req.headers[SIGNATURE_HEADER];
    if (!verifyWebhookSignature(rawBody, Array.isArray(signature) ? signature[0] : signature, options.signingKey)) {
      req.log.warn('Ring webhook rejected: bad or missing signature');
      return reply.code(401).send({ error: 'invalid signature' });
    }

    defer(() => {
      try {
        const outcome = processWebhook(options.db, rawBody);
        req.log.info({ outcome }, 'Ring webhook processed');
      } catch (err) {
        req.log.error({ err }, 'Ring webhook processing failed');
      }
    });
    return reply.code(200).send({ status: 'ok' });
  });
};
