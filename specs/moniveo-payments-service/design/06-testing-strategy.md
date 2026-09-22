---
design:
  id: "D-006"
  title: "Testing Strategy"
  spec_slug: "moniveo-payments-service"
  created: "2026-09-18T22:45:00Z"
  updated: "2026-09-18T22:45:00Z"
---

# Testing Strategy

The house rule in both sibling repos (`.cursor/rules/02-testing/RULE.md`) is that a route or service
function without tests covering success and failure is incomplete. For a financial service the bar
is higher, so this adds two things the existing repos do not have: integration tests against a real
PostgreSQL instance, and a reusable provider contract suite.

## A deliberate departure from the sibling repos

`moni-resident` tests its backend entirely with `vi.mock('@prisma/client')`. That approach cannot
work here, because the most important guarantees in this service *are* database behaviour:

- the unique index on `(organization_id, external_reference)` preventing a duplicate charge,
- the unique index on `(provider, provider_event_id)` deduplicating webhooks,
- the `CHECK (refunded_amount <= amount)` constraint preventing over-refunding,
- idempotency-key insertion racing under concurrency.

Mocked Prisma would report all four as passing while the real constraint was missing. So Prisma is
mocked only in pure unit tests of logic that happens to sit near the database; every guarantee that
depends on Postgres is tested against Postgres.

## Layers

| Layer | Location | Database | Runtime | Runs on |
| --- | --- | --- | --- | --- |
| Unit | `tests/unit/` | none | milliseconds | every save |
| Contract | `tests/contract/` | none | milliseconds | every save |
| Integration | `tests/integration/` | real Postgres | seconds | pre-push, CI |
| End-to-end | `tests/e2e/` | real Postgres | seconds | pre-push, CI |

`pnpm test` runs all four. `pnpm test:unit` runs the first two and needs no Docker, which keeps the
inner loop fast.

## Test database

A single Postgres container serves both development and tests, using two databases on the same
instance. This avoids a second container, avoids Testcontainers as a dependency, and keeps
`docker compose up -d` as the only infrastructure step.

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: moniveo
      POSTGRES_PASSWORD: moniveo
      POSTGRES_DB: moniveo_payments
    ports: ["5433:5432"]
    volumes:
      - ./docker/init-test-db.sql:/docker-entrypoint-initdb.d/init-test-db.sql
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U moniveo -d moniveo_payments"]
      interval: 5s
      retries: 10
```

Port `5433` rather than `5432`, because most developers already have something on `5432` and a
port collision during onboarding is a poor first impression. `init-test-db.sql` is one line:
`CREATE DATABASE moniveo_payments_test;`.

`tests/helpers/db.ts` runs `prisma migrate deploy` against `TEST_DATABASE_URL` once per run via a
Vitest `globalSetup`, then truncates between tests:

```ts
export async function resetDatabase(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      outbox_events, event_subscriptions, webhook_events, idempotency_keys,
      refunds, payment_attempts, payments, payment_methods,
      payment_accounts, organizations, service_clients
    RESTART IDENTITY CASCADE;
  `);
}
```

Truncation rather than transaction rollback, because several tests exercise concurrency across
multiple connections and a wrapping transaction would hide exactly the races being tested.

Integration files run with `singleThread: true` so they share one database without interfering:

```ts
// vitest.config.ts
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/helpers/global-setup.ts'],
    poolOptions: { threads: { singleThread: true } },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      thresholds: {
        'src/domain/**':    { lines: 95, functions: 95, branches: 90 },
        'src/modules/**':   { lines: 85, functions: 85, branches: 75 },
        'src/providers/**': { lines: 90, functions: 90, branches: 80 },
      },
    },
  },
});
```

Per-directory thresholds rather than one global number. A single 80% target lets thin coverage of
the status machine hide behind thorough coverage of route plumbing, and the status machine is where
the money is.

## Unit tests

Pure functions, no I/O.

**`tests/unit/domain/payment-status.test.ts`** — every legal transition in `ALLOWED_TRANSITIONS`
succeeds; a table-driven case asserts every illegal pair throws `INVALID_PAYMENT_STATE`. Terminal
states accept nothing. Each transition sets the right timestamp and leaves the others null.

**`tests/unit/domain/money.test.ts`** — non-integers rejected rather than rounded; zero and negative
rejected; the upper bound enforced; unknown currency codes rejected; mismatched currencies rejected
on comparison. One explicit regression test: `8500` formats as `$85.00` and the codebase contains no
path that divides by 100 into a float.

**`tests/unit/domain/refund-rules.test.ts`** — refundable amount by status; exact-remainder refund
allowed and one minor unit more rejected; a sequence of partial refunds summing to the total ends in
`REFUNDED`; partial refund rejected when the provider lacks `PARTIAL_REFUNDS`.

**`tests/unit/providers/registry.test.ts`** — unknown key throws `PROVIDER_NOT_FOUND`; capability
checks reflect the adapter's declarations; `list()` matches what `GET /v1/providers` serialises.

**`tests/unit/providers/fake/*.test.ts`** — each scenario produces the documented result; webhook
signatures verify with the right secret and fail with a wrong one; a tampered body fails
verification.

**`tests/unit/platform/idempotency.test.ts`** — fingerprinting is stable across key order and
whitespace, and differs when a value differs.

**`tests/unit/platform/secrets.test.ts`** — `env://NAME` resolves; an unknown reference throws
`PROVIDER_CONFIGURATION_ERROR`; a malformed scheme is rejected; the error message does not contain
the resolved value.

**`tests/unit/platform/logging.test.ts`** — a log record containing `authorization`, `apiKey`,
`webhookSecret`, `credentials`, `setupToken`, or `rawBody` emits `[REDACTED]`. This is asserted
rather than assumed, because redaction configuration is easy to break silently.

## Provider contract tests

`tests/contract/payment-provider.contract.ts` exports one function that every adapter must pass. It
is the mechanism that makes "another provider can be added without changing core business logic"
checkable rather than aspirational.

```ts
export interface ContractHarness {
  provider: PaymentProvider;
  context: ProviderContext;
  /** Drive the provider toward an outcome without reaching into its internals. */
  simulate(
    providerPaymentId: string,
    outcome: 'PAID' | 'FAILED' | 'AUTHORIZED',
  ): Promise<void>;
  /** Produce a tokenizable setup token. Skipped when TOKENIZATION is absent. */
  createSetupToken?(): Promise<string>;
}

export function runPaymentProviderContract(
  name: string,
  createHarness: () => Promise<ContractHarness>,
): void;
```

The suite asserts, for every adapter:

*Declaration consistency.* `key` is non-empty and matches the registry. `capabilities` and method
presence agree in both directions — `REFUNDS` implies `refundPayment` exists, and `refundPayment`
existing implies `REFUNDS` is declared. `PARTIAL_REFUNDS` implies `REFUNDS`.
`WEBHOOK_SIGNATURE_VERIFICATION` implies `WEBHOOKS`. `supportedCurrencies` is non-empty and all
entries are valid ISO 4217.

*Payment creation.* Returns a non-empty `providerPaymentId` and a `status` inside
`NormalizedPaymentStatus`. `amount` round-trips exactly, including currency. `REDIRECT_CHECKOUT`
implies a `checkoutUrl` when the status is `PENDING` or `PROCESSING`. `providerMetadata` is a plain
object. Two calls with different `idempotencyKey` values produce different `providerPaymentId`
values; two calls with the same key produce the same one.

*Retrieval.* `getPayment` on a known id returns a result whose `providerPaymentId` and `amount`
match creation. On an unknown id it throws `ProviderError`, never returns null or undefined.

*Failure mapping.* A declined payment yields `status: 'FAILED'` with `failure.code` inside
`ProviderFailureCode` and `failure.retryable` a boolean. Errors thrown are always `ProviderError`,
never a raw HTTP or SDK error — asserted by rejecting any thrown value that is not an instance of
`ProviderError`.

*Refunds*, when declared. A full refund succeeds. A partial refund succeeds when `PARTIAL_REFUNDS`
is declared. A refund exceeding the payment throws `ProviderError` with `REFUND_NOT_ALLOWED`.
`providerRefundId` differs from `providerPaymentId`.

*Tokenization*, when declared. `createPaymentMethod` with a setup token returns a
`providerPaymentMethodId` and, for `CARD`, a `last4` of exactly four digits. No returned field
contains anything resembling a full PAN, asserted with a Luhn-length regex over the serialised
result. `chargePaymentMethod` with that token produces a payment.

*Webhooks*, when declared. `parseWebhook` returns a discriminated union member with a non-empty
`providerEventId`. The same raw body parses to the same `providerEventId` twice — the property
duplicate detection depends on. A body the provider did not produce yields `kind: 'UNKNOWN'` rather
than throwing. With `WEBHOOK_SIGNATURE_VERIFICATION`, a correctly signed body verifies, a body with
one byte changed does not, and a missing signature header does not.

Wiring an adapter in is four lines:

```ts
// tests/contract/fake-provider.contract.test.ts
runPaymentProviderContract('FakePaymentProvider', async () => {
  const provider = new FakePaymentProvider();
  return { provider, context: testProviderContext(), simulate: /* ... */ };
});
```

When Pagadito arrives, `pagadito.contract.test.ts` is the same four lines against a recorded-HTTP
harness. An adapter that cannot pass the suite is not finished.

## Integration tests

Real Postgres, real Fastify via `app.inject()`, fake provider. No HTTP socket is opened, so tests
stay fast while exercising the complete middleware chain — authentication, validation, idempotency,
error handling, serialisation.

```ts
const response = await app.inject({
  method: 'POST',
  url: '/v1/payments',
  headers: { authorization: `Bearer ${apiKey}`, 'idempotency-key': 'k1' },
  payload: { organizationId, externalReference: 'fee-1', customerReference: 'c-1',
             amount: 8500, currency: 'USD' },
});
```

**Organizations** — creation persists and scopes to the caller's product; duplicate `externalId`
returns `409`; a Health key reading a Resident organization gets `404`, not `403`; `sourceProduct`
in the request body is ignored rather than honoured.

**Payment accounts** — creation resolves credential references; an unresolvable reference yields
`PENDING_CONFIGURATION`; responses never contain a secret value or reference, asserted by scanning
the serialised body for the known test secret string; the partial unique index permits only one
default per organization.

**Payment creation** — a successful fake payment reaches `PROCESSING` with attempt 1; an instant
success reaches `PAID` with `paidAt` set; a decline returns `402` **and** persists a `FAILED`
payment; an unconfigured organization returns `422 PROVIDER_CONFIGURATION_ERROR`; an unsupported
currency returns `422`; a duplicate `externalReference` returns `409` carrying the existing id.

**Idempotency** — the same key with the same body returns the identical response with
`Idempotency-Replayed: true` and exactly one payment row; the same key with a different body returns
`409 DUPLICATE_REQUEST`; keys are scoped per service client, so two products using key `k1`
independently both succeed; a missing key on a mutation returns `422`. The decisive case fires ten
concurrent identical requests with `Promise.all` and asserts exactly one payment row exists and one
response is authoritative while the rest replay or return `REQUEST_IN_PROGRESS`. This is the test
that proves the requirement "duplicate payment requests cannot create duplicate charges", and it
only means anything against a real database.

**Webhooks** — a valid signed webhook moves `PROCESSING` to `PAID` and writes `payment.paid` to the
outbox; an invalid signature returns `401` and persists nothing; a duplicate `providerEventId`
returns `202` with `duplicate: true` and leaves the payment untouched with no second outbox event;
an out-of-order `processing` event arriving after `paid` is recorded `IGNORED` and changes nothing;
an event for an unknown `providerPaymentId` is `IGNORED`, not `FAILED`; a processing error sets
`FAILED` with `nextRetryAt` and succeeds on retry; twenty concurrent deliveries of the same event
produce exactly one state change.

**Refunds** — a full refund moves `PAID` to `REFUNDED`; two partial refunds summing to the total end
at `REFUNDED` with correct intermediate `PARTIALLY_REFUNDED` and `refundableAmount` values; one minor
unit over the remainder returns `409`; a refund against a `PENDING` payment returns `409`; the
original payment's `amount`, `createdAt`, and `paidAt` are byte-identical before and after, which is
the audit-immutability assertion; two concurrent full refunds result in exactly one success, with
the `CHECK` constraint proven by a direct raw-SQL over-refund attempt that must be rejected.

**Internal events** — a paid payment enqueues `payment.paid`; the dispatcher delivers it to a
subscription with a valid `X-Moniveo-Signature`; a receiver returning 500 causes a retry with
growing `nextAttemptAt`; exceeding the budget marks it `DEAD`; redelivery reuses the same
`X-Moniveo-Event-Id`.

**Security and configuration** — `/dev/*` returns `404` under `NODE_ENV=production`; a missing or
malformed API key returns `401`; a revoked client returns `401`; webhook rate limiting returns `429`
past the threshold; a request body above the size limit returns `413`; booting with an invalid
environment throws before the server listens.

## End-to-end test

`tests/e2e/payment-lifecycle.e2e.test.ts` implements the milestone-1 sequence exactly as drawn in
the lifecycle document, with `tests/helpers/simulated-product-backend.ts` standing in for the
Resident backend: a small HTTP server that records callbacks, verifies signatures, and can be told
to fail on demand.

```
create organization
  -> configure fake payment account
  -> create payment (8500 USD)
  -> replay the same Idempotency-Key, assert one payment
  -> fake provider emits a signed paid webhook
  -> payment becomes PAID
  -> simulated Resident backend receives payment.paid with a valid signature
  -> duplicate webhook arrives, nothing changes and no second callback fires
  -> full refund
  -> payment becomes REFUNDED
  -> simulated backend receives payment.refunded
```

A second e2e case covers multi-tenant provider selection: two organizations on two different
registered providers (the fake registered twice under distinct keys with different merchant
identifiers) each complete a payment, and the test asserts each was routed to its own account and
that no code path branched on the organization. That is the executable form of "provider selection
works per organization".

## What is intentionally not tested

Stated so the gaps are decisions rather than oversights.

- **No load or performance testing.** Premature at this stage; the indexes are designed for the
  known queries and that is the extent of the performance commitment.
- **No mutation testing.** Valuable for a status machine, but the per-directory coverage thresholds
  plus table-driven transition tests give most of the benefit at a fraction of the runtime.
- **No snapshot tests on API responses.** Snapshots on financial payloads tend to get regenerated
  without being read. Explicit field assertions are used instead.
- **No tests against real provider sandboxes.** There is no real provider yet. When Pagadito lands,
  it gets the contract suite against recorded HTTP fixtures plus a manually-run sandbox smoke test
  kept out of CI.

## CI

GitHub Actions, Node 20.19.4, pnpm 9.15.4, a `postgres:16-alpine` service container:

```
pnpm install --frozen-lockfile
pnpm db:generate
pnpm lint
pnpm typecheck
pnpm test          # unit + contract + integration + e2e
pnpm openapi:check # fails if the committed openapi.json is stale
```

CI additionally greps the diff for forbidden patterns — `cardNumber`, `cvv`, `pan`, `track2` — as a
blunt but effective guard against a schema or DTO change quietly pulling the service inside the
cardholder data environment.
