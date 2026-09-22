---
resource:
  id: "RS-002"
  title: "Moniveo Health API Conventions"
  source: "/Users/edward/Documents/moni-health"
  spec_slug: "moniveo-payments-service"
  created: "2026-09-18T22:45:00Z"
  updated: "2026-09-18T22:45:00Z"
---

# Moniveo Health API Conventions

## Source

`/Users/edward/Documents/moni-health`, principally `apps/api/` and `packages/db/`. This is the only
standalone Node HTTP service in the Moniveo estate and therefore the closest existing template for
`moniveo-payments`.

## Summary

`moni-health` runs a Hono API (`apps/api`) against a shared Prisma package (`packages/db`) inside a
pnpm + Turborepo workspace. Its module layout — `schema.ts` / `repository.ts` / `service.ts` per
resource, with thin route handlers — and its Prisma conventions transfer directly. Its transport
layer does not, because `moniveo-payments` uses Fastify.

## Key Insights

- **App composition.** `src/index.ts` loads environment and calls `serve()`; `src/app.ts` builds and
  exports the app without listening. That split is what makes in-process testing possible and is
  worth copying exactly, as Fastify's `app.inject()` depends on the same separation.
- **Module layout.** `modules/<name>/{types,schema,repository,service}.ts`, with routes kept thin
  and business logic out of handlers.
- **Validation.** Zod schemas per module with `z.infer` types, applied through a `validateBody`
  middleware that returns HTTP 422 on `ZodError`.
- **Prisma conventions.** `@default(uuid())` identifiers, camelCase Prisma fields with
  `@map("snake_case")`, `@@map` on every model, `createdAt` / `updatedAt` with `@default(now())` and
  `@updatedAt`, `deletedAt` for soft deletes, and composite indexes such as
  `@@index([clinicId, startsAt])`.
- **Multi-tenancy.** `clinicId` on tenant-scoped models with a `requireClinic()` middleware that
  compares the token's tenant against the requested one. `moniveo-payments` needs the identical
  shape with `organizationId`.
- **Response envelope.** `{ success, data, error }`, with a global `app.onError` returning a generic
  message and logging the detail.
- **Tooling.** pnpm 9.15.4, Node >= 20, TypeScript `strict: true` targeting ES2022, shared ESLint
  config, `tsx watch` for development and `tsup` for builds.
- **Error messages are Spanish**, while all code, file names, and identifiers are English — an
  explicit rule in `.cursor/rules/00-architecture/RULE.md`.

## Spec Alignment

| Requirement | What is inherited |
| --- | --- |
| R-004, R-006 | tenant column plus enforcement middleware, following the `clinicId` / `requireClinic()` pattern |
| R-026 | Zod-per-module validation, extended here to also generate the OpenAPI document |
| R-027 | authentication resolving a request-scoped context object carrying the tenant |
| R-028 | a single global error handler that never leaks internal detail |
| R-033 | `dev` / `build` / `start` / `db:*` / `test` script naming |

## Implementation Blueprint

**Adopt unchanged**: the `index.ts` / `app.ts` split; the four-file module layout, extended with
`routes.ts` because Fastify registers routes as plugins and `mapper.ts` to keep Prisma rows out of
responses; every Prisma naming convention; Node and pnpm versions; `tsx` and `tsup`.

**Adapt**: Hono middleware becomes Fastify plugins and hooks. `validateBody` becomes
`fastify-type-provider-zod`, which gives validation and the OpenAPI document from one schema.
`requireAuth` becomes a `preHandler` populating `request.serviceContext`.

**Reject, with reasons**:

- *The monorepo.* `moni-health` needs Turborepo for three deployable surfaces. This service has one.
  A workspace, a `packages/db` boundary, and cross-package build ordering would be overhead with no
  payoff. Detailed in the repository structure document.
- *The `{ success, data, error }` envelope.* It forces every OpenAPI response schema into a wrapper
  generic, producing weak generated clients. Bare resources plus a structured error object read
  better in Swagger UI, and the HTTP status already carries the success signal.
- *Spanish error messages.* This API's consumers are Moniveo backends, not end users. Error text is
  a developer-facing artifact here, so `code` is the contract and `message` is English. Products
  localise for their own users. Confirmed 2026-09-18.
- *Soft deletes.* `deletedAt` suits patient records. Financial records are never deleted at all, so
  there is nothing to soft-delete; status enums and append-only refunds cover every case.

## Risks & Considerations

- Fastify is a new framework for the organisation. Mitigated by keeping the structure recognisable —
  same module layout, same naming, same script names — so the transport layer is the only unfamiliar
  part.
- `moni-health`'s `apps/api` has **no test files** despite declaring Vitest. There is no existing
  testing practice to copy for a standalone Moniveo API, so the strategy in this spec sets the
  precedent rather than following one.
- The two repos disagree on package scope: `@moni/*` in resident, `@moniveo/*` in health. This repo
  uses `moniveo-payments` unscoped, since nothing is published.
- `moni-health` has no `docker-compose.yml` and no `.nvmrc`. Both are added here, since the brief
  requires a Docker Postgres and a reproducible Node version.
