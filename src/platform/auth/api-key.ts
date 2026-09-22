import { ServiceClientStatus } from '@prisma/client';

import { AppError, ErrorCode } from '../../domain/errors';
import { prisma } from '../../db/prisma';
import {
  type ServiceAuthenticator,
  type ServiceContext,
  parseApiKey,
  verifyApiKeyHash,
} from './service-auth';

const UNAUTHENTICATED_MESSAGE = 'Authentication required.';

function unauthenticated(): never {
  throw new AppError(ErrorCode.UNAUTHENTICATED, UNAUTHENTICATED_MESSAGE);
}

export class ApiKeyAuthenticator implements ServiceAuthenticator {
  async authenticate(credential: string): Promise<ServiceContext> {
    const parsed = parseApiKey(credential);
    if (!parsed) {
      unauthenticated();
    }

    const client = await prisma.serviceClient.findUnique({
      where: { keyPrefix: parsed.prefix },
    });

    if (!client) {
      unauthenticated();
    }

    if (client.status !== ServiceClientStatus.ACTIVE || client.revokedAt != null) {
      unauthenticated();
    }

    if (!verifyApiKeyHash(parsed.raw, client.keyHash)) {
      unauthenticated();
    }

    void prisma.serviceClient
      .update({
        where: { id: client.id },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => {
        // Best-effort last-used tracking; never fail the request.
      });

    return {
      serviceClientId: client.id,
      serviceClientName: client.name,
      sourceProduct: client.sourceProduct,
      scopes: client.scopes,
    };
  }
}
