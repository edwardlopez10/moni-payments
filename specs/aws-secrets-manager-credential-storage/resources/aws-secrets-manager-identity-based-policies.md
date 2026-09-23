---
resource:
  id: "RS-002"
  title: "AWS Secrets Manager Identity-Based Policies"
  source: "https://docs.aws.amazon.com/secretsmanager/latest/userguide/auth-and-access_iam-policies.html"
  spec_slug: "aws-secrets-manager-credential-storage"
  created: "2026-09-22T23:10:00Z"
  updated: "2026-09-22T23:10:00Z"
---

# AWS Secrets Manager Identity-Based Policies

## Source
https://docs.aws.amazon.com/secretsmanager/latest/userguide/auth-and-access_iam-policies.html

## Summary
Worked examples of IAM policies attached to users, groups, or roles that grant scoped access to
secrets. They cover single-secret reads, KMS decrypt pairing, path wildcards, create permissions,
and forcing customer managed keys. This page is the practical template for the runtime policy
behind R-007 and R-008.

## Key Insights
- **Path-prefix scoping.** `arn:aws:secretsmanager:<region>:<account>:secret:TestEnv/*` grants
  access to every secret whose name starts with `TestEnv/`. This is the core mechanism for
  per-environment isolation when both environments share one AWS account.
- **ARN suffix.** Secrets Manager appends 6 random characters to every secret ARN. The pattern
  `name-??????` securely matches a not-yet-created secret. `name-*` over-matches, for example
  `name-other-a1b2c3`.
- **Delete-and-recreate caveat.** If a secret is deleted and recreated with the same name, any
  principal granted by name pattern automatically gains access to the new secret. Naming must
  therefore be unique per account and never reused across tenants.
- **Reads need two statements.** A customer managed key read needs `secretsmanager:GetSecretValue`
  on the secret and `kms:Decrypt` on the key.
- **Creating secrets can't be scoped by ARN before creation.** The `CreateSecret` example uses
  `Resource: "*"`. Narrowing is done with condition keys: `secretsmanager:Name`, `aws:RequestTag`,
  and `secretsmanager:KmsKeyArn` (see RS-003).
- **Forcing customer managed keys.** Deny `CreateSecret` and `UpdateSecret` when
  `secretsmanager:KmsKeyArn` is the AWS managed key. Deny `CreateSecret` when `KmsKeyArn` is null,
  because it would default to `aws/secretsmanager`.

## Spec Alignment
- **R-007:** one naming prefix per environment plus one principal per environment gives
  policy-enforced isolation even in a single AWS account. For example, `moniveo-payments/staging/`
  and `moniveo-payments/production/`. The trailing `/` matters: without it, `staging*` would
  also match `staging-legacy`.
- **R-002 / R-003:** the service stores only the secret name (or a scheme-prefixed name) as the
  account's `secretRef`, never the value. It can also store the name without the ARN. The provider
  then resolves region and account from its own configuration. This avoids persisting
  infrastructure identifiers and lets the provider reject any reference outside its own
  environment prefix.
- **R-008:** the examples map directly onto a minimal runtime policy (see Blueprint).
- **Not relevant:** batch retrieval (`BatchGetSecretValue` needs `Resource: "*"` on
  `ListSecrets`, which is broader than needed). Group-based grants for humans are also out of
  scope.

## Implementation Blueprint
The runtime policy for the staging principal (production is identical with `production`
substituted and its own key):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadWriteOwnEnvironmentSecrets",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret",
        "secretsmanager:PutSecretValue",
        "secretsmanager:DeleteSecret"
      ],
      "Resource": "arn:aws:secretsmanager:<region>:<account>:secret:moniveo-payments/staging/*"
    },
    {
      "Sid": "CreateOnlyInOwnPrefixWithOwnKeyAndTags",
      "Effect": "Allow",
      "Action": ["secretsmanager:CreateSecret", "secretsmanager:TagResource"],
      "Resource": "arn:aws:secretsmanager:<region>:<account>:secret:moniveo-payments/staging/*",
      "Condition": {
        "StringEquals": {
          "secretsmanager:KmsKeyArn": "<staging-cmk-arn>",
          "aws:RequestTag/Environment": "staging"
        }
      }
    },
    {
      "Sid": "UseOwnEnvironmentKeyOnly",
      "Effect": "Allow",
      "Action": ["kms:Decrypt", "kms:GenerateDataKey"],
      "Resource": "<staging-cmk-arn>"
    },
    {
      "Sid": "NeverForceDelete",
      "Effect": "Deny",
      "Action": "secretsmanager:DeleteSecret",
      "Resource": "*",
      "Condition": { "Bool": { "secretsmanager:ForceDeleteWithoutRecovery": "true" } }
    }
  ]
}
```

- Secret naming: `moniveo-payments/<env>/orgs/<organizationId>/payment-accounts/<paymentAccountId>`.
  It uses immutable UUIDs only: no org names, provider account numbers, or other PII. Because the
  account id is unique per account, names are never reused across tenants.
- Validation: a staging integration run against a real sandbox account (opt-in, not in default CI)
  that creates, reads, overwrites, and deletes one secret. It must also assert that a read outside
  the prefix fails with `AccessDeniedException`.

## Risks & Considerations
- The exact condition-key support per action (for example, whether `KmsKeyArn` is evaluated on
  `CreateSecret`) must be checked against RS-003 before finalizing. A condition key that isn't
  supported for an action is simply ignored, which fails open.
- Tag-based conditions only protect creation. Pair them with a deny on `UntagResource` and
  `TagResource` for the `Environment` key on existing secrets, so the tag can't be changed later.
- A single shared AWS account with prefixes is weaker than separate AWS accounts per environment,
  because one mis-scoped policy exposes both. Separate accounts are the stronger option. Decide in
  `update_spec`.
- Wildcard `/*` also grants access to any future secret under the prefix, which is intended.
  Nothing outside this service should write into `moniveo-payments/`.
