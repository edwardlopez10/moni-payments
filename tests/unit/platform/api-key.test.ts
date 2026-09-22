import { describe, expect, it } from 'vitest';

import {
  buildApiKey,
  hashApiKey,
  parseApiKey,
  verifyApiKeyHash,
} from '../../../src/platform/auth/service-auth';

describe('api key parsing and hashing', () => {
  it('parses mvp_prefix_secret keys', () => {
    expect(parseApiKey('mvp_abc_secret-value')).toEqual({
      prefix: 'abc',
      secret: 'secret-value',
      raw: 'mvp_abc_secret-value',
    });
  });

  it('rejects malformed keys', () => {
    expect(parseApiKey('')).toBeNull();
    expect(parseApiKey('Bearer x')).toBeNull();
    expect(parseApiKey('mvp_onlyprefix')).toBeNull();
  });

  it('verifies hashes in constant-time compare', () => {
    const key = buildApiKey('pref', 's3cret');
    const hash = hashApiKey(key);
    expect(verifyApiKeyHash(key, hash)).toBe(true);
    expect(verifyApiKeyHash(key, hashApiKey('mvp_pref_other'))).toBe(false);
  });
});
