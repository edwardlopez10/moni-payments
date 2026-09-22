import { describe, expect, it, vi } from 'vitest';

import { AppError, ErrorCode } from '../../../src/domain/errors';
import { ProviderCapability } from '../../../src/providers/capabilities';
import { createRegistry } from '../../../src/providers/registry';
import { FakePaymentProvider } from '../../../src/providers/fake';
import { selectProvider } from '../../../src/modules/payments/provider-selection';

vi.mock('../../../src/modules/payment-accounts/repository', () => ({
  findPaymentAccountById: vi.fn(),
  findDefaultActiveAccount: vi.fn(),
}));

import * as paymentAccountRepo from '../../../src/modules/payment-accounts/repository';

describe('provider selection', () => {
  const registry = createRegistry([new FakePaymentProvider()]);
  const secrets = {
    schemes: ['env'] as const,
    resolve: async () => 'resolved-secret',
  };

  it('uses an explicitly named account belonging to the organization', async () => {
    vi.mocked(paymentAccountRepo.findPaymentAccountById).mockResolvedValue({
      id: 'acct-1',
      organizationId: 'org-1',
      provider: 'fake',
      providerMerchantId: 'M-1',
      status: 'ACTIVE',
      isDefault: false,
      configuration: {},
      credentialRefs: { apiKey: 'env://X' },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const selected = await selectProvider(
      { organizationId: 'org-1', paymentAccountId: 'acct-1', requestId: 'r1' },
      { registry, secrets },
    );
    expect(selected.account.id).toBe('acct-1');
    expect(selected.context.credentials.apiKey).toBe('resolved-secret');
  });

  it('falls back to the default ACTIVE account', async () => {
    vi.mocked(paymentAccountRepo.findDefaultActiveAccount).mockResolvedValue({
      id: 'acct-default',
      organizationId: 'org-1',
      provider: 'fake',
      providerMerchantId: 'M-1',
      status: 'ACTIVE',
      isDefault: true,
      configuration: {},
      credentialRefs: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const selected = await selectProvider(
      { organizationId: 'org-1', requestId: 'r1' },
      { registry, secrets },
    );
    expect(selected.account.id).toBe('acct-default');
  });

  it('rejects missing accounts and unsupported capabilities', async () => {
    vi.mocked(paymentAccountRepo.findDefaultActiveAccount).mockResolvedValue(null);
    await expect(
      selectProvider({ organizationId: 'org-1', requestId: 'r1' }, { registry, secrets }),
    ).rejects.toMatchObject({ code: ErrorCode.PROVIDER_CONFIGURATION_ERROR });

    vi.mocked(paymentAccountRepo.findDefaultActiveAccount).mockResolvedValue({
      id: 'acct-default',
      organizationId: 'org-1',
      provider: 'fake',
      providerMerchantId: 'M-1',
      status: 'ACTIVE',
      isDefault: true,
      configuration: {},
      credentialRefs: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    // Build a registry whose fake lacks REFUNDS by wrapping capabilities.
    const limited = new FakePaymentProvider();
    Object.defineProperty(limited, 'capabilities', {
      value: new Set([ProviderCapability.WEBHOOKS]),
    });
    const limitedRegistry = createRegistry([limited]);

    await expect(
      selectProvider(
        {
          organizationId: 'org-1',
          requestId: 'r1',
          requiredCapability: ProviderCapability.REFUNDS,
        },
        { registry: limitedRegistry, secrets },
      ),
    ).rejects.toBeInstanceOf(AppError);
  });
});
