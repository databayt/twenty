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
};

// Resolve the URL plural segment to an active object scoped to the workspace (namePlural is the
// canonical REST collection key upstream). Unknown/inactive -> 404.
export const resolveObject = async (
  workspaceId: string,
  namePlural: string,
): Promise<ResolvedObject> => {
  const object = await prisma.objectMetadata.findFirst({
    where: { workspaceId, namePlural, isActive: true },
    select: { id: true, nameSingular: true, namePlural: true, isCustom: true },
  });
  if (!object) {
    throw new ObjectNotFoundError(`object '${namePlural}' not found`);
  }
  return {
    id: object.id,
    nameSingular: object.nameSingular,
    namePlural: object.namePlural,
    tableName: computeObjectTargetTable(object.nameSingular, object.isCustom),
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
