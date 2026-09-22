import { describe, expect, it } from 'vitest';

import { fingerprintRequest } from '../../../src/platform/idempotency/store';

describe('idempotency fingerprint', () => {
  it('is stable across JSON key order', () => {
    const a = fingerprintRequest({ b: 1, a: 2 }, { id: '1' });
    const b = fingerprintRequest({ a: 2, b: 1 }, { id: '1' });
    expect(a).toBe(b);
  });

  it('differs when a value differs', () => {
    const a = fingerprintRequest({ amount: 100 }, {});
    const b = fingerprintRequest({ amount: 101 }, {});
    expect(a).not.toBe(b);
  });

  it('includes path params in the fingerprint', () => {
    const a = fingerprintRequest({ amount: 100 }, { id: 'a' });
    const b = fingerprintRequest({ amount: 100 }, { id: 'b' });
    expect(a).not.toBe(b);
  });
});
