import { z } from 'zod';

const appEnvSchema = z.enum(['development', 'staging', 'production', 'test']);
export type AppEnv = z.infer<typeof appEnvSchema>;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /**
   * Deployment environment for secrets isolation. Distinct from NODE_ENV so Railway staging
   * can run with NODE_ENV=production and APP_ENV=staging.
   */
  APP_ENV: appEnvSchema.optional(),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  TEST_DATABASE_URL: z.string().min(1).optional(),
  SECRETS_PROVIDER: z.enum(['env', 'memory', 'aws']).default('env'),
  /** Required when SECRETS_PROVIDER=aws. */
  AWS_REGION: z.string().min(1).optional(),
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  /** e.g. moniveo-payments/staging/ — required when SECRETS_PROVIDER=aws. */
  SECRETS_NAMESPACE_PREFIX: z.string().min(1).optional(),
  /** Customer-managed KMS key id/arn for this environment — required when SECRETS_PROVIDER=aws. */
  SECRETS_KMS_KEY_ID: z.string().min(1).optional(),
  /** In-process credential cache TTL; capped at 60s (R-014). */
  SECRETS_CACHE_TTL_SECONDS: z.coerce.number().int().positive().max(60).default(60),
  /** Secrets Manager deletion recovery window (days). */
  SECRETS_DELETION_RECOVERY_WINDOW_DAYS: z.coerce.number().int().min(7).max(30).default(7),
  /** Age after which payment-account credentials are reported as stale. */
  CREDENTIALS_MAX_AGE_DAYS: z.coerce.number().int().positive().default(90),
  /** Dispatcher poll interval. Omit to use 2000 in non-test, 0 in test. */
  DISPATCHER_INTERVAL_MS: z.coerce.number().int().nonnegative().optional(),
  /** General API rate limit (requests per minute per IP). */
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  /** Provider webhook rate limit (requests per minute per IP). */
  WEBHOOK_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
});

type ParsedEnv = z.infer<typeof envSchema>;

export type Env = Omit<ParsedEnv, 'APP_ENV'> & {
  APP_ENV: AppEnv;
};

export class EnvValidationError extends Error {
  readonly issues: Array<{ path: string; message: string }>;

  constructor(issues: Array<{ path: string; message: string }>) {
    const names = [...new Set(issues.map((issue) => issue.path || '(root)'))].join(', ');
    super(`Invalid environment: ${names}`);
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

function resolveAppEnv(
  data: ParsedEnv,
  issues: Array<{ path: string; message: string }>,
): AppEnv | undefined {
  if (data.APP_ENV) {
    return data.APP_ENV;
  }
  if (data.NODE_ENV === 'test') {
    return 'test';
  }
  if (data.NODE_ENV === 'development') {
    return 'development';
  }
  issues.push({
    path: 'APP_ENV',
    message: 'APP_ENV is required when NODE_ENV=production (set staging or production)',
  });
  return undefined;
}

/**
 * Fail-fast secrets configuration checks (R-007, R-015).
 * Staging/production must use aws with a matching namespace prefix and CMK.
 */
export function assertSecretsConfig(env: Env): void {
  const issues: Array<{ path: string; message: string }> = [];

  if (
    (env.APP_ENV === 'staging' || env.APP_ENV === 'production') &&
    env.SECRETS_PROVIDER !== 'aws'
  ) {
    issues.push({
      path: 'SECRETS_PROVIDER',
      message: `SECRETS_PROVIDER must be aws when APP_ENV=${env.APP_ENV}`,
    });
  }

  if (env.SECRETS_PROVIDER === 'aws') {
    const required = [
      'AWS_REGION',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'SECRETS_NAMESPACE_PREFIX',
      'SECRETS_KMS_KEY_ID',
    ] as const;
    for (const key of required) {
      if (!env[key]) {
        issues.push({
          path: key,
          message: `${key} is required when SECRETS_PROVIDER=aws`,
        });
      }
    }
  }

  if (env.APP_ENV === 'staging' || env.APP_ENV === 'production') {
    const expectedPrefix = `moniveo-payments/${env.APP_ENV}/`;
    if (
      env.SECRETS_NAMESPACE_PREFIX &&
      !env.SECRETS_NAMESPACE_PREFIX.startsWith(expectedPrefix)
    ) {
      issues.push({
        path: 'SECRETS_NAMESPACE_PREFIX',
        message: `SECRETS_NAMESPACE_PREFIX must start with ${expectedPrefix}`,
      });
    }
  }

  if (issues.length > 0) {
    throw new EnvValidationError(issues);
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.') || '(root)',
      message: issue.message,
    }));
    throw new EnvValidationError(issues);
  }

  const issues: Array<{ path: string; message: string }> = [];
  const appEnv = resolveAppEnv(result.data, issues);
  if (!appEnv || issues.length > 0) {
    throw new EnvValidationError(issues);
  }

  const env: Env = { ...result.data, APP_ENV: appEnv };
  assertSecretsConfig(env);
  return env;
}
