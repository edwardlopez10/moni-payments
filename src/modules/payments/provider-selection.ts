import type { PaymentAccount } from '@prisma/client';

import { AppError, ErrorCode } from '../../domain/errors';
import { getSecretsProvider, type SecretsProvider } from '../../platform/secrets';
import { loadAccountCredentialBundle } from '../payment-accounts/credentials';
import type { ProviderCapability } from '../../providers/capabilities';
import {
  getProviderRegistry,
  type ProviderRegistry,
} from '../../providers/registry';
import type { PaymentProvider, ProviderContext } from '../../providers/types';
import * as paymentAccountRepo from '../payment-accounts/repository';

export interface SelectedProvider {
  account: PaymentAccount;
  provider: PaymentProvider;
  context: ProviderContext;
}

export interface SelectProviderInput {
  organizationId: string;
  paymentAccountId?: string | null | undefined;
  requestId: string;
  requiredCapability?: ProviderCapability | undefined;
  currency?: string | undefined;
}

function asStringRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export async function selectProvider(
  input: SelectProviderInput,
  deps: {
    registry?: ProviderRegistry;
    secrets?: SecretsProvider;
  } = {},
): Promise<SelectedProvider> {
  const registry = deps.registry ?? getProviderRegistry();
  const secrets = deps.secrets ?? getSecretsProvider();

  let account: PaymentAccount | null = null;
  if (input.paymentAccountId) {
    account = await paymentAccountRepo.findPaymentAccountById(input.paymentAccountId);
    if (!account || account.organizationId !== input.organizationId) {
      throw new AppError(
        ErrorCode.PROVIDER_CONFIGURATION_ERROR,
        'Payment account not found for organization.',
      );
    }
    if (account.status !== 'ACTIVE') {
      throw new AppError(
        ErrorCode.PROVIDER_CONFIGURATION_ERROR,
        'Payment account is not ACTIVE.',
      );
    }
  } else {
    account = await paymentAccountRepo.findDefaultActiveAccount(input.organizationId);
    if (!account) {
      throw new AppError(
        ErrorCode.PROVIDER_CONFIGURATION_ERROR,
        'Organization has no usable ACTIVE payment account.',
      );
    }
  }

  const provider = registry.get(account.provider);

  if (input.requiredCapability && !provider.capabilities.has(input.requiredCapability)) {
    throw new AppError(
      ErrorCode.CAPABILITY_NOT_SUPPORTED,
      `Provider '${provider.key}' does not support ${input.requiredCapability}.`,
    );
  }

  if (input.currency && !provider.supportedCurrencies.has(input.currency)) {
    throw new AppError(
      ErrorCode.CURRENCY_NOT_SUPPORTED,
      `Provider '${provider.key}' does not support currency ${input.currency}.`,
    );
  }

  const credentials = await loadAccountCredentialBundle(account, secrets);

  const context: ProviderContext = {
    organizationId: input.organizationId,
    paymentAccountId: account.id,
    providerMerchantId: account.providerMerchantId,
    configuration: asStringRecord(account.configuration),
    credentials,
    requestId: input.requestId,
  };

  return { account, provider, context };
}
