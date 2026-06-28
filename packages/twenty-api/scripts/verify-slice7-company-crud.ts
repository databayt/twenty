// Slice 7 CRUD checks against the live Hogwarts DB — in-process helper calls (no HTTP/token mint),
// net-zero. A throwaway company exercises create -> get -> patch -> soft-delete -> hard-destroy; a
// temp restricted role proves the read/update/softDelete/destroy permission denials.
// Run: cd packages/twenty-api && DATABASE_URL="$PG_DATABASE_URL" npx tsx scripts/verify-slice7-company-crud.ts
import { type AuthContext } from '../app/lib/auth';
import { assertObjectPermission, PermissionError } from '../app/lib/permissions';
import { prisma } from '../app/lib/prisma';
import {
  createWorkspaceCompany,
  destroyWorkspaceCompany,
  getWorkspaceCompany,
  listWorkspaceCompanies,
  softDeleteWorkspaceCompany,
  updateWorkspaceCompany,
} from '../app/lib/workspace';

const HW = '80df2525-e3f0-4020-85e9-95251ca5d902';
const SCHEMA = 'workspace_7mnum4pk2xma6fag4hcj854aq';
const SPARE_UW = '059adf98-95f6-48ea-aaa7-9f39702d5b20';
const SPARE_RT = '5fb0c8c6-3f5f-4ccd-b6d1-1e42353b8ba8';
const MEMBER_ROLE = '2ebce242-69ba-4736-8e5c-1f441515464e';
const MEMBER_APP = '21069490-8926-4a43-96c0-4d7a4d909fd3';

let failed = false;
const ok = (m: string): void => console.log('  ok:', m);
const bad = (m: string): void => {
  console.error('  FAIL:', m);
  failed = true;
};
const assert = (cond: boolean, m: string): void => (cond ? ok(m) : bad(m));
const expectDeny = async (fn: () => Promise<void>, m: string): Promise<void> => {
  try {
    await fn();
    bad(`${m} -> did NOT throw`);
  } catch (e) {
    if (e instanceof PermissionError && e.status === 403) ok(`${m} -> 403`);
    else bad(`${m} -> wrong error ${(e as Error).message}`);
  }
};

const activeCount = async (): Promise<number> => {
  const rows = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM "${SCHEMA}"."company" WHERE "deletedAt" IS NULL`,
  );
  return rows[0]?.n ?? -1;
};

const main = async (): Promise<void> => {
  const baseline = await activeCount();
  console.log(`=== baseline active companies: ${baseline} ===`);

  console.log('=== CRUD lifecycle (throwaway company) ===');
  const created = await createWorkspaceCompany(SCHEMA, { name: '__slice7_crud__' });
  try {
    const got = await getWorkspaceCompany(SCHEMA, created.id);
    assert(got !== null && got.name === '__slice7_crud__', 'GET-one returns the created company');
    const list1 = await listWorkspaceCompanies(SCHEMA, 500);
    assert(list1.some((c) => c.id === created.id), 'created company appears in the list');
    assert((await activeCount()) === baseline + 1, 'active count +1 after create');

    const updated = await updateWorkspaceCompany(SCHEMA, created.id, { name: '__slice7_renamed__' });
    assert(updated !== null && updated.name === '__slice7_renamed__', 'PATCH renames the company');
    assert((await getWorkspaceCompany(SCHEMA, created.id))?.name === '__slice7_renamed__', 'rename persisted');

    const soft = await softDeleteWorkspaceCompany(SCHEMA, created.id);
    assert(soft !== null && soft.deletedAt != null, 'soft-delete stamps deletedAt');
    assert((await getWorkspaceCompany(SCHEMA, created.id)) === null, 'soft-deleted row hidden from GET-one');
    const list2 = await listWorkspaceCompanies(SCHEMA, 500);
    assert(!list2.some((c) => c.id === created.id), 'soft-deleted row dropped from the list');
    assert((await activeCount()) === baseline, 'active count back to baseline after soft-delete');
    assert((await softDeleteWorkspaceCompany(SCHEMA, created.id)) === null, 'second soft-delete -> null (404)');
    assert((await updateWorkspaceCompany(SCHEMA, created.id, { name: 'x' })) === null, 'update on soft-deleted -> null (404)');
  } finally {
    await destroyWorkspaceCompany(SCHEMA, created.id);
  }
  assert((await getWorkspaceCompany(SCHEMA, created.id)) === null, 'hard-destroyed row is gone');
  assert((await activeCount()) === baseline, 'net-zero: active count restored to baseline');
  assert((await destroyWorkspaceCompany(SCHEMA, created.id)) === null, 'destroy of missing row -> null (404)');

  console.log('=== permission denials via temp restricted role (net-zero) ===');
  await prisma.$executeRaw`DELETE FROM core."role" WHERE label = 'slice7-deny-test' AND "workspaceId" = ${HW}::uuid`;
  const createdRole = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO core."role" (id,label,"workspaceId","canUpdateAllSettings","canAccessAllTools","canReadAllObjectRecords","canUpdateAllObjectRecords","canSoftDeleteAllObjectRecords","canDestroyAllObjectRecords","isEditable","canBeAssignedToUsers","canBeAssignedToAgents","canBeAssignedToApiKeys","universalIdentifier","applicationId","createdAt","updatedAt")
    VALUES (gen_random_uuid(),'slice7-deny-test',${HW}::uuid,false,false,false,false,false,false,true,true,false,false,gen_random_uuid(),${MEMBER_APP}::uuid,now(),now())
    RETURNING id`;
  const tempRoleId = createdRole[0].id;
  const denyCtx: AuthContext = {
    tokenType: 'ACCESS',
    workspaceId: HW,
    databaseSchema: SCHEMA,
    userWorkspaceId: SPARE_UW,
  };
  try {
    await prisma.$executeRaw`UPDATE core."roleTarget" SET "roleId" = ${tempRoleId}::uuid, "updatedAt" = now() WHERE id = ${SPARE_RT}::uuid`;
    await expectDeny(() => assertObjectPermission(denyCtx, { nameSingular: 'company' }, 'read'), 'restricted denied read');
    await expectDeny(() => assertObjectPermission(denyCtx, { nameSingular: 'company' }, 'update'), 'restricted denied update');
    await expectDeny(() => assertObjectPermission(denyCtx, { nameSingular: 'company' }, 'softDelete'), 'restricted denied softDelete');
    await expectDeny(() => assertObjectPermission(denyCtx, { nameSingular: 'company' }, 'destroy'), 'restricted denied destroy');
  } finally {
    await prisma.$executeRaw`UPDATE core."roleTarget" SET "roleId" = ${MEMBER_ROLE}::uuid, "updatedAt" = now() WHERE id = ${SPARE_RT}::uuid`;
    await prisma.$executeRaw`DELETE FROM core."role" WHERE id = ${tempRoleId}::uuid`;
  }

  console.log(failed ? '\nSLICE 7 FAIL' : '\nSLICE 7 COMPANY CRUD OK ✓');
  if (failed) process.exitCode = 1;
};

main()
  .catch((e) => {
    console.error('SLICE 7 ERROR:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
