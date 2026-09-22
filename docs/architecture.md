# Architecture

Moniveo Payments orchestrates charges, refunds, and provider webhooks for all Moniveo products through one shared API and PostgreSQL database.

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

Products never call providers directly. Payments never reads a product database.

## Payment status machine

`src/domain/payment-status.ts` defines `ALLOWED_TRANSITIONS`. `transitionPayment()` is the only code permitted to write `Payment.status`.

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

Illegal transitions from API calls raise `INVALID_PAYMENT_STATE`. Illegal transitions from webhooks are recorded as `IGNORED` (stale or out-of-order delivery).

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

The provider receives `202 Accepted` as soon as the event is durably stored. Processing runs asynchronously via the dispatcher.

## Internal event delivery

State changes write `outbox_events` in the same database transaction. A scheduler delivers signed JSON callbacks to product `EventSubscription` URLs with exponential backoff and at-least-once semantics.

Event types include: `payment.created`, `payment.processing`, `payment.paid`, `payment.failed`, `payment.refunded`, `payment.partially_refunded`, `refund.succeeded`, and others defined in `src/domain/events.ts`.

## Repository layout

| Path | Role |
| --- | --- |
| `src/domain/` | Pure payment rules (status machine, money, refunds) |
| `src/providers/` | Provider adapters and registry |
| `src/modules/` | Resource services and routes |
| `src/platform/` | Auth, idempotency, secrets, outbox, logging, security |
| `src/routes/dev/` | Fake provider simulation (development/test only) |
