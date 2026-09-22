---
design:
  id: "D-005"
  title: "API Endpoint Specification"
  spec_slug: "moniveo-payments-service"
  created: "2026-09-18T22:45:00Z"
  updated: "2026-09-18T22:45:00Z"
---

# API Endpoint Specification

All business endpoints live under `/v1`. Operational endpoints (`/health`, `/ready`) and
development endpoints (`/dev/*`) are unversioned because they are not part of the product contract.

## Conventions

**Envelope.** `moni-health` wraps responses in `{ success, data, error }` and `moni-resident`
returns bare objects. This service returns **bare resource objects** on success and a structured
error object on failure. The reason is OpenAPI: a generic envelope makes every response schema a
wrapper generic, which produces poor generated clients and weak Swagger UI examples. The HTTP status
code already carries success or failure, so the envelope's `success` field is redundant.

**Money.** Always a pair of `amount` (integer minor units) and `currency` (ISO 4217 alpha-3). No
endpoint accepts or returns a decimal amount. Zod rejects non-integers rather than rounding them,
because silently rounding a client's floating-point mistake is how a cent goes missing.

**Timestamps.** UTC ISO 8601 with milliseconds, e.g. `2026-09-18T22:45:00.000Z`.

**Identifiers.** UUID v4 for every Moniveo-generated id.

**Pagination.** Cursor-based. Requests take `limit` (default 25, max 100) and `cursor`; responses
return `{ data: [...], nextCursor: string | null }`. Offset pagination is avoided because payment
lists are append-heavy and offsets skip or duplicate rows as new payments arrive.

## Authentication

Every `/v1` request carries an API key:

```http
Authorization: Bearer mvp_live_a1b2c3_<secret>
```

The key resolves to a `ServiceContext`:

```ts
interface ServiceContext {
  serviceClientId: string;
  serviceClientName: string;
  sourceProduct: 'RESIDENT' | 'HEALTH' | 'ENVIRONMENT';
  scopes: string[];
}
```

Two rules follow, and they are enforced in a Fastify `preHandler` rather than in each route:

1. A client may only access organizations whose `sourceProduct` matches its own. A Resident API key
   reading a Health organization gets `404 ORGANIZATION_NOT_FOUND` — 404 rather than 403, so the
   response does not confirm that the organization exists.
2. Every log line and every stored idempotency key carries `serviceClientId`, which is what makes
   "every request identifies the calling product" verifiable after the fact.

Webhook endpoints are the exception: they are authenticated by provider signature, not API key,
because the caller is a payment provider.

Migrating to signed service tokens later means adding a `ServiceAuthenticator` implementation that
produces the same `ServiceContext`. No route handler changes.

## Headers

| Header | Direction | Purpose |
| --- | --- | --- |
| `Authorization: Bearer <key>` | request | service authentication |
| `Idempotency-Key: <string>` | request | required on all `/v1` mutations |
| `X-Request-Id: <uuid>` | request | optional client correlation id |
| `X-Request-Id: <uuid>` | response | always returned, generated when absent |
| `Idempotency-Replayed: true` | response | present when a stored response was replayed |
| `X-Moniveo-Event-Id` | outbound callback | stable event id for consumer dedupe |
| `X-Moniveo-Signature` | outbound callback | `sha256=<hmac>` over the raw body |

## Error format

```json
{
  "error": {
    "code": "PAYMENT_DECLINED",
    "message": "The payment was declined by the provider.",
    "requestId": "8f1c0e8a-6b4e-4e2a-a0a1-f6c2d3b9a7e4",
    "details": [
      { "field": "amount", "issue": "must be a positive integer in minor units" }
    ]
  }
}
```

`details` appears only for validation failures. Provider text, provider codes, and stack traces
never appear in `message`; they are logged against `requestId` instead.

| Code | HTTP | Meaning |
| --- | --- | --- |
| `VALIDATION_ERROR` | 422 | request failed schema validation |
| `UNAUTHENTICATED` | 401 | missing or invalid API key |
| `FORBIDDEN` | 403 | authenticated but not permitted |
| `ORGANIZATION_NOT_FOUND` | 404 | unknown, or outside the caller's product |
| `PAYMENT_NOT_FOUND` | 404 | unknown payment |
| `PAYMENT_METHOD_NOT_FOUND` | 404 | unknown payment method |
| `PROVIDER_NOT_FOUND` | 404 | provider key not in the registry |
| `DUPLICATE_REQUEST` | 409 | idempotency key reused with a different payload |
| `REQUEST_IN_PROGRESS` | 409 | identical request still executing |
| `DUPLICATE_EXTERNAL_REFERENCE` | 409 | organization already has this `externalReference` |
| `INVALID_PAYMENT_STATE` | 409 | operation illegal from the current status |
| `REFUND_NOT_ALLOWED` | 409 | not refundable, or exceeds the remaining amount |
| `PAYMENT_DECLINED` | 402 | provider declined the charge |
| `INVALID_PAYMENT_METHOD` | 402 | token invalid, expired, or revoked |
| `CAPABILITY_NOT_SUPPORTED` | 422 | provider does not support the operation |
| `PROVIDER_CONFIGURATION_ERROR` | 422 | no usable payment account, or missing credentials |
| `CURRENCY_NOT_SUPPORTED` | 422 | provider does not support the currency |
| `PROVIDER_UNAVAILABLE` | 502 | provider unreachable or erroring |
| `RATE_LIMITED` | 429 | too many requests |
| `INTERNAL_ERROR` | 500 | unexpected failure |

`402 Payment Required` for declines is intentional: a decline is not a client mistake, and using 400
or 422 would make it indistinguishable from malformed input in dashboards and retry logic.

## Organizations

### `POST /v1/organizations`

Idempotent. Creates the payee entity.

```jsonc
// request
{
  "externalId": "condo-las-palmas",       // required, unique within the caller's product
  "name": "Condominio Las Palmas",
  "metadata": { "region": "sv-central" }  // optional, string values only
}
```

`sourceProduct` is **not** in the body. It comes from the authenticated `ServiceContext`, which
removes an entire class of mass-assignment bug where a Resident key creates a Health organization.

```jsonc
// 201
{
  "id": "0c0d...",
  "sourceProduct": "RESIDENT",
  "externalId": "condo-las-palmas",
  "name": "Condominio Las Palmas",
  "status": "ACTIVE",
  "metadata": { "region": "sv-central" },
  "createdAt": "2026-09-18T22:45:00.000Z",
  "updatedAt": "2026-09-18T22:45:00.000Z"
}
```

Errors: `409 DUPLICATE_EXTERNAL_REFERENCE`, `422 VALIDATION_ERROR`.

### `GET /v1/organizations/:id`

Returns the organization. `404 ORGANIZATION_NOT_FOUND` when it belongs to another product.

### `GET /v1/organizations?externalId=...`

Added beyond the brief. Products hold their own `externalId`, not the Moniveo UUID, so without this
every product would have to persist a mapping table. Returns a paginated list; combined with
`externalId` it returns zero or one result.

## Payment accounts

### `POST /v1/organizations/:id/payment-accounts`

```jsonc
{
  "provider": "fake",                       // validated against the registry
  "providerMerchantId": "MERCHANT-001",
  "isDefault": true,
  "configuration": {                        // non-sensitive only
    "returnUrl": "https://resident.moniveo.com/payments/return",
    "cancelUrl": "https://resident.moniveo.com/payments/cancel",
    "checkoutMode": "REDIRECT"
  },
  "credentialRefs": {                       // references, never values
    "apiKey": "env://FAKE_PROVIDER_API_KEY",
    "webhookSecret": "env://FAKE_PROVIDER_WEBHOOK_SECRET"
  }
}
```

The request is rejected with `422 VALIDATION_ERROR` if any `credentialRefs` value does not carry a
scheme registered with the `SecretsProvider` — today that means `env://` — which is a cheap
structural guard against someone pasting a live secret into the body. The accepted scheme set is
derived from the registered implementations rather than hardcoded, so adopting a secret manager
later widens validation without an edit here. On creation the service resolves every reference; if
one cannot be resolved the account is stored as `PENDING_CONFIGURATION` and the response says so,
rather than failing at the first payment attempt hours later.

The response echoes `configuration` but returns `credentialRefs` as keys only:

```jsonc
{
  "id": "5d2e...",
  "organizationId": "0c0d...",
  "provider": "fake",
  "providerMerchantId": "MERCHANT-001",
  "status": "ACTIVE",
  "isDefault": true,
  "configuration": { "checkoutMode": "REDIRECT", "returnUrl": "..." },
  "credentialKeys": ["apiKey", "webhookSecret"],
  "createdAt": "2026-09-18T22:45:00.000Z",
  "updatedAt": "2026-09-18T22:45:00.000Z"
}
```

Neither the secret reference nor the resolved value is ever serialised.

### `GET /v1/organizations/:id/payment-accounts`

Lists accounts with the same redaction.

### `PATCH /v1/organizations/:id/payment-accounts/:accountId`

Added beyond the brief. Rotating credential references, disabling an account, and switching the
default are all operations that would otherwise require direct database access. Accepts `status`,
`isDefault`, `configuration`, `credentialRefs`.

## Payments

### `POST /v1/payments`

Idempotent. The core endpoint.

```jsonc
{
  "organizationId": "0c0d...",
  "externalReference": "fee-2026-09/unit-402",  // unique per organization
  "customerReference": "resident-8821",
  "amount": 8500,                                // USD 85.00
  "currency": "USD",
  "description": "Cuota de mantenimiento septiembre 2026",
  "paymentAccountId": null,                      // optional; defaults to the org's default account
  "paymentMethodId": null,                       // optional; charges a stored token
  "returnUrl": "https://resident.moniveo.com/payments/return",
  "metadata": { "period": "2026-09", "fakeScenario": "success" }
}
```

Validation, in order, so the cheapest checks fail first:

1. Schema: `amount` an integer in `[1, 2_000_000_000]`, `currency` a known ISO 4217 code,
   `externalReference` 1–255 characters, `metadata` at most 20 string-valued keys.
2. Organization exists, is `ACTIVE`, and matches the caller's `sourceProduct`.
3. Payment account resolves and is `ACTIVE`.
4. Provider supports `currency`; otherwise `CURRENCY_NOT_SUPPORTED`.
5. If `paymentMethodId` is set, it belongs to the same organization and customer, is `ACTIVE`, and
   the provider declares `TOKENIZATION`.
6. `externalReference` is unused for this organization; otherwise
   `409 DUPLICATE_EXTERNAL_REFERENCE` with the existing payment id in `details`, so the caller can
   recover without guessing.

```jsonc
// 201
{
  "id": "9a7b...",
  "organizationId": "0c0d...",
  "sourceProduct": "RESIDENT",
  "externalReference": "fee-2026-09/unit-402",
  "customerReference": "resident-8821",
  "amount": 8500,
  "currency": "USD",
  "refundedAmount": 0,
  "refundableAmount": 0,                    // 0 until PAID; computed, not stored
  "status": "PROCESSING",
  "provider": "fake",
  "providerPaymentId": "fake_pay_01J8...",
  "description": "Cuota de mantenimiento septiembre 2026",
  "checkoutUrl": "http://localhost:4000/dev/fake-provider/checkout/fake_pay_01J8...",
  "metadata": { "period": "2026-09" },
  "failureCode": null,
  "failureMessage": null,
  "createdAt": "2026-09-18T22:45:00.000Z",
  "updatedAt": "2026-09-18T22:45:01.000Z",
  "authorizedAt": null,
  "paidAt": null,
  "failedAt": null,
  "latestAttempt": {
    "id": "3f1a...",
    "attemptNumber": 1,
    "status": "PROCESSING",
    "failureCode": null,
    "createdAt": "2026-09-18T22:45:00.000Z"
  }
}
```

`refundableAmount` is derived rather than stored so a client never has to reimplement the rule
"refundable only when `PAID` or `PARTIALLY_REFUNDED`, and only up to `amount - refundedAmount`".

A declined payment returns `402 PAYMENT_DECLINED` **and the payment resource is still created** with
status `FAILED`. A decline is a recorded financial event, not a request that never happened, and the
payment id is returned in `details` so the product can reference it.

### `GET /v1/payments/:id`

Returns the payment including `attempts[]` and `refunds[]`.

### `GET /v1/payments`

Query parameters: `organizationId` (required), `status` (repeatable), `customerReference`,
`externalReference`, `provider`, `createdAfter`, `createdBefore`, `limit`, `cursor`. Sorted by
`createdAt` descending, which is what the `(organization_id, status, created_at)` index serves.

### `POST /v1/payments/:id/retry`

Added beyond the brief, and the reason is structural. `PaymentAttempt` exists so that a retry does
not corrupt the original payment, but the brief provides no endpoint that creates a second attempt.
Without it, a product facing a declined payment has only one option — invent a new
`externalReference` — which defeats the duplicate-charge guarantee. This endpoint is the intended
path: it requires the payment to be `FAILED`, creates attempt N+1, and transitions back to
`PROCESSING`. Idempotent.

### `POST /v1/payments/:id/cancel`

Added beyond the brief. Cancels a `PENDING` or `PROCESSING` payment where the provider supports it,
so abandoned checkouts do not sit in `PROCESSING` forever. Idempotent.

## Refunds

### `POST /v1/payments/:id/refunds`

Idempotent.

```jsonc
{
  "amount": 2500,                  // optional; omitted means full remaining amount
  "reason": "Cancelación de servicio",
  "externalReference": "refund-req-551",
  "metadata": {}
}
```

Rejected with `409 REFUND_NOT_ALLOWED` when the payment is not `PAID` or `PARTIALLY_REFUNDED`, when
`amount` exceeds `amount - refundedAmount`, or when the amount is partial and the provider lacks
`PARTIAL_REFUNDS`.

```jsonc
// 201
{
  "id": "b4c2...",
  "paymentId": "9a7b...",
  "amount": 2500,
  "currency": "USD",
  "isPartial": true,
  "status": "SUCCEEDED",
  "provider": "fake",
  "providerRefundId": "fake_ref_01J8...",
  "reason": "Cancelación de servicio",
  "createdAt": "2026-09-18T22:50:00.000Z",
  "completedAt": "2026-09-18T22:50:01.000Z",
  "payment": { "status": "PARTIALLY_REFUNDED", "refundedAmount": 2500, "refundableAmount": 6000 }
}
```

The nested `payment` summary saves the caller an immediate follow-up `GET` to learn the new state.

### `GET /v1/payments/:id/refunds`

Lists refunds for the payment.

## Payment methods

### `GET /v1/organizations/:organizationId/customers/:customerReference/payment-methods`

Returns stored tokens with display metadata only.

```jsonc
{
  "data": [
    {
      "id": "e7f8...",
      "customerReference": "resident-8821",
      "provider": "fake",
      "type": "CARD",
      "status": "ACTIVE",
      "brand": "visa",
      "last4": "4242",
      "expirationMonth": 12,
      "expirationYear": 2029,
      "isDefault": true,
      "createdAt": "2026-09-18T22:40:00.000Z"
    }
  ],
  "nextCursor": null
}
```

`providerPaymentMethodId` is deliberately not returned. It is a provider credential of sorts, and no
product needs it — products reference the Moniveo `id`.

### `POST /v1/organizations/:organizationId/customers/:customerReference/payment-methods`

Added beyond the brief, because the brief specifies a list endpoint with no way to create the rows
it lists. Accepts **only** a `setupToken` produced by provider-hosted collection:

```jsonc
{ "setupToken": "fake_setup_tok_01J8...", "setDefault": true }
```

There is no field on this endpoint capable of carrying a PAN or a CVV, which keeps the service
outside the cardholder data environment by construction rather than by policy. Requires the provider
to declare `TOKENIZATION`.

### `DELETE /v1/organizations/:organizationId/customers/:customerReference/payment-methods/:id`

Revokes the token at the provider and sets `status: REVOKED`. The row is retained because past
payments reference it.

## Providers

### `GET /v1/providers`

```jsonc
{
  "data": [
    {
      "key": "fake",
      "displayName": "Fake Payment Provider",
      "capabilities": ["TOKENIZATION", "REFUNDS", "PARTIAL_REFUNDS", "WEBHOOKS",
                       "WEBHOOK_SIGNATURE_VERIFICATION", "REDIRECT_CHECKOUT",
                       "PAYMENT_STATUS_POLLING"],
      "supportedCurrencies": ["USD", "GTQ", "HNL", "CRC", "COP", "MXN"],
      "available": true
    }
  ]
}
```

Generated from the registry, so it cannot drift from the adapters.

### `GET /v1/providers/:provider/capabilities`

Returns one descriptor, `404 PROVIDER_NOT_FOUND` otherwise.

## Webhooks

### `POST /v1/webhooks/:provider`

No API key. Authenticated by provider signature. Content type is whatever the provider sends, and
the raw body is preserved byte-for-byte via a Fastify `addContentTypeParser` that stores the
`Buffer` before any JSON parsing, because re-serialised JSON breaks signature verification.

| Response | When |
| --- | --- |
| `202 Accepted` | stored, or recognised as a duplicate |
| `400` | unparseable body |
| `401` | signature verification failed |
| `404` | unknown provider, or the provider lacks `WEBHOOKS` |
| `429` | rate limit exceeded |

```json
{ "received": true, "eventId": "0f9e...", "duplicate": false }
```

The endpoint never returns 5xx for a business-logic problem. An unknown payment or a stale
transition is a `202`, because a 5xx makes providers retry and eventually disable the endpoint.
Rate limiting is per source IP plus provider, sized well above expected provider volume so it acts
as an abuse guard rather than a throttle on legitimate traffic.

## Health

### `GET /health`

Liveness. No dependency checks, always `200` while the process is up.

```json
{ "status": "ok", "service": "moniveo-payments", "version": "0.1.0", "uptimeSeconds": 1284 }
```

### `GET /ready`

Readiness. Runs `SELECT 1`, confirms migrations are applied, and confirms the registry loaded.
Returns `503` with per-check detail when anything fails.

```json
{
  "status": "ready",
  "checks": {
    "database": { "status": "ok", "latencyMs": 3 },
    "migrations": { "status": "ok", "pending": 0 },
    "providers": { "status": "ok", "registered": ["fake"] }
  }
}
```

## Development-only endpoints

Registered only when `NODE_ENV` is `development` or `test`. The guard is at plugin registration, so
in production the routes do not exist and return the standard `404` — there is no runtime flag that
could be flipped by an environment variable mistake, and an integration test asserts they are absent
under `NODE_ENV=production`.

| Endpoint | Effect |
| --- | --- |
| `POST /dev/fake-provider/payments/:id/succeed` | emits a signed `paid` webhook |
| `POST /dev/fake-provider/payments/:id/fail` | emits a `failed` webhook with a chosen failure code |
| `POST /dev/fake-provider/payments/:id/authorize` | emits an `authorized` webhook |
| `POST /dev/fake-provider/payments/:id/send-webhook` | re-emits the current status, optional `delayMs` |
| `POST /dev/fake-provider/payments/:id/send-duplicate-webhook` | re-sends the last event id verbatim |
| `POST /dev/fake-provider/payments/:id/send-out-of-order-webhook` | sends a stale status after a newer one |
| `POST /dev/fake-provider/payments/:id/chargeback` | emits a chargeback webhook |
| `POST /dev/fake-provider/refunds/:id/succeed` | completes an async refund |
| `POST /dev/fake-provider/refunds/:id/fail` | fails an async refund |
| `POST /dev/fake-provider/payment-methods/setup-token` | mints a setup token with chosen brand and last4 |
| `POST /dev/webhooks/:eventId/retry` | reprocesses a stored webhook event |
| `POST /dev/outbox/:eventId/redeliver` | redelivers an internal event |
| `GET /dev/outbox` | inspects the outbox, including `DEAD` entries |

These drive the fake provider's *simulation*; they never write payment state directly. A "succeed"
call makes the provider emit a webhook, and the ordinary webhook pipeline does the rest — which is
what keeps the manual testing path identical to the production path.

## OpenAPI

`@fastify/swagger` with `fastify-type-provider-zod` generates the document from the same Zod schemas
used for validation, so documentation cannot drift from behaviour. Swagger UI is mounted at `/docs`
in development and test only. `pnpm openapi:export` writes `openapi.json` to the repository root so
products can generate clients, and CI fails if the committed file is stale.

Operations are tagged `Organizations`, `Payment Accounts`, `Payments`, `Refunds`,
`Payment Methods`, `Providers`, `Webhooks`, `Health`, and `Development`, which is also the order the
manual testing walkthrough in the README follows.
