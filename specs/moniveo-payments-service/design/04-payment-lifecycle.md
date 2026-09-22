---
design:
  id: "D-004"
  title: "Payment Lifecycle"
  spec_slug: "moniveo-payments-service"
  created: "2026-09-18T22:45:00Z"
  updated: "2026-09-18T22:45:00Z"
---

# Payment Lifecycle

## System context

```mermaid
flowchart TB
    subgraph products["Moniveo product backends"]
        R["Moniveo Resident<br/>condominium administration"]
        H["Moniveo Health<br/>clinics"]
        E["Moniveo Environment"]
    end

    subgraph payments["Moniveo Payments"]
        API["REST API /v1"]
        SVC["Payment services<br/>status machine, refunds, idempotency"]
        REG["Provider registry"]
        WH["Webhook pipeline"]
        OUT["Outbox dispatcher"]
        DB[("PostgreSQL")]
    end

    subgraph adapters["PaymentProvider adapters"]
        FAKE["FakePaymentProvider"]
        PAG["PagaditoProvider<br/>(later)"]
        WOM["WompiProvider<br/>(later)"]
        PAY["PayWayProvider<br/>(later)"]
    end

    subgraph external["Payment providers"]
        PAGX["Pagadito"]
        WOMX["Wompi"]
        PAYX["PayWay"]
    end

    R -->|"API key + Idempotency-Key"| API
    H --> API
    E --> API

    API --> SVC
    SVC --> DB
    SVC --> REG
    REG --> FAKE
    REG --> PAG
    REG --> WOM
    REG --> PAY

    PAG --> PAGX
    WOM --> WOMX
    PAY --> PAYX

    PAGX -.->|"provider webhook"| WH
    FAKE -.->|"simulated webhook"| WH
    WH --> DB
    WH --> SVC

    OUT --> DB
    OUT -.->|"signed HTTP callback"| R
    OUT -.-> H
    OUT -.-> E

    style payments fill:#EAF2FF
    style products fill:#F3F0FF
    style external fill:#FFF4E6
```

The only arrows from a product go to the Payments API, and the only arrows to an external provider
come from an adapter. Nothing crosses from a product to a provider, and nothing crosses from
Payments into a product database.

## Payment status machine

```mermaid
stateDiagram-v2
    [*] --> PENDING : POST /v1/payments

    PENDING --> PROCESSING : provider accepted, awaiting outcome
    PENDING --> AUTHORIZED : provider authorized synchronously
    PENDING --> PAID : provider captured synchronously
    PENDING --> FAILED : provider declined
    PENDING --> CANCELLED : cancelled before submission

    PROCESSING --> AUTHORIZED : authorization webhook
    PROCESSING --> PAID : capture webhook
    PROCESSING --> FAILED : failure webhook
    PROCESSING --> CANCELLED : cancellation webhook

    AUTHORIZED --> PAID : capture webhook
    AUTHORIZED --> FAILED : capture failed
    AUTHORIZED --> CANCELLED : authorization voided

    FAILED --> PROCESSING : retry creates a new PaymentAttempt

    PAID --> PARTIALLY_REFUNDED : refund succeeded, amount remaining
    PAID --> REFUNDED : refund succeeded, nothing remaining
    PAID --> CHARGEBACK : chargeback webhook

    PARTIALLY_REFUNDED --> PARTIALLY_REFUNDED : further partial refund
    PARTIALLY_REFUNDED --> REFUNDED : remainder refunded
    PARTIALLY_REFUNDED --> CHARGEBACK : chargeback webhook

    REFUNDED --> CHARGEBACK : chargeback webhook
    REFUNDED --> [*]
    CANCELLED --> [*]
    CHARGEBACK --> [*]
```

The table lives in `src/domain/payment-status.ts` as data, not as scattered `if` statements:

```ts
export const ALLOWED_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  PENDING:            ['PROCESSING', 'AUTHORIZED', 'PAID', 'FAILED', 'CANCELLED'],
  PROCESSING:         ['AUTHORIZED', 'PAID', 'FAILED', 'CANCELLED'],
  AUTHORIZED:         ['PAID', 'FAILED', 'CANCELLED'],
  PAID:               ['PARTIALLY_REFUNDED', 'REFUNDED', 'CHARGEBACK'],
  PARTIALLY_REFUNDED: ['PARTIALLY_REFUNDED', 'REFUNDED', 'CHARGEBACK'],
  REFUNDED:           ['CHARGEBACK'],
  FAILED:             ['PROCESSING'],
  CANCELLED:          [],
  CHARGEBACK:         [],
} as const;
```

Notes on the less obvious edges:

- `FAILED -> PROCESSING` is the retry path. The `Payment` row is reused because
  `externalReference` is unique per organization, and a new `PaymentAttempt` records the retry. The
  earlier attempt's failure detail survives on its own row, so no history is overwritten.
- Anything reachable from `PAID` is also reachable from `PARTIALLY_REFUNDED`, because a partially
  refunded payment is still a captured payment.
- `CHARGEBACK` is terminal here. Representment and dispute handling are deliberately out of scope
  for milestone 1; the status exists so the event can be recorded and the product notified.
- `CANCELLED` is terminal. A cancelled charge that later needs collecting is a new business fact and
  gets a new `externalReference`.

`transitionPayment()` is the only function permitted to write `Payment.status`. It validates the
edge, sets the matching timestamp (`authorizedAt`, `paidAt`, `failedAt`, `cancelledAt`), writes the
outbox event, and does all of it in one transaction. An illegal transition from an API call raises
`INVALID_PAYMENT_STATE`; an illegal transition arriving from a webhook is not an error at all — it
is a stale or out-of-order delivery and the event is recorded as `IGNORED`.

## Happy path: create through callback

```mermaid
sequenceDiagram
    autonumber
    participant P as Resident backend
    participant API as Payments API
    participant S as PaymentService
    participant DB as PostgreSQL
    participant ADP as Provider adapter
    participant PRV as Provider

    P->>API: POST /v1/payments<br/>Idempotency-Key: k1
    API->>API: authenticate API key -> ServiceContext
    API->>DB: INSERT idempotency_keys (IN_PROGRESS)
    API->>S: createPayment(input, ctx)

    S->>DB: load organization + default payment account
    S->>S: validate money, currency, capability
    S->>DB: INSERT payment (PENDING) + payment_attempt #1
    S->>DB: INSERT outbox_event payment.created

    S->>ADP: createPayment(input, providerContext)
    ADP->>PRV: provider API call
    PRV-->>ADP: accepted, providerPaymentId, checkoutUrl
    ADP-->>S: PaymentResult { status: PROCESSING }

    S->>DB: transition PENDING -> PROCESSING<br/>store providerPaymentId<br/>outbox payment.processing
    S-->>API: payment
    API->>DB: UPDATE idempotency_keys (COMPLETED + response)
    API-->>P: 201 Created { id, status, checkoutUrl }

    Note over P,PRV: payer completes checkout out of band

    PRV->>API: POST /v1/webhooks/:provider (raw body)
    API->>ADP: verifyWebhook(raw, ctx)
    ADP-->>API: verified
    API->>ADP: parseWebhook(raw)
    ADP-->>API: PaymentWebhookEvent { status: PAID }
    API->>DB: INSERT webhook_events (RECEIVED, unique on providerEventId)
    API-->>PRV: 202 Accepted

    Note over API,DB: dispatcher picks it up asynchronously

    API->>S: processWebhookEvent(eventId)
    S->>DB: resolve payment by (provider, providerPaymentId)
    S->>S: is PROCESSING -> PAID a legal transition? yes
    S->>DB: transition to PAID, set paidAt<br/>complete attempt #1<br/>outbox payment.paid<br/>mark webhook PROCESSED

    API->>P: POST callback payment.paid<br/>X-Moniveo-Event-Id, X-Moniveo-Signature
    P-->>API: 200 OK
    API->>DB: outbox DELIVERED
```

The acknowledgement at step 21 happens before processing. The provider gets a fast `202` as soon as
the event is durably stored, and correctness does not depend on how long processing takes or whether
it succeeds on the first try.

## Webhook ingestion pipeline

```mermaid
flowchart TD
    A["POST /v1/webhooks/:provider"] --> B{"provider in registry<br/>and supports WEBHOOKS?"}
    B -- no --> B1["404 PROVIDER_NOT_FOUND"]
    B -- yes --> C["capture raw body bytes"]
    C --> D["load candidate accounts + signing secrets"]
    D --> E{"provider supports<br/>signature verification?"}

    E -- yes --> F{"signature valid?"}
    F -- no --> F1["401, log, do not persist payload"]
    F -- yes --> G["verified = true"]
    E -- no --> H["verified = false, allowed by policy"]

    G --> I["parseWebhook -> NormalizedWebhookEvent"]
    H --> I
    I --> J["INSERT webhook_events<br/>unique (provider, providerEventId)"]
    J --> K{"unique violation?"}
    K -- yes --> K1["202 duplicate, no reprocessing"]
    K -- no --> L["202 Accepted"]

    L --> M["dispatcher claims RECEIVED events"]
    M --> N{"resolve payment or refund<br/>from provider ids"}
    N -- not found --> N1["status IGNORED<br/>unknown resource"]
    N -- found --> O{"transition legal from<br/>current status?"}
    O -- no --> O1["status IGNORED<br/>stale or out of order"]
    O -- yes --> P["transaction:<br/>update payment/attempt/refund<br/>+ write outbox event<br/>+ mark PROCESSED"]
    P --> Q["outbox dispatcher delivers<br/>signed callback to product"]

    N1 --> R["terminal, no retry"]
    O1 --> R
    K1 --> R

    S["processing threw"] --> T{"attempts < max?"}
    T -- yes --> U["status FAILED, nextRetryAt = backoff"]
    T -- no --> V["status FAILED, no further retry, alert"]
    U --> M
```

Three distinct non-error outcomes end in `IGNORED`: duplicate, unknown resource, and stale
transition. Keeping them separate from `FAILED` is what prevents normal provider behaviour from
generating a retry storm and an on-call page.

## Refund flow

```mermaid
sequenceDiagram
    autonumber
    participant P as Product backend
    participant API as Payments API
    participant S as RefundService
    participant DB as PostgreSQL
    participant ADP as Provider adapter

    P->>API: POST /v1/payments/:id/refunds<br/>Idempotency-Key: r1<br/>{ amount: 2500 }
    API->>S: createRefund

    S->>DB: SELECT payment FOR UPDATE
    S->>S: status is PAID or PARTIALLY_REFUNDED?
    S->>S: amount <= amount - refundedAmount?
    S->>S: currency matches?
    S->>S: provider supports REFUNDS<br/>(and PARTIAL_REFUNDS if partial)?
    S->>DB: INSERT refund (PENDING)

    S->>ADP: refundPayment(input, ctx)
    ADP-->>S: RefundResult { SUCCEEDED }

    S->>DB: transaction:<br/>refund -> SUCCEEDED<br/>payment.refundedAmount += 2500<br/>status -> PARTIALLY_REFUNDED or REFUNDED<br/>outbox payment.refunded
    Note right of DB: CHECK (refunded_amount <= amount)<br/>is the final guarantee
    S-->>API: refund
    API-->>P: 201 Created
```

`SELECT ... FOR UPDATE` serialises concurrent refunds against the same payment. Even if that lock
were removed, the `CHECK` constraint would still make over-refunding impossible — the validation is
belt and braces on purpose, because this is the one arithmetic error in a payments system that
directly loses money.

Some providers report refunds asynchronously. In that case the adapter returns `PROCESSING`,
`refundedAmount` is not incremented, and the increment happens when the refund webhook arrives. The
same transactional block handles both entry points.

## Idempotent create

```mermaid
flowchart TD
    A["mutation request with Idempotency-Key"] --> B["fingerprint = sha256(canonical body + path params)"]
    B --> C["INSERT idempotency_keys<br/>(serviceClientId, key, endpoint) IN_PROGRESS"]
    C --> D{"unique violation?"}

    D -- no --> E["execute the operation"]
    E --> F["store status + response body, mark COMPLETED"]
    F --> G["return the real response"]

    D -- yes --> H["load the existing row"]
    H --> I{"fingerprint matches?"}
    I -- no --> J["409 DUPLICATE_REQUEST<br/>key reused for a different operation"]
    I -- yes --> K{"row status"}
    K -- COMPLETED --> L["replay stored response<br/>Idempotency-Replayed: true"]
    K -- IN_PROGRESS --> M["409 REQUEST_IN_PROGRESS, retryable"]
    K -- FAILED --> N["delete row, execute again"]
```

Storing a failed attempt as `FAILED` and allowing a retry with the same key is deliberate: a request
that failed with a 500 never produced a financial operation, so refusing to let the client retry
with the same key would push it toward generating a new key, which is the behaviour most likely to
cause an actual double charge.

## Internal event delivery

```mermaid
flowchart LR
    A["state change in a transaction"] --> B[("outbox_events<br/>PENDING")]
    B --> C["dispatcher every 2s<br/>claim PENDING where nextAttemptAt <= now"]
    C --> D["resolve EventSubscription<br/>by sourceProduct + organizationId"]
    D --> E["POST signed JSON<br/>X-Moniveo-Event-Id<br/>X-Moniveo-Signature<br/>X-Moniveo-Delivery-Attempt"]
    E --> F{"2xx?"}
    F -- yes --> G["DELIVERED"]
    F -- no --> H{"attempts < 8?"}
    H -- yes --> I["FAILED, backoff<br/>2s 8s 30s 2m 10m 30m 2h"]
    H -- no --> J["DEAD, surfaced for manual replay"]
    I --> C
```

Event names, matching the brief: `payment.created`, `payment.processing`, `payment.authorized`,
`payment.paid`, `payment.failed`, `payment.cancelled`, `payment.refunded`,
`payment.partially_refunded`, `payment.chargeback`, `refund.succeeded`, `refund.failed`.

Every delivery carries a stable `eventId` so the receiving product can deduplicate. Delivery is
at-least-once and the documentation states that plainly rather than implying exactly-once semantics
that the transport cannot provide.

## Milestone 1 demonstration path

```mermaid
sequenceDiagram
    autonumber
    participant SIM as Simulated Resident backend
    participant MP as Moniveo Payments
    participant FP as FakePaymentProvider

    SIM->>MP: POST /v1/organizations (RESIDENT, externalId ext-condo-1)
    MP-->>SIM: organization
    SIM->>MP: POST /v1/organizations/:id/payment-accounts (provider fake)
    MP-->>SIM: payment account ACTIVE

    SIM->>MP: POST /v1/payments  Idempotency-Key: k1  amount 8500 USD
    MP->>FP: createPayment
    FP-->>MP: PROCESSING + checkoutUrl
    MP-->>SIM: 201 PROCESSING

    SIM->>MP: POST /v1/payments same Idempotency-Key: k1
    MP-->>SIM: 200 replayed, same payment id, no second charge

    SIM->>MP: POST /dev/fake-provider/payments/:id/succeed
    FP->>MP: signed webhook payment.paid
    MP->>MP: PROCESSING -> PAID
    MP->>SIM: callback payment.paid

    SIM->>MP: POST /dev/fake-provider/payments/:id/send-duplicate-webhook
    MP-->>MP: duplicate detected, IGNORED, no second callback

    SIM->>MP: POST /v1/payments/:id/refunds amount 8500
    MP->>FP: refundPayment
    FP-->>MP: SUCCEEDED
    MP->>MP: PAID -> REFUNDED
    MP->>SIM: callback payment.refunded
```

This sequence is implemented verbatim as `tests/e2e/payment-lifecycle.e2e.test.ts` and mirrored in
the Bruno collection, so the milestone is demonstrable both automatically and by hand.
