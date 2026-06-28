import { prisma } from '../prisma';

// Ported faithfully from twenty's cron mechanic — "on a schedule, enumerate ACTIVE workspaces and do
// per-workspace work" — minus any destructive effect. Counts active workspaces + per-workspace
// companies and records an idempotent snapshot. Pure Postgres; the only write is a cleanly-reversible
// delete-then-insert into core.keyValuePair. A plain async fn so it runs identically in a direct test
// with NO Inngest cloud/dev-server (the Inngest function is a thin wrapper around it).

export type WorkspaceMetrics = {
  activeWorkspaces: number;
  perWorkspace: { databaseSchema: string; companies: number }[];
  computedAt: string;
};

const SCHEMA_PATTERN = /^workspace_[a-z0-9]+$/;
const METRICS_KEY = 'cron:workspaceMetrics';

export const runWorkspaceMetricsSnapshot =
  async (): Promise<WorkspaceMetrics> => {
    const activeRows = await prisma.$queryRaw<{ active: number }[]>`
      SELECT count(*)::int AS active FROM core."workspace" WHERE "activationStatus" = 'ACTIVE'`;
    const activeWorkspaces = activeRows[0]?.active ?? 0;

    const workspaces = await prisma.workspace.findMany({
      select: { databaseSchema: true },
    });

    const perWorkspace: WorkspaceMetrics['perWorkspace'] = [];
    for (const workspace of workspaces) {
      const schema = workspace.databaseSchema;
      // Identifiers can't be bound params — reuse the workspace-schema allow-pattern (injection guard).
      if (!schema || !SCHEMA_PATTERN.test(schema)) {
        continue;
      }
      const rows = await prisma.$queryRawUnsafe<{ companies: number }[]>(
        `SELECT count(*)::int AS companies FROM "${schema}"."company"`,
      );
      perWorkspace.push({
        databaseSchema: schema,
        companies: rows[0]?.companies ?? 0,
      });
    }

    const metrics: WorkspaceMetrics = {
      activeWorkspaces,
      perWorkspace,
      computedAt: new Date().toISOString(),
    };

    // Idempotent + reversible: delete-then-insert in one transaction (userId/workspaceId are NULL, so
    // a NULL-distinct unique key would make ON CONFLICT unreliable). type uses the existing enum.
    await prisma.$transaction([
      prisma.$executeRaw`DELETE FROM core."keyValuePair" WHERE key = ${METRICS_KEY}`,
      prisma.$executeRaw`INSERT INTO core."keyValuePair" (key, value, type)
        VALUES (${METRICS_KEY}, ${JSON.stringify(metrics)}::jsonb, 'CONFIG_VARIABLE')`,
    ]);

    return metrics;
  };
