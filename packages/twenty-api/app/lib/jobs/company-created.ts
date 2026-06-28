import { prisma } from '../prisma';

// Read-only downstream reaction to a company.created event — replaces twenty's "entity event ->
// enqueue a worker job" coupling. Confirms the created row exists and returns the workspace's company
// count. Plain async fn (no Inngest import) so it's directly testable.

export type CompanyCreatedEvent = {
  workspaceId: string;
  databaseSchema: string;
  companyId: string;
  name: string | null;
};

const SCHEMA_PATTERN = /^workspace_[a-z0-9]+$/;

export const handleCompanyCreated = async (
  data: CompanyCreatedEvent,
): Promise<{ companyId: string; exists: boolean; workspaceCompanyCount: number }> => {
  if (!SCHEMA_PATTERN.test(data.databaseSchema)) {
    throw new Error(`Refusing to query unexpected schema name: ${data.databaseSchema}`);
  }

  const found = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT "id" FROM "${data.databaseSchema}"."company" WHERE "id" = $1::uuid`,
    data.companyId,
  );
  const countRows = await prisma.$queryRawUnsafe<{ count: number }[]>(
    `SELECT count(*)::int AS count FROM "${data.databaseSchema}"."company"`,
  );

  return {
    companyId: data.companyId,
    exists: found.length > 0,
    workspaceCompanyCount: countRows[0]?.count ?? 0,
  };
};
