-- Idempotent teardown for the Slice 3 verification field (Hogwarts workspace).
-- Run via: npx prisma db execute --schema prisma/schema.prisma --file scripts/cleanup-slice3-test-field.sql
-- (the Postgres MCP is read-only). Net effect: returns the dev DB to its pre-test state.
ALTER TABLE "workspace_7mnum4pk2xma6fag4hcj854aq"."company" DROP COLUMN IF EXISTS "sliceTestField";
DELETE FROM core."fieldMetadata"
  WHERE "objectMetadataId" = '61dd1891-de5c-4653-8736-1ca4542c4fae' AND name = 'sliceTestField';
