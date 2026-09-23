-- Replace PaymentAccountStatus so PENDING_CONFIGURATION becomes NOT_CONFIGURED,
-- and add the remaining lifecycle values. New credential metadata stays empty.

CREATE TYPE "PaymentAccountStatus_new" AS ENUM (
  'NOT_CONFIGURED',
  'ONBOARDING',
  'PENDING_VERIFICATION',
  'ACTIVE',
  'SUSPENDED',
  'DISABLED',
  'REJECTED'
);

ALTER TABLE "payment_accounts" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "payment_accounts"
  ALTER COLUMN "status" TYPE "PaymentAccountStatus_new"
  USING (
    CASE "status"::text
      WHEN 'PENDING_CONFIGURATION' THEN 'NOT_CONFIGURED'
      ELSE "status"::text
    END
  )::"PaymentAccountStatus_new";

ALTER TABLE "payment_accounts"
  ALTER COLUMN "status" SET DEFAULT 'NOT_CONFIGURED';

DROP TYPE "PaymentAccountStatus";

ALTER TYPE "PaymentAccountStatus_new" RENAME TO "PaymentAccountStatus";

ALTER TABLE "payment_accounts"
  ADD COLUMN "secret_ref" TEXT,
  ADD COLUMN "credentials_updated_at" TIMESTAMP(3),
  ADD COLUMN "credentials_present_keys" JSONB NOT NULL DEFAULT '[]';

CREATE UNIQUE INDEX "payment_accounts_secret_ref_key" ON "payment_accounts"("secret_ref");
