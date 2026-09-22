import {
  OrganizationStatus,
  type Organization,
  type SourceProduct,
} from '@prisma/client';

import { prisma } from '../../db/prisma';
import { AppError, ErrorCode } from '../../domain/errors';

const NOT_FOUND_MESSAGE = 'Organization not found.';

export type OrganizationAccessMode = 'read' | 'mutate';

/**
 * Loads an organization and enforces product tenancy.
 * Cross-product and missing orgs both yield the same 404 body so existence is not disclosed.
 */
export async function resolveOrganization(
  organizationId: string,
  callerSourceProduct: SourceProduct,
  mode: OrganizationAccessMode = 'read',
): Promise<Organization> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
  });

  if (!organization || organization.sourceProduct !== callerSourceProduct) {
    throw new AppError(ErrorCode.ORGANIZATION_NOT_FOUND, NOT_FOUND_MESSAGE);
  }

  if (
    mode === 'mutate' &&
    (organization.status === OrganizationStatus.SUSPENDED ||
      organization.status === OrganizationStatus.ARCHIVED)
  ) {
    throw new AppError(
      ErrorCode.FORBIDDEN,
      `Organization is ${organization.status.toLowerCase()} and cannot be modified.`,
    );
  }

  return organization;
}

export function organizationNotFoundError(): AppError {
  return new AppError(ErrorCode.ORGANIZATION_NOT_FOUND, NOT_FOUND_MESSAGE);
}
