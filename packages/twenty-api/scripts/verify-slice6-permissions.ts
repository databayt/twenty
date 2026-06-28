// Slice 6 permission checks against the live Hogwarts DB — in-process AuthContexts + direct helper
// calls (no HTTP/token mint; resilient to flaky network/headless). The deny path creates a temp
// restricted role on the SPARE userWorkspace, then restores net-zero in a finally.
// Run: cd packages/twenty-api && DATABASE_URL="$PG_DATABASE_URL" npx tsx scripts/verify-slice6-permissions.ts
import { type AuthContext } from '../app/lib/auth';
import {
  assertObjectPermission,
  assertSettingsPermission,
  PermissionError,
} from '../app/lib/permissions';
import { prisma } from '../app/lib/prisma';

const HW = '80df2525-e3f0-4020-85e9-95251ca5d902';
const SCHEMA = 'workspace_7mnum4pk2xma6fag4hcj854aq';
const ABDOUT_UW = '059adf98-95f6-48ea-aaa7-9f39702d5b11'; // Admin
const ALI_UW = '059adf98-95f6-48ea-aaa7-9f39702d5b21'; // Member
const SPARE_UW = '059adf98-95f6-48ea-aaa7-9f39702d5b20'; // Member (dupe ali) — repurposed for deny
const SPARE_RT = '5fb0c8c6-3f5f-4ccd-b6d1-1e42353b8ba8'; // its roleTarget id
const MEMBER_ROLE = '2ebce242-69ba-4736-8e5c-1f441515464e';
const MEMBER_APP = '21069490-8926-4a43-96c0-4d7a4d909fd3';
const COMPANY_OBJ = '61dd1891-de5c-4653-8736-1ca4542c4fae';
const API_KEY = '20202020-f401-4d8a-a731-64d007c27bad';

const access = (userWorkspaceId: string): AuthContext => ({
  tokenType: 'ACCESS',
  workspaceId: HW,
  databaseSchema: SCHEMA,
  userWorkspaceId,
});
const apikey = (apiKeyId: string): AuthContext => ({
  tokenType: 'API_KEY',
  workspaceId: HW,
  databaseSchema: SCHEMA,
  apiKeyId,
});

let failed = false;
const ok = (m: string): void => console.log('  ok:', m);
const bad = (m: string): void => {
  console.error('  FAIL:', m);
  failed = true;
};
const expectAllow = async (fn: () => Promise<void>, m: string): Promise<void> => {
  try {
    await fn();
    ok(m);
  } catch (e) {
    bad(`${m} -> threw ${(e as Error).message}`);
  }
};
const expectDeny = async (fn: () => Promise<void>, m: string): Promise<void> => {
  try {
    await fn();
    bad(`${m} -> did NOT throw`);
  } catch (e) {
    if (e instanceof PermissionError && e.status === 403) ok(`${m} -> 403`);
    else bad(`${m} -> wrong error ${(e as Error).message}`);
  }
};

const main = async (): Promise<void> => {
  console.log('=== ALLOW (existing roles) ===');
  await expectAllow(() => assertObjectPermission(access(ABDOUT_UW), { nameSingular: 'company' }, 'read'), 'admin reads company');
  await expectAllow(() => assertObjectPermission(access(ABDOUT_UW), { nameSingular: 'company' }, 'create'), 'admin creates company');
  await expectAllow(() => assertSettingsPermission(access(ABDOUT_UW), 'canUpdateAllSettings'), 'admin allowed settings (field create)');
  await expectAllow(() => assertObjectPermission(access(ALI_UW), { nameSingular: 'company' }, 'read'), 'member reads company');

  console.log('=== DENY (settings + no-role) ===');
  await expectDeny(() => assertSettingsPermission(access(ALI_UW), 'canUpdateAllSettings'), 'member denied settings (field create)');
  await expectDeny(() => assertObjectPermission(access('00000000-0000-0000-0000-000000000000'), { nameSingular: 'company' }, 'read'), 'unbound userWorkspace denied');

  console.log('=== API_KEY branch (best-effort) ===');
  const apiKeyRoleTarget = await prisma.roleTarget.findFirst({
    where: { workspaceId: HW, apiKeyId: API_KEY },
    select: { roleId: true },
  });
  if (apiKeyRoleTarget) {
    await expectAllow(() => assertObjectPermission(apikey(API_KEY), { nameSingular: 'company' }, 'read'), 'apiKey principal reads company');
  } else {
    console.log('  skip: no apiKey roleTarget in Hogwarts (apiKey branch still covered by code path)');
  }

  console.log('=== DENY via temp restricted role (net-zero) ===');
  await prisma.$executeRaw`DELETE FROM core."role" WHERE label = 'slice6-deny-test' AND "workspaceId" = ${HW}::uuid`;
  const created = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO core."role" (id,label,"workspaceId","canUpdateAllSettings","canAccessAllTools","canReadAllObjectRecords","canUpdateAllObjectRecords","canSoftDeleteAllObjectRecords","canDestroyAllObjectRecords","isEditable","canBeAssignedToUsers","canBeAssignedToAgents","canBeAssignedToApiKeys","universalIdentifier","applicationId","createdAt","updatedAt")
    VALUES (gen_random_uuid(),'slice6-deny-test',${HW}::uuid,false,false,false,false,false,false,true,true,false,false,gen_random_uuid(),${MEMBER_APP}::uuid,now(),now())
    RETURNING id`;
  const tempRoleId = created[0].id;
  try {
    await prisma.$executeRaw`UPDATE core."roleTarget" SET "roleId" = ${tempRoleId}::uuid, "updatedAt" = now() WHERE id = ${SPARE_RT}::uuid`;
    await expectDeny(() => assertObjectPermission(access(SPARE_UW), { nameSingular: 'company' }, 'read'), 'restricted role denied read');
    await expectDeny(() => assertObjectPermission(access(SPARE_UW), { nameSingular: 'company' }, 'create'), 'restricted role denied create');

    // Override precedence: an explicit read=true override beats the role's false default; create stays
    // denied because its override column is null -> falls back to the false default.
    await prisma.$executeRaw`INSERT INTO core."objectPermission" (id,"roleId","objectMetadataId","canReadObjectRecords","canUpdateObjectRecords","canSoftDeleteObjectRecords","canDestroyObjectRecords","workspaceId","universalIdentifier","applicationId","createdAt","updatedAt")
      VALUES (gen_random_uuid(),${tempRoleId}::uuid,${COMPANY_OBJ}::uuid,true,null,null,null,${HW}::uuid,gen_random_uuid(),${MEMBER_APP}::uuid,now(),now())`;
    await expectAllow(() => assertObjectPermission(access(SPARE_UW), { nameSingular: 'company' }, 'read'), 'objectPermission override read=true beats false default');
    await expectDeny(() => assertObjectPermission(access(SPARE_UW), { nameSingular: 'company' }, 'create'), 'override null create -> falls back to false default (denied)');
  } finally {
    await prisma.$executeRaw`UPDATE core."roleTarget" SET "roleId" = ${MEMBER_ROLE}::uuid, "updatedAt" = now() WHERE id = ${SPARE_RT}::uuid`;
    await prisma.$executeRaw`DELETE FROM core."objectPermission" WHERE "roleId" = ${tempRoleId}::uuid`;
    await prisma.$executeRaw`DELETE FROM core."role" WHERE id = ${tempRoleId}::uuid`;
  }

  console.log(failed ? '\nSLICE 6 FAIL' : '\nSLICE 6 PERMISSIONS OK ✓');
  if (failed) process.exitCode = 1;
};

main()
  .catch((e) => {
    console.error('SLICE 6 ERROR:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
