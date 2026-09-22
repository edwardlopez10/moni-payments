import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  TEST_DATABASE_URL: z.string().min(1).optional(),
  SECRETS_PROVIDER: z.enum(['env']).default('env'),
  /** Dispatcher poll interval. Omit to use 2000 in non-test, 0 in test. */
  DISPATCHER_INTERVAL_MS: z.coerce.number().int().nonnegative().optional(),
  /** General API rate limit (requests per minute per IP). */
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  /** Provider webhook rate limit (requests per minute per IP). */
  WEBHOOK_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
});

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  readonly issues: Array<{ path: string; message: string }>;

  constructor(issues: Array<{ path: string; message: string }>) {
    const names = [...new Set(issues.map((issue) => issue.path || '(root)'))].join(', ');
    super(`Invalid environment: ${names}`);
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (result.success) {
    return result.data;
  }

  const issues = result.error.issues.map((issue) => ({
    path: issue.path.map(String).join('.') || '(root)',
    message: issue.message,
  }));

  throw new EnvValidationError(issues);
}
