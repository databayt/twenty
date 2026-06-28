import { randomUUID } from 'node:crypto';

import { prisma } from '../prisma';
import {
  buildScalarColumnDefinition,
  computeObjectTargetTable,
  escapeIdentifier,
  isValidFieldName,
  WORKSPACE_SCHEMA_RE,
} from './ddl';

// The minimal faithful slice of twenty's create-field action handler: write one fieldMetadata row +
// run one ALTER TABLE ADD COLUMN in the workspace schema + bump metadataVersion, all in ONE
// transaction (twenty uses a single TypeORM QueryRunner; splitting across connections loses atomicity).
// Deferred (see .claude/docs/MIGRATION-LEDGER.md): composite/relation/enum types, object creation,
// the computed-diff engine, indexes/search-vector, and the GraphQL/metadata cache rebuild.

export class MetadataError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'MetadataError';
    this.status = status;
  }
}

export type CreatedField = {
  id: string;
  name: string;
  label: string;
  type: string;
  objectMetadataId: string;
  isActive: boolean;
  isCustom: boolean;
};

type CreateScalarFieldArgs = {
  workspaceId: string;
  databaseSchema: string;
  objectMetadataId: string;
  name: string;
  label: string;
  type: string; // already narrowed to a supported scalar by the route ('TEXT' for this slice)
};

export const createScalarField = async (
  args: CreateScalarFieldArgs,
): Promise<CreatedField> => {
  const { workspaceId, databaseSchema, objectMetadataId, name, label, type } =
    args;

  if (!isValidFieldName(name)) {
    throw new MetadataError('Invalid field name (must be camelCase alphanumeric)', 400);
  }
  // databaseSchema comes from the verified token's workspace; re-assert the invariant before any DDL.
  if (!WORKSPACE_SCHEMA_RE.test(databaseSchema)) {
    throw new MetadataError('Invalid workspace schema', 400);
  }

  // Object must belong to the authenticated workspace (cross-tenant id -> 404).
  const object = await prisma.objectMetadata.findFirst({
    where: { id: objectMetadataId, workspaceId },
    select: { nameSingular: true, isCustom: true },
  });
  if (!object) {
    throw new MetadataError('Object not found in this workspace', 404);
  }

  // Pre-flight uniqueness, mirroring the (name, objectMetadataId, workspaceId) DB constraint.
  const existing = await prisma.fieldMetadata.findFirst({
    where: { objectMetadataId, name, workspaceId },
    select: { id: true },
  });
  if (existing) {
    throw new MetadataError('A field with this name already exists', 409);
  }

  // fieldMetadata.applicationId is NOT NULL with no default — resolve the workspace's Custom app.
  const customApplication = await prisma.application.findFirst({
    where: { workspaceId, name: 'Custom' },
    select: { id: true },
  });
  if (!customApplication) {
    throw new MetadataError('Custom application not found for workspace', 409);
  }

  const tableName = computeObjectTargetTable(object.nameSingular, object.isCustom);
  const alterSql = `ALTER TABLE ${escapeIdentifier(databaseSchema)}.${escapeIdentifier(tableName)} ADD COLUMN ${buildScalarColumnDefinition(name, type)}`;

  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '8s'`);

        // (1) DDL in the workspace schema — additive; Postgres DDL is transactional, so a later
        // failure rolls this back.
        await tx.$executeRawUnsafe(alterSql);

        // (2) metadata row
        const field = await tx.fieldMetadata.create({
          data: {
            objectMetadataId,
            type,
            name,
            label,
            isCustom: true,
            isActive: true,
            isNullable: true,
            workspaceId,
            universalIdentifier: randomUUID(),
            applicationId: customApplication.id,
          },
          select: {
            id: true,
            name: true,
            label: true,
            type: true,
            objectMetadataId: true,
            isActive: true,
            isCustom: true,
          },
        });

        // (3) bump metadataVersion (folded into the tx for determinism; twenty bumps post-commit in
        // its cache-invalidation step, which this slice skips).
        await tx.workspace.update({
          where: { id: workspaceId },
          data: { metadataVersion: { increment: 1 } },
        });

        return field;
      },
      { timeout: 15000, maxWait: 8000 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Duplicate column (metadata/physical drift or race) -> 409.
    if (/already exists/i.test(message)) {
      throw new MetadataError('A field with this name already exists', 409);
    }
    throw error;
  }
};
