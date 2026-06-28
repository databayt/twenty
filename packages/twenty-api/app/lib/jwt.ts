import { createHash } from 'node:crypto';

import jwt from 'jsonwebtoken';

import { getValidPublicKeyPemById } from './signing-key';

// Faithful port of twenty-server jwt-wrapper.service.ts (resolveVerificationKey + verifyJwtToken).
// Dual-algorithm: NEW tokens are ES256 (asymmetric, header.kid -> public key from core.signingKey);
// LEGACY tokens are HS256 with a secret derived as sha256hex(APP_SECRET + appSecretBody + type).
// The algorithm/key is chosen from the JWT HEADER, never from the (attacker-controllable) payload,
// and jwt.verify is pinned to the single resolved algorithm to prevent alg-confusion.

export type VerifiedPayload = {
  type?: string;
  sub?: string;
  userId?: string;
  workspaceId?: string;
  userWorkspaceId?: string;
  workspaceMemberId?: string;
  jti?: string;
  [key: string]: unknown;
};

type DecodedHeader = { alg?: string; kid?: string };

const decodeHeader = (token: string): DecodedHeader | null => {
  const decoded = jwt.decode(token, { complete: true });
  return decoded && typeof decoded === 'object'
    ? (decoded.header as DecodedHeader)
    : null;
};

const isAsymmetricHeader = (header: DecodedHeader | null): boolean =>
  !!header &&
  header.alg === 'ES256' &&
  typeof header.kid === 'string' &&
  header.kid.length > 0;

const decodePayload = (token: string): VerifiedPayload => {
  const payload = jwt.decode(token);
  if (!payload || typeof payload !== 'object') {
    throw new Error('Token payload invalid');
  }
  return payload as VerifiedPayload;
};

// EXACT replica of generateAppSecret: hex( sha256( APP_SECRET + appSecretBody + type ) ), no
// separators, this order. The hex STRING is the HMAC secret (jsonwebtoken uses its utf-8 bytes) —
// do NOT decode it to bytes.
const deriveHs256Secret = (type: string, appSecretBody: string): string => {
  const appSecret = process.env.APP_SECRET;
  if (!appSecret) {
    throw new Error('APP_SECRET is not set');
  }
  return createHash('sha256')
    .update(`${appSecret}${appSecretBody}${type}`)
    .digest('hex');
};

export const verifyToken = async (token: string): Promise<VerifiedPayload> => {
  const header = decodeHeader(token);

  // PRIMARY: ES256 asymmetric (what currently-issued frontend tokens use).
  if (isAsymmetricHeader(header)) {
    const publicKeyPem = await getValidPublicKeyPemById(header!.kid as string);
    if (!publicKeyPem) {
      throw new Error('Token invalid');
    }
    return jwt.verify(token, publicKeyPem, {
      algorithms: ['ES256'],
    }) as VerifiedPayload;
  }

  // LEGACY: HS256 with the APP_SECRET-derived secret.
  const payload = decodePayload(token);
  const appSecretBody = payload.workspaceId ?? payload.userId;
  if (!appSecretBody) {
    throw new Error('Token invalid');
  }
  const type = payload.type ?? 'ACCESS';

  try {
    return jwt.verify(token, deriveHs256Secret(type, appSecretBody), {
      algorithms: ['HS256'],
    }) as VerifiedPayload;
  } catch (error) {
    // Pre-2025-12-12 API keys were mistakenly signed with type 'ACCESS' (upstream PR #16504).
    if (type === 'API_KEY') {
      return jwt.verify(token, deriveHs256Secret('ACCESS', appSecretBody), {
        algorithms: ['HS256'],
      }) as VerifiedPayload;
    }
    throw error;
  }
};
