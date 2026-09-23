import { PassThrough } from 'node:stream';

import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { AppError, ErrorCode } from '../../../src/domain/errors';
import { toErrorBody } from '../../../src/platform/http/error-handler';
import { LOG_REDACT_PATHS } from '../../../src/platform/logging/logger';

const CANARY = 'canary-credential-value-do-not-leak';

describe('logger redaction', () => {
  it('redacts authorization and credential-bearing fields from log records', async () => {
    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    const logger = pino(
      {
        level: 'info',
        redact: {
          paths: [...LOG_REDACT_PATHS],
          censor: '[REDACTED]',
        },
      },
      stream,
    );

    logger.info(
      {
        authorization: `Bearer ${CANARY}`,
        paymentId: 'pay_1',
        clientSecret: CANARY,
        clientId: CANARY,
        SecretString: CANARY,
        secret: CANARY,
        credentials: { apiKey: CANARY },
      },
      'probe',
    );
    await new Promise((resolve) => setTimeout(resolve, 30));

    const joined = Buffer.concat(chunks).toString('utf8');
    expect(joined).toContain('[REDACTED]');
    expect(joined).not.toContain(CANARY);
    expect(joined).toContain('pay_1');
  });
});

describe('error body redaction', () => {
  it('does not forward raw secret-store exception messages to callers', () => {
    const awsNoise = new Error(
      `User: arn:aws:iam::123:user/x is not authorized to perform secretsmanager:GetSecretValue on SecretString=${CANARY}`,
    );
    const { statusCode, body } = toErrorBody(awsNoise, 'req-aws');
    expect(statusCode).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('An unexpected error occurred.');
    expect(JSON.stringify(body)).not.toContain(CANARY);
    expect(JSON.stringify(body)).not.toContain('GetSecretValue');
  });

  it('keeps AppError messages that are already sanitized', () => {
    const error = new AppError(
      ErrorCode.PROVIDER_CONFIGURATION_UNAVAILABLE,
      'Secret store temporarily unavailable.',
      { cause: new Error(`SecretString=${CANARY}`) },
    );
    const { body } = toErrorBody(error, 'req-1');
    expect(body.error.message).toBe('Secret store temporarily unavailable.');
    expect(JSON.stringify(body)).not.toContain(CANARY);
  });
});
