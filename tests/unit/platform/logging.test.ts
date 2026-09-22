import { PassThrough } from 'node:stream';

import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { LOG_REDACT_PATHS } from '../../../src/platform/logging/logger';

describe('logger redaction', () => {
  it('redacts authorization from log records', async () => {
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

    logger.info({ authorization: 'Bearer secret-token', paymentId: 'pay_1' }, 'probe');
    await new Promise((resolve) => setTimeout(resolve, 30));

    const joined = Buffer.concat(chunks).toString('utf8');
    expect(joined).toContain('[REDACTED]');
    expect(joined).not.toContain('secret-token');
    expect(joined).toContain('pay_1');
  });
});
