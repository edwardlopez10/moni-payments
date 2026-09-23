# Secrets

Payment-account credentials live in the secret store. PostgreSQL stores only the service-generated reference.

## Migrating `env://` credential references

Existing accounts may still store per-field references such as `env://FAKE_PROVIDER_API_KEY`. The migration copies those values into one bundle at:

`moniveo-payments/<env>/orgs/<organizationId>/payment-accounts/<accountId>`

`ACTIVE` accounts stay `ACTIVE`, so payment processing continues. The secret is written first. The account row is then updated in one transaction. If that update fails, the account still reads the old references and a re-run skips accounts already on the new reference.

| Current status | After migration |
| --- | --- |
| `PENDING_CONFIGURATION` | `NOT_CONFIGURED` |
| `ACTIVE` | `ACTIVE` |
| `DISABLED` | `DISABLED` |
| Any other current lifecycle status | Unchanged |

```bash
pnpm secrets:migrate-refs -- --dry-run
pnpm secrets:migrate-refs
```

Dry-run prints the planned reference, status change, and credential field names. It does not call `put` and does not print secret values.

Re-running the script skips accounts whose `secretRef` is already the service-generated reference.

## After migration

Staging and production must boot with `SECRETS_PROVIDER=aws` and `APP_ENV` set to `staging` or `production`. That combination rejects the `env` and `memory` providers at startup. Do not leave payment accounts on `env://` references after the script succeeds.

`APP_ENV` is the deployment environment used for secret names and IAM isolation. `NODE_ENV` is the Node runtime mode. On Railway, staging should set `NODE_ENV=production` and `APP_ENV=staging`. Production should set both to `production`.

## Isolation

Staging and production share one AWS account for now. They are separated by name prefix, a customer-managed KMS key, and an exclusive IAM user per environment. Secret names look like:

`moniveo-payments/<env>/orgs/<organizationId>/payment-accounts/<accountId>`

Example policies are in `infra/aws/staging-runtime-policy.json` and `infra/aws/production-runtime-policy.json`. Replace `<region>`, `<account>`, and the CMK ARN before attaching them. The runtime user may create, tag, read, describe, put, and delete (with a recovery window) only under its own prefix and key. The policies do not grant `secretsmanager:*`. They deny `ListSecrets`, batch reads, resource-policy changes, untag, update, rotation, replication, restore, and force-delete.

No human and no CI principal has standing `secretsmanager:GetSecretValue` on production secrets. Break-glass reads are a separate, temporary grant, not a policy on the runtime user or on CI.

Confirm each condition key is supported for that action on the Secrets Manager service-authorization page before relying on it. A condition key the action does not support is ignored.

### Operator checklist

1. Create one customer-managed KMS key for staging and another for production. Do not use the `aws/secretsmanager` managed key.
2. Create one IAM user per environment. No other environment, human, or CI role shares that user.
3. Attach the matching example policy with the region, account, and that environment's CMK ARN filled in.
4. Create an access key and store `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `SECRETS_NAMESPACE_PREFIX`, and `SECRETS_KMS_KEY_ID` in that environment's Railway variables.
5. Negative test: using the staging access key, call `GetSecretValue` on a secret whose name starts with `moniveo-payments/production/`. The call must fail with `AccessDeniedException`.

### IAM access key rotation

Rotate each environment's runtime access key at least every 90 days. Overlap the keys so the service never boots without a valid key:

1. Create a second access key on the same IAM user.
2. Deploy the new key to Railway and confirm the service can still read and write its own prefix.
3. Disable the old key.
4. After 7 days of overlap, delete the old key.
