import { describe, expect, it } from 'vitest';

import type { CredentialAuditWrite } from '../../../src/platform/audit/credential-audit';
import { AuditingSecretsProvider } from '../../../src/platform/secrets/auditing-provider';
import { MemorySecretsProvider } from '../../../src/platform/secrets/memory-provider';
import type { SecretsProvider } from '../../../src/platform/secrets/types';

const reference =
  'memory://moniveo-payments/test/orgs/org-1/payment-accounts/acct-1';

function recordingProvider(inner: SecretsProvider) {
  const writes: CredentialAuditWrite[] = [];
  const provider = new AuditingSecretsProvider(inner, async (input) => {
    writes.push(input);
  });
  return { provider, writes };
}

describe('AuditingSecretsProvider', () => {
  it('records put, rotation, delete, exists, and get without the secret value', async () => {
    const { provider, writes } = recordingProvider(new MemorySecretsProvider());
    const secret = { apiKey: 'canary-credential-value', webhookSecret: 'whsec' };

    await provider.put(reference, secret);
    await provider.put(reference, secret, { auditOperation: 'rotation' });
    await provider.exists(reference);
    await provider.get(reference);
    await provider.delete(reference);

    expect(writes.map((row) => row.operation)).toEqual([
      'PUT',
      'ROTATION',
      'EXISTS',
      'GET',
      'DELETE',
    ]);
    expect(writes.every((row) => row.outcome === 'SUCCESS')).toBe(true);
    expect(writes.every((row) => row.paymentAccountId === 'acct-1')).toBe(true);
    expect(JSON.stringify(writes)).not.toContain('canary-credential-value');
  });

  it('skips get audit when the inner provider still has a fresh cache entry', async () => {
    const inner = new MemorySecretsProvider();
    let fresh = false;
    const caching = Object.assign(inner, {
      hasFreshCache() {
        return fresh;
      },
    });
    await caching.put(reference, { apiKey: 'cached' });
    const { provider, writes } = recordingProvider(caching);

    await provider.get(reference);
    fresh = true;
    await provider.get(reference);

    expect(writes.map((row) => row.operation)).toEqual(['GET']);
  });

  it('records a failure and still throws', async () => {
    const inner = new MemorySecretsProvider();
    const { provider, writes } = recordingProvider(inner);

    await expect(provider.get(reference)).rejects.toThrow(/could not be resolved/);
    expect(writes).toEqual([
      {
        organizationId: 'org-1',
        paymentAccountId: 'acct-1',
        operation: 'GET',
        outcome: 'FAILURE',
      },
    ]);
  });

  it('does not audit references that are not payment-account bundles', async () => {
    const { provider, writes } = recordingProvider(new MemorySecretsProvider());
    await provider.put('memory://FAKE_PROVIDER_API_KEY', 'value');
    expect(writes).toEqual([]);
  });
});
