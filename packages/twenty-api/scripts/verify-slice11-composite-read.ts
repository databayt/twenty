// Slice 11 composite-field READ against the live Hogwarts DB — in-process, net-zero.
//   Layer 0: reNestRecord unit checks (null-equivalents, ACTOR collapse) on real person plans.
//   Layer A: live company composites (LINKS/ADDRESS/CURRENCY/ACTOR) read + re-nested; scalar back-compat.
//   Layer B: a probe person (Harry Potter) is INSERTed with rich composite sub-columns, read back via
//            the generic reader, asserted nested, then HARD-deleted -> net-zero.
// Run: cd packages/twenty-api && DATABASE_URL="$PG_DATABASE_URL" npx tsx scripts/verify-slice11-composite-read.ts
import { randomUUID } from 'node:crypto';

import { prisma } from '../app/lib/prisma';
import {
  getObjectReadShape,
  getRecord,
  getTableColumnSet,
  listRecords,
  reNestRecord,
  resolveObject,
  type CompositeReadPlan,
} from '../app/lib/records';

const HW = '80df2525-e3f0-4020-85e9-95251ca5d902';
const SCHEMA = 'workspace_7mnum4pk2xma6fag4hcj854aq';
const ENUM = `"${SCHEMA}"."person_createdBySource_enum"`;

let failed = false;
const ok = (m: string): void => console.log('  ok:', m);
const bad = (m: string): void => {
  console.error('  FAIL:', m);
  failed = true;
};
const assert = (cond: boolean, m: string): void => (cond ? ok(m) : bad(m));
const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const need = <T>(value: T | undefined, label: string): T => {
  if (value === undefined) throw new Error(`missing ${label}`);
  return value;
};

const personCount = async (): Promise<number> => {
  const rows = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM "${SCHEMA}"."person" WHERE "deletedAt" IS NULL`,
  );
  return rows[0]?.n ?? -1;
};

const main = async (): Promise<void> => {
  // ---- Layer 0: reNestRecord unit checks, using the real person plans -------------------------------
  console.log('=== Layer 0: reNestRecord unit checks ===');
  const personObj = await resolveObject(HW, 'people');
  const personCols = await getTableColumnSet(SCHEMA, 'person');
  const personShape = await getObjectReadShape(HW, personObj.id, personCols);
  const find = (field: string): CompositeReadPlan =>
    need(
      personShape.composites.find((c) => c.field === field),
      `person composite ${field}`,
    );
  const linksPlan = find('linkedinLink');
  const actorPlan = find('createdBy');
  assert(actorPlan.isRequiredPresent && !actorPlan.isNullable, 'createdBy plan: ACTOR, non-nullable');

  const nulledLinks = reNestRecord(
    {
      linkedinLinkPrimaryLinkLabel: null,
      linkedinLinkPrimaryLinkUrl: null,
      linkedinLinkSecondaryLinks: null,
    },
    [linksPlan],
  );
  assert(
    eq(nulledLinks.linkedinLink, { primaryLinkLabel: '', primaryLinkUrl: '', secondaryLinks: [] }),
    'LINKS null sub-columns -> {label:"",url:"",secondary:[]}',
  );
  assert(
    !('linkedinLinkPrimaryLinkUrl' in nulledLinks),
    'flat sub-columns are removed after re-nesting',
  );

  const collapsedActor = reNestRecord(
    {
      createdBySource: null,
      createdByName: null,
      createdByWorkspaceMemberId: null,
      createdByContext: null,
    },
    [actorPlan],
  );
  assert(
    eq(collapsedActor.createdBy, { source: 'MANUAL', workspaceMemberId: null, name: '', context: {} }),
    'ACTOR all-required-empty + non-nullable -> defaultWhenEmpty',
  );

  const liveActor = reNestRecord(
    {
      createdBySource: 'API',
      createdByName: 'Probe',
      createdByWorkspaceMemberId: null,
      createdByContext: { foo: 'bar' },
    },
    [actorPlan],
  );
  assert(
    eq(liveActor.createdBy, {
      source: 'API',
      workspaceMemberId: null,
      name: 'Probe',
      context: { foo: 'bar' },
    }),
    'ACTOR with source present -> nested object preserved',
  );

  // ---- Layer A: live company composites ------------------------------------------------------------
  console.log('=== Layer A: live company composites ===');
  const companyObj = await resolveObject(HW, 'companies');
  const companyCols = await getTableColumnSet(SCHEMA, 'company');
  const companyShape = await getObjectReadShape(HW, companyObj.id, companyCols);
  const compositeFields = companyShape.composites.map((c) => c.field).sort();
  console.log('  company composites:', compositeFields.join(', '));
  for (const f of ['domainName', 'address', 'annualRevenue', 'createdBy', 'updatedBy', 'linkedinLink']) {
    assert(compositeFields.includes(f), `company shape includes ${f}`);
  }
  // Sub-columns are in the SELECT list; the composite field names are NOT (they're synthesized).
  assert(
    companyShape.selectColumns.includes('domainNamePrimaryLinkUrl'),
    'selectColumns carries composite sub-columns',
  );
  assert(
    !companyShape.selectColumns.includes('domainName'),
    'selectColumns does NOT carry the synthetic composite field name',
  );

  const nested = await listRecords(
    SCHEMA,
    'company',
    companyShape.selectColumns,
    500,
    companyShape.composites,
  );
  const alAzhar = need(
    nested.find((r) => r.name === 'Al-Azhar Schools'),
    'Al-Azhar Schools row',
  );
  const domainName = alAzhar.domainName as Record<string, unknown>;
  assert(domainName?.primaryLinkUrl === 'alazhar.edu.eg', 'domainName.primaryLinkUrl re-nested');
  assert(domainName?.primaryLinkLabel === '', 'domainName.primaryLinkLabel null -> ""');
  assert(eq(domainName?.secondaryLinks, []), 'domainName.secondaryLinks null -> []');
  const address = alAzhar.address as Record<string, unknown>;
  assert(address?.addressCity === '', 'address.addressCity null -> ""');
  assert(address?.addressLat === null, 'address.addressLat null -> null (raw, numeric)');
  const annualRevenue = alAzhar.annualRevenue as Record<string, unknown>;
  assert(annualRevenue?.amountMicros === null, 'annualRevenue.amountMicros null -> null');
  assert(annualRevenue?.currencyCode === null, 'annualRevenue.currencyCode null -> null');
  const createdBy = alAzhar.createdBy as Record<string, unknown>;
  assert(createdBy?.source === 'MANUAL', 'createdBy.source = MANUAL');
  assert(createdBy?.name === 'Abdou', 'createdBy.name = Abdou');
  assert(
    createdBy?.workspaceMemberId === '701819b1-b9dd-4b6e-840b-e9b4ef8c0216',
    'createdBy.workspaceMemberId preserved (uuid)',
  );
  assert(!('domainNamePrimaryLinkUrl' in alAzhar), 'company: flat composite sub-columns removed');
  assert(!('createdBySource' in alAzhar), 'company: flat ACTOR sub-columns removed');
  assert(typeof alAzhar.name === 'string' && typeof alAzhar.id === 'string', 'scalars id/name intact');

  // Scalar back-compat: empty composites -> byte-identical flat behaviour (no nesting).
  const flat = await listRecords(SCHEMA, 'company', companyShape.selectColumns, 500);
  const flatAlAzhar = need(flat.find((r) => r.name === 'Al-Azhar Schools'), 'flat Al-Azhar');
  assert(
    flatAlAzhar.domainNamePrimaryLinkUrl === 'alazhar.edu.eg' && !('domainName' in flatAlAzhar),
    'composites=[] -> flat sub-columns, no nesting (Slice 8 behaviour preserved)',
  );

  // ---- Layer B: net-zero probe person --------------------------------------------------------------
  console.log('=== Layer B: net-zero person probe ===');
  const baseline = await personCount();
  console.log(`  baseline active persons: ${baseline}`);
  const probeId = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "${SCHEMA}"."person"
       ("id","nameFirstName","nameLastName","emailsPrimaryEmail","emailsAdditionalEmails",
        "phonesPrimaryPhoneNumber","phonesPrimaryPhoneCountryCode","phonesPrimaryPhoneCallingCode",
        "linkedinLinkPrimaryLinkUrl","linkedinLinkPrimaryLinkLabel",
        "createdBySource","createdByName","createdByContext")
     VALUES ($1::uuid,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11::${ENUM},$12,$13::jsonb)`,
    probeId,
    'Harry',
    'Potter',
    'harry@hogwarts.edu',
    JSON.stringify(['h2@owl.post']),
    '5551234',
    'GB',
    '+44',
    'linkedin.com/in/harry',
    'Harry P',
    'API',
    'Slice11 Probe',
    JSON.stringify({}),
  );
  try {
    assert((await personCount()) === baseline + 1, 'probe insert: active person count +1');
    const row = await getRecord(
      SCHEMA,
      'person',
      personShape.selectColumns,
      probeId,
      personShape.composites,
    );
    if (!row) {
      bad('getRecord returned null for the probe person');
    } else {
      assert(eq(row.name, { firstName: 'Harry', lastName: 'Potter' }), 'name -> {firstName,lastName}');
      assert(
        eq(row.emails, { primaryEmail: 'harry@hogwarts.edu', additionalEmails: ['h2@owl.post'] }),
        'emails -> {primaryEmail, additionalEmails[jsonb]}',
      );
      const phones = row.phones as Record<string, unknown>;
      assert(
        phones?.primaryPhoneNumber === '5551234' &&
          phones?.primaryPhoneCountryCode === 'GB' &&
          phones?.primaryPhoneCallingCode === '+44' &&
          eq(phones?.additionalPhones, []),
        'phones -> {number,country,calling,additional[]}',
      );
      const linkedin = row.linkedinLink as Record<string, unknown>;
      assert(
        linkedin?.primaryLinkUrl === 'linkedin.com/in/harry' &&
          linkedin?.primaryLinkLabel === 'Harry P' &&
          eq(linkedin?.secondaryLinks, []),
        'linkedinLink -> {label,url,secondary[]}',
      );
      assert(
        eq(row.createdBy, {
          source: 'API',
          workspaceMemberId: null,
          name: 'Slice11 Probe',
          context: {},
        }),
        'createdBy ACTOR -> nested (source=API, name set, no member)',
      );
      assert(
        !('nameFirstName' in row) && !('createdBySource' in row) && !('emailsPrimaryEmail' in row),
        'all flat composite sub-columns removed from the probe row',
      );
      assert(typeof row.id === 'string' && typeof row.createdAt !== 'undefined', 'id + createdAt present');
    }
  } finally {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "${SCHEMA}"."person" WHERE "id" = $1::uuid`,
      probeId,
    );
  }
  assert(
    (await getRecord(SCHEMA, 'person', personShape.selectColumns, probeId, personShape.composites)) ===
      null,
    'probe hard-deleted: gone',
  );
  assert((await personCount()) === baseline, 'net-zero: active person count restored');

  console.log(failed ? '\nSLICE 11 FAIL' : '\nSLICE 11 COMPOSITE READ OK ✓');
  if (failed) process.exitCode = 1;
};

main()
  .catch((e) => {
    console.error('SLICE 11 ERROR:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
