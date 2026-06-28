import { prisma } from './prisma';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Mirrors jwt-key-manager.getValidPublicKeyPemById: return the plaintext SPKI PEM for a non-revoked
// signing key, looked up by the token header's `kid`. Returns null for a bad/missing/revoked key
// (caller treats that as an invalid token, like upstream's UNAUTHENTICATED).
export const getValidPublicKeyPemById = async (
  kid: string,
): Promise<string | null> => {
  if (!UUID_RE.test(kid)) {
    return null;
  }

  const row = await prisma.signingKey.findFirst({
    where: { id: kid, revokedAt: null },
    select: { publicKey: true },
  });

  return row?.publicKey ?? null;
};
