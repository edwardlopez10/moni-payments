import pino, { type Logger, type LoggerOptions } from 'pino';

import type { Env } from '../../config/env';

export const LOG_REDACT_PATHS = [
  'authorization',
  'headers.authorization',
  'req.headers.authorization',
  'apiKey',
  'webhookSecret',
  'credentials',
  'setupToken',
  'rawBody',
  '*.authorization',
  '*.apiKey',
  '*.webhookSecret',
  '*.credentials',
  '*.setupToken',
] as const;

export function buildLoggerOptions(env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>): LoggerOptions {
  const options: LoggerOptions = {
    level: env.LOG_LEVEL,
    redact: {
      paths: [...LOG_REDACT_PATHS],
      censor: '[REDACTED]',
    },
  };

  if (env.NODE_ENV === 'development') {
    options.transport = {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard' },
    };
  }

  return options;
}

export function createLogger(env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>): Logger {
  return pino(buildLoggerOptions(env));
}
