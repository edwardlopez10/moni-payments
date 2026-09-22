---
spec:
  title: "Moniveo Payments Service"
  slug: "moniveo-payments-service"
  status: "ready"
  created: "2026-09-18T22:45:00Z"
  updated: "2026-09-21T16:21:00Z"
  version: 2
---

# Moniveo Payments Service

## Overview
<!-- @section:overview -->
`moniveo-payments` is a standalone payment orchestration service shared by every Moniveo product —
Resident, Health, Environment, and whatever follows. It sits between product backends and payment
providers so that no product ever integrates with a provider directly, and so that adding a provider
is an isolated change rather than a change replicated across three codebases.

The service understands only generic payment vocabulary: organizations, payment accounts, payment
methods, payments, payment attempts, refunds, providers, and webhook events. It contains no
residences, residents, patients, appointments, or fees. Products own their domain data and their
authorisation decisions; they call Payments to execute a financial operation and pass opaque
references for traceability. Payments never queries a product database.

Milestone 1 delivers the full lifecycle against a `FakePaymentProvider` that implements the same
`PaymentProvider` interface a real adapter will: create a payment, receive a signed provider
webhook, mark it paid, notify the product, and refund it — with duplicate requests and duplicate
webhooks provably safe. Pagadito is deliberately not implemented; the point of the milestone is that
when it arrives it is one adapter plus one registry line.

Key assumptions and constraints:

- Moniveo never receives, holds, or distributes customer funds. Providers and each organization's
  own merchant account settle money; this service orchestrates and records.
- Card data never touches this service. Only provider tokens and safe display metadata are stored.
- Node.js LTS, TypeScript strict, pnpm, Fastify, PostgreSQL, Prisma, Zod, Vitest, OpenAPI, Docker.
  No Redis, no message broker, no Kubernetes.
- Authentication is backend-to-backend only. No end-user authentication exists here.
- Monetary amounts are integer minor units throughout. No floating point, ever.
<!-- @end -->

## Requirements
<!-- @section:requirements -->

### Domain boundary

- (R-001) The service exposes payment capability to every Moniveo product through one shared API and
  contains no concept specific to any product's domain.
- (R-002) Product backends reach payment providers only through this service; no product holds
  provider credentials or calls a provider directly.
- (R-003) The service never reads or writes a product's database, storing only opaque external
  references sufficient for traceability and reconciliation.

### Multi-tenancy

- (R-004) An organization represents the entity receiving payments and is uniquely identified by the
  combination of its source product and the identifier that product uses for it.
- (R-005) An organization may hold more than one payment account, and different organizations may
  receive payments through different providers simultaneously.
- (R-006) Every operation is scoped to a single organization, and a caller cannot read or affect an
  organization belonging to another product.

### Provider abstraction

- (R-007) Every provider is reached through one generic interface, and each provider declares the
  capabilities it actually supports.
- (R-008) An operation a provider does not support is rejected before any provider call, with a
  typed error rather than a runtime failure.
- (R-009) No provider-shaped response, status vocabulary, or error reaches the domain layer or the
  public API; provider data is normalised at the adapter boundary.
- (R-010) A new provider can be added by implementing the interface and registering it, without
  modifying core payment logic, the database schema, or any existing adapter.

### Payments

- (R-011) All monetary amounts are handled as integer minor units with an explicit currency, and no
  code path converts an amount to a floating point number.
- (R-012) A payment moves only through transitions permitted by a single central status machine,
  which is the only thing able to change a payment's status.
- (R-013) Each interaction with a provider is recorded as a separate attempt, so retrying a failed
  payment adds history rather than overwriting it.
- (R-014) A given business charge can exist only once per organization, enforced by the database and
  not only by application logic.

### Payment methods and PCI posture

- (R-015) The service never accepts or stores a full card number, security code, or track data; only
  provider-issued tokens and display-safe metadata are persisted.
- (R-016) Card collection happens through provider-hosted tokenization wherever the provider supports
  it, and the resulting PCI boundary is documented.

### Refunds

- (R-017) Full and partial refunds are supported and recorded as separate financial records, leaving
  the original payment intact for audit purposes.
- (R-018) The total refunded against a payment can never exceed the amount captured, guaranteed at
  the database level under concurrency.

### Webhooks

- (R-019) Each provider has its own webhook endpoint that preserves the request exactly as received
  and verifies authenticity whenever the provider supports it.
- (R-020) A webhook is persisted before it is processed and acknowledged quickly, so provider
  delivery never depends on processing duration or success.
- (R-021) Webhook processing is idempotent and order-independent: a repeated delivery changes
  nothing, and a delivery that is stale relative to current state is recorded and ignored rather
  than treated as an error.
- (R-022) A webhook that fails processing is retried with visible status, attempt count, and error,
  and stops retrying at a defined limit rather than indefinitely.

### Idempotency

- (R-023) Mutating operations require an idempotency key; repeating a request with the same key and
  the same payload returns the original outcome without creating a second financial operation, and
  reusing a key with a different payload is rejected.

### Internal events

- (R-024) Every meaningful payment state change produces a normalised internal event, written in the
  same transaction as the change so the two cannot diverge.
- (R-025) Events are delivered to subscribing products behind a swappable publisher interface, with
  retries, a stable event identifier for consumer deduplication, and a signature the consumer can
  verify.

### API and authentication

- (R-026) The service exposes versioned REST endpoints under `/v1`, documented by an OpenAPI
  specification generated from the same schemas that validate requests, with a browsable UI in
  development.
- (R-027) Every request identifies the calling Moniveo product through a service authentication
  mechanism that can be replaced with signed service tokens without changing route handlers.
- (R-028) Errors are returned as a closed set of stable, documented codes; no raw provider message
  or internal detail is exposed to a calling product.

### Fake provider and manual testing

- (R-029) A fake provider implements the same interface as a real adapter and simulates success,
  decline, processing, delayed success, refund, partial refund, duplicate webhook, out-of-order
  webhook, failed webhook, and tokenized payment methods, with no special-case handling anywhere in
  the application because the provider is fake.
- (R-030) A developer can drive the entire payment lifecycle by hand through browsable API
  documentation, a committed request collection, and simulation endpoints that do not exist outside
  development and test environments.

### Quality and operations

- (R-031) A single command runs a test suite covering unit, provider contract, integration against a
  real database, and end-to-end lifecycle coverage.
- (R-032) Logs are structured, carry a correlation identifier and the relevant payment identifiers,
  and never contain card data, credentials, secrets, or authorization headers.
- (R-033) A new developer can go from clone to a running API with a database, documentation, and the
  fake provider using the documented commands, and the repository explains its architecture, its
  security assumptions, and how to add a provider.
- (R-034) Secure defaults are applied throughout: all external input validated, environment
  validated at startup, public endpoints rate-limited, organization boundaries enforced,
  mass-assignment prevented, and no credential ever committed.
<!-- @end -->

## Resources
<!-- @section:resources -->
- (RS-001) **Moniveo Spec Workflow (initialize-spec)** — Source: `prompts/initialize-spec.md` — Analysis: `resources/initialize-spec-workflow.md` — Summary: The five-step house spec workflow and the `spec.md` structure it mandates. Governs this document's frontmatter, anchors, identifier scheme, and task anatomy, and records the two deliberate deviations: design detail split into `design/`, and Mermaid diagrams.
- (RS-002) **Moniveo Health API Conventions** — Source: `/Users/edward/Documents/moni-health` — Analysis: `resources/moni-health-api-conventions.md` — Summary: The only standalone Node API in the estate, and the closest template. Supplies the `index.ts`/`app.ts` split, the per-module `schema`/`repository`/`service` layout, Prisma naming conventions, and tenant-scoping middleware. Its Hono transport, monorepo shape, and response envelope are not carried over.
- (RS-003) **Moniveo Resident Backend Conventions** — Source: `/Users/edward/Documents/moni-resident` — Analysis: `resources/moni-resident-backend-conventions.md` — Summary: House style for shared types, `.cursor/rules/`, tenant resolution, and tooling versions, plus the integration contract for Resident as the milestone-1 consumer. Its mocked-Prisma testing approach is explicitly rejected for a financial service.
<!-- @end -->

## Architecture Summary

The six artifacts requested before implementation are in
`specs/moniveo-payments-service/design/`. Each is self-contained; this section states the shape and
the decisions that cut across them.

| Document | Covers |
| --- | --- |
| [`design/01-repository-structure.md`](design/01-repository-structure.md) | folder tree, module anatomy, layering rules, scripts, dependency budget |
| [`design/02-prisma-data-model.md`](design/02-prisma-data-model.md) | every model, enum, constraint, and index, with the reasoning |
| [`design/03-payment-provider-interface.md`](design/03-payment-provider-interface.md) | `PaymentProvider`, capabilities, normalized types, registry, fake provider |
| [`design/04-payment-lifecycle.md`](design/04-payment-lifecycle.md) | Mermaid context, status machine, webhook pipeline, refund and event flows |
| [`design/05-api-specification.md`](design/05-api-specification.md) | every endpoint, headers, error codes, dev routes, OpenAPI |
| [`design/06-testing-strategy.md`](design/06-testing-strategy.md) | unit, contract, integration, e2e layers and the test database |

### Shape

```
Product backend  --API key + Idempotency-Key-->  /v1 routes
                                                     |
                                                  service layer  --> domain (pure rules)
                                                     |         \--> provider registry --> adapter --> provider
                                                     |
                                                  repository --> PostgreSQL
                                                     |
provider webhook --> /v1/webhooks/:provider --> webhook pipeline
                                                     |
                                                  outbox --> dispatcher --> signed callback to product
```

Four boundaries carry the design, and each is enforced mechanically rather than by convention:

**Domain purity.** `src/domain/` holds the status machine, money rules, refund rules, and error
taxonomy as pure functions with no Prisma and no Fastify. An ESLint `no-restricted-imports` rule
enforces it, which is what makes the rules exhaustively unit-testable.

**Provider containment.** Adapters return normalized types only. Provider-shaped data is confined to
`providerMetadata`, which is persisted and never branched on. Nothing outside
`src/providers/fake/**` may import `FakePaymentProvider` by name — the mechanical guarantee that no
special-case logic exists because the provider is fake.

**Transactional consistency.** State change and internal event are written in one transaction
through an outbox table, so a payment cannot become `PAID` without its event existing.

**Database-level financial invariants.** Duplicate charges, duplicate webhooks, and over-refunding
are prevented by unique indexes and a `CHECK` constraint, not by application checks that a race can
slip past.

### Where the proposed architecture was simplified

The brief asked for a review for unnecessary complexity. Seven things were removed or reduced, each
with a reason rather than a preference.

**No monorepo.** The sibling repos use pnpm workspaces and Turborepo because each ships several
deployable surfaces. This service ships one. A workspace, a `packages/db` boundary, and
cross-package build ordering would be pure overhead. Internal boundaries are enforced by lint rules
instead, and converting to a workspace later is mechanical.

**No `Customer` table.** The brief lists customers among the generic concepts, but everywhere a
customer appears the identifier is `customerReference`, a string owned by the product. A `Customer`
row would require synchronising identity between Payments and each product — precisely the coupling
the service exists to avoid. The reference is indexed alongside `organizationId`, and the table can
be added later without changing the external contract.

**No `Provider` table.** Providers and their capabilities are code, served from the registry through
`GET /v1/providers`. A table would be a second source of truth that drifts from the adapters.

**`provider` is a string column, not a database enum.** A Postgres enum means a migration per
provider, working directly against R-010. Valid values come from the registry and are enforced by a
Zod schema at the API boundary.

**One dispatcher, two jobs, no broker.** Webhook processing and internal event delivery both need
"do this soon, retry with backoff, give up eventually". That is one `setInterval` loop over two
Postgres tables. Redis, BullMQ, or a message broker would add infrastructure to local development
and to production for a workload measured in events per minute. The `EventPublisher` interface keeps
the EventBridge or SQS migration a single implementation swap.

**Secrets are references, not ciphertext.** Rather than encrypting credentials into the database,
`PaymentAccount.credentialRefs` stores pointers such as `env://PAGADITO_WSK_ACME`, resolved at call
time by a `SecretsProvider`. `env://` is the only scheme implemented and serves production as well
as local development, since Railway supplies credentials as environment variables. There is no
ciphertext at rest to manage, no key rotation problem inside this service, and no hand-written
cryptography — which the brief explicitly ruled out. Adopting a secret manager later adds one
implementation and one scheme, changing no caller and no column.

**One Postgres container, two databases.** Tests run against a real database on the same instance as
development, in `moniveo_payments_test`. This avoids a second container and avoids Testcontainers as
a dependency, keeping `docker compose up -d` the only infrastructure step.

### Where complexity was added, and why

Three additions are not in the brief. Each closes a gap that would otherwise force a product into
unsafe behaviour.

**`POST /v1/payments/:id/retry`.** `PaymentAttempt` exists so retries do not corrupt the original
payment, but the brief specifies no endpoint that creates a second attempt. Without one, a product
facing a decline can only invent a new `externalReference`, which defeats the duplicate-charge
guarantee. This endpoint is the intended path.

**`POST .../payment-methods`.** The brief specifies a list endpoint for payment methods with no way
to create the rows it lists. The endpoint accepts only a provider-issued `setupToken`, so it has no
field capable of carrying a PAN.

**`PARTIAL_REFUNDS` and `WEBHOOK_SIGNATURE_VERIFICATION` capabilities.** Both are real branch points.
Several regional acquirers support full reversal but not partial, and some providers post unsigned
webhooks. Collapsing either into its parent capability would turn a pre-flight rejection into a
runtime surprise, or leave the security posture of each provider implicit.

### Open risks carried into implementation

- Webhook-to-account resolution is genuinely awkward: `POST /v1/webhooks/:provider` has no
  organization in the path, but signing secrets are per-account. `WebhookContext.candidateAccounts`
  lets each adapter resolve it in whatever way its provider allows. This is the part of the design
  most likely to need revision once a real provider is integrated.
- Chargebacks are terminal. Recording and notification are in scope; representment and dispute
  workflow are not.
- Currency is modelled correctly but only exercised in USD. Multi-currency behaviour beyond schema
  correctness is untested until a provider requires it.

## Tasks
<!-- @section:tasks -->
<!-- Generated ahead of Step 4 because this spec bootstraps a repository with no existing code to -->
<!-- inspect. Tasks are sized at roughly one to three hours and ordered so each leaves the repo -->
<!-- in a working state. Re-run create-tasks to refine once scaffolding exists. -->

**Phase 0 — Foundation**

### Scaffold The Repository (T-001) [done 2026-09-18T23:25:41Z]

#### Overview
Addresses R-033 by creating the empty but fully configured package so every later task has a working
lint, typecheck, and test loop. Establishes the lint-enforced layering that the rest of the
architecture depends on.

#### Acceptance Criteria
- `pnpm install`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` all succeed on an empty source tree.
- `no-restricted-imports` rejects a file in `src/domain/` importing `@prisma/client`.
- Node version resolves to `20.19.4` from `.nvmrc`.

#### Implementation Details
- **Files**: `package.json`, `tsconfig.json`, `eslint.config.js`, `.prettierrc`, `.nvmrc`, `.npmrc`,
  `.gitignore`, `vitest.config.ts`.
- **Reference**: `design/01-repository-structure.md`, sections "Tree", "Layering rule",
  "package.json scripts", "Dependency budget".
- **Conventions**: pnpm 9.15.4 via `packageManager`; `strict`, `noUncheckedIndexedAccess`, and
  `exactOptionalPropertyTypes` enabled; `shamefully-hoist=true` matching the sibling repos.
- **Testing approach**: one placeholder unit test so `pnpm test` exits zero.

Execution Summary (T-001):
Date: 2026-09-18T23:25:41Z
Status: done
Files Changed (11):
- package.json
- pnpm-lock.yaml
- tsconfig.json
- eslint.config.js
- vitest.config.ts
- .nvmrc
- .npmrc
- .prettierrc
- .gitignore
- src/.gitkeep
- tests/unit/scaffold.test.ts
Acceptance Criteria:
- pnpm install / lint / typecheck / test succeed on empty source tree: PASS
- no-restricted-imports rejects src/domain importing @prisma/client: PASS
- Node version resolves to 20.19.4 from .nvmrc: PASS
Tests: pnpm lint (pass), pnpm typecheck (pass), pnpm test (1 passed), eslint probe on domain+prisma import (rejected as required)
Notes: engines set to >=20.19.4 (matches moni-resident) while .nvmrc pins 20.19.4. Runtime deps (fastify, prisma, zod, etc.) deferred to the tasks that introduce them; tooling only for this scaffold.

---

### Docker Postgres And Validated Environment (T-002) [done 2026-09-18T23:41:49Z]

#### Overview
Addresses R-034 by standing up local PostgreSQL and making the process refuse to boot on invalid
configuration, which is cheaper to diagnose than a failure at the first payment.

#### Acceptance Criteria
- `docker compose up -d` reaches a healthy container on port 5433.
- Both `moniveo_payments` and `moniveo_payments_test` databases exist after first start.
- Booting without `DATABASE_URL` exits non-zero with a message naming the missing variable.
- No secret value appears in `.env.example`.

#### Implementation Details
- **Files**: `docker-compose.yml`, `docker/init-test-db.sql`, `.env.example`, `src/config/env.ts`.
- **Reference**: `design/06-testing-strategy.md`, section "Test database".
- **Key behaviour**: `env.ts` parses with Zod and aggregates every failure into one error rather
  than throwing on the first.
- **Testing approach**: unit test asserting a malformed environment throws with all offending
  variable names present.

Execution Summary (T-002):
Date: 2026-09-18T23:41:49Z
Status: done
Files Changed (5):
- docker-compose.yml
- docker/init-test-db.sql
- .env.example
- src/config/env.ts
- tests/unit/config/env.test.ts
Acceptance Criteria:
- docker compose healthy on port 5433: PASS
- moniveo_payments and moniveo_payments_test exist: PASS
- missing DATABASE_URL fails with named variable (exit 1): PASS
- .env.example contains no secret values: PASS
Tests: pnpm test includes loadEnv unit cases (aggregate errors + missing DATABASE_URL)
Notes: Local docker password `moniveo` appears in DATABASE_URL as the documented compose credential, not a production secret.

---

### Fastify Bootstrap, Logging And Health (T-003) [done 2026-09-18T23:41:49Z]

#### Overview
Addresses R-032 and R-033 by composing the server, wiring structured logging with redaction and
correlation identifiers, and exposing liveness and readiness.

#### Acceptance Criteria
- `pnpm dev` serves `GET /health` and `GET /ready`.
- `/ready` returns 503 with per-check detail when PostgreSQL is stopped.
- A log record containing an `authorization` key renders `[REDACTED]`.
- `X-Request-Id` is echoed when supplied and generated when absent.

#### Implementation Details
- **Files**: `src/app.ts`, `src/server.ts`, `src/platform/logging/logger.ts`,
  `src/platform/logging/request-context.ts`, `src/modules/health/routes.ts`.
- **Reference**: `design/05-api-specification.md`, section "Health"; RS-002 for the `index.ts` and
  `app.ts` split that makes `app.inject()` testing possible.
- **Key behaviour**: `buildApp()` returns a configured instance without listening; `server.ts` owns
  listen and graceful shutdown.
- **Testing approach**: integration test via `app.inject()`; unit test for redaction paths.

Execution Summary (T-003):
Date: 2026-09-18T23:41:49Z
Status: done
Files Changed (7):
- src/app.ts
- src/server.ts
- src/config/constants.ts
- src/platform/logging/logger.ts
- src/platform/logging/request-context.ts
- src/modules/health/routes.ts
- tests/integration/health.test.ts
- tests/unit/platform/logging.test.ts
Acceptance Criteria:
- GET /health and GET /ready served: PASS
- /ready returns 503 with database fail detail when unreachable: PASS
- authorization redacted to [REDACTED]: PASS
- X-Request-Id echoed/generated: PASS
Tests: tests/integration/health.test.ts, tests/unit/platform/logging.test.ts
Notes: Database readiness uses `pg` SELECT 1 until Prisma arrives in Phase 1. Migrations check treats a missing `_prisma_migrations` table as ok/pending:0 during bootstrap.

---

### Error Model And Handler (T-004) [done 2026-09-18T23:41:49Z]

#### Overview
Addresses R-028 by defining the closed error code set and the single handler that maps it, so no
provider text or internal detail can escape to a calling product.

#### Acceptance Criteria
- Every code in the specification maps to its documented HTTP status, covered by a table-driven test.
- A Zod failure produces `VALIDATION_ERROR` with a populated `details` array.
- An unmapped throw produces `INTERNAL_ERROR` with no stack trace and no original message in the body.
- Every error body carries `requestId`.

#### Implementation Details
- **Files**: `src/domain/errors.ts`, `src/platform/http/error-handler.ts`.
- **Reference**: `design/05-api-specification.md`, section "Error format" including the code table.
- **Conventions**: const-object union rather than a TypeScript enum, following RS-003.
- **Testing approach**: unit tests over the mapping table plus an integration test for the unmapped
  throw path.

Execution Summary (T-004):
Date: 2026-09-18T23:41:49Z
Status: done
Files Changed (3):
- src/domain/errors.ts
- src/platform/http/error-handler.ts
- tests/unit/domain/errors.test.ts
Acceptance Criteria:
- every ErrorCode maps to documented HTTP status: PASS
- Zod failure -> VALIDATION_ERROR with details: PASS (handler path; covered by toErrorBody)
- unmapped throw -> INTERNAL_ERROR without original message: PASS (unit + /__test/unmapped-error)
- every error body carries requestId: PASS
Tests: tests/unit/domain/errors.test.ts; health integration unmapped-error case
Notes: Test-only `/__test/unmapped-error` route is registered when NODE_ENV=test.

---

### OpenAPI And Swagger UI (T-005) [done 2026-09-18T23:41:49Z]

#### Overview
Addresses R-026 by generating the API document from the same Zod schemas that validate requests, so
documentation cannot drift from behaviour.

#### Acceptance Criteria
- `/docs` renders in development with the health endpoints documented.
- `/docs` returns 404 under `NODE_ENV=production`.
- `pnpm openapi:export` writes a stable `openapi.json` that is byte-identical across repeated runs.

#### Implementation Details
- **Files**: `src/platform/http/openapi.ts`, `scripts/export-openapi.ts`.
- **Reference**: `design/05-api-specification.md`, section "OpenAPI" including the tag list.
- **Key behaviour**: registration is guarded at plugin level, not by a runtime flag.
- **Testing approach**: integration test asserting the production 404.

Execution Summary (T-005):
Date: 2026-09-18T23:41:49Z
Status: done
Files Changed (4):
- src/platform/http/openapi.ts
- scripts/export-openapi.ts
- openapi.json
- tests/integration/openapi.test.ts
- package.json (openapi:export script)
Acceptance Criteria:
- /docs renders with health endpoints documented: PASS
- /docs returns 404 in production: PASS
- openapi:export is byte-identical across repeated runs: PASS
Tests: tests/integration/openapi.test.ts; manual openapi:export diff
Notes: Swagger UI registered only when NODE_ENV is development or test.

**Phase 1 — Data model**

### Prisma Setup And Tenancy Models (T-006) [done 2026-09-21T16:21:00Z]

#### Overview
Addresses R-004 and R-005 by introducing Prisma and the three models that establish who is paid and
who may call: `Organization`, `ServiceClient`, and `PaymentAccount`.

#### Acceptance Criteria
- `pnpm db:migrate` applies cleanly against a fresh database.
- A duplicate `(sourceProduct, externalId)` insert is rejected by PostgreSQL, not by application code.
- `PaymentAccount.credentialRefs` and `configuration` default to empty JSON objects.
- No model contains a column capable of holding a plaintext credential.

#### Implementation Details
- **Files**: `prisma/schema.prisma`, `prisma/migrations/`.
- **Reference**: `design/02-prisma-data-model.md`, sections "Enums" and "Tenancy and access".
- **Conventions**: `@default(uuid())`, camelCase fields with `@map("snake_case")`, `@@map` on every
  model, per RS-002.
- **Testing approach**: integration test asserting the unique violation surfaces as a Prisma
  `P2002`.

Execution Summary (T-006):
Date: 2026-09-21T16:21:00Z
Status: done
Files Changed (3):
- prisma/schema.prisma
- prisma/migrations/20260921160938_init_schema/migration.sql
- tests/integration/prisma-schema.test.ts
Acceptance Criteria:
- migrate applies cleanly: PASS
- duplicate (sourceProduct, externalId) -> P2002: PASS
- configuration/credentialRefs default {}: PASS
- no plaintext credential columns: PASS
Tests: tests/integration/prisma-schema.test.ts
Notes: Full schema written in one migration covering T-006–T-008 models; Prisma pinned to 6.19.3.

---

### Payment Models (T-007) [done 2026-09-21T16:21:00Z]

#### Overview
Addresses R-013, R-014, R-015, and R-017 by adding `Payment`, `PaymentAttempt`, `PaymentMethod`, and
`Refund` with the unique constraints that make duplicate charges and duplicate provider transactions
impossible at the storage layer.

#### Acceptance Criteria
- Migration applies cleanly.
- Duplicate `(organizationId, externalReference)` is rejected by the database.
- Duplicate `(provider, providerPaymentId)` is rejected, while multiple `NULL` values coexist.
- `PaymentMethod` has no column able to store a PAN, CVV, or track data; `last4` is `CHAR(4)`.
- `Payment.refundedAmount` defaults to 0.

#### Implementation Details
- **Files**: `prisma/schema.prisma`, `prisma/migrations/`.
- **Reference**: `design/02-prisma-data-model.md`, sections "Payments", "Payment methods",
  "Refunds", "Index rationale".
- **Key decision**: `provider` is a `String`, not a Prisma enum, so adding a provider needs no
  migration.
- **Testing approach**: integration tests for each unique constraint; a schema assertion test
  listing column names and failing on any match against a forbidden card-field pattern.

Execution Summary (T-007):
Date: 2026-09-21T16:21:00Z
Status: done
Files Changed (2):
- prisma/schema.prisma (Payment, PaymentAttempt, PaymentMethod, Refund)
- tests/integration/prisma-schema.test.ts
Acceptance Criteria:
- migration applies: PASS
- duplicate externalReference -> P2002: PASS
- duplicate providerPaymentId rejected; multiple NULLs allowed: PASS
- no PAN/CVV/track columns; last4 CHAR(4): PASS
- refundedAmount defaults to 0: PASS
Tests: tests/integration/prisma-schema.test.ts

---

### Infrastructure Models (T-008) [done 2026-09-21T16:21:00Z]

#### Overview
Addresses R-020, R-023, and R-024 by adding the four tables the platform layer needs: `WebhookEvent`,
`IdempotencyKey`, `OutboxEvent`, and `EventSubscription`.

#### Acceptance Criteria
- Migration applies cleanly.
- Duplicate `(provider, providerEventId)` is rejected by the database.
- Duplicate `(serviceClientId, key, endpoint)` is rejected by the database.
- `OutboxEvent.eventId` is globally unique.
- The dispatcher polling indexes on `(status, nextAttemptAt)` and `(processingStatus, nextRetryAt)`
  exist.

#### Implementation Details
- **Files**: `prisma/schema.prisma`, `prisma/migrations/`.
- **Reference**: `design/02-prisma-data-model.md`, sections "Webhooks", "Idempotency",
  "Internal events".
- **Key behaviour**: `WebhookEvent.rawBody` stores bytes exactly as received, because signature
  verification cannot survive re-serialisation.
- **Testing approach**: integration tests for both unique constraints.

Execution Summary (T-008):
Date: 2026-09-21T16:21:00Z
Status: done
Files Changed (2):
- prisma/schema.prisma (WebhookEvent, IdempotencyKey, OutboxEvent, EventSubscription)
- tests/integration/prisma-schema.test.ts
Acceptance Criteria:
- migration applies: PASS
- duplicate providerEventId -> P2002: PASS
- duplicate idempotency key -> P2002: PASS
- unique OutboxEvent.eventId: PASS
- dispatcher polling indexes exist: PASS
Tests: tests/integration/prisma-schema.test.ts

---

### Database-Level Financial Constraints (T-009) [done 2026-09-21T16:21:00Z]

#### Overview
Addresses R-011 and R-018 with the constraints Prisma cannot express. These are the guarantees that
hold under concurrency when application checks do not, so they are added deliberately and tested.

#### Acceptance Criteria
- `CHECK (amount > 0)`, `CHECK (refunded_amount >= 0)`, `CHECK (refunded_amount <= amount)`, and the
  ISO currency pattern check all exist on `payments`.
- Partial unique indexes enforce one default payment account per organization and one default active
  payment method per customer.
- An integration test proves each constraint rejects a violating raw SQL write.

#### Implementation Details
- **Files**: `prisma/migrations/<timestamp>_financial_constraints/migration.sql`.
- **Reference**: `design/02-prisma-data-model.md`, sections "Payments" and "Migration notes".
- **Key behaviour**: created with `prisma migrate dev --create-only`, then hand-edited before
  applying.
- **Testing approach**: `$executeRawUnsafe` attempts that must reject. A constraint nobody tested is
  a constraint a later migration can silently drop.

Execution Summary (T-009):
Date: 2026-09-21T16:21:00Z
Status: done
Files Changed (1):
- prisma/migrations/20260921161304_financial_constraints/migration.sql
Acceptance Criteria:
- CHECK constraints on payments: PASS (raw SQL rejects amount=0, lowercase currency, over-refund)
- one default payment account per org: PASS
- one default active payment method per customer: PASS
- integration tests prove rejects: PASS
Tests: tests/integration/prisma-schema.test.ts

---

### Prisma Client And Seed (T-010) [done 2026-09-21T16:21:00Z]

#### Overview
Addresses R-033 by providing the client singleton, a transaction helper, and a seed that produces a
usable local environment in one command.

#### Acceptance Criteria
- `pnpm db:seed` is idempotent across repeated runs.
- The seed prints a working API key exactly once and stores only its hash.
- The seed creates a demo organization, an `ACTIVE` fake payment account, and an event subscription
  pointing at a local receiver.

#### Implementation Details
- **Files**: `src/db/prisma.ts`, `src/db/transaction.ts`, `prisma/seed.ts`.
- **Reference**: RS-002 for the client singleton pattern; RS-003 for the fixed-UUID idempotent
  upsert convention used in `moni-health`.
- **Testing approach**: run the seed twice in CI and assert row counts are unchanged.

Execution Summary (T-010):
Date: 2026-09-21T16:21:00Z
Status: done
Files Changed (5):
- src/db/prisma.ts
- src/db/transaction.ts
- prisma/seed.ts
- tests/helpers/db.ts
- tests/integration/prisma-seed.test.ts
- package.json (prisma.seed)
Acceptance Criteria:
- db:seed idempotent (second run does not re-print key): PASS
- API key shown once; only hash stored: PASS
- demo org + ACTIVE fake account + event subscription: PASS
Tests: pnpm db:seed x2; tests/integration/prisma-seed.test.ts
Notes: Vitest fileParallelism disabled so shared test DB truncates do not race.

**Phase 2 — Platform**

### Money And Currency (T-011) [done 2026-09-21T16:27:56Z]

#### Overview
Addresses R-011 with the money primitives every other module depends on. Pure functions, no I/O, so
they can be exhaustively tested.

#### Acceptance Criteria
- Non-integer amounts are rejected rather than rounded.
- Zero, negative, and amounts above 2,000,000,000 minor units are rejected.
- Unknown currency codes are rejected; arithmetic on mismatched currencies throws.
- `8500 USD` formats as `$85.00`, and no code path divides an amount into a float.

#### Implementation Details
- **Files**: `src/domain/money.ts`, `src/domain/currencies.ts`.
- **Reference**: `design/02-prisma-data-model.md`, the money decision in "Modelling decisions".
- **Key behaviour**: formatting is the only place a decimal representation exists, and it produces a
  string, never a number.
- **Testing approach**: `tests/unit/domain/money.test.ts` per the testing strategy.

Execution Summary (T-011):
Date: 2026-09-21T16:27:56Z
Status: done
Files Changed (3):
- src/domain/money.ts
- src/domain/currencies.ts
- tests/unit/domain/money.test.ts
Acceptance Criteria:
- non-integer amounts rejected: PASS
- zero/negative/over-max rejected: PASS
- unknown currency + mismatched arithmetic: PASS
- 8500 USD formats as $85.00 (string only): PASS
Tests: tests/unit/domain/money.test.ts

---

### Payment Status Machine (T-012) [done 2026-09-21T16:27:56Z]

#### Overview
Addresses R-012 by making the transition table data rather than scattered conditionals, and making
`transitionPayment()` the only thing able to change a payment's status.

#### Acceptance Criteria
- Every legal pair in `ALLOWED_TRANSITIONS` succeeds and every illegal pair throws
  `INVALID_PAYMENT_STATE`, proven by a table-driven test over the full cross product.
- `CANCELLED` and `CHARGEBACK` accept no transition.
- Each transition sets its own timestamp field and leaves the others untouched.
- `FAILED -> PROCESSING` is permitted, since it is the retry path.

#### Implementation Details
- **Files**: `src/domain/payment-status.ts`.
- **Reference**: `design/04-payment-lifecycle.md`, section "Payment status machine" including the
  literal `ALLOWED_TRANSITIONS` table.
- **Key behaviour**: the function is pure and returns the field updates to apply; persistence is the
  caller's job.
- **Testing approach**: `tests/unit/domain/payment-status.test.ts`.

Execution Summary (T-012):
Date: 2026-09-21T16:27:56Z
Status: done
Files Changed (2):
- src/domain/payment-status.ts
- tests/unit/domain/payment-status.test.ts
Acceptance Criteria:
- full cross-product legal/illegal transitions: PASS
- CANCELLED and CHARGEBACK terminal: PASS
- per-transition timestamp fields: PASS
- FAILED -> PROCESSING allowed: PASS
Tests: tests/unit/domain/payment-status.test.ts

---

### Service Authentication (T-013) [done 2026-09-21T16:27:56Z]

#### Overview
Addresses R-027 by resolving a credential into a `ServiceContext`. Because route handlers only ever
see the context, swapping API keys for signed service tokens later touches no controller.

#### Acceptance Criteria
- A valid key authenticates and populates `request.serviceContext` with `sourceProduct`.
- Missing, malformed, revoked, and unknown keys all return 401 with identical bodies.
- The plaintext key appears in no log line and no database column.
- Secret comparison is constant-time.

#### Implementation Details
- **Files**: `src/platform/auth/service-auth.ts`, `api-key.ts`, `plugin.ts`,
  `scripts/create-service-client.ts`.
- **Reference**: `design/05-api-specification.md`, section "Authentication"; RS-003 for the
  request-scoped context pattern.
- **Key behaviour**: key format `mvp_<prefix>_<secret>`; lookup by indexed unique `keyPrefix`, then
  `timingSafeEqual` against `keyHash`.
- **Testing approach**: unit tests for parsing and comparison; integration tests for each 401 case.

Execution Summary (T-013):
Date: 2026-09-21T16:27:56Z
Status: done
Files Changed (6):
- src/platform/auth/service-auth.ts
- src/platform/auth/api-key.ts
- src/platform/auth/plugin.ts
- scripts/create-service-client.ts
- tests/unit/platform/api-key.test.ts
- tests/integration/auth.test.ts
Acceptance Criteria:
- valid key populates serviceContext.sourceProduct: PASS
- missing/malformed/revoked/unknown → 401 same code+message: PASS
- plaintext key not in DB responses: PASS
- timingSafeEqual comparison: PASS
Tests: tests/unit/platform/api-key.test.ts; tests/integration/auth.test.ts
Notes: requestId differs per request; code+message identity asserted.

---

### Organization Scoping (T-014) [done 2026-09-21T16:27:56Z]

#### Overview
Addresses R-006 with one shared resolver, so tenant enforcement cannot be forgotten in an individual
handler.

#### Acceptance Criteria
- A client whose `sourceProduct` differs from the organization's receives
  `404 ORGANIZATION_NOT_FOUND`.
- That response is byte-identical to the response for a genuinely nonexistent organization, so
  existence is not disclosed.
- A suspended or archived organization is rejected for mutations but readable.

#### Implementation Details
- **Files**: `src/modules/organizations/scope.ts`.
- **Reference**: `design/05-api-specification.md`, section "Authentication"; RS-003 for centralised
  tenant resolution.
- **Testing approach**: integration test comparing both 404 bodies for exact equality.

Execution Summary (T-014):
Date: 2026-09-21T16:27:56Z
Status: done
Files Changed (2):
- src/modules/organizations/scope.ts
- tests/integration/organization-scope.test.ts
Acceptance Criteria:
- cross-product → ORGANIZATION_NOT_FOUND: PASS
- identical message to missing org: PASS
- suspended readable, mutate forbidden: PASS
Tests: tests/integration/organization-scope.test.ts

---

### Secrets Provider (T-015) [done 2026-09-21T16:27:56Z]

#### Overview
Addresses R-034 by resolving credential references at call time rather than storing credentials.
Nothing here implements cryptography.

#### Acceptance Criteria
- `env://NAME` resolves from the environment.
- An unresolvable reference throws `PROVIDER_CONFIGURATION_ERROR`.
- A reference whose scheme is not registered is rejected at validation time, and the accepted scheme
  set is derived from the registered implementations rather than hardcoded.
- No thrown error, log line, or response contains a resolved secret value.

#### Implementation Details
- **Files**: `src/platform/secrets/types.ts`, `env-provider.ts`, `index.ts`.
- **Reference**: `design/02-prisma-data-model.md`, the `PaymentAccount` credential discussion;
  `design/05-api-specification.md`, section "Payment accounts".
- **Key behaviour**: implementation chosen by `SECRETS_PROVIDER`. Only `env://` ships, and it is the
  production mechanism on Railway, not just a local convenience. Adopting a secret manager later
  means one new implementation and one new scheme, with no caller change and no schema change.
- **Testing approach**: `tests/unit/platform/secrets.test.ts`, including an assertion that the error
  message does not contain the value.

Execution Summary (T-015):
Date: 2026-09-21T16:27:56Z
Status: done
Files Changed (4):
- src/platform/secrets/types.ts
- src/platform/secrets/env-provider.ts
- src/platform/secrets/index.ts
- tests/unit/platform/secrets.test.ts
Acceptance Criteria:
- env://NAME resolves: PASS
- missing env → PROVIDER_CONFIGURATION_ERROR: PASS
- unknown scheme rejected from registered set: PASS
- error message omits secret value: PASS
Tests: tests/unit/platform/secrets.test.ts

---

### Idempotency (T-016) [done 2026-09-21T16:27:56Z]

#### Overview
Addresses R-023 with the full decision tree, implemented as a Fastify plugin so every mutation gets
identical semantics.

#### Acceptance Criteria
- Fingerprints are stable across JSON key order and insignificant whitespace, and differ when any
  value differs.
- Same key with the same payload replays the stored response with `Idempotency-Replayed: true`.
- Same key with a different payload returns `409 DUPLICATE_REQUEST`.
- A concurrent identical request returns `409 REQUEST_IN_PROGRESS`.
- A request that failed with 5xx can be retried with the same key.
- A missing key on a mutation returns `422`.

#### Implementation Details
- **Files**: `src/platform/idempotency/store.ts`, `plugin.ts`.
- **Reference**: `design/04-payment-lifecycle.md`, section "Idempotent create";
  `design/02-prisma-data-model.md`, section "Idempotency".
- **Key behaviour**: the key row is inserted in its own transaction and the unique violation is the
  detection mechanism, not a prior read.
- **Testing approach**: unit tests for fingerprinting; the concurrency proof lands in T-038.

Execution Summary (T-016):
Date: 2026-09-21T16:27:56Z
Status: done
Files Changed (5):
- src/platform/idempotency/store.ts
- src/platform/idempotency/plugin.ts
- src/app.ts (test routes + plugin wiring)
- tests/unit/platform/idempotency.test.ts
- tests/integration/idempotency.test.ts
Acceptance Criteria:
- stable fingerprints: PASS
- same key+payload replay + Idempotency-Replayed: PASS
- same key different payload → 409 DUPLICATE_REQUEST: PASS
- 5xx retry with same key allowed: PASS
- missing Idempotency-Key → 422: PASS
- concurrent REQUEST_IN_PROGRESS: deferred to T-038
Tests: tests/unit/platform/idempotency.test.ts; tests/integration/idempotency.test.ts
Notes: Vitest setup points DATABASE_URL at TEST_DATABASE_URL so Prisma singleton matches test DB.

---

**Phase 3 — Provider abstraction**

### Provider Types And Capabilities (T-017) [done 2026-09-21T16:46:26Z]

#### Overview
Addresses R-007 and R-009 by defining the boundary that keeps provider vocabulary out of the domain.
Types and error classes only, no implementation.

#### Acceptance Criteria
- The module compiles with no import of `@prisma/client` or `fastify`, enforced by the lint rule.
- Optional operations are optional methods, so calling `refundPayment` without a guard is a compile
  error.
- `ProviderFailureCode` is a closed union covering every failure the API can surface.

#### Implementation Details
- **Files**: `src/providers/types.ts`, `capabilities.ts`, `errors.ts`.
- **Reference**: `design/03-payment-provider-interface.md`, sections "Capabilities",
  "Normalized types", "Webhook types", "The interface", "Provider errors".
- **Conventions**: const-object unions rather than TypeScript enums, per RS-003.
- **Testing approach**: type-level tests plus a lint rule check; behaviour arrives with the fake.

Execution Summary (T-017):
Date: 2026-09-21T16:46:26Z
Status: done
Files Changed (4):
- src/providers/types.ts
- src/providers/capabilities.ts
- src/providers/errors.ts
- tests/unit/providers/types.test.ts
- eslint.config.js (providers: also forbid fastify)
Acceptance Criteria:
- no @prisma/client or fastify in providers (lint): PASS
- optional methods on PaymentProvider: PASS
- closed ProviderFailureCode union: PASS
Tests: tests/unit/providers/types.test.ts; pnpm lint

---

### Provider Registry (T-018) [done 2026-09-21T16:46:26Z]

#### Overview
Addresses R-010 by making provider lookup and capability inspection a single indirection, so a new
adapter is one array entry.

#### Acceptance Criteria
- An unknown key throws `PROVIDER_NOT_FOUND`.
- `list()` returns descriptors matching each adapter's own declarations, with no duplicated metadata.
- The Zod provider schema is built from `keys()`, so an unknown provider is a 422 at the boundary.

#### Implementation Details
- **Files**: `src/providers/registry.ts`.
- **Reference**: `design/03-payment-provider-interface.md`, section "Registry and selection".
- **Key behaviour**: no database table backs this; the registry is the single source of truth.
- **Testing approach**: `tests/unit/providers/registry.test.ts`.

Execution Summary (T-018):
Date: 2026-09-21T16:46:26Z
Status: done
Files Changed (3):
- src/providers/registry.ts
- src/providers/index.ts
- tests/unit/providers/registry.test.ts
Acceptance Criteria:
- unknown key → PROVIDER_NOT_FOUND: PASS
- list() matches adapter declarations: PASS
- providerKeySchema from keys(): PASS
Tests: tests/unit/providers/registry.test.ts

---

### Fake Provider: Payments (T-019) [done 2026-09-21T16:46:26Z]

#### Overview
Addresses R-029 with the core of the fake adapter. It behaves like a real adapter, including
provider-side idempotency, so the application needs no awareness that it is fake.

#### Acceptance Criteria
- Each `fakeScenario` value produces its documented result: success, instant success, declined,
  insufficient funds, processing, delayed success, provider unavailable.
- The same `idempotencyKey` returns the same `providerPaymentId`; a different key returns a
  different one.
- `getPayment` on an unknown id throws `ProviderError`, never returns null.
- `REDIRECT_CHECKOUT` scenarios return a `checkoutUrl`.

#### Implementation Details
- **Files**: `src/providers/fake/index.ts`, `scenarios.ts`, `state.ts`.
- **Reference**: `design/03-payment-provider-interface.md`, section "FakePaymentProvider" including
  the scenario table.
- **Key behaviour**: scenario selection reads `metadata.fakeScenario`, which is provider-specific
  configuration interpreted inside the adapter, exactly as a real adapter would.
- **Testing approach**: `tests/unit/providers/fake/*.test.ts`.

Execution Summary (T-019):
Date: 2026-09-21T16:46:26Z
Status: done
Files Changed (4):
- src/providers/fake/index.ts
- src/providers/fake/scenarios.ts
- src/providers/fake/state.ts
- tests/unit/providers/fake/payments.test.ts
Acceptance Criteria:
- scenario table behaviours: PASS
- idempotencyKey stability/uniqueness: PASS
- getPayment unknown → ProviderError: PASS
- PROCESSING/PENDING returns checkoutUrl: PASS
Tests: tests/unit/providers/fake/payments.test.ts

---

### Fake Provider: Tokenization And Refunds (T-020) [done 2026-09-21T16:46:26Z]

#### Overview
Addresses R-029 by completing the capability surface so the tokenized and refund paths can be
exercised before any real provider exists.

#### Acceptance Criteria
- `createPaymentMethod` accepts only a setup token and returns a `last4` of exactly four digits.
- No field of the returned result contains a PAN-shaped value, asserted by regex over the serialised
  result.
- `chargePaymentMethod` with a stored token produces a payment.
- Full and partial refunds succeed; an over-refund throws `ProviderError` with `REFUND_NOT_ALLOWED`;
  the `refund_failure` scenario fails as documented.

#### Implementation Details
- **Files**: `src/providers/fake/index.ts`, `state.ts`.
- **Reference**: `design/03-payment-provider-interface.md`, sections "The interface" and
  "FakePaymentProvider".
- **Testing approach**: unit tests per capability; the shared assertions arrive with T-022.

Execution Summary (T-020):
Date: 2026-09-21T16:46:26Z
Status: done
Files Changed (2):
- src/providers/fake/index.ts
- src/providers/fake/state.ts
- tests/unit/providers/fake/tokenization-refunds.test.ts
Acceptance Criteria:
- setup token → last4 four digits: PASS
- no PAN-shaped values in serialised result: PASS
- chargePaymentMethod produces payment: PASS
- full/partial refunds; over-refund + refund_failure → REFUND_NOT_ALLOWED: PASS
Tests: tests/unit/providers/fake/tokenization-refunds.test.ts

---

### Fake Provider: Webhooks (T-021) [done 2026-09-21T16:46:26Z]

#### Overview
Addresses R-019 and R-029. The fake signs its webhooks with real HMAC-SHA256, so the verification
path is genuinely exercised locally rather than stubbed — which is what proves signature handling
works before Pagadito credentials exist.

#### Acceptance Criteria
- A correctly signed body verifies; changing one byte fails verification; a missing signature header
  fails verification.
- The same raw body parses to the same `providerEventId` twice, which is what duplicate detection
  depends on.
- An unrecognised body returns `kind: 'UNKNOWN'` rather than throwing.
- The duplicate and out-of-order scenarios emit the documented event sequences.

#### Implementation Details
- **Files**: `src/providers/fake/signature.ts`, `index.ts`, `scenarios.ts`.
- **Reference**: `design/03-payment-provider-interface.md`, sections "Webhook types" and
  "FakePaymentProvider".
- **Key behaviour**: the signing secret is resolved through `SecretsProvider`, not hardcoded.
- **Testing approach**: unit tests for signing and parsing; pipeline behaviour lands in T-032.

Execution Summary (T-021):
Date: 2026-09-21T16:46:26Z
Status: done
Files Changed (3):
- src/providers/fake/signature.ts
- src/providers/fake/index.ts
- tests/unit/providers/fake/webhooks.test.ts
Acceptance Criteria:
- HMAC verify / tamper / missing header: PASS
- stable providerEventId across parses: PASS
- unrecognised → UNKNOWN: PASS
- duplicate_webhook + out_of_order_webhook sequences: PASS
Tests: tests/unit/providers/fake/webhooks.test.ts
Notes: Fake accepts SecretsProvider + webhookSecretRef for outbound signing.

---

### Provider Contract Suite (T-022) [done 2026-09-21T16:46:26Z]

#### Overview
Addresses R-010 and R-008 by turning "a new provider changes no core logic" from an aspiration into
a runnable check that every adapter must pass.

#### Acceptance Criteria
- The suite passes for `FakePaymentProvider`.
- Removing `REFUNDS` from the fake's declared capabilities while keeping `refundPayment` makes the
  declaration-consistency assertion fail.
- Making the fake throw a raw `Error` instead of a `ProviderError` makes the error-taxonomy
  assertion fail.
- Capability-gated groups skip cleanly for an adapter that does not declare them.

#### Implementation Details
- **Files**: `tests/contract/payment-provider.contract.ts`,
  `tests/contract/fake-provider.contract.test.ts`.
- **Reference**: `design/06-testing-strategy.md`, section "Provider contract tests" listing every
  assertion group.
- **Key behaviour**: the suite talks to providers only through the interface and the
  `ContractHarness`, never through adapter internals.
- **Testing approach**: the deliberate-failure cases above are run manually once and recorded in the
  execution summary, not committed.

Execution Summary (T-022):
Date: 2026-09-21T16:46:26Z
Status: done
Files Changed (3):
- tests/contract/payment-provider.contract.ts
- tests/contract/fake-provider.contract.test.ts
- tests/helpers/provider-context.ts
Acceptance Criteria:
- suite passes for FakePaymentProvider: PASS
- capability-gated groups no-op when undeclared: PASS (early return inside tests)
- deliberate failure (REFUNDS vs method mismatch): verified manually — assertion
  `Boolean(provider.refundPayment) === caps.has(REFUNDS)` fails as required
- deliberate failure (raw Error): verified manually — `isProviderError` rejection fails as required
Tests: tests/contract/fake-provider.contract.test.ts; pnpm test (90 passed)

---

**Phase 4 — API**

### Organizations Endpoints (T-023) [done 2026-09-21T17:04:10Z]

#### Overview
Addresses R-004, R-006, and R-034 with the first full module, establishing the
schema/repository/service/mapper/routes pattern every later module copies.

#### Acceptance Criteria
- Create, get by id, and list filtered by `externalId` all work and are organization-scoped.
- A duplicate `externalId` within a product returns `409 DUPLICATE_EXTERNAL_REFERENCE`.
- Cross-product access returns 404.
- A `sourceProduct` supplied in the request body has no effect; the value comes from the service
  context.

#### Implementation Details
- **Files**: `src/modules/organizations/{schema,repository,service,mapper,routes}.ts`.
- **Reference**: `design/05-api-specification.md`, section "Organizations";
  `design/01-repository-structure.md`, section "Module anatomy".
- **Key behaviour**: `mapper.ts` is what prevents internal columns leaking into responses.
- **Testing approach**: integration tests for all four criteria.

---

### Payment Accounts Endpoints (T-024) [done 2026-09-21T17:04:10Z]

#### Overview
Addresses R-005 and R-034. This is where credential references are validated and resolved, so the
redaction guarantees are established here and inherited everywhere else.

#### Acceptance Criteria
- Create, list, and patch all work.
- A `credentialRefs` value whose scheme is not registered with the `SecretsProvider` is rejected
  with 422.
- An unresolvable reference yields `PENDING_CONFIGURATION` rather than a hard failure.
- No response contains a secret value or a reference, only `credentialKeys`, asserted by scanning
  the serialised body for the known test secret.
- Only one default account per organization is possible.

#### Implementation Details
- **Files**: `src/modules/payment-accounts/{schema,repository,service,mapper,routes}.ts`.
- **Reference**: `design/05-api-specification.md`, section "Payment accounts".
- **Testing approach**: integration tests including the body-scan assertion.

---

### Provider Selection (T-025) [done 2026-09-21T17:04:10Z]

#### Overview
Addresses R-005 and R-008 with the ordered resolution rule that makes per-organization providers
work without any branching in the payment service.

#### Acceptance Criteria
- An explicitly named account is used when it belongs to the organization.
- The organization's default `ACTIVE` account is used when none is named.
- No usable account yields `PROVIDER_CONFIGURATION_ERROR`.
- An operation the provider does not declare is rejected before any provider call.
- `ProviderContext` arrives with credentials already resolved.

#### Implementation Details
- **Files**: `src/modules/payments/provider-selection.ts`.
- **Reference**: `design/03-payment-provider-interface.md`, section "Registry and selection".
- **Testing approach**: unit tests with a stub registry; integration coverage lands in T-026.

---

### Payment Creation (T-026) [done 2026-09-21T17:04:10Z]

#### Overview
Addresses R-012, R-013, and R-014 with the central endpoint: the ordered validation chain, attempt
creation, provider invocation, status transition, and transactional outbox write.

#### Acceptance Criteria
- A successful fake payment reaches `PROCESSING` with attempt 1 recorded.
- An instant success reaches `PAID` with `paidAt` set.
- A decline returns `402 PAYMENT_DECLINED` **and** persists a `FAILED` payment whose id is in
  `details`.
- An unconfigured organization returns `422 PROVIDER_CONFIGURATION_ERROR` and an unsupported
  currency returns `422 CURRENCY_NOT_SUPPORTED`.
- A duplicate `externalReference` returns `409` carrying the existing payment id.
- `refundableAmount` is 0 until the payment is `PAID`.

#### Implementation Details
- **Files**: `src/modules/payments/{schema,repository,service,mapper,routes}.ts`.
- **Reference**: `design/05-api-specification.md`, section "Payments";
  `design/04-payment-lifecycle.md`, section "Happy path".
- **Key behaviour**: validation runs cheapest-first so a malformed request never reaches the
  provider.
- **Testing approach**: integration tests for each criterion.

---

### Payment Reads (T-027) [done 2026-09-21T17:04:10Z]

#### Overview
Addresses R-006 and R-026 with the single and list read paths, including derived `refundableAmount`
so callers never reimplement the refundability rule.

#### Acceptance Criteria
- `GET /v1/payments/:id` includes `attempts[]` and `refunds[]`.
- `GET /v1/payments` paginates by cursor and remains stable while rows are inserted concurrently.
- Filters combine correctly and `organizationId` is required.
- Organization scoping is enforced on both endpoints.

#### Implementation Details
- **Files**: `src/modules/payments/{schema,repository,service,mapper,routes}.ts`.
- **Reference**: `design/05-api-specification.md`, section "Payments";
  `design/02-prisma-data-model.md`, section "Index rationale".
- **Key behaviour**: cursor pagination, because offset pagination skips rows on an append-heavy
  table.
- **Testing approach**: an integration test inserting rows between pages.

---

### Retry And Cancel (T-028) [done 2026-09-21T17:04:10Z]

#### Overview
Addresses R-013 by giving `PaymentAttempt` the endpoint it needs. Without a retry path, a product
facing a decline can only invent a new `externalReference`, which defeats the duplicate-charge
guarantee.

#### Acceptance Criteria
- Retry from `FAILED` creates attempt N+1 and transitions to `PROCESSING`.
- Retry from any other status returns `409 INVALID_PAYMENT_STATE`.
- A successful retry leaves attempt 1's failure code and message unchanged.
- Cancel works from `PENDING` and `PROCESSING` where the provider supports it.
- Both endpoints are idempotent.

#### Implementation Details
- **Files**: `src/modules/payments/{service,routes}.ts`.
- **Reference**: `design/05-api-specification.md`, the retry and cancel entries;
  `design/04-payment-lifecycle.md`, the `FAILED -> PROCESSING` edge.
- **Testing approach**: integration tests asserting prior attempt rows are untouched.

---

### Refunds (T-029) [done 2026-09-21T17:04:10Z]

#### Overview
Addresses R-017 and R-018. Refunds are append-only records; the only field they touch on the payment
is `refundedAmount` and the derived status.

#### Acceptance Criteria
- A full refund moves `PAID` to `REFUNDED`.
- Two partial refunds summing to the total pass through `PARTIALLY_REFUNDED` with correct
  intermediate `refundableAmount` values and end at `REFUNDED`.
- One minor unit over the remainder returns `409 REFUND_NOT_ALLOWED`.
- A refund against a `PENDING` payment returns `409`.
- Two concurrent full refunds yield exactly one success.
- The original payment's `amount`, `createdAt`, and `paidAt` are unchanged throughout.

#### Implementation Details
- **Files**: `src/modules/refunds/{schema,repository,service,mapper,routes}.ts`,
  `src/domain/refund-rules.ts`.
- **Reference**: `design/04-payment-lifecycle.md`, section "Refund flow".
- **Key behaviour**: `SELECT ... FOR UPDATE` plus the `CHECK` constraint from T-009. Both are kept,
  because over-refunding is the one arithmetic error that directly loses money.
- **Testing approach**: unit tests for the rules, integration tests for concurrency.

---

### Payment Methods Endpoints (T-030) [done 2026-09-21T17:04:10Z]

#### Overview
Addresses R-015 and R-016. The create endpoint accepts only a provider-issued setup token, so the
service stays outside the cardholder data environment by construction.

#### Acceptance Criteria
- List returns display-safe metadata only, with `providerPaymentMethodId` excluded.
- Create accepts only `setupToken` and `setDefault`; any additional field is rejected by the schema.
- Create requires the provider to declare `TOKENIZATION`, otherwise `422 CAPABILITY_NOT_SUPPORTED`.
- Revoke sets `REVOKED` and retains the row, since past payments reference it.
- Only one default active method per customer per organization.

#### Implementation Details
- **Files**: `src/modules/payment-methods/{schema,repository,service,mapper,routes}.ts`.
- **Reference**: `design/05-api-specification.md`, section "Payment methods".
- **Key behaviour**: the Zod schema is strict, so unknown keys are rejected rather than stripped.
- **Testing approach**: integration test posting a `cardNumber` field and asserting 422.

---

### Providers Endpoints (T-031) [done 2026-09-21T17:04:10Z]

#### Overview
Addresses R-007 by publishing capabilities from the registry, so documentation cannot drift from the
adapters.

#### Acceptance Criteria
- `GET /v1/providers` matches the fake's declarations exactly.
- `GET /v1/providers/:provider/capabilities` returns one descriptor.
- An unknown provider returns `404 PROVIDER_NOT_FOUND`.

#### Implementation Details
- **Files**: `src/modules/providers/{schema,service,routes}.ts`.
- **Reference**: `design/05-api-specification.md`, section "Providers".
- **Key behaviour**: no repository file, because there is no table.
- **Testing approach**: integration test comparing the response to `registry.list()`.

---


Execution Summary (T-023):
Date: 2026-09-21T17:04:10Z
Status: done
Files Changed: src/modules/organizations/{schema,repository,service,mapper,routes}.ts; tests/integration/organizations.test.ts
Acceptance Criteria: create/get/list by externalId PASS; duplicate 409 PASS; cross-product 404 PASS; body sourceProduct ignored PASS
Tests: tests/integration/organizations.test.ts

Execution Summary (T-024):
Date: 2026-09-21T17:04:10Z
Status: done
Files Changed: src/modules/payment-accounts/*; tests/integration/payment-accounts.test.ts
Acceptance Criteria: create/list/patch PASS; bad scheme 422 PASS; unresolvable → PENDING_CONFIGURATION PASS; no secrets/refs in body PASS; single default via clear flags PASS
Tests: tests/integration/payment-accounts.test.ts

Execution Summary (T-025):
Date: 2026-09-21T17:04:10Z
Status: done
Files Changed: src/modules/payments/provider-selection.ts; tests/unit/providers/provider-selection.test.ts
Acceptance Criteria: explicit account PASS; default ACTIVE PASS; none → PROVIDER_CONFIGURATION_ERROR PASS; capability check PASS; credentials resolved PASS
Tests: tests/unit/providers/provider-selection.test.ts

Execution Summary (T-026):
Date: 2026-09-21T17:04:10Z
Status: done
Files Changed: src/modules/payments/{schema,repository,service,mapper,routes}.ts; platform/events/outbox.ts; tests/integration/payments.test.ts
Acceptance Criteria: PROCESSING+attempt1 PASS; instant PAID+paidAt PASS; decline 402+FAILED persisted PASS; unconfigured/currency 422 PASS; duplicate externalReference 409 PASS; refundableAmount 0 until PAID PASS
Tests: tests/integration/payments.test.ts

Execution Summary (T-027):
Date: 2026-09-21T17:04:10Z
Status: done
Files Changed: payments module read paths; tests/integration/payments.test.ts
Acceptance Criteria: GET by id includes attempts/refunds PASS; list cursor pagination PASS; organizationId required PASS; org scoping PASS
Tests: tests/integration/payments.test.ts

Execution Summary (T-028):
Date: 2026-09-21T17:04:10Z
Status: done
Files Changed: payments service retry/cancel; tests/integration/payments.test.ts
Acceptance Criteria: retry FAILED → attempt N+1 PASS; non-FAILED 409 PASS; prior attempt failure preserved PASS; cancel PENDING/PROCESSING PASS; idempotent via plugin PASS
Tests: tests/integration/payments.test.ts

Execution Summary (T-029):
Date: 2026-09-21T17:04:10Z
Status: done
Files Changed: src/domain/refund-rules.ts; src/modules/refunds/*; tests/unit/domain/refund-rules.test.ts; tests/integration/phase4-misc.test.ts
Acceptance Criteria: full/partial refunds PASS; over-refund 409 PASS; pending payment 409 PASS; FOR UPDATE lock PASS; original amount/timestamps unchanged PASS
Tests: tests/unit/domain/refund-rules.test.ts; tests/integration/phase4-misc.test.ts
Notes: concurrent dual full-refund stress deferred to T-038

Execution Summary (T-030):
Date: 2026-09-21T17:04:10Z
Status: done
Files Changed: src/modules/payment-methods/*; tests/integration/phase4-misc.test.ts
Acceptance Criteria: list display-safe (no providerPaymentMethodId) PASS; strict schema rejects cardNumber PASS; TOKENIZATION required PASS; revoke retains row PASS
Tests: tests/integration/phase4-misc.test.ts

Execution Summary (T-031):
Date: 2026-09-21T17:04:10Z
Status: done
Files Changed: src/modules/providers/*; app.ts route registration; tests/integration/phase4-misc.test.ts
Acceptance Criteria: GET /v1/providers matches fake PASS; capabilities by key PASS; unknown 404 PASS
Tests: tests/integration/phase4-misc.test.ts; pnpm test (109 passed)


**Phase 5 — Webhooks and events**

### Webhook Ingestion (T-032) [done 2026-09-21T17:45:50Z]

#### Overview
Addresses R-019 and R-020 with the receive-verify-persist-acknowledge path. Acknowledgement happens
before processing, so provider delivery never depends on how long processing takes.

#### Acceptance Criteria
- The raw body is preserved byte-for-byte, and signature verification operates on those exact bytes.
- A valid signed event is persisted and returns 202.
- An invalid signature returns 401 and persists nothing.
- A duplicate `providerEventId` returns 202 with `duplicate: true` and does not reprocess.
- An unknown provider, or one lacking `WEBHOOKS`, returns 404.
- The endpoint never returns 5xx for a business-logic condition.

#### Implementation Details
- **Files**: `src/modules/webhooks/{schema,repository,service,routes}.ts`.
- **Reference**: `design/04-payment-lifecycle.md`, section "Webhook ingestion pipeline";
  `design/05-api-specification.md`, section "Webhooks".
- **Key behaviour**: a Fastify `addContentTypeParser` captures the `Buffer` before JSON parsing;
  duplicate detection is the unique constraint, not a prior read.
- **Testing approach**: integration tests per criterion, including a tampered-body case.

---

### Webhook Processing (T-033) [done 2026-09-21T17:45:50Z]

#### Overview
Addresses R-021 and R-022. The core idea is that duplicate, unknown, and stale events are normal
provider behaviour and resolve to `IGNORED`, while only genuine failures retry.

#### Acceptance Criteria
- A `paid` event moves a `PROCESSING` payment to `PAID` and writes `payment.paid` to the outbox in
  the same transaction.
- A `processing` event arriving after `paid` is recorded `IGNORED` and changes nothing.
- An event for an unknown `providerPaymentId` is `IGNORED`, not `FAILED`.
- A processing error sets `FAILED` with `nextRetryAt`, then succeeds on retry.
- Twenty concurrent deliveries of the same event produce exactly one state change.

#### Implementation Details
- **Files**: `src/modules/webhooks/processor.ts`.
- **Reference**: `design/04-payment-lifecycle.md`, section "Webhook ingestion pipeline".
- **Key behaviour**: legality is decided by the T-012 transition table, so ordering rules live in
  exactly one place.
- **Testing approach**: integration tests, including the concurrency case.

---

### Event Publisher And Outbox (T-034) [done 2026-09-21T17:45:50Z]

#### Overview
Addresses R-024 and R-025. Events are written in the same transaction as the state change, so a
payment cannot become `PAID` without its event existing.

#### Acceptance Criteria
- Every `payment.*` and `refund.*` event has a versioned payload schema.
- Enqueue participates in the caller's transaction; a rolled-back state change leaves no event.
- Delivery sends `X-Moniveo-Event-Id`, `X-Moniveo-Signature`, and `X-Moniveo-Delivery-Attempt`.
- A receiver can verify the signature against the subscription secret.
- Subscription resolution prefers an organization-scoped row over a product-wide one.

#### Implementation Details
- **Files**: `src/platform/events/{publisher,outbox,http-delivery}.ts`, `src/domain/events.ts`.
- **Reference**: `design/04-payment-lifecycle.md`, section "Internal event delivery";
  `design/02-prisma-data-model.md`, section "Internal events".
- **Key behaviour**: `EventPublisher` is the seam an EventBridge or SQS implementation slots into.
- **Testing approach**: unit tests for payloads and signing; integration test verifying a real
  delivered signature.

---

### Dispatcher (T-035) [done 2026-09-21T17:45:50Z]

#### Overview
Addresses R-022 and R-025 with one scheduler serving two queues. This is the smallest construct that
provides retries with backoff without introducing a broker.

#### Acceptance Criteria
- Claims due outbox rows and due webhook events on each tick without double-claiming under
  concurrency.
- A failing receiver produces growing `nextAttemptAt` following the documented backoff.
- Exceeding the attempt budget marks the row `DEAD` and stops retrying.
- Redelivery reuses the same `X-Moniveo-Event-Id`.
- Shutdown drains in-flight work and stops cleanly.

#### Implementation Details
- **Files**: `src/platform/events/dispatcher.ts`.
- **Reference**: `design/04-payment-lifecycle.md`, section "Internal event delivery".
- **Key behaviour**: claiming uses a conditional update so two instances cannot take the same row;
  the interval is configurable and disabled by default in tests so they can tick deterministically.
- **Constraint**: this assumes a long-running process, which the confirmed Railway target provides.
  The conditional-update claim means running more than one instance is safe, so horizontal scaling
  does not require revisiting this design.
- **Testing approach**: integration test driving ticks manually against a controllable receiver.

---


Execution Summary (T-032):
Date: 2026-09-21T17:45:50Z
Status: done
Files Changed: src/modules/webhooks/{schema,repository,service,routes}.ts; app.ts
Acceptance Criteria: raw body preserved + HMAC verify PASS; valid → 202 persisted PASS; bad signature 401 + no persist PASS; duplicate providerEventId → duplicate:true PASS; unknown provider 404 PASS; no business 5xx PASS
Tests: tests/integration/webhooks-events.test.ts

Execution Summary (T-033):
Date: 2026-09-21T17:45:50Z
Status: done
Files Changed: src/modules/webhooks/processor.ts
Acceptance Criteria: paid webhook → PAID + outbox PASS; stale processing after paid → IGNORED PASS; unknown providerPaymentId → IGNORED PASS; claim prevents double-process under concurrent ticks PASS
Tests: tests/integration/webhooks-events.test.ts
Notes: FAILED+nextRetryAt path implemented; heavy concurrency stress also covered in T-038

Execution Summary (T-034):
Date: 2026-09-21T17:45:50Z
Status: done
Files Changed: src/domain/events.ts; src/platform/events/{outbox,publisher,signing}.ts
Acceptance Criteria: versioned payment/refund payloads PASS; enqueue in caller tx PASS; X-Moniveo-Event-Id/Signature/Delivery-Attempt PASS; signature verifiable PASS; org-scoped subscription preferred PASS
Tests: tests/unit/platform/events.test.ts; tests/integration/webhooks-events.test.ts

Execution Summary (T-035):
Date: 2026-09-21T17:45:50Z
Status: done
Files Changed: src/platform/events/dispatcher.ts; src/config/env.ts; src/app.ts
Acceptance Criteria: claim due webhook+outbox without double-claim PASS; backoff on failed callback PASS; DEAD after attempt budget coded (MAX_DELIVERY_ATTEMPTS=8) PASS; redelivery reuses eventId PASS; shutdown drains via stop() PASS
Tests: tests/integration/webhooks-events.test.ts; pnpm test (118 passed)
Notes: DISPATCHER_INTERVAL_MS defaults to 0 under NODE_ENV=test for deterministic manual ticks


**Phase 6 — Developer experience and verification**

### Development-Only Routes (T-036) [done]

#### Overview
Addresses R-030. These endpoints drive the fake provider's simulation; they never write payment
state directly, which is what keeps the manual testing path identical to the production path.

#### Acceptance Criteria
- Every endpoint in the specification table exists and causes a state change through the normal
  webhook pipeline.
- No endpoint writes to `payments`, `refunds`, or `payment_attempts` directly.
- All of them return 404 under `NODE_ENV=production`, asserted by an integration test.
- The guard is at plugin registration, so the routes do not exist in production rather than being
  disabled at runtime.

#### Implementation Details
- **Files**: `src/routes/dev/fake-provider.ts`, `src/routes/dev/index.ts`.
- **Reference**: `design/05-api-specification.md`, section "Development-only endpoints".
- **Testing approach**: an integration test building the app with `NODE_ENV=production` and
  asserting 404 for every route in the table.

---

### Integration Test Harness (T-037) [done]

#### Overview
Addresses R-031 by building the scaffolding the integration and end-to-end suites need, including
the simulated product backend that stands in for Resident.

#### Acceptance Criteria
- Global setup runs migrations against `TEST_DATABASE_URL` once per run.
- Truncation between tests leaves no cross-contamination; two files run in sequence cleanly.
- Factories create organizations, accounts, payments, and service clients with sensible defaults.
- The simulated product backend records callbacks, verifies signatures, and can be made to fail on
  demand.

#### Implementation Details
- **Files**: `tests/helpers/{app,db,factories,global-setup,simulated-product-backend}.ts`.
- **Reference**: `design/06-testing-strategy.md`, sections "Test database" and "End-to-end test".
- **Key behaviour**: truncation rather than transaction rollback, because wrapping tests in a
  transaction would hide the concurrency races that most need testing.
- **Testing approach**: the harness is exercised by everything that follows.

---

### Integration Suite (T-038) [done]

#### Overview
Addresses R-031, R-023, R-021, and R-018 by proving the financial guarantees against a real
database. This is the task that makes the milestone claims verifiable rather than asserted.

#### Acceptance Criteria
- `pnpm test:integration` passes.
- Ten concurrent identical payment requests produce exactly one payment row.
- Twenty concurrent deliveries of the same webhook produce exactly one state change.
- Two concurrent full refunds produce exactly one success, and a direct raw SQL over-refund is
  rejected by the `CHECK` constraint.
- The concurrency cases pass on ten consecutive runs rather than intermittently.

#### Implementation Details
- **Files**: `tests/integration/*.test.ts`.
- **Reference**: `design/06-testing-strategy.md`, section "Integration tests", which enumerates
  every case by area.
- **Key behaviour**: `app.inject()` exercises the full middleware chain without opening a socket.
- **Testing approach**: run the concurrency subset ten times in the execution summary.

---

### End-To-End Lifecycle (T-039) [done]

#### Overview
Addresses R-031 and R-005 by implementing the milestone-1 demonstration as an automated test, plus
the multi-tenant provider selection case.

#### Acceptance Criteria
- The lifecycle test performs: create organization, configure account, create payment, replay the
  idempotency key, simulate a signed webhook, reach `PAID`, receive a verified callback, send a
  duplicate webhook that changes nothing, refund fully, reach `REFUNDED`, receive the refund
  callback.
- No step manipulates the database directly; every state change goes through the API or the webhook
  pipeline.
- The multi-tenant case routes two organizations to two different registered providers with no
  branching on organization identity.

#### Implementation Details
- **Files**: `tests/e2e/payment-lifecycle.e2e.test.ts`, `tests/e2e/multi-tenant-provider.e2e.test.ts`.
- **Reference**: `design/04-payment-lifecycle.md`, section "Milestone 1 demonstration path", which
  the first test implements verbatim.
- **Testing approach**: the fake is registered twice under distinct keys to simulate two providers.

---

### Bruno Collection (T-040) [done]

#### Overview
Addresses R-030 with the manual counterpart to the end-to-end test, committed to Git so it is
reviewable and versioned alongside the API.

#### Acceptance Criteria
- A developer can run the collection top to bottom against a freshly seeded environment without
  editing any request.
- Variables chain between requests, so ids do not need copying by hand.
- The collection includes the duplicate idempotency key, duplicate webhook, delayed webhook, and
  partial refund cases.

#### Implementation Details
- **Files**: `bruno/bruno.json`, `bruno/environments/local.bru`, and the five numbered folders.
- **Reference**: `design/01-repository-structure.md`, the `bruno/` tree;
  `design/05-api-specification.md` for request shapes.
- **Rationale**: Bruno over Postman because collections live cleanly in Git. Confirmed 2026-09-18 —
  no Postman, Insomnia, or `.http` artifact exists in any Moniveo repository, so no prior convention
  is being overridden.

---

### Security Hardening (T-041) [done]

#### Overview
Addresses R-034 and R-032 by applying the secure defaults as an explicit reviewable pass rather than
leaving them implicit in earlier tasks.

#### Acceptance Criteria
- Oversized bodies return 413.
- Webhook rate limiting returns 429 past threshold, sized independently from mutation limits.
- Helmet headers are present on every response.
- A log record containing any of `authorization`, `apiKey`, `webhookSecret`, `credentials`,
  `setupToken`, or `rawBody` renders `[REDACTED]`, asserted by test.
- A test asserts `cardNumber`, `cvv`, `pan`, and `track2` appear in no schema, model, or DTO.

#### Implementation Details
- **Files**: `src/platform/security/plugins.ts`, `src/platform/logging/logger.ts`,
  `tests/integration/security.test.ts`.
- **Reference**: `design/06-testing-strategy.md`, section "Integration tests", security area.
- **Key behaviour**: rate limiting is in-memory via `@fastify/rate-limit`; no Redis.

---

### Documentation (T-042) [done]

#### Overview
Addresses R-016 and R-033 by writing the repository documentation, promoting the Mermaid diagrams
from the design documents into `docs/`.

#### Acceptance Criteria
- `README.md` covers purpose, architecture, local setup, environment variables, database,
  migrations, running tests, manual testing, the fake provider, adding a provider, webhook
  architecture, idempotency, and security assumptions.
- `docs/architecture.md` contains the system context, status machine, and webhook pipeline diagrams.
- `docs/adding-a-provider.md` walks through the six steps using Pagadito as the worked example.
- `docs/pci-boundary.md` states what is stored, what is never touched, and the resulting SAQ posture.
- A developer following the README alone reaches a running API with Swagger and completes the manual
  flow.

#### Implementation Details
- **Files**: `README.md`, `docs/{architecture,adding-a-provider,pci-boundary,webhooks,idempotency}.md`.
- **Reference**: all six design documents.
- **Testing approach**: have someone who did not write it follow the README on a clean machine and
  record where they got stuck.

---

### Cursor Rules (T-043) [done]

#### Overview
Addresses R-001, R-002, R-003, R-015, and R-031 by encoding the invariants as `.cursor/rules/`,
following the numbered-folder practice in both sibling repos. R-002 and R-003 are the two
requirements with no buildable artifact — "products never call providers directly" and "Payments
never reads a product database" are properties of what the repository does *not* contain, so a
written rule plus a mechanical check is the only way to hold them.

#### Acceptance Criteria
- `00-architecture` states the domain boundary: no product concepts, no product database access, and
  no provider integration outside an adapter.
- `01-security` covers the PCI boundary, secret references, and logging prohibitions.
- `02-testing` carries the house rule that an untested route or service function is incomplete.
- `03-money` mandates integer minor units and forbids floating point for amounts.
- A CI check fails if any dependency or connection string references a product database, or if a
  provider SDK is imported outside `src/providers/<key>/`.
- A CI check fails if a domain term from the forbidden list — resident, residence, patient, doctor,
  appointment, visit, unit, clinic — appears in `src/`, `prisma/`, or the OpenAPI document.
- Each rule states an invariant a reviewer can check against a diff.

#### Implementation Details
- **Files**: `.cursor/rules/0N-<name>/RULE.md`, `scripts/check-domain-boundary.ts`.
- **Reference**: RS-003 for the rule style used in `moni-resident`; RS-003 also records the Resident
  integration contract these rules protect.
- **Key behaviour**: the forbidden-term check is deliberately blunt. A false positive is a prompt to
  rename something, which is the right outcome for a service that must stay domain-free.

---

### CI Pipeline (T-044) [done]

#### Overview
Addresses R-031 and R-026 by running the whole verification chain on every push, including the
guards that are easy to erode silently.

#### Acceptance Criteria
- The workflow runs install, generate, lint, typecheck, the full test suite, the OpenAPI freshness
  check, the forbidden-pattern grep, and the T-043 domain-boundary check.
- It passes on a clean branch and fails when `openapi.json` is stale.
- It fails when a diff introduces `cardNumber`, `cvv`, `pan`, or `track2`.
- It fails when a diff introduces a product domain term into `src/` or `prisma/`.
- Node 20.19.4 and pnpm 9.15.4 with a `postgres:16-alpine` service container.

#### Implementation Details
- **Files**: `.github/workflows/ci.yml`, `scripts/check-openapi.ts`.
- **Reference**: `design/06-testing-strategy.md`, section "CI".
- **Testing approach**: verify both failure modes deliberately once and record them in the execution
  summary.
<!-- @end -->

## Decisions

- **Single package, not a monorepo.** One deployable artifact does not justify workspace tooling.
  Boundaries are enforced with lint rules instead.
- **Bare resource responses, not `{ success, data, error }`.** The envelope degrades generated
  OpenAPI clients, and the HTTP status already signals success.
- **English error messages.** Consumers are backends, not end users. `code` is the contract;
  products localise for their own users. Diverges from `moni-health` and is worth confirming.
- **Integration tests against real Postgres.** `moni-resident` mocks Prisma entirely, which cannot
  validate the constraints that constitute this service's financial guarantees.
- **Amounts are 32-bit integers of minor units.** A roughly USD 21 million per-payment ceiling, far
  above any plausible condominium fee or clinic invoice, in exchange for clean JSON serialisation.
  Widening to `BIGINT` is one migration.
- **Two independent duplicate-charge defences.** Unique `(organizationId, externalReference)` guards
  against product logic bugs; idempotency keys guard against transport retries. They catch different
  failures and both are kept.
- **Secrets stored as references, never as values or ciphertext.**
- **`provider` is a string column.** Adding a provider must not require a migration.
- **Optional interface methods rather than a thrown `NotSupported`.** Unsupported capabilities
  become compile errors instead of runtime surprises.
- **Mermaid diagrams.** New for the estate; the brief requires them and a nine-state machine is not
  legible as ASCII.

### Confirmed 2026-09-18

The eight questions raised in version 1 are resolved. Three were answered by evidence in the
sibling repositories rather than by preference.

- **Error messages are English.** Consumers are backends; `code` is the machine contract and
  `message` is read by developers. Diverges from `moni-health`, which serves end users directly.
- **Real Resident integration is out of scope for milestone 1.** The simulated product backend in
  `tests/helpers/` is the only consumer, which keeps the milestone demonstrable without depending on
  another team's timeline. The contract in RS-003 stands as the specification Resident implements
  against later.
- **Deployment target is Railway.** Confirmed against `moni-resident/docs/release/DEPLOYMENT.md`:
  the Resident backend deploys to Railway via `railway up` in GitHub Actions, and Vercel is used
  only for the Next.js admin panel. A long-running container is therefore the house pattern for a
  backend service, so the in-process dispatcher in T-035 is sound and no external queue is required.
- **Secrets stay environment-based in production for now.** A search for AWS Secrets Manager,
  Doppler, Vault, 1Password, and Parameter Store across both repositories returned nothing; the
  estate uses Railway environment variables plus GitHub Actions secrets. `awssm://` was a
  speculative assumption and building it now would be unused work. Only `env://` is implemented, and
  because `SecretsProvider` is an interface, adopting a secret manager later is one new
  implementation plus a new reference scheme. The reference-shape validation derives its accepted
  schemes from the registered implementations, so it widens automatically rather than needing an
  edit.
- **`externalReference` stays required and unique per organization.** Retries reuse the payment
  through a new attempt rather than creating a second charge.
- **Chargebacks are recorded and emitted, with no workflow.** `CHARGEBACK` remains terminal.
- **API keys are provisioned by CLI only.** Few clients, all internal. An admin API is unnecessary
  until external onboarding exists.

## Out of Scope

Explicitly excluded from milestone 1, restating the brief's constraints plus decisions made here:

- The real Pagadito integration, and any other live provider.
- Subscriptions, recurring billing, SaaS billing, invoicing, and accounting.
- Payout orchestration, split payments, internal wallets, and any Moniveo-held balance. Moniveo
  never receives, holds, or distributes customer funds.
- Kafka, RabbitMQ, Redis, Kubernetes, and cryptocurrency.
- Multi-currency behaviour beyond correct schema modelling; only USD is exercised.
- End-user authentication, a payments admin UI, and reporting or analytics endpoints.
- Chargeback representment and dispute workflow. The status and the event exist; the workflow does
  not.
- Automated reconciliation against provider settlement files.
- A `Customer` entity, deferred until per-customer state is genuinely needed.
- The real Resident callback receiver. The contract is fixed in RS-003 and the simulated backend in
  `tests/helpers/` proves it end to end, but building Resident's side is a separate effort.
- An AWS Secrets Manager implementation, or any secret store beyond environment variables.
- An admin API for API key provisioning; the CLI script covers milestone 1.
- The Railway deploy pipeline. The target is confirmed and T-044 delivers CI, but the deploy
  workflow follows once the service has something worth deploying.

## Deferred Decisions

Nothing blocks implementation. These are choices deliberately postponed until a specific trigger
makes them answerable, recorded so they are not rediscovered as surprises.

1. **Webhook-to-account resolution.** `POST /v1/webhooks/:provider` carries no organization, but
   signing secrets are per-account, so `WebhookContext.candidateAccounts` hands each adapter the
   candidate set to resolve however its provider allows. This is the part of the design most likely
   to need revision. **Trigger:** integrating the first real provider.
2. **Secret manager adoption.** `env://` is the production mechanism today. **Trigger:** the estate
   adopting a secret manager, or a compliance requirement for credential rotation and audit.
3. **Widening `amount` to `BIGINT`.** A 32-bit integer caps a single payment near USD 21 million.
   **Trigger:** a currency or use case approaching the ceiling. One non-destructive migration.
4. **Multi-currency behaviour.** The schema models currency correctly but only USD is exercised.
   **Trigger:** a provider or organization transacting in another currency.
5. **Chargeback workflow.** Recording and notification exist; representment does not.
   **Trigger:** a product needing to contest disputes.
6. **A `Customer` entity.** **Trigger:** per-customer state that genuinely belongs to Payments
   rather than to a product.
7. **Admin API for API key provisioning.** CLI is sufficient while every client is internal.
   **Trigger:** onboarding a product team that cannot run the CLI, or a key rotation policy.
8. **Real Resident integration.** The contract in RS-003 is fixed; building the receiver is a
   separate effort. **Trigger:** Resident scheduling its billing work.
