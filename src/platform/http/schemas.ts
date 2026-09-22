import { z } from 'zod';

import { listCurrencies } from '../../domain/currencies';

export const metadataSchema = z
  .record(z.string(), z.string())
  .refine((value) => Object.keys(value).length <= 20, {
    message: 'metadata supports at most 20 keys',
  })
  .default({});

export const currencySchema = z
  .string()
  .length(3)
  .refine((code) => listCurrencies().some((c) => c.code === code), {
    message: 'unsupported currency',
  });

export const amountSchema = z
  .number()
  .int()
  .min(1)
  .max(2_000_000_000);

export const cursorPaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().uuid().optional(),
});

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const [iso, id] = raw.split('|');
  if (!iso || !id) {
    throw new Error('Invalid cursor');
  }
  return { createdAt: new Date(iso), id };
}

export function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}
