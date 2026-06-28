import { NextResponse, type NextRequest } from 'next/server';

import { authOrResponse, permitOrResponse } from '../../../lib/http';
import {
  destroyWorkspaceCompany,
  getWorkspaceCompany,
  softDeleteWorkspaceCompany,
  updateWorkspaceCompany,
} from '../../../lib/workspace';

// Native /rest/companies/:id — GET (read), PATCH/PUT (update), DELETE. Faithful to twenty-server:
// bare DELETE is a HARD destroy; DELETE ?soft_delete=true soft-deletes (stamps deletedAt). Each method
// is auth- + permission-guarded (read / update / softDelete | destroy). Every other /rest/* path still
// proxies to legacy. Node runtime (jsonwebtoken + node:crypto + Prisma).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

// Canonical UUID v1-5 (matches twenty-shared isValidUuid); workspace records are uuid_generate_v4.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const badUuid = (id: string): NextResponse =>
  NextResponse.json({ error: `'${id}' is not a valid UUID` }, { status: 400 });
const notFound = (): NextResponse =>
  NextResponse.json({ error: 'Record not found' }, { status: 404 });

export const GET = async (
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> => {
  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return badUuid(id);
  }

  const ctx = await authOrResponse(request);
  if (ctx instanceof NextResponse) {
    return ctx;
  }
  const denied = await permitOrResponse(ctx, 'company', 'read');
  if (denied) {
    return denied;
  }

  const company = await getWorkspaceCompany(ctx.databaseSchema, id);
  if (!company) {
    return notFound();
  }
  // Upstream GET-one envelope: data.<singular>.
  return NextResponse.json({ data: { company } });
};

const update = async (
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> => {
  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return badUuid(id);
  }

  const ctx = await authOrResponse(request);
  if (ctx instanceof NextResponse) {
    return ctx;
  }
  const denied = await permitOrResponse(ctx, 'company', 'update');
  if (denied) {
    return denied;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  // Partial update; this slice whitelists `name` only. Require it to be present (omitted != null).
  if (typeof body !== 'object' || body === null || !('name' in body)) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
  }
  const rawName = (body as { name?: unknown }).name;
  const name = typeof rawName === 'string' ? rawName : null;

  const company = await updateWorkspaceCompany(ctx.databaseSchema, id, { name });
  if (!company) {
    return notFound();
  }
  // Upstream update envelope: data.update<Singular>.
  return NextResponse.json({ data: { updateCompany: company } });
};

export const PATCH = update;
export const PUT = update; // upstream keeps PUT as a PATCH alias

export const DELETE = async (
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> => {
  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return badUuid(id);
  }

  const ctx = await authOrResponse(request);
  if (ctx instanceof NextResponse) {
    return ctx;
  }

  // Upstream: bare DELETE = hard destroy; ?soft_delete=true = soft delete.
  const soft = new URL(request.url).searchParams.get('soft_delete') === 'true';
  const denied = await permitOrResponse(
    ctx,
    'company',
    soft ? 'softDelete' : 'destroy',
  );
  if (denied) {
    return denied;
  }

  const deleted = soft
    ? await softDeleteWorkspaceCompany(ctx.databaseSchema, id)
    : await destroyWorkspaceCompany(ctx.databaseSchema, id);
  if (!deleted) {
    return notFound();
  }

  // Upstream returns id-only under the same delete<Singular> key for both soft and hard.
  return NextResponse.json({ data: { deleteCompany: { id: deleted.id } } });
};
