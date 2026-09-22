# Architecture invariants

Review every change against these rules. A diff that violates any item should be rejected or redesigned before merge.

## Domain boundary

- `src/`, `prisma/`, and `openapi.json` must not introduce product-domain vocabulary: resident, residence, patient, doctor, appointment, visit, unit, clinic (except `SourceProduct` enum tokens `RESIDENT`, `HEALTH`, `ENVIRONMENT`).
- The service stores only payment vocabulary: organizations, payment accounts, payment methods, payments, attempts, refunds, providers, webhooks, outbox events.
- Products pass opaque references (`externalId`, `externalReference`, `customerReference`); Payments never models product entities.

## No product database access

- No `DATABASE_URL`, Prisma datasource, or connection string may reference product databases (`resident`, `health_app`, `moni_resident`, `moni_health`).
- No code may import or query another Moniveo product's schema or ORM client.

## Provider isolation

- Payment provider SDKs and HTTP clients for Pagadito, Wompi, PayWay, Stripe, or similar may be imported only under `src/providers/<key>/`.
- Core modules (`src/domain/`, `src/modules/`, `src/platform/`) must depend on `PaymentProvider` and the registry, never on a concrete adapter.
- Adding a provider must not require edits to `prisma/schema.prisma` or payment status/refund core logic.

## Layering

- `src/domain/` is pure TypeScript: no Prisma, Fastify, or I/O.
- `src/providers/*` must not import Prisma.
- Provider-shaped responses are normalized at the adapter boundary; domain and public API never expose raw provider status or error codes.

## Multi-tenancy

- Every operation is scoped to one organization; callers cannot read or mutate organizations outside their authenticated `sourceProduct`.
- Cross-product organization access returns `404 ORGANIZATION_NOT_FOUND`, not `403`.
