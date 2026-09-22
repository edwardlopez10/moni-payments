import type { ProviderCapability } from './capabilities';

export interface Money {
  /** Integer minor units. 8500 === USD 85.00 */
  amount: number;
  /** ISO 4217 alpha-3 */
  currency: string;
}

export type NormalizedPaymentStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'AUTHORIZED'
  | 'PAID'
  | 'FAILED'
  | 'CANCELLED';

export const ProviderFailureCode = {
  PAYMENT_DECLINED: 'PAYMENT_DECLINED',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  INVALID_PAYMENT_METHOD: 'INVALID_PAYMENT_METHOD',
  EXPIRED_PAYMENT_METHOD: 'EXPIRED_PAYMENT_METHOD',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  PROVIDER_CONFIGURATION_ERROR: 'PROVIDER_CONFIGURATION_ERROR',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  DUPLICATE_TRANSACTION: 'DUPLICATE_TRANSACTION',
  AMOUNT_NOT_ALLOWED: 'AMOUNT_NOT_ALLOWED',
  CURRENCY_NOT_SUPPORTED: 'CURRENCY_NOT_SUPPORTED',
  REFUND_NOT_ALLOWED: 'REFUND_NOT_ALLOWED',
  UNKNOWN: 'UNKNOWN',
} as const;

export type ProviderFailureCode =
  (typeof ProviderFailureCode)[keyof typeof ProviderFailureCode];

export interface ProviderFailure {
  code: ProviderFailureCode;
  message: string;
  /** Provider's own code, for support tickets. Never returned to calling products. */
  providerCode?: string;
  retryable: boolean;
}

export interface PaymentResult {
  /** Moniveo payment id echoed back for correlation. */
  paymentId: string;
  providerPaymentId: string;
  status: NormalizedPaymentStatus;
  amount: Money;
  createdAt: Date;
  /** Present when the provider expects the payer to be redirected. */
  checkoutUrl?: string;
  /** Present when the provider returns a client token for embedded checkout. */
  clientToken?: string;
  /** Set when status is FAILED. */
  failure?: ProviderFailure;
  /** Opaque. Persisted for support and reconciliation, never branched on. */
  providerMetadata: Record<string, unknown>;
}

export interface PaymentMethodResult {
  providerPaymentMethodId: string;
  type: 'CARD' | 'BANK_ACCOUNT' | 'WALLET' | 'OTHER';
  brand?: string;
  last4?: string;
  expirationMonth?: number;
  expirationYear?: number;
  holderName?: string;
  providerMetadata: Record<string, unknown>;
}

export interface RefundResult {
  providerRefundId: string;
  status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
  amount: Money;
  createdAt: Date;
  failure?: ProviderFailure;
  providerMetadata: Record<string, unknown>;
}

export interface RawWebhookRequest {
  /** Exact bytes as received. Signature verification depends on this being untouched. */
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | string[] | undefined>;
}

export interface WebhookVerificationResult {
  verified: boolean;
  /** Populated when verification fails, for logging. Not returned to the caller. */
  reason?: string;
}

export type NormalizedWebhookEvent =
  | PaymentWebhookEvent
  | RefundWebhookEvent
  | UnknownWebhookEvent;

interface WebhookEventBase {
  /** Stable per-delivery id. Adapter falls back to `sha256:<hex>` of rawBody. */
  providerEventId: string;
  /** Provider's own event name, stored for observability. */
  providerEventType: string;
  /** Provider's timestamp when available; used for ordering diagnostics only. */
  occurredAt?: Date;
  providerMetadata: Record<string, unknown>;
}

export interface PaymentWebhookEvent extends WebhookEventBase {
  kind: 'PAYMENT';
  providerPaymentId: string;
  status: NormalizedPaymentStatus | 'CHARGEBACK';
  amount?: Money;
  failure?: ProviderFailure;
}

export interface RefundWebhookEvent extends WebhookEventBase {
  kind: 'REFUND';
  providerRefundId: string;
  providerPaymentId?: string;
  status: 'SUCCEEDED' | 'FAILED';
  amount?: Money;
  failure?: ProviderFailure;
}

/** Recognised as well-formed but not actionable. Recorded, then IGNORED. */
export interface UnknownWebhookEvent extends WebhookEventBase {
  kind: 'UNKNOWN';
}

export interface ProviderContext {
  organizationId: string;
  paymentAccountId: string;
  providerMerchantId: string;
  /** Non-sensitive settings from PaymentAccount.configuration. */
  configuration: Record<string, unknown>;
  /** Secrets already resolved by SecretsProvider. Never logged. */
  credentials: Record<string, string>;
  /** Correlation id for provider-call logging. */
  requestId: string;
}

export interface WebhookContext {
  provider: string;
  /** Resolved webhook signing secret, when the provider account has one. */
  signingSecret?: string;
  /**
   * Accounts that could have sent this event. A webhook arrives before we know which
   * organization it belongs to, so verification may need to try each candidate secret.
   */
  candidateAccounts: Array<{
    paymentAccountId: string;
    providerMerchantId: string;
    signingSecret?: string;
  }>;
}

export interface CreatePaymentInput {
  paymentId: string;
  amount: Money;
  description?: string;
  customerReference: string;
  /** Charge a stored token instead of collecting new details. */
  providerPaymentMethodId?: string;
  returnUrl?: string;
  cancelUrl?: string;
  /** Forwarded to the provider when supported, for provider-side dedupe. */
  idempotencyKey: string;
  metadata: Record<string, string>;
}

export interface CreatePaymentMethodInput {
  organizationId: string;
  customerReference: string;
  /**
   * Single-use token produced by provider-hosted collection.
   * Raw card data is never accepted by this interface.
   */
  setupToken: string;
  metadata: Record<string, string>;
}

export interface ChargePaymentMethodInput extends CreatePaymentInput {
  providerPaymentMethodId: string;
}

export interface RefundPaymentInput {
  refundId: string;
  providerPaymentId: string;
  amount: Money;
  /** True when amount equals the full captured amount. */
  isFullRefund: boolean;
  reason?: string;
  idempotencyKey: string;
}

export interface PaymentProvider {
  readonly key: string;
  readonly displayName: string;
  readonly capabilities: ReadonlySet<ProviderCapability>;
  readonly supportedCurrencies: ReadonlySet<string>;

  createPayment(input: CreatePaymentInput, ctx: ProviderContext): Promise<PaymentResult>;

  getPayment(providerPaymentId: string, ctx: ProviderContext): Promise<PaymentResult>;

  createPaymentMethod?(
    input: CreatePaymentMethodInput,
    ctx: ProviderContext,
  ): Promise<PaymentMethodResult>;

  chargePaymentMethod?(
    input: ChargePaymentMethodInput,
    ctx: ProviderContext,
  ): Promise<PaymentResult>;

  refundPayment?(input: RefundPaymentInput, ctx: ProviderContext): Promise<RefundResult>;

  verifyWebhook?(
    request: RawWebhookRequest,
    ctx: WebhookContext,
  ): Promise<WebhookVerificationResult>;

  parseWebhook?(request: RawWebhookRequest): Promise<NormalizedWebhookEvent>;
}
