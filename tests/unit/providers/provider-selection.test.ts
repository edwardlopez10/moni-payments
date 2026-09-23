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
    put: async () => {},
    get: async <T>() => 'resolved-secret' as T,
    delete: async () => {},
    exists: async () => true,
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

  it('rejects a suspended account instead of falling back to another account', async () => {
    vi.mocked(paymentAccountRepo.findPaymentAccountById).mockResolvedValue({
      id: 'acct-suspended',
      organizationId: 'org-1',
      provider: 'fake',
      providerMerchantId: 'M-1',
      status: 'SUSPENDED',
      isDefault: false,
      configuration: {},
      secretRef: 'memory://acct-suspended',
      credentialRefs: { bundle: 'memory://acct-suspended' },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    vi.mocked(paymentAccountRepo.findDefaultActiveAccount).mockClear();

    await expect(
      selectProvider(
        { organizationId: 'org-1', paymentAccountId: 'acct-suspended', requestId: 'r1' },
        { registry, secrets },
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.PROVIDER_CONFIGURATION_ERROR,
      message: 'Payment account is not ACTIVE.',
    });
    expect(paymentAccountRepo.findDefaultActiveAccount).not.toHaveBeenCalled();
  });

  it('propagates a secret-store outage before a provider call', async () => {
    vi.mocked(paymentAccountRepo.findPaymentAccountById).mockResolvedValue({
      id: 'acct-1',
      organizationId: 'org-1',
      provider: 'fake',
      providerMerchantId: 'M-1',
      status: 'ACTIVE',
      isDefault: true,
      configuration: {},
      secretRef: 'awssm://moniveo-payments/test/orgs/org-1/payment-accounts/acct-1',
      credentialRefs: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const unavailable = {
      ...secrets,
      get: async () => {
        throw new AppError(
          ErrorCode.PROVIDER_CONFIGURATION_UNAVAILABLE,
          'Secret store temporarily unavailable.',
        );
      },
    };

    await expect(
      selectProvider(
        { organizationId: 'org-1', paymentAccountId: 'acct-1', requestId: 'r1' },
        { registry, secrets: unavailable },
      ),
    ).rejects.toMatchObject({ code: ErrorCode.PROVIDER_CONFIGURATION_UNAVAILABLE });
  });
});
