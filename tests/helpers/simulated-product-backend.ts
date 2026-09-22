import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { verifyCallbackSignature } from '../../src/platform/events/signing';

export interface ReceivedCallback {
  eventId: string | null;
  signature: string | null;
  attempt: string | null;
  body: unknown;
  rawBody: string;
  verified: boolean;
}

export interface SimulatedProductBackend {
  readonly url: string;
  readonly secret: string;
  readonly callbacks: ReceivedCallback[];
  failNext(count?: number): void;
  reset(): void;
  close(): Promise<void>;
  waitForCallbacks(count: number, timeoutMs?: number): Promise<ReceivedCallback[]>;
}

/**
 * Stand-in for a product backend (e.g. Resident) that receives signed outbox callbacks.
 */
export async function startSimulatedProductBackend(options?: {
  secret?: string;
}): Promise<SimulatedProductBackend> {
  const secret = options?.secret ?? process.env.EVENT_CALLBACK_SECRET ?? 'test-callback-secret';
  const callbacks: ReceivedCallback[] = [];
  let failRemaining = 0;

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      const signature = typeof req.headers['x-moniveo-signature'] === 'string'
        ? req.headers['x-moniveo-signature']
        : null;
      const eventId = typeof req.headers['x-moniveo-event-id'] === 'string'
        ? req.headers['x-moniveo-event-id']
        : null;
      const attempt = typeof req.headers['x-moniveo-delivery-attempt'] === 'string'
        ? req.headers['x-moniveo-delivery-attempt']
        : null;
      let body: unknown = rawBody;
      try {
        body = JSON.parse(rawBody) as unknown;
      } catch {
        // keep raw string
      }
      const verified = verifyCallbackSignature(rawBody, signature ?? undefined, secret);
      callbacks.push({ eventId, signature, attempt, body, rawBody, verified });

      if (failRemaining > 0) {
        failRemaining -= 1;
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'simulated failure' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ received: true }));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind simulated product backend');
  }
  const url = `http://127.0.0.1:${address.port}/callbacks/payments`;

  return {
    url,
    secret,
    callbacks,
    failNext(count = 1) {
      failRemaining = count;
    },
    reset() {
      callbacks.length = 0;
      failRemaining = 0;
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
    async waitForCallbacks(count, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs;
      while (callbacks.length < count) {
        if (Date.now() > deadline) {
          throw new Error(
            `Timed out waiting for ${count} callbacks (got ${callbacks.length})`,
          );
        }
        await new Promise((r) => setTimeout(r, 25));
      }
      return callbacks.slice(0, count);
    },
  };
}
