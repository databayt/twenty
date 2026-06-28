// Slice 8 generic metadata-driven read against the live Hogwarts DB — in-process, read-only, net-zero.
// Target: the WORKFLOW object (a non-company standard object with real data).
// Run: cd packages/twenty-api && DATABASE_URL="$PG_DATABASE_URL" npx tsx scripts/verify-slice8-generic-read.ts
import { prisma } from '../app/lib/prisma';
import {
  getObjectScalarColumns,
  getRecord,
  listRecords,
  ObjectNotFoundError,
  resolveObject,
} from '../app/lib/records';

const HW = '80df2525-e3f0-4020-85e9-95251ca5d902';
const SCHEMA = 'workspace_7mnum4pk2xma6fag4hcj854aq';

let failed = false;
const ok = (m: string): void => console.log('  ok:', m);
const bad = (m: string): void => {
  console.error('  FAIL:', m);
  failed = true;
};
const assert = (cond: boolean, m: string): void => (cond ? ok(m) : bad(m));

const main = async (): Promise<void> => {
  console.log('=== resolveObject (by plural) ===');
  const obj = await resolveObject(HW, 'workflows');
  console.log('  resolved:', JSON.stringify(obj));
  assert(obj.nameSingular === 'workflow', 'nameSingular === workflow');
  assert(obj.namePlural === 'workflows', 'namePlural === workflows');
  assert(obj.tableName === 'workflow', 'tableName === workflow (standard object, no underscore)');

  console.log('=== getObjectScalarColumns (metadata-derived) ===');
  const columns = await getObjectScalarColumns(HW, obj.id);
  console.log('  columns:', columns.join(', '));
  assert(
    ['id', 'createdAt', 'updatedAt', 'name'].every((c) => columns.includes(c)),
    'base columns (id/createdAt/updatedAt) + scalar name present',
  );
  assert(
    !['deletedAt', 'position', 'searchVector', 'createdBySource', 'statuses'].some((c) =>
      columns.includes(c),
    ),
    'no system/composite/relation column leakage',
  );

  console.log('=== listRecords ===');
  const rows = await listRecords(SCHEMA, obj.tableName, columns, 50);
  console.log('  count:', rows.length, '| names:', rows.map((r) => r.name).join(' / '));
  assert(rows.length >= 1, 'listRecords returns rows');
  assert(
    rows.every((r) => columns.every((c) => c in r)),
    'each row has exactly the selected columns',
  );

  console.log('=== getRecord (one + missing) ===');
  const firstId = rows[0]?.id as string;
  const one = await getRecord(SCHEMA, obj.tableName, columns, firstId);
  assert(one !== null && one.id === firstId, 'getRecord returns the requested row');
  const missing = await getRecord(
    SCHEMA,
    obj.tableName,
    columns,
    '00000000-0000-4000-8000-000000000000',
  );
  assert(missing === null, 'getRecord of a non-existent id -> null (404)');

  console.log('=== unknown object ===');
  try {
    await resolveObject(HW, 'definitelynotanobject');
    bad('unknown object should throw');
  } catch (e) {
    if (e instanceof ObjectNotFoundError && e.status === 404) ok('unknown object -> ObjectNotFoundError 404');
    else bad(`unknown object -> wrong error ${(e as Error).message}`);
  }

  console.log(failed ? '\nSLICE 8 FAIL' : '\nSLICE 8 GENERIC READ OK ✓');
  if (failed) process.exitCode = 1;
};

main()
  .catch((e) => {
    console.error('SLICE 8 ERROR:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
