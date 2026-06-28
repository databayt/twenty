import { NextResponse, type NextRequest } from 'next/server';

import { authenticateRequest, AuthError, type AuthContext } from '../../lib/auth';
import { inngest } from '../../lib/inngest/client';
import {
  createWorkspaceCompany,
  listWorkspaceCompanies,
} from '../../lib/workspace';

// First fully-ported endpoint: authenticated, native /rest/companies (list + create). Auth + tenant
// come ONLY from the verified bearer token's workspaceId claim, exactly like twenty-server. Every
// other /rest/* path still falls through to the legacy server via app/[...slug]/route.ts.
// jsonwebtoken + node:crypto + Prisma require the Node runtime.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const authOrResponse = async (
  request: NextRequest,
): Promise<AuthContext | NextResponse> => {
  try {
    return await authenticateRequest(request);
  } catch (error) {
    const authError =
      error instanceof AuthError ? error : new AuthError('Unauthorized');
    return NextResponse.json({ error: authError.message }, { status: authError.status });
  }
};

export const GET = async (request: NextRequest): Promise<NextResponse> => {
  const ctx = await authOrResponse(request);
  if (ctx instanceof NextResponse) {
    return ctx;
  }

  const companies = await listWorkspaceCompanies(ctx.databaseSchema);

  // Upstream list envelope (rest-api-find-many.handler.ts). depth/filter/limit are TODOs for the slice.
  return NextResponse.json({
    data: { companies },
    totalCount: companies.length,
    pageInfo: { hasNextPage: false, startCursor: null, endCursor: null },
  });
};

export const POST = async (request: NextRequest): Promise<NextResponse> => {
  const ctx = await authOrResponse(request);
  if (ctx instanceof NextResponse) {
    return ctx;
  }

  let body: { name?: string | null };
  try {
    body = (await request.json()) as { name?: string | null };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const company = await createWorkspaceCompany(ctx.databaseSchema, {
    name: body?.name ?? null,
  });

  // Fire-and-forget event -> the Inngest `company-created` job (replaces twenty's entity-event ->
  // worker-queue coupling). Best-effort: payload is sourced only from the verified token + created
  // row, and a dev-server-down / missing event key must never fail the 201.
  try {
    await inngest.send({
      name: 'twenty-api/company.created',
      data: {
        workspaceId: ctx.workspaceId,
        databaseSchema: ctx.databaseSchema,
        companyId: company.id,
        name: company.name,
      },
    });
  } catch {
    // intentionally ignored — event coupling must not regress the create endpoint
  }

  // Upstream create envelope: data.create<Singular> (rest-api-create-one.handler.ts).
  return NextResponse.json({ data: { createCompany: company } }, { status: 201 });
};
