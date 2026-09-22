import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { organizationNotFoundError, resolveOrganization } from '../../src/modules/organizations/scope';
import { ErrorCode, type AppError } from '../../src/domain/errors';
import { createTestPrisma, resetDatabase } from '../helpers/db';

describe('organization scoping', () => {
  const prisma = createTestPrisma();

  let residentOrgId: string;
  let healthOrgId: string;
  let suspendedOrgId: string;

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);

    const resident = await prisma.organization.create({
      data: {
        sourceProduct: 'RESIDENT',
        externalId: 'res-1',
        name: 'Resident Org',
      },
    });
    residentOrgId = resident.id;

    const health = await prisma.organization.create({
      data: {
        sourceProduct: 'HEALTH',
        externalId: 'health-1',
        name: 'Health Org',
      },
    });
    healthOrgId = health.id;

    const suspended = await prisma.organization.create({
      data: {
        sourceProduct: 'RESIDENT',
        externalId: 'res-suspended',
        name: 'Suspended Org',
        status: 'SUSPENDED',
      },
    });
    suspendedOrgId = suspended.id;
  });

  it('returns byte-identical 404 for cross-product and missing organizations', async () => {
    let crossProduct: AppError | undefined;
    let missing: AppError | undefined;

    try {
      await resolveOrganization(healthOrgId, 'RESIDENT', 'read');
    } catch (error) {
      crossProduct = error as AppError;
    }

    try {
      await resolveOrganization('00000000-0000-4000-8000-000000000000', 'RESIDENT', 'read');
    } catch (error) {
      missing = error as AppError;
    }

    expect(crossProduct?.code).toBe(ErrorCode.ORGANIZATION_NOT_FOUND);
    expect(missing?.code).toBe(ErrorCode.ORGANIZATION_NOT_FOUND);
    expect(crossProduct?.message).toBe(missing?.message);
    expect(crossProduct?.message).toBe(organizationNotFoundError().message);
  });

  it('allows reading a suspended organization but rejects mutations', async () => {
    const readable = await resolveOrganization(suspendedOrgId, 'RESIDENT', 'read');
    expect(readable.id).toBe(suspendedOrgId);

    await expect(resolveOrganization(suspendedOrgId, 'RESIDENT', 'mutate')).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
  });

  it('returns the organization when product matches', async () => {
    const org = await resolveOrganization(residentOrgId, 'RESIDENT', 'mutate');
    expect(org.id).toBe(residentOrgId);
  });
});
