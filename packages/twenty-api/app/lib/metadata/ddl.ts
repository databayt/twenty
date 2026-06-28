// Pure DDL helpers ported from twenty's workspace-migration column utilities (scalar subset).
// Identifiers (schema/table/column names) can't be bound parameters, so they are validated against
// strict allow-patterns AND double-quoted before interpolation — the SQL-injection guard.

// twenty escapeIdentifier: wrap in double quotes, double any internal quotes.
export const escapeIdentifier = (identifier: string): string =>
  `"${identifier.replace(/"/g, '""')}"`;

// A field name becomes BOTH metadata.name and a physical column name.
export const FIELD_NAME_RE = /^[a-zA-Z][a-zA-Z0-9]*$/;
export const isValidFieldName = (name: string): boolean => FIELD_NAME_RE.test(name);

export const WORKSPACE_SCHEMA_RE = /^workspace_[a-z0-9]+$/;

// computeObjectTargetTable: custom objects get a leading underscore; standard use nameSingular verbatim.
export const computeObjectTargetTable = (
  nameSingular: string,
  isCustom: boolean,
): string => (isCustom ? `_${nameSingular}` : nameSingular);

// fieldMetadataTypeToColumnType — scalar subset. This slice accepts only TEXT; the rest document the
// faithful map and make unsupported types fail loudly rather than emit wrong DDL.
const SCALAR_COLUMN_TYPE: Readonly<Record<string, string>> = {
  TEXT: 'text',
  UUID: 'uuid',
  NUMERIC: 'numeric',
  NUMBER: 'double precision',
  POSITION: 'double precision',
  BOOLEAN: 'boolean',
  DATE_TIME: 'timestamptz',
  DATE: 'date',
  RAW_JSON: 'jsonb',
};

export const scalarColumnType = (fieldType: string): string => {
  const columnType = SCALAR_COLUMN_TYPE[fieldType];
  if (!columnType) {
    throw new Error(`Unsupported (non-scalar) field type for this slice: ${fieldType}`);
  }
  return columnType;
};

// Nullable scalar with a null default — twenty emits a literal `DEFAULT NULL` (a no-op kept for parity).
// e.g. buildScalarColumnDefinition('myField', 'TEXT') -> "myField" text DEFAULT NULL
export const buildScalarColumnDefinition = (
  name: string,
  fieldType: string,
): string => `${escapeIdentifier(name)} ${scalarColumnType(fieldType)} DEFAULT NULL`;
