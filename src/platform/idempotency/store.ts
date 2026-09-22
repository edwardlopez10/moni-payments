import { createHash } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { prisma } from '../../db/prisma';
import { AppError, ErrorCode } from '../../domain/errors';

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export type IdempotencyRecordStatus = 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

export interface BeginIdempotencyInput {
  serviceClientId: string;
  key: string;
  endpoint: string;
  fingerprint: string;
}

export type BeginIdempotencyResult =
  | { kind: 'proceed'; recordId: string }
  | { kind: 'replay'; statusCode: number; body: unknown }
  | { kind: 'in_progress' }
  | { kind: 'conflict' };

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export function fingerprintRequest(body: unknown, pathParams: Record<string, string> = {}): string {
  const canonical = stableStringify({
    body: body ?? null,
    pathParams,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export async function beginIdempotentRequest(
  input: BeginIdempotencyInput,
): Promise<BeginIdempotencyResult> {
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS);

  try {
    const created = await prisma.idempotencyKey.create({
      data: {
        serviceClientId: input.serviceClientId,
        key: input.key,
        endpoint: input.endpoint,
        requestFingerprint: input.fingerprint,
        status: 'IN_PROGRESS',
        expiresAt,
      },
    });
    return { kind: 'proceed', recordId: created.id };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }
  }

  const existing = await prisma.idempotencyKey.findUnique({
    where: {
      serviceClientId_key_endpoint: {
        serviceClientId: input.serviceClientId,
        key: input.key,
        endpoint: input.endpoint,
      },
    },
  });

  if (!existing) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, 'Idempotency key disappeared after conflict.');
  }

  if (existing.requestFingerprint !== input.fingerprint) {
    return { kind: 'conflict' };
  }

  if (existing.status === 'COMPLETED' && existing.responseStatus != null) {
    return {
      kind: 'replay',
      statusCode: existing.responseStatus,
      body: existing.responseBody ?? null,
    };
  }

  if (existing.status === 'IN_PROGRESS') {
    return { kind: 'in_progress' };
  }

  // FAILED — delete and allow retry with the same key.
  await prisma.idempotencyKey.delete({ where: { id: existing.id } });
  const created = await prisma.idempotencyKey.create({
    data: {
      serviceClientId: input.serviceClientId,
      key: input.key,
      endpoint: input.endpoint,
      requestFingerprint: input.fingerprint,
      status: 'IN_PROGRESS',
      expiresAt,
    },
  });
  return { kind: 'proceed', recordId: created.id };
}

export async function completeIdempotentRequest(
  recordId: string,
  statusCode: number,
  body: unknown,
): Promise<void> {
  await prisma.idempotencyKey.update({
    where: { id: recordId },
    data: {
      status: statusCode >= 500 ? 'FAILED' : 'COMPLETED',
      responseStatus: statusCode,
      responseBody: body === undefined ? Prisma.JsonNull : (body as Prisma.InputJsonValue),
    },
  });
}

export async function failIdempotentRequest(recordId: string): Promise<void> {
  await prisma.idempotencyKey.update({
    where: { id: recordId },
    data: { status: 'FAILED' },
  });
}
