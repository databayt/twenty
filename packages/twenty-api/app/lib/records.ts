import {
  computeObjectTargetTable,
  escapeIdentifier,
  FIELD_NAME_RE,
  WORKSPACE_SCHEMA_RE,
} from './metadata/ddl';
import { prisma } from './prisma';

// Generic, metadata-driven record reads for ANY standard object — the move from one-object-at-a-time
// to deriving the column list from field metadata (twenty's single catch-all controller, ported).
// READ-only + SCALAR fields only for this slice; composites/relations/enums + writes are deferred.

export class ObjectNotFoundError extends Error {
  readonly status = 404;

  constructor(message: string) {
    super(message);
    this.name = 'ObjectNotFoundError';
  }
}

// Field types whose physical column is a single column named exactly `field.name`. Composites
// (ACTOR/ADDRESS/CURRENCY/EMAILS/FULL_NAME/LINKS/PHONES/RICH_TEXT), relations (RELATION/MORPH_RELATION),
// enum-backed (SELECT/MULTI_SELECT/RATING), ARRAY, FILES and TS_VECTOR are intentionally excluded.
export const READ_SCALAR_FIELD_TYPES: ReadonlySet<string> = new Set([
  'TEXT',
  'UUID',
  'NUMERIC',
  'NUMBER',
  'POSITION',
  'BOOLEAN',
  'DATE_TIME',
  'DATE',
  'RAW_JSON',
]);

// Object table name; custom objects get a leading underscore (computeObjectTargetTable).
const TABLE_NAME_RE = /^_?[a-zA-Z][a-zA-Z0-9]*$/;

export type ResolvedObject = {
  id: string;
  nameSingular: string;
  namePlural: string;
  tableName: string;
  isSystem: boolean;
};

// Resolve the URL plural segment to an active object scoped to the workspace (namePlural is the
// canonical REST collection key upstream). Unknown/inactive -> 404.
export const resolveObject = async (
  workspaceId: string,
  namePlural: string,
): Promise<ResolvedObject> => {
  const object = await prisma.objectMetadata.findFirst({
    where: { workspaceId, namePlural, isActive: true },
    select: { id: true, nameSingular: true, namePlural: true, isCustom: true, isSystem: true },
  });
  if (!object) {
    throw new ObjectNotFoundError(`object '${namePlural}' not found`);
  }
  return {
    id: object.id,
    nameSingular: object.nameSingular,
    namePlural: object.namePlural,
    tableName: computeObjectTargetTable(object.nameSingular, object.isCustom),
    isSystem: object.isSystem,
  };
};

// The SELECT list: forced base columns + active, non-system SCALAR field columns (column == field.name).
export const getObjectScalarColumns = async (
  workspaceId: string,
  objectMetadataId: string,
): Promise<string[]> => {
  const fields = await prisma.fieldMetadata.findMany({
    where: { workspaceId, objectMetadataId, isActive: true, isSystem: false },
    select: { name: true, type: true },
  });
  const scalarNames = fields
    .filter(
      (field) =>
        READ_SCALAR_FIELD_TYPES.has(field.type) &&
        field.name !== 'deletedAt' &&
        FIELD_NAME_RE.test(field.name),
    )
    .map((field) => field.name);
  return Array.from(new Set(['id', 'createdAt', 'updatedAt', ...scalarNames]));
};

// Identifiers can't be bound params — validate every one, then escape, then interpolate. Values bound.
const assertIdentifiers = (
  databaseSchema: string,
  tableName: string,
  columns: string[],
): void => {
  if (!WORKSPACE_SCHEMA_RE.test(databaseSchema)) {
    throw new Error(`Invalid workspace schema: ${databaseSchema}`);
  }
  if (!TABLE_NAME_RE.test(tableName)) {
    throw new Error(`Invalid table name: ${tableName}`);
  }
  for (const column of columns) {
    if (!FIELD_NAME_RE.test(column)) {
      throw new Error(`Invalid column name: ${column}`);
    }
  }
};

const columnList = (columns: string[]): string =>
  columns.map(escapeIdentifier).join(', ');

export const listRecords = async (
  databaseSchema: string,
  tableName: string,
  columns: string[],
  limit = 50,
): Promise<Record<string, unknown>[]> => {
  assertIdentifiers(databaseSchema, tableName, columns);
  return prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT ${columnList(columns)} FROM ${escapeIdentifier(databaseSchema)}.${escapeIdentifier(tableName)} WHERE "deletedAt" IS NULL ORDER BY "id" ASC NULLS FIRST LIMIT $1`,
    limit,
  );
};

export const getRecord = async (
  databaseSchema: string,
  tableName: string,
  columns: string[],
  id: string,
): Promise<Record<string, unknown> | null> => {
  assertIdentifiers(databaseSchema, tableName, columns);
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT ${columnList(columns)} FROM ${escapeIdentifier(databaseSchema)}.${escapeIdentifier(tableName)} WHERE "id" = $1::uuid AND "deletedAt" IS NULL LIMIT 1`,
    id,
  );
  return rows[0] ?? null;
};

// --- Slice 9: generic writes (scalar fields). Writable = READ scalars minus POSITION (system-managed).
// createdBy*/updatedBy* are OMITTED (DB defaults), so the generic writer needs no per-table enum cast.

export const WRITABLE_SCALAR_FIELD_TYPES: ReadonlySet<string> = new Set(
  [...READ_SCALAR_FIELD_TYPES].filter((t) => t !== 'POSITION'),
);
const FORCED_COLUMNS: ReadonlySet<string> = new Set([
  'id',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'position',
]);
const UUID_VALUE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class WriteValidationError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = 'WriteValidationError';
  }
}

export const capitalize = (value: string): string =>
  value.charAt(0).toUpperCase() + value.slice(1);

export type WritableField = {
  name: string;
  type: string;
  isNullable: boolean;
  defaultValue: unknown;
};

export const getWritableScalarFields = async (
  workspaceId: string,
  objectMetadataId: string,
): Promise<WritableField[]> => {
  const fields = await prisma.fieldMetadata.findMany({
    where: { workspaceId, objectMetadataId, isActive: true, isSystem: false },
    select: { name: true, type: true, isNullable: true, defaultValue: true },
  });
  return fields
    .filter(
      (field) =>
        WRITABLE_SCALAR_FIELD_TYPES.has(field.type) &&
        FIELD_NAME_RE.test(field.name) &&
        !FORCED_COLUMNS.has(field.name),
    )
    .map((field) => ({
      name: field.name,
      type: field.type,
      isNullable: field.isNullable ?? true,
      defaultValue: field.defaultValue,
    }));
};

// Coerce + validate a JSON request value for a scalar field, returning the parameterized placeholder
// (with an explicit cast — required for uuid/numeric/timestamptz/date/jsonb) and the bound value.
const coerceFieldValue = (
  type: string,
  value: unknown,
  paramIndex: number,
): { placeholderSql: string; bound: unknown } => {
  const p = `$${paramIndex}`;
  const castByType: Record<string, string> = {
    TEXT: 'text',
    UUID: 'uuid',
    BOOLEAN: 'boolean',
    NUMBER: 'double precision',
    NUMERIC: 'numeric',
    DATE_TIME: 'timestamptz',
    DATE: 'date',
    RAW_JSON: 'jsonb',
  };
  const cast = castByType[type];
  if (!cast) {
    throw new WriteValidationError(`Unsupported field type for write: ${type}`);
  }
  if (value === null) {
    return { placeholderSql: `${p}::${cast}`, bound: null };
  }
  switch (type) {
    case 'TEXT':
      if (typeof value !== 'string') {
        throw new WriteValidationError('Expected a string');
      }
      return { placeholderSql: `${p}::text`, bound: value };
    case 'UUID':
      if (typeof value !== 'string' || !UUID_VALUE_RE.test(value)) {
        throw new WriteValidationError('Expected a UUID');
      }
      return { placeholderSql: `${p}::uuid`, bound: value };
    case 'BOOLEAN': {
      let boolValue: boolean;
      if (typeof value === 'boolean') boolValue = value;
      else if (value === 'true') boolValue = true;
      else if (value === 'false') boolValue = false;
      else throw new WriteValidationError('Expected a boolean');
      return { placeholderSql: `${p}::boolean`, bound: boolValue };
    }
    case 'NUMBER':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new WriteValidationError('Expected a finite number');
      }
      return { placeholderSql: `${p}::double precision`, bound: value };
    case 'NUMERIC': {
      const numeric = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(numeric)) {
        throw new WriteValidationError('Expected a numeric value');
      }
      // Bind as a string to preserve precision (Prisma round-trips numeric as string).
      return { placeholderSql: `${p}::numeric`, bound: String(value) };
    }
    case 'DATE_TIME': {
      const date = value instanceof Date ? value : new Date(String(value));
      if (Number.isNaN(date.getTime())) {
        throw new WriteValidationError('Expected an ISO-8601 date-time');
      }
      return { placeholderSql: `${p}::timestamptz`, bound: date.toISOString() };
    }
    case 'DATE':
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new WriteValidationError('Expected a YYYY-MM-DD date');
      }
      return { placeholderSql: `${p}::date`, bound: value };
    case 'RAW_JSON': {
      let json: string;
      try {
        json = JSON.stringify(value);
      } catch {
        throw new WriteValidationError('Invalid JSON value');
      }
      return { placeholderSql: `${p}::jsonb`, bound: json };
    }
    default:
      throw new WriteValidationError(`Unsupported field type for write: ${type}`);
  }
};

type WriteColumn = { name: string; placeholderSql: string; bound: unknown };

// Whitelist body keys to the writable set (reject unknown -> 400, matching upstream), skip undefined,
// and coerce each value. Placeholders are numbered $1..$N in column order.
const buildWriteColumns = (
  writableFields: WritableField[],
  body: Record<string, unknown>,
): WriteColumn[] => {
  const byName = new Map(writableFields.map((field) => [field.name, field]));
  const columns: WriteColumn[] = [];
  let paramIndex = 1;
  for (const key of Object.keys(body)) {
    const def = byName.get(key);
    if (!def) {
      throw new WriteValidationError(`Object doesn't have any "${key}" field`);
    }
    const value = body[key];
    if (value === undefined) {
      continue;
    }
    const { placeholderSql, bound } = coerceFieldValue(def.type, value, paramIndex);
    columns.push({ name: key, placeholderSql, bound });
    paramIndex += 1;
  }
  return columns;
};

export const createRecord = async (
  databaseSchema: string,
  tableName: string,
  writableFields: WritableField[],
  body: Record<string, unknown>,
  returningColumns: string[],
): Promise<Record<string, unknown>> => {
  // Pre-empt NOT-NULL-without-default violations with a clean 400.
  for (const field of writableFields) {
    if (!field.isNullable && (field.defaultValue === null || field.defaultValue === undefined)) {
      const provided = body[field.name];
      if (provided === undefined || provided === null) {
        throw new WriteValidationError(`Field ${field.name} is required`);
      }
    }
  }
  const columns = buildWriteColumns(writableFields, body);
  assertIdentifiers(databaseSchema, tableName, [
    ...columns.map((c) => c.name),
    ...returningColumns,
  ]);

  const target = `${escapeIdentifier(databaseSchema)}.${escapeIdentifier(tableName)}`;
  const sql =
    columns.length === 0
      ? `INSERT INTO ${target} DEFAULT VALUES RETURNING ${columnList(returningColumns)}`
      : `INSERT INTO ${target} (${columns.map((c) => escapeIdentifier(c.name)).join(', ')}) VALUES (${columns.map((c) => c.placeholderSql).join(', ')}) RETURNING ${columnList(returningColumns)}`;

  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    sql,
    ...columns.map((c) => c.bound),
  );
  return rows[0];
};

export const updateRecord = async (
  databaseSchema: string,
  tableName: string,
  writableFields: WritableField[],
  id: string,
  body: Record<string, unknown>,
  returningColumns: string[],
): Promise<Record<string, unknown> | null> => {
  const columns = buildWriteColumns(writableFields, body);
  if (columns.length === 0) {
    throw new WriteValidationError('No updatable fields provided');
  }
  assertIdentifiers(databaseSchema, tableName, [
    ...columns.map((c) => c.name),
    ...returningColumns,
  ]);

  const setFragments = columns.map(
    (c) => `${escapeIdentifier(c.name)} = ${c.placeholderSql}`,
  );
  const idParamIndex = columns.length + 1;
  const sql = `UPDATE ${escapeIdentifier(databaseSchema)}.${escapeIdentifier(tableName)} SET ${setFragments.join(', ')}, "updatedAt" = now() WHERE "id" = $${idParamIndex}::uuid AND "deletedAt" IS NULL RETURNING ${columnList(returningColumns)}`;

  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    sql,
    ...columns.map((c) => c.bound),
    id,
  );
  return rows[0] ?? null;
};

export const softDeleteRecord = async (
  databaseSchema: string,
  tableName: string,
  id: string,
): Promise<{ id: string } | null> => {
  assertIdentifiers(databaseSchema, tableName, []);
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `UPDATE ${escapeIdentifier(databaseSchema)}.${escapeIdentifier(tableName)} SET "deletedAt" = now(), "updatedAt" = now() WHERE "id" = $1::uuid AND "deletedAt" IS NULL RETURNING "id"`,
    id,
  );
  return rows[0] ?? null;
};

export const destroyRecord = async (
  databaseSchema: string,
  tableName: string,
  id: string,
): Promise<{ id: string } | null> => {
  assertIdentifiers(databaseSchema, tableName, []);
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `DELETE FROM ${escapeIdentifier(databaseSchema)}.${escapeIdentifier(tableName)} WHERE "id" = $1::uuid RETURNING "id"`,
    id,
  );
  return rows[0] ?? null;
};
