import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

interface PolicyStatement {
  Effect: string;
  Action: string | string[];
  Resource: string | string[];
}

interface PolicyDocument {
  Statement: PolicyStatement[];
}

const FILES = [
  'infra/aws/staging-runtime-policy.json',
  'infra/aws/production-runtime-policy.json',
] as const;

function load(relativePath: string): { text: string; policy: PolicyDocument } {
  const text = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
  return { text, policy: JSON.parse(text) as PolicyDocument };
}

function actions(statement: PolicyStatement): string[] {
  return Array.isArray(statement.Action) ? statement.Action : [statement.Action];
}

describe('runtime IAM policies', () => {
  it('does not allow secretsmanager:* or ListSecrets', () => {
    for (const file of FILES) {
      const { text, policy } = load(file);
      expect(text).not.toContain('secretsmanager:*');
      const allowed = policy.Statement.filter((statement) => statement.Effect === 'Allow').flatMap(
        actions,
      );
      expect(allowed).not.toContain('secretsmanager:ListSecrets');
      expect(allowed).not.toContain('secretsmanager:*');
      const denied = policy.Statement.filter((statement) => statement.Effect === 'Deny').flatMap(
        actions,
      );
      expect(denied).toContain('secretsmanager:ListSecrets');
    }
  });

  it('scopes each environment to its own prefix', () => {
    const staging = load(FILES[0]).text;
    const production = load(FILES[1]).text;
    expect(staging).toContain('moniveo-payments/staging/');
    expect(staging).not.toContain('moniveo-payments/production/');
    expect(production).toContain('moniveo-payments/production/');
    expect(production).not.toContain('moniveo-payments/staging/');
  });
});
