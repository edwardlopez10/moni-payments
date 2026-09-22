import { randomUUID } from 'node:crypto';

import type { ProviderContext, WebhookContext } from '../../src/providers/types';

export function testProviderContext(
  overrides: Partial<ProviderContext> = {},
): ProviderContext {
  return {
    organizationId: overrides.organizationId ?? randomUUID(),
    paymentAccountId: overrides.paymentAccountId ?? randomUUID(),
    providerMerchantId: overrides.providerMerchantId ?? 'fake-merchant',
    configuration: overrides.configuration ?? {},
    credentials: overrides.credentials ?? { webhookSecret: 'test-fake-webhook-secret' },
    requestId: overrides.requestId ?? randomUUID(),
  };
}

export function testWebhookContext(
  overrides: Partial<WebhookContext> = {},
): WebhookContext {
  const context: WebhookContext = {
    provider: overrides.provider ?? 'fake',
    candidateAccounts: overrides.candidateAccounts ?? [],
  };
  if (overrides.signingSecret !== undefined) {
    context.signingSecret = overrides.signingSecret;
  } else {
    context.signingSecret = 'test-fake-webhook-secret';
  }
  return context;
}
