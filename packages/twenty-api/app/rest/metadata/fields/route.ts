import { NextResponse, type NextRequest } from 'next/server';

import { authenticateRequest, AuthError, type AuthContext } from '../../../lib/auth';
import {
  createScalarField,
  MetadataError,
} from '../../../lib/metadata/create-field-runner';
import {
  assertSettingsPermission,
  PermissionError,
} from '../../../lib/permissions';

// Slice 3 (per-workspace migration runner — first faithful increment): create one TEXT custom field
// on an existing object. Authenticated + tenant-scoped via the Slice 2 spine; tenant comes ONLY from
// the verified token. Every other /rest/* path still proxies to legacy via app/[...slug]/route.ts.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CreateFieldBody = {
  objectMetadataId: string;
  name: string;
  label: string;
  type: string;
};

// Narrow unknown -> typed body (no `any`); this slice only accepts type 'TEXT'.
const parseBody = (raw: unknown): CreateFieldBody => {
  if (typeof raw !== 'object' || raw === null) {
    throw new MetadataError('Invalid JSON body', 400);
  }
  const body = raw as Record<string, unknown>;
  const { objectMetadataId, name, label, type } = body;
  if (
    typeof objectMetadataId !== 'string' ||
    typeof name !== 'string' ||
    typeof label !== 'string' ||
    typeof type !== 'string'
  ) {
    throw new MetadataError(
      'objectMetadataId, name, label and type are required strings',
      400,
    );
  }
  if (type !== 'TEXT') {
    throw new MetadataError("Only type 'TEXT' is supported in this slice", 400);
  }
  return { objectMetadataId, name, label, type };
};

export const POST = async (request: NextRequest): Promise<NextResponse> => {
  let ctx: AuthContext;
  try {
    ctx = await authenticateRequest(request);
  } catch (error) {
    const authError =
      error instanceof AuthError ? error : new AuthError('Unauthorized');
    return NextResponse.json({ error: authError.message }, { status: authError.status });
  }

  // Creating a field is a data-model change -> gated by the settings flag (not the object write flag).
  try {
    await assertSettingsPermission(ctx, 'canUpdateAllSettings');
  } catch (error) {
    if (error instanceof PermissionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  let body: CreateFieldBody;
  try {
    body = parseBody(await request.json());
  } catch (error) {
    if (error instanceof MetadataError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const field = await createScalarField({
      workspaceId: ctx.workspaceId,
      databaseSchema: ctx.databaseSchema,
      objectMetadataId: body.objectMetadataId,
      name: body.name,
      label: body.label,
      type: body.type,
    });
    // Upstream create envelope: data.create<Singular>.
    return NextResponse.json({ data: { createField: field } }, { status: 201 });
  } catch (error) {
    if (error instanceof MetadataError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
};
