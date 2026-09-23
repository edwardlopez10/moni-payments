---
resource:
  id: "RS-003"
  title: "Service Authorization Reference: AWS Secrets Manager"
  source: "https://docs.aws.amazon.com/service-authorization/latest/reference/list_awssecretsmanager.html"
  spec_slug: "aws-secrets-manager-credential-storage"
  created: "2026-09-22T23:10:00Z"
  updated: "2026-09-22T23:10:00Z"
---

# Service Authorization Reference: AWS Secrets Manager

## Source
https://docs.aws.amazon.com/service-authorization/latest/reference/list_awssecretsmanager.html

The page renders client-side and could not be fetched as text. The action, ARN, and condition-key
inventory below was taken from AWS's machine-readable policy catalog
(`https://awspolicygen.s3.amazonaws.com/js/policies.js`), which backs the same reference. Per-action
condition-key support must be confirmed on the live page before policies are finalized.

## Summary
The authoritative list of every IAM action, resource type, and condition key for Secrets Manager.
It lets us map each `SecretsProvider` operation to the minimum set of actions (R-008), and choose
condition keys that enforce environment isolation and safe deletion (R-007).

## Key Insights
- **Resource ARN:** `arn:aws:secretsmanager:${Region}:${Account}:secret:${SecretId}`. This is the
  only resource type, and `SecretId` includes the 6-character random suffix.
- **Actions (23):** `BatchGetSecretValue`, `CancelRotateSecret`, `CreateSecret`,
  `DeleteResourcePolicy`, `DeleteSecret`, `DescribeSecret`, `GetRandomPassword`,
  `GetResourcePolicy`, `GetSecretValue`, `ListSecretVersionIds`, `ListSecrets`,
  `PutResourcePolicy`, `PutSecretValue`, `RemoveRegionsFromReplication`,
  `ReplicateSecretToRegions`, `RestoreSecret`, `RotateSecret`, `StopReplicationToReplica`,
  `TagResource`, `UntagResource`, `UpdateSecret`, `UpdateSecretVersionStage`,
  `ValidateResourcePolicy`.
- **Condition keys that matter for this spec:**
  - `secretsmanager:Name`: restricts `CreateSecret` to the environment prefix.
  - `secretsmanager:KmsKeyArn` / `secretsmanager:KmsKeyId`: forces the environment's customer
    managed key.
  - `aws:RequestTag/${TagKey}`, `aws:TagKeys`, `aws:ResourceTag/${TagKey}`: tag-based isolation
    (ABAC) and preventing tag tampering.
  - `secretsmanager:ForceDeleteWithoutRecovery` and `secretsmanager:RecoveryWindowInDays`:
    forbid immediate deletion and enforce a minimum recovery window.
  - `secretsmanager:BlockPublicPolicy`: only relevant if resource policies are ever allowed.
  - `secretsmanager:AddReplicaRegions` and `secretsmanager:SecretPrimaryRegion`: keep secrets in
    a single region.

## Spec Alignment
Mapping of the `SecretsProvider` operations (R-003) to the minimum actions (R-008):

| Operation | Actions required | Notes |
|---|---|---|
| `put` (new) | `CreateSecret`, `TagResource`, `kms:GenerateDataKey` | Tags on create need `TagResource` |
| `put` (existing) | `PutSecretValue`, `kms:GenerateDataKey` | Creates a new version; the old one becomes `AWSPREVIOUS` |
| `get` | `GetSecretValue`, `kms:Decrypt` | Returns the `AWSCURRENT` version |
| `exists` | `DescribeSecret` | Metadata only, never the value; exposes `DeletedDate` |
| `delete` | `DeleteSecret` | With a recovery window; force-delete denied |

- **Explicitly never granted to the runtime:** `ListSecrets`, `BatchGetSecretValue`, all
  `*ResourcePolicy` actions, `UntagResource`, `UpdateSecret`, `RotateSecret`, all replication
  actions, and `RestoreSecret`. `RestoreSecret` is reserved for the operator break-glass path.
- **R-007:** `secretsmanager:Name` + `aws:RequestTag/Environment` + `KmsKeyArn` together make it
  impossible for the staging principal to create a secret that looks like production.

## Implementation Blueprint
- The `put` flow: call `DescribeSecret`. If the secret doesn't exist, `CreateSecret` with `Name`,
  `KmsKeyId`, `Tags`, and a `ClientRequestToken`. If it exists, `PutSecretValue` with a
  `ClientRequestToken`. The token should be derived from our idempotency key so retries don't
  create duplicate versions. Handle `ResourceExistsException` on the race between describe and
  create by falling through to `PutSecretValue`.
- The `exists` semantics must be decided explicitly. A secret scheduled for deletion is visible to
  `DescribeSecret` (with a `DeletedDate`), but `GetSecretValue` fails. Recommendation: treat it as
  "does not exist".
- The `delete` flow: `DeleteSecret` with `RecoveryWindowInDays` (7–30). Enforce a floor via a deny
  on `secretsmanager:RecoveryWindowInDays` `NumericLessThan` the chosen minimum.
- Validation: keep the least-privilege policy JSON in the repo (for example under `infra/aws/`) and
  lint it in CI with a simple check that no `"*"` action and no disallowed action is present.

## Risks & Considerations
- Condition keys unsupported by a given action are silently ignored. This is the most common way
  least-privilege policies fail open. Verify each key/action pairing on the live reference page.
- A deleted secret's name can't be reused until its recovery window ends (standard Secrets Manager
  behaviour). Account ids in names avoid collisions, but re-configuring the same account after a
  delete must either restore the secret or use a new, versioned name.
- The action list evolves (for example, `BatchGetSecretValue` is relatively recent). Policies
  written as explicit allowlists are safe against new actions. Never use `secretsmanager:*` for
  the runtime.
