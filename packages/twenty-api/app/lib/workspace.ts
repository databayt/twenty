import { prisma } from './prisma';

// The tenant spine every ported read/write reuses: resolve a workspace (typed Prisma read of the
// static core schema) to its dedicated Postgres schema, then read its object data from that schema.
// Twenty materializes one Postgres schema per workspace (see .claude/docs/VERCEL-BACKEND.md).

export type ResolvedWorkspace = {
  id: string;
  displayName: string | null;
  databaseSchema: string;
};

export const resolveWorkspaceSchema = async (
  subdomain: string,
): Promise<ResolvedWorkspace | null> => {
  const workspace = await prisma.workspace.findFirst({
    where: { subdomain },
    select: { id: true, displayName: true, databaseSchema: true },
  });

  if (!workspace?.databaseSchema) {
    return null;
  }

  return {
    id: workspace.id,
    displayName: workspace.displayName,
    databaseSchema: workspace.databaseSchema,
  };
};

export type WorkspaceCompany = { id: string; name: string | null; createdAt: Date };

// Read object data from a workspace's own schema. The schema name comes from trusted core data (never
// user input) and is still validated against an allow-pattern before interpolation — a Postgres
// identifier can't be a bound parameter, so this is the SQL-injection guard. Values stay parameterized.
export const listWorkspaceCompanies = async (
  databaseSchema: string,
  limit = 50,
): Promise<WorkspaceCompany[]> => {
  if (!/^workspace_[a-z0-9]+$/.test(databaseSchema)) {
    throw new Error(`Refusing to query unexpected schema name: ${databaseSchema}`);
  }

  return prisma.$queryRawUnsafe<WorkspaceCompany[]>(
    `SELECT "id", "name", "createdAt" FROM "${databaseSchema}"."company" ORDER BY "createdAt" DESC LIMIT $1`,
    limit,
  );
};
