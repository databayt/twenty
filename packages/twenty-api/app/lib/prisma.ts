import { PrismaClient } from '../generated/prisma';

// A single PrismaClient reused across hot-reloads (dev) and warm serverless invocations (prod),
// so we don't exhaust the Postgres connection pool. On Vercel point DATABASE_URL at Neon (pooled).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
