import { createHmac, timingSafeEqual } from 'node:crypto';

import type { RawWebhookRequest, WebhookVerificationResult } from '../types';

export const FAKE_SIGNATURE_HEADER = 'x-fake-signature';

export function signFakeWebhook(rawBody: Buffer, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export function verifyFakeWebhookSignature(
  request: RawWebhookRequest,
  secret: string | undefined,
): WebhookVerificationResult {
  if (!secret) {
    return { verified: false, reason: 'missing signing secret' };
  }

  const provided = headerValue(request.headers, FAKE_SIGNATURE_HEADER);
  if (!provided) {
    return { verified: false, reason: 'missing signature header' };
  }

  const expected = signFakeWebhook(request.rawBody, secret);
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
    return { verified: false, reason: 'signature mismatch' };
  }

  return { verified: true };
}
