// Slice 9 generic writes against the live Hogwarts DB — in-process, net-zero. Target: the `note`
// object (writable scalar: title TEXT; no required columns). Creates one probe row and hard-destroys
// it at the end.
// Run: cd packages/twenty-api && DATABASE_URL="$PG_DATABASE_URL" npx tsx scripts/verify-slice9-generic-write.ts
import { prisma } from '../app/lib/prisma';
import {
  createRecord,
  destroyRecord,
  getObjectScalarColumns,
  getRecord,
  getWritableScalarFields,
  listRecords,
  resolveObject,
  softDeleteRecord,
  updateRecord,
  WriteValidationError,
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
const expectThrow = async (fn: () => Promise<unknown>, m: string): Promise<void> => {
  try {
    await fn();
    bad(`${m} -> did NOT throw`);
  } catch (e) {
    if (e instanceof WriteValidationError && e.status === 400) ok(`${m} -> 400`);
    else bad(`${m} -> wrong error ${(e as Error).message}`);
  }
};

const noteCount = async (): Promise<number> => {
  const rows = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM "${SCHEMA}"."note" WHERE "deletedAt" IS NULL`,
  );
  return rows[0]?.n ?? -1;
};

const main = async (): Promise<void> => {
  const obj = await resolveObject(HW, 'notes');
  assert(obj.tableName === 'note' && obj.nameSingular === 'note', 'resolveObject notes -> table note');

  const writable = await getWritableScalarFields(HW, obj.id);
  console.log('  writable fields:', writable.map((f) => `${f.name}:${f.type}`).join(', '));
  assert(writable.some((f) => f.name === 'title' && f.type === 'TEXT'), 'title (TEXT) is writable');
  const cols = await getObjectScalarColumns(HW, obj.id);

  const baseline = await noteCount();
  console.log(`=== baseline active notes: ${baseline} ===`);

  console.log('=== create -> get -> update ===');
  const created = await createRecord(SCHEMA, obj.tableName, writable, { title: 'slice9-probe' }, cols);
  const id = created.id as string;
  try {
    assert(created.title === 'slice9-probe', 'createRecord sets title');
    assert((await getRecord(SCHEMA, obj.tableName, cols, id))?.title === 'slice9-probe', 'getRecord round-trip');
    assert((await noteCount()) === baseline + 1, 'active count +1 after create');

    const updated = await updateRecord(SCHEMA, obj.tableName, writable, id, { title: 'slice9-probe-2' }, cols);
    assert(updated?.title === 'slice9-probe-2', 'updateRecord renames title');

    console.log('=== validation (400) cases ===');
    await expectThrow(() => updateRecord(SCHEMA, obj.tableName, writable, id, {}, cols), 'empty update');
    await expectThrow(() => createRecord(SCHEMA, obj.tableName, writable, { bogus: 'x' }, cols), 'unknown field on create');
    await expectThrow(() => createRecord(SCHEMA, obj.tableName, writable, { title: 123 }, cols), 'wrong type for title');

    console.log('=== soft-delete ===');
    const soft = await softDeleteRecord(SCHEMA, obj.tableName, id);
    assert(soft?.id === id, 'softDeleteRecord returns id');
    assert((await getRecord(SCHEMA, obj.tableName, cols, id)) === null, 'soft-deleted hidden from getRecord');
    assert(!(await listRecords(SCHEMA, obj.tableName, cols, 500)).some((r) => r.id === id), 'soft-deleted dropped from list');
    assert((await softDeleteRecord(SCHEMA, obj.tableName, id)) === null, 'second soft-delete -> null');
    assert((await noteCount()) === baseline, 'active count back to baseline after soft-delete');
  } finally {
    await destroyRecord(SCHEMA, obj.tableName, id);
  }
  assert((await getRecord(SCHEMA, obj.tableName, cols, id)) === null, 'hard-destroyed row gone');
  assert((await destroyRecord(SCHEMA, obj.tableName, id)) === null, 'destroy of missing -> null');
  assert((await noteCount()) === baseline, 'net-zero: active note count restored');

  console.log(failed ? '\nSLICE 9 FAIL' : '\nSLICE 9 GENERIC WRITE OK ✓');
  if (failed) process.exitCode = 1;
};

main()
  .catch((e) => {
    console.error('SLICE 9 ERROR:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
