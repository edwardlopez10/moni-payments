---
design:
  id: "D-003"
  title: "PaymentProvider Interface"
  spec_slug: "moniveo-payments-service"
  created: "2026-09-18T22:45:00Z"
  updated: "2026-09-18T22:45:00Z"
---

# PaymentProvider Interface

This is the contract that decides whether the "add a provider without changing core logic" goal
holds. Everything in `src/providers/types.ts` is plain TypeScript with no Prisma and no Fastify
imports, so an adapter can be unit-tested in isolation and the domain never sees a provider type.

## Capabilities

```ts
export const ProviderCapability = {
  TOKENIZATION: 'TOKENIZATION',
  REFUNDS: 'REFUNDS',
  PARTIAL_REFUNDS: 'PARTIAL_REFUNDS',
  RECURRING_PAYMENTS: 'RECURRING_PAYMENTS',
  WEBHOOKS: 'WEBHOOKS',
  WEBHOOK_SIGNATURE_VERIFICATION: 'WEBHOOK_SIGNATURE_VERIFICATION',
  REDIRECT_CHECKOUT: 'REDIRECT_CHECKOUT',
  EMBEDDED_CHECKOUT: 'EMBEDDED_CHECKOUT',
  PAYMENT_STATUS_POLLING: 'PAYMENT_STATUS_POLLING',
} as const;

export type ProviderCapability =
  (typeof ProviderCapability)[keyof typeof ProviderCapability];
```

Two capabilities were added beyond the brief's list, because both are real branch points in the
code rather than marketing labels:

- `PARTIAL_REFUNDS` separate from `REFUNDS`. Several Latin American acquirers support a full reversal
  but not a partial one. Collapsing these would force the refund service to discover the limitation
  from a runtime error instead of rejecting the request up front with `REFUND_NOT_ALLOWED`.
- `WEBHOOK_SIGNATURE_VERIFICATION` separate from `WEBHOOKS`. A provider can post webhooks without
  signing them. The distinction is what lets the ingestion pipeline decide between "reject
  unverified" and "accept but mark `verified: false`", and it makes the security posture of each
  provider explicit and auditable rather than implicit.

Const objects rather than TypeScript enums follow the `moni-resident` shared-types convention and
keep the values usable as plain strings in Zod schemas and JSON responses.

## Normalized types

No provider response object crosses this boundary. Everything provider-shaped is confined to
`providerMetadata`, which is `Record<string, unknown>` and is only ever persisted, never read by
business logic.

```ts
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

  /** Set when status is FAILED. Mapped to an internal ErrorCode by the adapter. */
  failure?: ProviderFailure;

  /** Opaque. Persisted for support and reconciliation, never branched on. */
  providerMetadata: Record<string, unknown>;
}

export interface ProviderFailure {
  code: ProviderFailureCode;
  message: string;
  /** Provider's own code, for support tickets. Never returned to calling products. */
  providerCode?: string;
  retryable: boolean;
}

export type ProviderFailureCode =
  | 'PAYMENT_DECLINED'
  | 'INSUFFICIENT_FUNDS'
  | 'INVALID_PAYMENT_METHOD'
  | 'EXPIRED_PAYMENT_METHOD'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_CONFIGURATION_ERROR'
  | 'AUTHENTICATION_REQUIRED'
  | 'DUPLICATE_TRANSACTION'
  | 'AMOUNT_NOT_ALLOWED'
  | 'CURRENCY_NOT_SUPPORTED'
  | 'REFUND_NOT_ALLOWED'
  | 'UNKNOWN';

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
```

`ProviderFailureCode` is the single translation point from provider vocabulary to Moniveo
vocabulary. Mapping happens inside the adapter, which is the only place that understands what
`"pagadito.RS-DECLINED"` means. Everything upstream sees a closed union.

## Webhook types

```ts
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
```

`UnknownWebhookEvent` matters. Providers send events we do not model — settlement notices, test
pings, account notifications. Without a neutral outcome the pipeline would have to choose between
throwing (causing pointless retries and error noise) and silently dropping (losing the audit trail).
Returning `UNKNOWN` records the event and marks it `IGNORED`.

## The interface

```ts
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

  createPayment(
    input: CreatePaymentInput,
    ctx: ProviderContext,
  ): Promise<PaymentResult>;

  getPayment(
    providerPaymentId: string,
    ctx: ProviderContext,
  ): Promise<PaymentResult>;

  createPaymentMethod?(
    input: CreatePaymentMethodInput,
    ctx: ProviderContext,
  ): Promise<PaymentMethodResult>;

  chargePaymentMethod?(
    input: ChargePaymentMethodInput,
    ctx: ProviderContext,
  ): Promise<PaymentResult>;

  refundPayment?(
    input: RefundPaymentInput,
    ctx: ProviderContext,
  ): Promise<RefundResult>;

  verifyWebhook?(
    request: RawWebhookRequest,
    ctx: WebhookContext,
  ): Promise<WebhookVerificationResult>;

  parseWebhook?(
    request: RawWebhookRequest,
  ): Promise<NormalizedWebhookEvent>;
}
```

### Why optional methods rather than throwing `NotSupported`

The brief says not to force every provider to support every capability. Marking the optional
operations as optional methods means TypeScript itself refuses to let the service call
`provider.refundPayment(...)` without a check, so an unsupported capability becomes a compile error
instead of a runtime surprise. `createPayment` and `getPayment` stay mandatory because a payment
provider that cannot do those is not a payment provider.

Capability declaration and method presence must agree, and the contract test suite asserts exactly
that: if `capabilities` contains `REFUNDS` then `refundPayment` must be defined, and vice versa.

### Webhook context

```ts
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
```

This exists because webhook verification has a genuine ordering problem: the endpoint is
`POST /v1/webhooks/:provider` with no organization in the path, but the signing secret is
per-account. The adapter is given the candidate set and decides how to resolve it — some providers
put a merchant identifier in the payload or a header, others require trying each secret.

## Provider errors

Adapters throw `ProviderError`; they never return provider-shaped errors and never let a raw HTTP
client error escape.

```ts
export class ProviderError extends Error {
  constructor(
    readonly code: ProviderFailureCode,
    message: string,
    readonly options: {
      providerCode?: string;
      retryable: boolean;
      httpStatus?: number;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
```

The service layer maps `ProviderError.code` to an API `ErrorCode`. `message` is for logs;
`providerCode` is for support. Neither reaches the calling product, which satisfies "do not expose
raw provider errors".

## Registry and selection

```ts
export interface ProviderRegistry {
  get(key: string): PaymentProvider;
  has(key: string): boolean;
  keys(): readonly string[];
  list(): readonly ProviderDescriptor[];
  supports(key: string, capability: ProviderCapability): boolean;
}

export interface ProviderDescriptor {
  key: string;
  displayName: string;
  capabilities: ProviderCapability[];
  supportedCurrencies: string[];
}
```

Registration is one line per provider in `src/providers/registry.ts`:

```ts
const registry = createRegistry([
  new FakePaymentProvider(),
  // new PagaditoProvider(httpClient),
]);
```

`GET /v1/providers` serialises `registry.list()`, so capability documentation cannot drift from the
implementations. The Zod schema validating the `provider` field on payment-account creation is built
from `registry.keys()`, so an unknown provider is a 422 at the boundary, and no database migration
is needed to add one.

Selection per payment, in `PaymentService`:

1. If the request names a `paymentAccountId`, load it and verify it belongs to the organization.
2. Otherwise load the organization's default `ACTIVE` payment account.
3. If none exists, fail with `PROVIDER_CONFIGURATION_ERROR`.
4. Resolve the adapter from the registry using the account's `provider`.
5. Check the required capability for the operation; reject early if absent.
6. Resolve `credentialRefs` through `SecretsProvider` into `ProviderContext.credentials`.

Steps 3 through 6 are identical for every provider, which is the mechanism by which Organization A
on Pagadito and Organization B on Wompi need no branching anywhere in the payment service.

## Adding a provider

The complete change set for a new provider, documented in `docs/adding-a-provider.md`:

1. Create `src/providers/<key>/index.ts` implementing `PaymentProvider`.
2. Map the provider's status vocabulary to `NormalizedPaymentStatus` and its error codes to
   `ProviderFailureCode`.
3. Declare `capabilities` and `supportedCurrencies` honestly.
4. Add one line to the registry array.
5. Add `tests/contract/<key>.contract.test.ts` running the shared suite against it.
6. Document the credential reference keys the adapter expects.

No file in `src/domain/`, `src/modules/`, or `prisma/schema.prisma` changes. A pull request that
touches those files while adding a provider is a signal the abstraction leaked, and that is the
review heuristic worth keeping.

## FakePaymentProvider

The fake is an adapter like any other, registered under the key `fake`, declaring every capability
and passing the same contract suite. It is not a mock and the application contains no branch that
tests for it.

Scenario selection is driven by the payment's `metadata`, which is data the fake adapter interprets
exactly the way a real adapter would interpret provider-specific configuration:

| `metadata.fakeScenario` | Behaviour |
| --- | --- |
| absent or `success` | `PROCESSING`, then a `paid` webhook shortly after |
| `instant_success` | returns `PAID` synchronously |
| `declined` | returns `FAILED` with `PAYMENT_DECLINED` |
| `insufficient_funds` | returns `FAILED` with `INSUFFICIENT_FUNDS` |
| `processing` | stays `PROCESSING`, no webhook until manually triggered |
| `delayed_success` | `paid` webhook after `metadata.fakeDelayMs` |
| `provider_unavailable` | throws `ProviderError('PROVIDER_UNAVAILABLE', retryable: true)` |
| `duplicate_webhook` | emits the same `providerEventId` twice |
| `out_of_order_webhook` | emits `paid` before `processing` |
| `refund_failure` | refunds fail with `REFUND_NOT_ALLOWED` |

The fake signs its webhooks with HMAC-SHA256 using a secret resolved through `SecretsProvider`, so
the verification path is genuinely exercised locally rather than stubbed out. That means signature
verification is proven working before any real provider credentials exist, which is one of the more
valuable things the fake buys.
