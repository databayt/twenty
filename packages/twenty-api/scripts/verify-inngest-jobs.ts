// Direct test of the Slice 4 job LOGIC against the live DB — no Inngest cloud/dev-server needed.
// Run: cd packages/twenty-api && DATABASE_URL="$PG_DATABASE_URL" npx tsx scripts/verify-inngest-jobs.ts
import { handleCompanyCreated } from '../app/lib/jobs/company-created';
import { runWorkspaceMetricsSnapshot } from '../app/lib/jobs/workspace-metrics-snapshot';
import { prisma } from '../app/lib/prisma';

const assert = (cond: boolean, msg: string): void => {
  if (!cond) {
    console.error('  FAIL:', msg);
    process.exitCode = 1;
    throw new Error(msg);
  }
  console.log('  ok:', msg);
};

const countMetricRows = async (): Promise<number> => {
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM core."keyValuePair" WHERE key = 'cron:workspaceMetrics'`;
  return rows[0]?.n ?? 0;
};

const main = async (): Promise<void> => {
  console.log('=== cron logic: runWorkspaceMetricsSnapshot ===');
  const metrics = await runWorkspaceMetricsSnapshot();
  console.log('  metrics:', JSON.stringify(metrics));
  assert(metrics.activeWorkspaces >= 1, `activeWorkspaces >= 1 (got ${metrics.activeWorkspaces})`);
  assert(metrics.perWorkspace.length >= 1, 'perWorkspace has at least one entry');

  console.log('=== durable write path (read back via DB) ===');
  const recorded = await prisma.$queryRaw<{ value: { activeWorkspaces: number; computedAt: string } }[]>`
    SELECT value FROM core."keyValuePair" WHERE key = 'cron:workspaceMetrics'`;
  assert(recorded.length === 1, 'exactly one cron:workspaceMetrics row recorded');
  assert(
    recorded[0].value.activeWorkspaces === metrics.activeWorkspaces &&
      recorded[0].value.computedAt === metrics.computedAt,
    'recorded jsonb matches the computed metrics',
  );

  console.log('=== idempotency: re-run must not duplicate ===');
  await runWorkspaceMetricsSnapshot();
  assert((await countMetricRows()) === 1, 'still exactly one row after re-run (replace, not insert)');

  console.log('=== event logic: handleCompanyCreated (read-only) ===');
  const ws = metrics.perWorkspace.find((w) => w.companies > 0);
  assert(!!ws, 'a workspace with >= 1 company exists');
  if (ws) {
    const sample = await prisma.$queryRawUnsafe<{ id: string; name: string | null }[]>(
      `SELECT "id", "name" FROM "${ws.databaseSchema}"."company" LIMIT 1`,
    );
    const result = await handleCompanyCreated({
      workspaceId: 'unused',
      databaseSchema: ws.databaseSchema,
      companyId: sample[0].id,
      name: sample[0].name,
    });
    assert(result.exists === true, 'handleCompanyCreated: created company is found');
    assert(
      result.workspaceCompanyCount === ws.companies,
      `event company count matches cron count (${result.workspaceCompanyCount} === ${ws.companies})`,
    );
  }

  console.log('=== net-zero cleanup ===');
  await prisma.$executeRaw`DELETE FROM core."keyValuePair" WHERE key = 'cron:workspaceMetrics'`;
  assert((await countMetricRows()) === 0, 'cleanup: cron:workspaceMetrics row removed (net-zero)');

  console.log('\nSLICE 4 JOB LOGIC OK ✓');
};

main()
  .catch((error) => {
    console.error('SLICE 4 FAIL:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
