import { createHash, timingSafeEqual } from 'node:crypto';

import type { SourceProduct } from '@prisma/client';

export interface ServiceContext {
  serviceClientId: string;
  serviceClientName: string;
  sourceProduct: SourceProduct;
  scopes: string[];
}

export interface ServiceAuthenticator {
  authenticate(credential: string): Promise<ServiceContext>;
}

export interface ParsedApiKey {
  prefix: string;
  secret: string;
  raw: string;
}

const API_KEY_PATTERN = /^mvp_([A-Za-z0-9]+)_([A-Za-z0-9_-]+)$/;

export function parseApiKey(raw: string): ParsedApiKey | null {
  const match = API_KEY_PATTERN.exec(raw.trim());
  if (!match) {
    return null;
  }
  const prefix = match[1];
  const secret = match[2];
  if (!prefix || !secret) {
    return null;
  }
  return { prefix, secret, raw: raw.trim() };
}

export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

export function buildApiKey(prefix: string, secret: string): string {
  return `mvp_${prefix}_${secret}`;
}

/** Constant-time compare of hex-encoded SHA-256 digests. */
export function verifyApiKeyHash(apiKey: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashApiKey(apiKey), 'utf8');
  const expected = Buffer.from(expectedHash, 'utf8');
  if (actual.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(actual, expected);
}
