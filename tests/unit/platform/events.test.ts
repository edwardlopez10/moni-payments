import { describe, expect, it } from 'vitest';

import { nextAttemptDelayMs, MAX_DELIVERY_ATTEMPTS } from '../../../src/domain/events';
import { signCallbackBody, verifyCallbackSignature } from '../../../src/platform/events/signing';

describe('callback signing', () => {
  it('signs and verifies HMAC bodies', () => {
    const body = '{"hello":"world"}';
    const signature = signCallbackBody(body, 'secret');
    expect(signature.startsWith('sha256=')).toBe(true);
    expect(verifyCallbackSignature(body, signature, 'secret')).toBe(true);
    expect(verifyCallbackSignature(body, signature, 'other')).toBe(false);
    expect(verifyCallbackSignature(body + 'x', signature, 'secret')).toBe(false);
  });
});

describe('delivery backoff', () => {
  it('returns growing delays then null at the attempt budget', () => {
    expect(nextAttemptDelayMs(1)).toBe(2_000);
    expect(nextAttemptDelayMs(2)).toBe(8_000);
    expect(nextAttemptDelayMs(MAX_DELIVERY_ATTEMPTS)).toBeNull();
  });
});
