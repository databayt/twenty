import { type NextRequest } from 'next/server';

import { verifyToken, type VerifiedPayload } from './jwt';
import { prisma } from './prisma';
import { resolveWorkspaceById } from './workspace';

// Condenses twenty-server's JwtAuthGuard -> AccessTokenService.validateTokenByRequest ->
// JwtWrapperService.verifyJwtToken -> JwtAuthStrategy.validate into one request authenticator.
// Returns a typed AuthContext or throws AuthError (mapped to 401/404 by the route).

export class AuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

export type AuthContext = {
  tokenType: 'ACCESS' | 'API_KEY';
  workspaceId: string;
  databaseSchema: string;
  userId?: string;
  userWorkspaceId?: string;
  workspaceMemberId?: string;
  apiKeyId?: string;
};

const extractBearerToken = (request: NextRequest): string => {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) {
    throw new AuthError('Missing or malformed Authorization header');
  }
  return match[1];
};

export const authenticateRequest = async (
  request: NextRequest,
): Promise<AuthContext> => {
  const token = extractBearerToken(request);

  let payload: VerifiedPayload;
  try {
    payload = await verifyToken(token);
  } catch {
    throw new AuthError('Token invalid or expired');
  }

  // Dispatch by payload.type, mirroring JwtAuthStrategy. Legacy API keys have no type but a
  // workspaceId and no userId.
  const type =
    payload.type ??
    (payload.workspaceId && !payload.userId ? 'API_KEY' : undefined);

  if (type === 'ACCESS' || type === 'PLAYGROUND') {
    const workspaceId = payload.workspaceId;
    const userWorkspaceId = payload.userWorkspaceId;
    const userId = payload.sub ?? payload.userId;

    // Upstream JwtAuthGuard gate: an ACCESS context must carry a userWorkspaceId.
    if (!workspaceId || !userWorkspaceId) {
      throw new AuthError('Token missing workspace context');
    }

    const workspace = await resolveWorkspaceById(workspaceId);
    if (!workspace) {
      throw new AuthError('Workspace not found', 404);
    }

    // Faithful membership check (mirrors resolveUserContext): the userWorkspace must belong to this
    // user + workspace.
    const userWorkspace = await prisma.userWorkspace.findFirst({
      where: { id: userWorkspaceId },
      select: { userId: true, workspaceId: true },
    });
    if (
      !userWorkspace ||
      userWorkspace.workspaceId !== workspaceId ||
      (userId !== undefined && userWorkspace.userId !== userId)
    ) {
      throw new AuthError('User workspace mismatch');
    }

    return {
      tokenType: 'ACCESS',
      workspaceId,
      databaseSchema: workspace.databaseSchema,
      userId,
      userWorkspaceId,
      workspaceMemberId: payload.workspaceMemberId,
    };
  }

  if (type === 'API_KEY') {
    const workspaceId = payload.workspaceId ?? payload.sub;
    const apiKeyId = payload.jti;
    if (!workspaceId || !apiKeyId) {
      throw new AuthError('API key token missing context');
    }

    const workspace = await resolveWorkspaceById(workspaceId);
    if (!workspace) {
      throw new AuthError('Workspace not found', 404);
    }

    // Mandatory DB recheck — the JWT can't be revoked and default lifetime is ~100y.
    const apiKey = await prisma.apiKey.findFirst({
      where: { id: apiKeyId },
      select: { revokedAt: true, expiresAt: true, workspaceId: true },
    });
    if (!apiKey || apiKey.workspaceId !== workspaceId) {
      throw new AuthError('API key not found');
    }
    if (apiKey.revokedAt) {
      throw new AuthError('This API Key is revoked');
    }
    if (apiKey.expiresAt < new Date()) {
      throw new AuthError('This API Key is expired');
    }

    return {
      tokenType: 'API_KEY',
      workspaceId,
      databaseSchema: workspace.databaseSchema,
      apiKeyId,
    };
  }

  throw new AuthError('Unsupported token type');
};
