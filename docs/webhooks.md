# Webhooks

Provider webhooks notify Moniveo Payments of asynchronous payment and refund outcomes. The ingestion path is identical for the fake provider and production adapters.

## Entry point

```http
POST /v1/webhooks/:provider
Content-Type: application/json (or provider-specific)
X-Provider-Signature: ... (provider-specific header)
```

- No service API key. Authentication is provider signature verification (when the adapter declares `WEBHOOK_SIGNATURE_VERIFICATION`).
- The raw request body is captured as bytes before JSON parsing so HMAC verification matches what the provider signed.
- Rate limiting is separate from general API limits (`WEBHOOK_RATE_LIMIT_MAX`).

## Ingestion pipeline

1. **Validate provider** — unknown key or missing `WEBHOOKS` capability → `404`.
2. **Verify signature** — invalid signature → `401`, nothing persisted.
3. **Parse** — adapter returns `NormalizedWebhookEvent` with provider ids and target status.
4. **Persist** — insert `webhook_events` with unique `(provider, providerEventId)`.
5. **Acknowledge** — return `202` with `{ received: true, eventId, duplicate }`.
6. **Process** — dispatcher claims `RECEIVED` rows and applies status transitions inside a transaction.

See the full diagram in [architecture.md](./architecture.md#webhook-ingestion-pipeline).

## Ordering and stale events

The payment status machine rejects illegal transitions. When a webhook implies a transition that is not allowed from the current status (for example `PROCESSING` after the payment is already `PAID`), the event is marked **`IGNORED`** — not `FAILED`.

This is intentional: out-of-order delivery is normal provider behaviour and must not trigger retries or alerts.

## Duplicates

Re-inserting the same `(provider, providerEventId)` hits a unique constraint. The handler returns `202` with `duplicate: true` and does not reprocess or emit a second outbox event.

Test with Bruno `04-webhooks/duplicate-webhook` or `POST /dev/fake-provider/payments/:id/send-duplicate-webhook`.

## Retries

Processing failures set `processingStatus: FAILED` with `nextRetryAt` backoff. The dispatcher retries until a maximum attempt count, then stops with alerting.

Development helper: `POST /dev/webhooks/:eventId/retry` reprocesses a stored event.

## Fake provider simulation

Development routes emit signed webhooks through the same `ingestWebhook` path:

| Route | Effect |
| --- | --- |
| `POST /dev/fake-provider/payments/:id/succeed` | `PAID` webhook |
| `POST /dev/fake-provider/payments/:id/fail` | `FAILED` webhook |
| `POST /dev/fake-provider/payments/:id/send-webhook` | Re-emit status; optional `delayMs` |
| `POST /dev/fake-provider/payments/:id/send-duplicate-webhook` | Same `providerEventId` twice |
| `POST /dev/fake-provider/payments/:id/send-out-of-order-webhook` | `PAID` then stale `PROCESSING` |

These routes never write payment rows directly — only the webhook pipeline changes state.

## Product callbacks

After webhook processing updates a payment, the outbox dispatcher delivers signed callbacks to product `EventSubscription` URLs. Products must deduplicate using `X-Moniveo-Event-Id`. Delivery is at-least-once.
