import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

import { PrismaClient, type SourceProduct } from '@prisma/client';
import { config as loadDotenv } from 'dotenv';

import { buildApiKey, hashApiKey } from '../src/platform/auth/service-auth';

loadDotenv({ path: resolve(process.cwd(), '.env') });

function usage(): never {
  console.error(
    'Usage: pnpm service-client:create -- --name <name> --product <RESIDENT|HEALTH|ENVIRONMENT> [--prefix <prefix>]',
  );
  process.exit(1);
}

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const name = readArg('--name');
  const product = readArg('--product') as SourceProduct | undefined;
  const prefixArg = readArg('--prefix');

  if (!name || !product) {
    usage();
  }

  if (!['RESIDENT', 'HEALTH', 'ENVIRONMENT'].includes(product)) {
    console.error('Invalid --product');
    process.exit(1);
  }

  const prefix = prefixArg ?? randomBytes(4).toString('hex');
  const secret = randomBytes(24).toString('base64url');
  const apiKey = buildApiKey(prefix, secret);
  const keyHash = hashApiKey(apiKey);

  const prisma = new PrismaClient();
  try {
    const client = await prisma.serviceClient.create({
      data: {
        name,
        sourceProduct: product,
        keyPrefix: prefix,
        keyHash,
        scopes: ['*'],
      },
    });

    console.log('Service client created.');
    console.log(`  id: ${client.id}`);
    console.log(`  sourceProduct: ${client.sourceProduct}`);
    console.log(`  keyPrefix: ${client.keyPrefix}`);
    console.log('');
    console.log('API key (shown once; store it securely):');
    console.log(`  ${apiKey}`);
    // Ensure hash function stays referenced for tree-shaking clarity in scripts.
    void createHash;
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
