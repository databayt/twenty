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

// Same resolution but by workspace id — used by auth, where the workspace comes from the verified
// token's workspaceId claim (not a subdomain). Also re-validates the schema-name allow-pattern.
export const resolveWorkspaceById = async (
  workspaceId: string,
): Promise<ResolvedWorkspace | null> => {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, displayName: true, databaseSchema: true },
  });

  if (
    !workspace?.databaseSchema ||
    !/^workspace_[a-z0-9]+$/.test(workspace.databaseSchema)
  ) {
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

// Create a company in the workspace's own schema. createdBySource is a per-schema enum — the schema
// name is allow-pattern validated above, so the qualified enum cast is safe; the record value (name)
// stays a bound parameter. id/createdAt/updatedAt/position fall back to their column defaults.
// TODO(slice): attribute createdByWorkspaceMemberId from the authed member; honor proper positioning.
export const createWorkspaceCompany = async (
  databaseSchema: string,
  input: { name?: string | null },
): Promise<WorkspaceCompany> => {
  if (!/^workspace_[a-z0-9]+$/.test(databaseSchema)) {
    throw new Error(`Refusing to write to unexpected schema name: ${databaseSchema}`);
  }

  const rows = await prisma.$queryRawUnsafe<WorkspaceCompany[]>(
    `INSERT INTO "${databaseSchema}"."company" ("name", "createdBySource", "createdByName")
     VALUES ($1, 'API'::"${databaseSchema}"."company_createdBySource_enum", 'API')
     RETURNING "id", "name", "createdAt"`,
    input.name ?? null,
  );

  return rows[0];
};
