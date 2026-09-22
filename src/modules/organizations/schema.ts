import { z } from 'zod';

import { metadataSchema } from '../../platform/http/schemas';

export const createOrganizationBodySchema = z
  .object({
    externalId: z.string().min(1).max(255),
    name: z.string().min(1).max(255),
    metadata: metadataSchema.optional(),
    // Accepted then ignored — sourceProduct comes from ServiceContext only.
    sourceProduct: z.string().optional(),
  })
  .strict();

export const organizationResponseSchema = z.object({
  id: z.string().uuid(),
  sourceProduct: z.enum(['RESIDENT', 'HEALTH', 'ENVIRONMENT']),
  externalId: z.string(),
  name: z.string(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']),
  metadata: z.record(z.string(), z.string()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const listOrganizationsQuerySchema = z.object({
  externalId: z.string().min(1).max(255).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const organizationListResponseSchema = z.object({
  data: z.array(organizationResponseSchema),
  nextCursor: z.string().nullable(),
});

export type CreateOrganizationBody = z.infer<typeof createOrganizationBodySchema>;
export type OrganizationResponse = z.infer<typeof organizationResponseSchema>;
