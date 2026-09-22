---
design:
  id: "D-001"
  title: "Proposed Repository Structure"
  spec_slug: "moniveo-payments-service"
  created: "2026-09-18T22:45:00Z"
  updated: "2026-09-18T22:45:00Z"
---

# Proposed Repository Structure

## Shape decision: single package, not a monorepo

`moni-resident` and `moni-health` are both pnpm + Turborepo monorepos because each ships several
deployable surfaces (backend, web dashboard, mobile app). `moniveo-payments` ships exactly one
artifact: an HTTP service. A monorepo would add `turbo.json`, a `packages/config` indirection, a
`packages/db` boundary, and cross-package build ordering for no benefit.

**Proposal: one package at the repository root.** pnpm is still the package manager (house
convention, and `pnpm` commands in the requested developer flow), but there is no workspace file
and no Turborepo. If a second surface ever appears (an admin console for payment operations, a
published client SDK), converting to a workspace is mechanical.

The one thing worth borrowing from a monorepo is the *internal* boundary discipline: `src/domain`
must not import from `src/modules`, and `src/providers/*` must not import Prisma. That is enforced
with an ESLint `no-restricted-imports` rule rather than with package boundaries.

## Tree

```text
moniveo-payments/
├── .cursor/
│   ├── rules/
│   │   ├── 00-architecture/RULE.md      # domain boundary: no product concepts
│   │   ├── 01-security/RULE.md          # PCI boundary, secret handling, logging
│   │   ├── 02-testing/RULE.md           # untested route or service = incomplete
│   │   └── 03-money/RULE.md             # minor units only, never float
│   └── skills/
│       ├── 00-agent-operating-mode/SKILL.md
│       └── 01-create-spec/SKILL.md
├── .github/workflows/ci.yml
├── bruno/                               # manual testing collection (committed, git-friendly)
│   ├── bruno.json
│   ├── environments/local.bru
│   ├── 01-setup/                        # create organization, create payment account
│   ├── 02-payments/                     # create, get, list, idempotency replay
│   ├── 03-refunds/                      # full refund, partial refund
│   ├── 04-webhooks/                     # simulate success, failure, duplicate, out-of-order
│   └── 05-providers/                    # list providers, read capabilities
├── docs/
│   ├── architecture.md                  # system context, lifecycle, Mermaid diagrams
│   ├── adding-a-provider.md             # step-by-step Pagadito / Wompi / PayWay guide
│   ├── pci-boundary.md                  # what we store, what we never touch, SAQ posture
│   ├── webhooks.md                      # ingestion pipeline, ordering, replay
│   └── idempotency.md                   # key scoping, fingerprints, replay semantics
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts                          # dev org + fake payment account + service client
├── prompts/                             # house 5-step spec workflow (copied from moni-resident)
├── specs/
│   └── moniveo-payments-service/
├── src/
│   ├── server.ts                        # process entry: env load, listen, signal handling
│   ├── app.ts                           # buildApp(): composes Fastify, testable without listen
│   │
│   ├── config/
│   │   ├── env.ts                       # Zod-validated environment, fails fast at boot
│   │   └── constants.ts
│   │
│   ├── db/
│   │   ├── prisma.ts                    # PrismaClient singleton
│   │   └── transaction.ts               # typed interactive-transaction helper
│   │
│   ├── domain/                          # pure TypeScript. No Prisma, no Fastify, no I/O.
│   │   ├── money.ts                     # Money type, minor-unit math, currency registry
│   │   ├── payment-status.ts            # PaymentStatus + allowed transition table
│   │   ├── refund-rules.ts              # refundable amount calculation and validation
│   │   ├── errors.ts                    # ErrorCode enum + AppError hierarchy
│   │   └── events.ts                    # internal event names and payload shapes
│   │
│   ├── providers/                       # provider abstraction + adapters. No Prisma imports.
│   │   ├── types.ts                     # PaymentProvider interface, normalized results
│   │   ├── capabilities.ts              # ProviderCapability enum + helpers
│   │   ├── registry.ts                  # key -> factory map, capability lookup
│   │   ├── errors.ts                    # ProviderError taxonomy adapters must throw
│   │   └── fake/
│   │       ├── index.ts                 # FakePaymentProvider implements PaymentProvider
│   │       ├── scenarios.ts             # declined / delayed / duplicate-webhook behaviours
│   │       ├── state.ts                 # in-memory simulated provider ledger
│   │       └── signature.ts             # HMAC signing so webhook verification is exercised
│   │
│   ├── platform/                        # cross-cutting infrastructure
│   │   ├── auth/
│   │   │   ├── service-auth.ts          # ServiceAuthenticator interface
│   │   │   ├── api-key.ts               # ApiKeyAuthenticator (hash compare)
│   │   │   └── plugin.ts                # Fastify plugin -> request.serviceContext
│   │   ├── idempotency/
│   │   │   ├── store.ts                 # Postgres-backed key store
│   │   │   └── plugin.ts                # Idempotency-Key handling around mutations
│   │   ├── secrets/
│   │   │   ├── types.ts                 # SecretsProvider interface
│   │   │   ├── env-provider.ts          # resolves env://NAME references (local and production)
│   │   │   └── index.ts                 # selection by SECRETS_PROVIDER env var
│   │   ├── events/
│   │   │   ├── publisher.ts             # EventPublisher interface
│   │   │   ├── outbox.ts                # transactional outbox writer
│   │   │   ├── http-delivery.ts         # signed HTTP callback delivery
│   │   │   └── dispatcher.ts            # single scheduler: outbox + webhook processing
│   │   ├── logging/
│   │   │   ├── logger.ts                # pino config + redaction paths
│   │   │   └── request-context.ts       # correlation id propagation
│   │   ├── http/
│   │   │   ├── error-handler.ts         # AppError -> normalized HTTP response
│   │   │   └── openapi.ts               # @fastify/swagger + zod-to-openapi wiring
│   │   └── security/
│   │       └── plugins.ts               # helmet, rate limits, body limits
│   │
│   ├── modules/                         # one folder per resource: schema/repository/service/routes
│   │   ├── organizations/
│   │   ├── payment-accounts/
│   │   ├── payments/
│   │   ├── payment-attempts/
│   │   ├── payment-methods/
│   │   ├── refunds/
│   │   ├── webhooks/
│   │   └── providers/                   # read-only capability endpoints
│   │
│   └── routes/
│       └── dev/
│           └── fake-provider.ts         # registered only when NODE_ENV is development|test
│
├── tests/
│   ├── unit/                            # mirrors src/domain and src/providers
│   ├── contract/
│   │   ├── payment-provider.contract.ts # reusable suite every adapter must pass
│   │   └── fake-provider.contract.test.ts
│   ├── integration/                     # real Postgres, real Fastify, fake provider
│   ├── e2e/
│   │   └── payment-lifecycle.e2e.test.ts
│   └── helpers/
│       ├── app.ts                       # build app with test config
│       ├── db.ts                        # migrate + truncate between tests
│       ├── factories.ts                 # organization/account/payment builders
│       └── simulated-product-backend.ts # captures internal event callbacks
│
├── docker-compose.yml                   # postgres only
├── .env.example
├── .nvmrc
├── .npmrc
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── eslint.config.js
├── .prettierrc
└── README.md
```

## Module anatomy

Every folder under `src/modules/` uses the same four files. This is the `moni-health` module
pattern (`schema.ts` / `repository.ts` / `service.ts`), extended with `routes.ts` because Fastify
registers routes as plugins rather than through file-based routing.

```text
src/modules/payments/
├── schema.ts        # Zod request/response schemas + z.infer types. Single source for OpenAPI.
├── repository.ts    # the only file allowed to touch Prisma for this resource
├── service.ts       # business rules, status transitions, provider orchestration
├── routes.ts        # Fastify plugin: auth, validation, idempotency, calls service
└── mapper.ts        # Prisma row -> API response shape (prevents mass assignment)
```

The `mapper.ts` file is deliberate. Returning Prisma rows directly is how internal columns
(`providerAccountId`, encrypted config, soft-delete flags) leak into API responses, so the
serialisation step is explicit and the response Zod schema is enforced on the way out.

## Layering rule

```text
routes.ts  ->  service.ts  ->  repository.ts  ->  Prisma
                   |
                   +-------->  providers/*     (via registry, never a concrete adapter)
                   +-------->  domain/*        (pure rules)
                   +-------->  platform/*      (secrets, events, logging)
```

Enforced by ESLint `no-restricted-imports`:

- `src/domain/**` may not import `@prisma/client`, `fastify`, or `src/modules/**`.
- `src/providers/**` may not import `@prisma/client` or `src/modules/**`.
- `src/modules/*/routes.ts` may not import `repository.ts` directly.
- Nothing outside `src/providers/fake/**` may import `FakePaymentProvider` by name.

That last rule is what mechanically guarantees the requirement that no special-case logic exists
because the provider happens to be fake.

## package.json scripts

Named to match the flow in the brief and the `moni-health` naming style.

```json
{
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsup src/server.ts --format esm --dts",
    "start": "node dist/server.js",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:deploy": "prisma migrate deploy",
    "db:seed": "tsx prisma/seed.ts",
    "db:reset": "prisma migrate reset --force",
    "test": "vitest run",
    "test:unit": "vitest run tests/unit tests/contract",
    "test:integration": "vitest run tests/integration tests/e2e",
    "test:watch": "vitest",
    "lint": "eslint .",
    "format": "prettier --write .",
    "typecheck": "tsc --noEmit"
  }
}
```

`pnpm test` runs everything, which is the stated requirement. `test:unit` is the fast loop that
needs no database.

## Dependency budget

Kept deliberately small; every entry has an immediate technical requirement.

| Package | Why |
| --- | --- |
| `fastify` | HTTP server |
| `@fastify/swagger`, `@fastify/swagger-ui` | OpenAPI document + dev UI |
| `@fastify/helmet` | secure response headers |
| `@fastify/rate-limit` | in-memory limiting for webhook and mutation endpoints |
| `fastify-type-provider-zod` | one Zod schema drives validation, types, and OpenAPI |
| `zod` | validation |
| `@prisma/client`, `prisma` | data access and migrations |
| `pino`, `pino-pretty` | structured logging, dev formatting |
| `tsx`, `tsup`, `typescript` | run and build |
| `vitest` | tests |
| `eslint`, `prettier`, `@typescript-eslint/*` | linting |
| `dotenv` | local env loading |

Node's built-in `crypto` covers HMAC signature verification, API key hashing, and idempotency
fingerprints, so no cryptography dependency is added and no cryptography is hand-rolled.

Explicitly **not** included: Redis, BullMQ, Kafka, RabbitMQ, Testcontainers, Turborepo, a DI
container, and any provider SDK. Retry scheduling uses Postgres plus a `setInterval` dispatcher,
which is sufficient at the volume an early-stage SaaS produces and removes an entire service from
the local development story.

## Runtime and tooling versions

- Node `20.19.4` pinned in `.nvmrc` and `engines`, matching `moni-resident`.
- pnpm `9.15.4` via `packageManager`, matching `moni-health`.
- TypeScript `strict: true`, `target: ES2022`, plus `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`, which are cheap to adopt on a greenfield financial service.
- `.npmrc` carries `shamefully-hoist=true` for parity with the sibling repos.
