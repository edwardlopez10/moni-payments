import { beforeAll, describe, expect, it } from 'vitest';

import { isKnownCurrency } from '../../src/domain/currencies';
import { ProviderCapability } from '../../src/providers/capabilities';
import { isProviderError } from '../../src/providers/errors';
import type {
  PaymentProvider,
  ProviderContext,
  ProviderFailureCode,
  WebhookContext,
} from '../../src/providers/types';
import { ProviderFailureCode as FailureCodes } from '../../src/providers/types';

const FAILURE_CODES = new Set<string>(Object.values(FailureCodes));
const PAN_SHAPED = /\b(?:\d[ -]*?){13,19}\b/;

export interface ContractHarness {
  provider: PaymentProvider;
  context: ProviderContext;
  /** Drive the provider toward an outcome without reaching into its internals. */
  simulate(
    providerPaymentId: string,
    outcome: 'PAID' | 'FAILED' | 'AUTHORIZED',
  ): Promise<void>;
  /** Produce a tokenizable setup token. Skipped when TOKENIZATION is absent. */
  createSetupToken?(): Promise<string> | string;
  /** Produce a signed webhook body the adapter can parse. Required when WEBHOOKS is declared. */
  createWebhookRequest?(
    kind: 'known' | 'unknown',
  ): Promise<{
    rawBody: Buffer;
    headers: Record<string, string | string[] | undefined>;
    query: Record<string, string | string[] | undefined>;
  }>;
}

export function runPaymentProviderContract(
  name: string,
  createHarness: () => Promise<ContractHarness>,
): void {
  describe(`PaymentProvider contract: ${name}`, () => {
    let harness: ContractHarness;
    let provider: PaymentProvider;
    let context: ProviderContext;

    beforeAll(async () => {
      harness = await createHarness();
      provider = harness.provider;
      context = harness.context;
    });

    describe('declaration consistency', () => {
      it('has a non-empty key and non-empty supported currencies', () => {
        expect(provider.key.length).toBeGreaterThan(0);
        expect(provider.supportedCurrencies.size).toBeGreaterThan(0);
        for (const currency of provider.supportedCurrencies) {
          expect(isKnownCurrency(currency)).toBe(true);
        }
      });

      it('keeps capabilities and method presence in sync', () => {
        const caps = provider.capabilities;
        expect(Boolean(provider.refundPayment)).toBe(caps.has(ProviderCapability.REFUNDS));
        expect(Boolean(provider.createPaymentMethod)).toBe(
          caps.has(ProviderCapability.TOKENIZATION),
        );
        expect(Boolean(provider.chargePaymentMethod)).toBe(
          caps.has(ProviderCapability.TOKENIZATION),
        );
        expect(Boolean(provider.verifyWebhook)).toBe(
          caps.has(ProviderCapability.WEBHOOK_SIGNATURE_VERIFICATION),
        );
        expect(Boolean(provider.parseWebhook)).toBe(caps.has(ProviderCapability.WEBHOOKS));

        if (caps.has(ProviderCapability.PARTIAL_REFUNDS)) {
          expect(caps.has(ProviderCapability.REFUNDS)).toBe(true);
        }
        if (caps.has(ProviderCapability.WEBHOOK_SIGNATURE_VERIFICATION)) {
          expect(caps.has(ProviderCapability.WEBHOOKS)).toBe(true);
        }
        if (caps.has(ProviderCapability.REFUNDS)) {
          expect(provider.refundPayment).toBeTypeOf('function');
        }
      });
    });

    describe('payment creation', () => {
      it('returns a normalized payment with exact amount round-trip', async () => {
        const result = await provider.createPayment(
          {
            paymentId: 'contract_pay_1',
            amount: { amount: 8500, currency: 'USD' },
            customerReference: 'contract-cust',
            idempotencyKey: `contract-create-${name}-1`,
            metadata: {},
          },
          context,
        );
        expect(result.providerPaymentId.length).toBeGreaterThan(0);
        expect(result.amount).toEqual({ amount: 8500, currency: 'USD' });
        expect(result.providerMetadata).toBeTypeOf('object');
        expect(result.providerMetadata).not.toBeNull();

        if (
          provider.capabilities.has(ProviderCapability.REDIRECT_CHECKOUT) &&
          (result.status === 'PENDING' || result.status === 'PROCESSING')
        ) {
          expect(result.checkoutUrl).toMatch(/^https?:\/\//);
        }
      });

      it('honours provider-side idempotency keys', async () => {
        const input = {
          paymentId: 'contract_pay_idem',
          amount: { amount: 500, currency: 'USD' },
          customerReference: 'contract-cust',
          idempotencyKey: `contract-idem-${name}`,
          metadata: {},
        };
        const first = await provider.createPayment(input, context);
        const second = await provider.createPayment(input, context);
        expect(second.providerPaymentId).toBe(first.providerPaymentId);

        const other = await provider.createPayment(
          { ...input, paymentId: 'contract_pay_idem_2', idempotencyKey: `contract-idem-${name}-b` },
          context,
        );
        expect(other.providerPaymentId).not.toBe(first.providerPaymentId);
      });
    });

    describe('retrieval', () => {
      it('returns a matching payment for a known id and throws ProviderError for unknown', async () => {
        const created = await provider.createPayment(
          {
            paymentId: 'contract_pay_get',
            amount: { amount: 300, currency: 'USD' },
            customerReference: 'contract-cust',
            idempotencyKey: `contract-get-${name}`,
            metadata: {},
          },
          context,
        );
        const fetched = await provider.getPayment(created.providerPaymentId, context);
        expect(fetched.providerPaymentId).toBe(created.providerPaymentId);
        expect(fetched.amount).toEqual(created.amount);

        await expect(provider.getPayment('definitely-missing-id', context)).rejects.toSatisfy(
          (error: unknown) => isProviderError(error),
        );
      });
    });

    describe('failure mapping', () => {
      it('maps declines to FAILED with a closed failure code and only throws ProviderError', async () => {
        let declined;
        try {
          declined = await provider.createPayment(
            {
              paymentId: 'contract_pay_fail',
              amount: { amount: 100, currency: 'USD' },
              customerReference: 'contract-cust',
              idempotencyKey: `contract-fail-${name}`,
              metadata: { fakeScenario: 'declined' },
            },
            context,
          );
        } catch (error) {
          expect(isProviderError(error)).toBe(true);
          return;
        }

        if (declined.status === 'FAILED') {
          expect(declined.failure).toBeDefined();
          expect(FAILURE_CODES.has(declined.failure!.code)).toBe(true);
          expect(typeof declined.failure!.retryable).toBe('boolean');
        }
      });
    });

    describe('refunds', () => {
      it('runs refund assertions when REFUNDS is declared', async () => {
        if (!provider.capabilities.has(ProviderCapability.REFUNDS) || !provider.refundPayment) {
          return;
        }

        const created = await provider.createPayment(
          {
            paymentId: 'contract_pay_refund',
            amount: { amount: 1000, currency: 'USD' },
            customerReference: 'contract-cust',
            idempotencyKey: `contract-refund-create-${name}`,
            metadata: { fakeScenario: 'instant_success' },
          },
          context,
        );

        if (created.status !== 'PAID') {
          await harness.simulate(created.providerPaymentId, 'PAID');
        }

        const full = await provider.refundPayment(
          {
            refundId: 'contract_refund_full',
            providerPaymentId: created.providerPaymentId,
            amount: { amount: 1000, currency: 'USD' },
            isFullRefund: true,
            idempotencyKey: `contract-refund-full-${name}`,
          },
          context,
        );
        expect(full.status).toBe('SUCCEEDED');
        expect(full.providerRefundId).not.toBe(created.providerPaymentId);

        const partialPayment = await provider.createPayment(
          {
            paymentId: 'contract_pay_partial',
            amount: { amount: 1000, currency: 'USD' },
            customerReference: 'contract-cust',
            idempotencyKey: `contract-partial-create-${name}`,
            metadata: { fakeScenario: 'instant_success' },
          },
          context,
        );
        if (partialPayment.status !== 'PAID') {
          await harness.simulate(partialPayment.providerPaymentId, 'PAID');
        }

        if (provider.capabilities.has(ProviderCapability.PARTIAL_REFUNDS)) {
          const partial = await provider.refundPayment(
            {
              refundId: 'contract_refund_partial',
              providerPaymentId: partialPayment.providerPaymentId,
              amount: { amount: 250, currency: 'USD' },
              isFullRefund: false,
              idempotencyKey: `contract-refund-partial-${name}`,
            },
            context,
          );
          expect(partial.status).toBe('SUCCEEDED');
        }

        await expect(
          provider.refundPayment(
            {
              refundId: 'contract_refund_over',
              providerPaymentId: partialPayment.providerPaymentId,
              amount: { amount: 10_000, currency: 'USD' },
              isFullRefund: false,
              idempotencyKey: `contract-refund-over-${name}`,
            },
            context,
          ),
        ).rejects.toSatisfy((error: unknown) => {
          expect(isProviderError(error)).toBe(true);
          expect((error as { code: ProviderFailureCode }).code).toBe(
            FailureCodes.REFUND_NOT_ALLOWED,
          );
          return true;
        });
      });
    });

    describe('tokenization', () => {
      it('runs tokenization assertions when TOKENIZATION is declared', async () => {
        if (
          !provider.capabilities.has(ProviderCapability.TOKENIZATION) ||
          !provider.createPaymentMethod ||
          !provider.chargePaymentMethod
        ) {
          return;
        }

        const setupToken =
          (await harness.createSetupToken?.()) ?? `contract_setup_${Date.now()}`;
        const method = await provider.createPaymentMethod(
          {
            organizationId: context.organizationId,
            customerReference: 'contract-cust',
            setupToken,
            metadata: {},
          },
          context,
        );
        expect(method.providerPaymentMethodId.length).toBeGreaterThan(0);
        if (method.type === 'CARD') {
          expect(method.last4).toMatch(/^\d{4}$/);
        }
        expect(JSON.stringify(method)).not.toMatch(PAN_SHAPED);

        const charged = await provider.chargePaymentMethod(
          {
            paymentId: 'contract_pay_token',
            amount: { amount: 1200, currency: 'USD' },
            customerReference: 'contract-cust',
            providerPaymentMethodId: method.providerPaymentMethodId,
            idempotencyKey: `contract-charge-${name}`,
            metadata: {},
          },
          context,
        );
        expect(charged.providerPaymentId.length).toBeGreaterThan(0);
      });
    });

    describe('webhooks', () => {
      it('runs webhook assertions when WEBHOOKS is declared', async () => {
        if (!provider.capabilities.has(ProviderCapability.WEBHOOKS) || !provider.parseWebhook) {
          return;
        }

        const known =
          (await harness.createWebhookRequest?.('known')) ??
          ({
            rawBody: Buffer.from('{}'),
            headers: {},
            query: {},
          } as const);

        const first = await provider.parseWebhook(known);
        const second = await provider.parseWebhook(known);
        expect(first.providerEventId.length).toBeGreaterThan(0);
        expect(second.providerEventId).toBe(first.providerEventId);

        const unknown =
          (await harness.createWebhookRequest?.('unknown')) ??
          ({
            rawBody: Buffer.from('{"not":"ours"}'),
            headers: {},
            query: {},
          } as const);
        const unknownEvent = await provider.parseWebhook(unknown);
        expect(unknownEvent.kind).toBe('UNKNOWN');

        if (
          provider.capabilities.has(ProviderCapability.WEBHOOK_SIGNATURE_VERIFICATION) &&
          provider.verifyWebhook
        ) {
          const signingSecret = context.credentials.webhookSecret ?? 'test-fake-webhook-secret';
          const webhookCtx = {
            provider: provider.key,
            signingSecret,
            candidateAccounts: [] as WebhookContext['candidateAccounts'],
          };

          const verified = await provider.verifyWebhook(known, webhookCtx);
          expect(verified.verified).toBe(true);

          const tampered = {
            ...known,
            rawBody: Buffer.concat([known.rawBody, Buffer.from('x')]),
          };
          expect((await provider.verifyWebhook(tampered, webhookCtx)).verified).toBe(false);

          expect(
            (await provider.verifyWebhook({ ...known, headers: {} }, webhookCtx)).verified,
          ).toBe(false);
        }
      });
    });
  });
}
