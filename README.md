# Moniveo Payments

Centralized payment orchestration for every Moniveo product. Product backends call this service to create payments, store tokenized payment methods, process refunds, and receive signed lifecycle callbacks — without integrating payment providers directly.

## Architecture overview

Moniveo Payments sits between product backends and payment provider adapters. Products authenticate with API keys, call `/v1` endpoints, and receive at-least-once HTTP callbacks from the outbox dispatcher. Provider webhooks enter through `/v1/webhooks/:provider`, are deduplicated and processed asynchronously, and drive the central payment status machine.

See [docs/architecture.md](docs/architecture.md) for system context diagrams, the status machine, and the webhook pipeline.

## Local setup

### Prerequisites

- Node.js 20.19.4 (see `.nvmrc`)
- pnpm 9.15.4
- Docker (for PostgreSQL)

### 1. Start PostgreSQL

```bash
docker compose up -d
```

Postgres listens on **host port 5433** (container 5432). Two databases are created: `moniveo_payments` (development) and `moniveo_payments_test` (tests).

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` if needed. Defaults:

| Variable | Default |
| --- | --- |
| `PORT` | `4000` |
| `DATABASE_URL` | `postgresql://moniveo:moniveo@localhost:5433/moniveo_payments` |
| `TEST_DATABASE_URL` | `postgresql://moniveo:moniveo@localhost:5433/moniveo_payments_test` |

### 3. Install, migrate, and seed

```bash
pnpm install
pnpm db:generate
pnpm db:deploy
pnpm db:seed
```

The seed prints an API key **once** on first run. Copy it into `bruno/environments/local.bru` as `apiKey`.

### 4. Run the API

```bash
pnpm dev
```

- API base: `http://localhost:4000`
- Swagger UI: `http://localhost:4000/docs`
- Health: `http://localhost:4000/health`
- Readiness: `http://localhost:4000/ready`

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `NODE_ENV` | no | `development`, `test`, or `production` (default `development`) |
| `PORT` | no | HTTP port (default `4000`) |
| `LOG_LEVEL` | no | Pino log level (default `info`) |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `TEST_DATABASE_URL` | tests | Test database connection string |
| `SECRETS_PROVIDER` | no | Secret resolver (`env` today) |
| `FAKE_PROVIDER_API_KEY` | dev | Resolved by fake provider `credentialRefs` |
| `FAKE_PROVIDER_WEBHOOK_SECRET` | dev | Webhook HMAC secret for fake provider |
| `EVENT_CALLBACK_SECRET` | dev | HMAC secret for outbound product callbacks |
| `RATE_LIMIT_MAX` | no | General API rate limit per IP/minute (default `300`) |
| `WEBHOOK_RATE_LIMIT_MAX` | no | Webhook rate limit per IP/minute (default `120`) |
| `DISPATCHER_INTERVAL_MS` | no | Outbox/webhook poll interval (default `2000`; `0` in tests) |

## Database and migrations

Schema lives in `prisma/schema.prisma`. Migrations are applied with:

```bash
pnpm db:migrate    # create/apply in development
pnpm db:deploy     # apply existing migrations (CI/production)
pnpm db:reset      # drop, migrate, seed (destructive)
```

Money is stored as integer minor units. Refund totals are guarded by a `CHECK (refunded_amount <= amount)` constraint.

## Running tests

```bash
pnpm test              # all layers (unit, contract, integration, e2e)
pnpm test:unit         # no database required
pnpm test:integration  # integration + e2e (requires Postgres)
```

Integration tests migrate `TEST_DATABASE_URL` once per run and truncate tables between cases.

## Manual testing with Bruno

The committed collection under `bruno/` mirrors the milestone-1 e2e flow:

1. **01-setup** — create organization and fake payment account
2. **02-payments** — create $85.00 USD payment, get, list, idempotency replay
3. **03-refunds** — succeed, full refund, second payment, partial refund
4. **04-webhooks** — succeed, duplicate, delayed, out-of-order webhooks
5. **05-providers** — list providers and fake capabilities

Open the collection in [Bruno](https://www.usebruno.com/), select the **local** environment, paste your seeded `apiKey`, and run the folders in order. Post-response scripts chain `organizationId`, `paymentId`, `refundId`, and `webhookEventId` automatically.

## Fake provider

`FakePaymentProvider` (`provider: fake`) implements the same `PaymentProvider` interface as a real adapter. Development routes under `/dev/fake-provider/*` emit signed webhooks through the normal ingestion pipeline — they never write payment state directly.

Common scenarios via payment `metadata.fakeScenario`: `success`, `instant_success`, `declined`, `processing`, `delayed_success`, and others (see [docs/architecture.md](docs/architecture.md)).

## Adding a provider

Implement the adapter under `src/providers/<key>/`, register it in the registry, add a contract test, and document credential keys. Step-by-step guide: [docs/adding-a-provider.md](docs/adding-a-provider.md).

## Webhooks

Provider webhooks POST to `/v1/webhooks/:provider` with raw body preservation for signature verification. Duplicates return `202` without reprocessing; stale transitions are recorded as `IGNORED`. Details: [docs/webhooks.md](docs/webhooks.md).

## Idempotency

All `/v1` mutations require `Idempotency-Key`. Keys are scoped per service client; identical body replays return the stored response with `Idempotency-Replayed: true`. Details: [docs/idempotency.md](docs/idempotency.md).

## Security assumptions

- Backend-to-backend authentication only (Bearer API keys). No end-user auth in this service.
- Card data never enters this service; only provider tokens and display metadata are stored. See [docs/pci-boundary.md](docs/pci-boundary.md).
- Secrets are referenced (`env://NAME`), not embedded in requests or responses.
- Logs redact credentials, raw webhook bodies, and setup tokens.
- CI enforces domain-boundary checks, OpenAPI freshness, and forbidden PCI field names.

## Additional commands

```bash
pnpm lint
pnpm typecheck
pnpm openapi:export   # regenerate openapi.json
pnpm openapi:check    # verify committed openapi.json matches the app
pnpm check:domain     # domain boundary and provider isolation checks
pnpm service-client:create -- --name "My Client" --product RESIDENT
```
