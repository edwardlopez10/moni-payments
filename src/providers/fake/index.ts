import { createHash, randomUUID } from 'node:crypto';

import type { SecretsProvider } from '../../platform/secrets/types';
import { ALL_PROVIDER_CAPABILITIES } from '../capabilities';
import { ProviderError } from '../errors';
import type {
  ChargePaymentMethodInput,
  CreatePaymentInput,
  CreatePaymentMethodInput,
  NormalizedWebhookEvent,
  PaymentProvider,
  PaymentResult,
  ProviderContext,
  ProviderFailure,
  RawWebhookRequest,
  RefundPaymentInput,
  RefundResult,
  WebhookContext,
  WebhookVerificationResult,
} from '../types';
import { ProviderFailureCode } from '../types';
import {
  FakeScenario,
  fakeDelayMs,
  resolveFakeScenario,
} from './scenarios';
import {
  FAKE_SIGNATURE_HEADER,
  signFakeWebhook,
  verifyFakeWebhookSignature,
} from './signature';
import { FakeProviderState } from './state';

const SUPPORTED_CURRENCIES = new Set(['USD', 'GTQ', 'HNL', 'CRC', 'COP', 'MXN', 'EUR']);

export interface FakePaymentProviderOptions {
  /** Registry key. Defaults to `fake`. Use distinct keys to simulate multiple providers in tests. */
  key?: string;
  displayName?: string;
  /**
   * Already-resolved webhook signing secret. Prefer resolving the reference through
   * SecretsProvider at the call site (or via `secrets` + `webhookSecretRef`).
   */
  signingSecret?: string;
  /** Optional SecretsProvider used to resolve `webhookSecretRef` when signing outbound events. */
  secrets?: SecretsProvider;
  /** Secret reference such as `env://FAKE_WEBHOOK_SECRET`. */
  webhookSecretRef?: string;
  now?: () => number;
  idGenerator?: () => string;
}

export class FakePaymentProvider implements PaymentProvider {
  readonly key: string;
  readonly displayName: string;
  readonly capabilities = new Set(ALL_PROVIDER_CAPABILITIES);
  readonly supportedCurrencies = SUPPORTED_CURRENCIES;

  readonly state = new FakeProviderState();
  private readonly options: FakePaymentProviderOptions;

  constructor(options: FakePaymentProviderOptions = {}) {
    this.options = options;
    this.key = options.key ?? 'fake';
    this.displayName = options.displayName ?? 'Fake Payment Provider';
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private nextId(prefix: string): string {
    const suffix = this.options.idGenerator?.() ?? randomUUID().replace(/-/g, '').slice(0, 16);
    return `${prefix}_${suffix}`;
  }

  private async resolveSigningSecret(
    ctxSecret?: string,
    credentials?: Record<string, string>,
  ): Promise<string | undefined> {
    if (ctxSecret) {
      return ctxSecret;
    }
    if (credentials?.webhookSecret) {
      return credentials.webhookSecret;
    }
    if (this.options.signingSecret) {
      return this.options.signingSecret;
    }
    if (this.options.secrets && this.options.webhookSecretRef) {
      return this.options.secrets.resolve(this.options.webhookSecretRef);
    }
    return undefined;
  }

  async createPayment(input: CreatePaymentInput, _ctx: ProviderContext): Promise<PaymentResult> {
    const existingId = this.state.paymentsByIdempotency.get(input.idempotencyKey);
    if (existingId) {
      const existing = this.state.payments.get(existingId);
      if (existing) {
        return structuredClone(existing.result);
      }
    }

    const scenario = resolveFakeScenario(input.metadata);

    if (scenario === FakeScenario.PROVIDER_UNAVAILABLE) {
      throw new ProviderError(ProviderFailureCode.PROVIDER_UNAVAILABLE, 'Fake provider unavailable.', {
        retryable: true,
        providerCode: 'fake.UNAVAILABLE',
      });
    }

    const providerPaymentId = this.nextId('fake_pay');
    const createdAt = new Date(this.now());
    const base: PaymentResult = {
      paymentId: input.paymentId,
      providerPaymentId,
      status: 'PROCESSING',
      amount: { ...input.amount },
      createdAt,
      providerMetadata: {
        scenario,
        customerReference: input.customerReference,
      },
    };

    let result = base;

    switch (scenario) {
      case FakeScenario.INSTANT_SUCCESS: {
        result = { ...base, status: 'PAID' };
        break;
      }
      case FakeScenario.DECLINED: {
        result = {
          ...base,
          status: 'FAILED',
          failure: {
            code: ProviderFailureCode.PAYMENT_DECLINED,
            message: 'Card was declined.',
            providerCode: 'fake.DECLINED',
            retryable: false,
          },
        };
        break;
      }
      case FakeScenario.INSUFFICIENT_FUNDS: {
        result = {
          ...base,
          status: 'FAILED',
          failure: {
            code: ProviderFailureCode.INSUFFICIENT_FUNDS,
            message: 'Insufficient funds.',
            providerCode: 'fake.INSUFFICIENT_FUNDS',
            retryable: false,
          },
        };
        break;
      }
      case FakeScenario.PROCESSING:
      case FakeScenario.REFUND_FAILURE:
      case FakeScenario.SUCCESS:
      case FakeScenario.DELAYED_SUCCESS:
      case FakeScenario.DUPLICATE_WEBHOOK:
      case FakeScenario.OUT_OF_ORDER_WEBHOOK:
      default: {
        result = {
          ...base,
          status: 'PROCESSING',
          checkoutUrl: `https://checkout.fake.test/pay/${providerPaymentId}`,
        };
        break;
      }
    }

    this.state.storePayment(result, scenario, input.idempotencyKey);
    this.enqueueScenarioWebhooks(result, scenario, input.metadata);
    return structuredClone(result);
  }

  private enqueueScenarioWebhooks(
    result: PaymentResult,
    scenario: FakeScenario,
    metadata: Record<string, string>,
  ): void {
    const delay = fakeDelayMs(metadata);
    const paidPayload = this.paymentWebhookPayload(result.providerPaymentId, 'PAID', result);
    const processingPayload = this.paymentWebhookPayload(
      result.providerPaymentId,
      'PROCESSING',
      result,
    );

    switch (scenario) {
      case FakeScenario.SUCCESS: {
        this.state.enqueueWebhook(paidPayload, this.now() + delay);
        break;
      }
      case FakeScenario.DELAYED_SUCCESS: {
        this.state.enqueueWebhook(paidPayload, this.now() + (delay > 0 ? delay : 25));
        break;
      }
      case FakeScenario.DUPLICATE_WEBHOOK: {
        const eventId = `fake_evt_dup_${result.providerPaymentId}`;
        const payload = { ...paidPayload, providerEventId: eventId };
        this.state.enqueueWebhook(payload, this.now());
        this.state.enqueueWebhook({ ...payload }, this.now());
        break;
      }
      case FakeScenario.OUT_OF_ORDER_WEBHOOK: {
        // Same emit time; array order is paid then processing (out of chronological order).
        this.state.enqueueWebhook(paidPayload, this.now());
        this.state.enqueueWebhook(processingPayload, this.now());
        break;
      }
      default:
        break;
    }
  }

  private paymentWebhookPayload(
    providerPaymentId: string,
    status: PaymentResult['status'],
    result: PaymentResult,
  ): Record<string, unknown> {
    return {
      kind: 'PAYMENT',
      providerEventId: `fake_evt_${providerPaymentId}_${status.toLowerCase()}`,
      providerEventType: `payment.${status.toLowerCase()}`,
      providerPaymentId,
      status,
      amount: result.amount,
      occurredAt: new Date(this.now()).toISOString(),
    };
  }

  async getPayment(providerPaymentId: string, _ctx: ProviderContext): Promise<PaymentResult> {
    const stored = this.state.payments.get(providerPaymentId);
    if (!stored) {
      throw new ProviderError(ProviderFailureCode.UNKNOWN, 'Payment not found at provider.', {
        retryable: false,
        providerCode: 'fake.NOT_FOUND',
      });
    }
    return structuredClone(stored.result);
  }

  async createPaymentMethod(input: CreatePaymentMethodInput, _ctx: ProviderContext) {
    if (!input.setupToken || input.setupToken.trim().length === 0) {
      throw new ProviderError(
        ProviderFailureCode.INVALID_PAYMENT_METHOD,
        'setupToken is required.',
        { retryable: false },
      );
    }

    // Derive a deterministic last4 from the token without embedding full card numbers.
    const digest = createHash('sha256').update(input.setupToken).digest('hex');
    const last4 = (Number.parseInt(digest.slice(0, 4), 16) % 10_000).toString().padStart(4, '0');

    const result = {
      providerPaymentMethodId: this.nextId('fake_pm'),
      type: 'CARD' as const,
      brand: 'visa',
      last4,
      expirationMonth: 12,
      expirationYear: 2030,
      holderName: 'Fake Cardholder',
      providerMetadata: {
        setupTokenFingerprint: digest.slice(0, 12),
        customerReference: input.customerReference,
      },
    };

    this.state.methods.set(result.providerPaymentMethodId, {
      result,
      setupToken: input.setupToken,
    });
    return structuredClone(result);
  }

  async chargePaymentMethod(
    input: ChargePaymentMethodInput,
    ctx: ProviderContext,
  ): Promise<PaymentResult> {
    const method = this.state.methods.get(input.providerPaymentMethodId);
    if (!method) {
      throw new ProviderError(
        ProviderFailureCode.INVALID_PAYMENT_METHOD,
        'Unknown payment method token.',
        { retryable: false },
      );
    }
    return this.createPayment(
      {
        ...input,
        metadata: {
          ...input.metadata,
          fakeScenario: input.metadata.fakeScenario ?? FakeScenario.INSTANT_SUCCESS,
        },
      },
      ctx,
    );
  }

  async refundPayment(input: RefundPaymentInput, _ctx: ProviderContext): Promise<RefundResult> {
    const existingId = this.state.refundsByIdempotency.get(input.idempotencyKey);
    if (existingId) {
      const existing = this.state.refunds.get(existingId);
      if (existing) {
        return structuredClone(existing.result);
      }
    }

    const stored = this.state.payments.get(input.providerPaymentId);
    if (!stored) {
      throw new ProviderError(ProviderFailureCode.UNKNOWN, 'Payment not found for refund.', {
        retryable: false,
      });
    }

    if (stored.scenario === FakeScenario.REFUND_FAILURE) {
      throw new ProviderError(ProviderFailureCode.REFUND_NOT_ALLOWED, 'Refund scenario failure.', {
        retryable: false,
        providerCode: 'fake.REFUND_FAILURE',
      });
    }

    if (stored.result.status !== 'PAID' && stored.result.status !== 'AUTHORIZED') {
      throw new ProviderError(
        ProviderFailureCode.REFUND_NOT_ALLOWED,
        'Payment is not refundable in its current status.',
        { retryable: false },
      );
    }

    const remaining = stored.result.amount.amount - stored.refundedAmount;
    if (input.amount.currency !== stored.result.amount.currency) {
      throw new ProviderError(
        ProviderFailureCode.CURRENCY_NOT_SUPPORTED,
        'Refund currency mismatch.',
        { retryable: false },
      );
    }
    if (input.amount.amount > remaining) {
      throw new ProviderError(
        ProviderFailureCode.REFUND_NOT_ALLOWED,
        'Refund exceeds remaining capturable amount.',
        { retryable: false },
      );
    }

    const providerRefundId = this.nextId('fake_rfnd');
    const result: RefundResult = {
      providerRefundId,
      status: 'SUCCEEDED',
      amount: { ...input.amount },
      createdAt: new Date(this.now()),
      providerMetadata: {
        moniveoRefundId: input.refundId,
        isFullRefund: input.isFullRefund,
      },
    };

    stored.refundedAmount += input.amount.amount;
    this.state.refunds.set(providerRefundId, {
      result,
      providerPaymentId: input.providerPaymentId,
      idempotencyKey: input.idempotencyKey,
    });
    this.state.refundsByIdempotency.set(input.idempotencyKey, providerRefundId);
    return structuredClone(result);
  }

  async verifyWebhook(
    request: RawWebhookRequest,
    ctx: WebhookContext,
  ): Promise<WebhookVerificationResult> {
    const secret = await this.resolveSigningSecret(ctx.signingSecret);
    if (secret) {
      return verifyFakeWebhookSignature(request, secret);
    }

    for (const account of ctx.candidateAccounts) {
      if (!account.signingSecret) {
        continue;
      }
      const result = verifyFakeWebhookSignature(request, account.signingSecret);
      if (result.verified) {
        return result;
      }
    }

    return verifyFakeWebhookSignature(request, undefined);
  }

  async parseWebhook(request: RawWebhookRequest): Promise<NormalizedWebhookEvent> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(request.rawBody.toString('utf8'));
    } catch {
      return {
        kind: 'UNKNOWN',
        providerEventId: `sha256:${createHash('sha256').update(request.rawBody).digest('hex')}`,
        providerEventType: 'unparseable',
        providerMetadata: {},
      };
    }

    if (!parsed || typeof parsed !== 'object') {
      return {
        kind: 'UNKNOWN',
        providerEventId: `sha256:${createHash('sha256').update(request.rawBody).digest('hex')}`,
        providerEventType: 'invalid',
        providerMetadata: {},
      };
    }

    const body = parsed as Record<string, unknown>;
    const providerEventId =
      typeof body.providerEventId === 'string' && body.providerEventId.length > 0
        ? body.providerEventId
        : `sha256:${createHash('sha256').update(request.rawBody).digest('hex')}`;
    const providerEventType =
      typeof body.providerEventType === 'string' ? body.providerEventType : 'unknown';
    const occurredAt =
      typeof body.occurredAt === 'string' ? new Date(body.occurredAt) : undefined;

    if (body.kind === 'PAYMENT' && typeof body.providerPaymentId === 'string') {
      const status = (body.status as PaymentResult['status'] | 'CHARGEBACK') ?? 'PROCESSING';
      const event: NormalizedWebhookEvent = {
        kind: 'PAYMENT',
        providerEventId,
        providerEventType,
        providerPaymentId: body.providerPaymentId,
        status,
        providerMetadata: { raw: body },
      };
      if (occurredAt !== undefined) {
        event.occurredAt = occurredAt;
      }
      if (body.amount && typeof body.amount === 'object') {
        event.amount = body.amount as PaymentResult['amount'];
      }
      // Keep in-memory provider state aligned so later refunds/charges see the webhook outcome.
      if (status !== 'CHARGEBACK' && this.state.payments.has(body.providerPaymentId)) {
        this.state.updatePaymentStatus(body.providerPaymentId, status);
      }
      return event;
    }

    if (body.kind === 'REFUND' && typeof body.providerRefundId === 'string') {
      const event: NormalizedWebhookEvent = {
        kind: 'REFUND',
        providerEventId,
        providerEventType,
        providerRefundId: body.providerRefundId,
        status: body.status === 'FAILED' ? 'FAILED' : 'SUCCEEDED',
        providerMetadata: { raw: body },
      };
      if (occurredAt !== undefined) {
        event.occurredAt = occurredAt;
      }
      if (typeof body.providerPaymentId === 'string') {
        event.providerPaymentId = body.providerPaymentId;
      }
      return event;
    }

    return {
      kind: 'UNKNOWN',
      providerEventId,
      providerEventType,
      providerMetadata: { raw: body },
    };
  }

  /**
   * Drive a stored payment to an outcome without reaching into registry internals.
   * Used by the provider contract harness.
   */
  async simulate(
    providerPaymentId: string,
    outcome: 'PAID' | 'FAILED' | 'AUTHORIZED',
  ): Promise<void> {
    const failure: ProviderFailure | undefined =
      outcome === 'FAILED'
        ? {
            code: ProviderFailureCode.PAYMENT_DECLINED,
            message: 'Simulated failure.',
            retryable: false,
          }
        : undefined;
    this.state.updatePaymentStatus(providerPaymentId, outcome, failure);
  }

  /** Drain due webhooks as signed RawWebhookRequest values. */
  async drainSignedWebhooks(ctx?: WebhookContext): Promise<RawWebhookRequest[]> {
    const secret =
      (await this.resolveSigningSecret(ctx?.signingSecret)) ?? 'test-fake-webhook-secret';
    const payloads = this.state.drainWebhooks(this.now());
    return payloads.map((payload) => {
      const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
      const signature = signFakeWebhook(rawBody, secret);
      return {
        rawBody,
        headers: { [FAKE_SIGNATURE_HEADER]: signature },
        query: {},
      };
    });
  }

  /** Build a signed webhook request for an arbitrary payload (tests). */
  async signWebhookPayload(
    payload: Record<string, unknown>,
    secret?: string,
  ): Promise<RawWebhookRequest> {
    const resolved = secret ?? (await this.resolveSigningSecret()) ?? 'test-fake-webhook-secret';
    const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
    return {
      rawBody,
      headers: { [FAKE_SIGNATURE_HEADER]: signFakeWebhook(rawBody, resolved) },
      query: {},
    };
  }

  createSetupToken(): string {
    return `fake_setup_${randomUUID().replace(/-/g, '')}`;
  }
}

export { FakeScenario } from './scenarios';
export { FAKE_SIGNATURE_HEADER, signFakeWebhook, verifyFakeWebhookSignature } from './signature';
