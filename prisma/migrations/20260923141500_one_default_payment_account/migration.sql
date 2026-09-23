-- At most one default payment account per organization.
CREATE UNIQUE INDEX IF NOT EXISTS "payment_accounts_one_default_per_org"
ON "payment_accounts" ("organization_id")
WHERE "is_default" = true;
