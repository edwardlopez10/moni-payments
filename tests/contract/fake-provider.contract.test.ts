import { FakePaymentProvider } from '../../src/providers/fake';
import { runPaymentProviderContract } from './payment-provider.contract';
import { testProviderContext } from '../helpers/provider-context';

runPaymentProviderContract('FakePaymentProvider', async () => {
  const provider = new FakePaymentProvider({
    signingSecret: 'test-fake-webhook-secret',
  });
  const context = testProviderContext({
    credentials: { webhookSecret: 'test-fake-webhook-secret' },
  });

  return {
    provider,
    context,
    simulate: (providerPaymentId, outcome) => provider.simulate(providerPaymentId, outcome),
    createSetupToken: () => provider.createSetupToken(),
    createWebhookRequest: async (kind) => {
      if (kind === 'unknown') {
        return provider.signWebhookPayload({ hello: 'not-a-payment-event' });
      }
      return provider.signWebhookPayload({
        kind: 'PAYMENT',
        providerEventId: 'contract-event-1',
        providerEventType: 'payment.paid',
        providerPaymentId: 'fake_pay_contract',
        status: 'PAID',
      });
    },
  };
});
