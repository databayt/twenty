import { NextResponse, type NextRequest } from 'next/server';

import { authOrResponse, permitOrResponse } from '../../../lib/http';
import { proxyToLegacy } from '../../../lib/proxy';
import {
  capitalize,
  destroyRecord,
  getObjectScalarColumns,
  getRecord,
  getWritableScalarFields,
  ObjectNotFoundError,
  resolveObject,
  softDeleteRecord,
  updateRecord,
  WriteValidationError,
} from '../../../lib/records';

// Generic metadata-driven single record: GET (read), PATCH/PUT (update), DELETE (hard destroy by
// default; ?soft_delete=true soft-deletes) — for any object's scalar fields. Reserved shapes + POST
// proxy to legacy. Static /rest/companies/[id] wins over this dynamic segment.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ object: string; id: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Reserved /rest/<x>/<y> shapes that aren't object/:id -> proxy.
const RESERVED_OBJECTS = new Set(['batch', 'restore', 'metadata']);
const RESERVED_SUBRESOURCES = new Set(['duplicates', 'groupBy', 'merge']);

const proxy = (request: NextRequest): Promise<Response> =>
  proxyToLegacy(request, new URL(request.url).pathname);

export const GET = async (
  request: NextRequest,
  context: RouteContext,
): Promise<Response> => {
  const { object, id } = await context.params;
  if (RESERVED_OBJECTS.has(object) || RESERVED_SUBRESOURCES.has(id)) {
    return proxy(request);
  }
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: `'${id}' is not a valid UUID` }, { status: 400 });
  }

  const ctx = await authOrResponse(request);
  if (ctx instanceof NextResponse) {
    return ctx;
  }

  let resolved;
  try {
    resolved = await resolveObject(ctx.workspaceId, object);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const denied = await permitOrResponse(ctx, resolved.nameSingular, 'read');
  if (denied) {
    return denied;
  }

  const columns = await getObjectScalarColumns(ctx.workspaceId, resolved.id);
  const row = await getRecord(ctx.databaseSchema, resolved.tableName, columns, id);
  if (!row) {
    return NextResponse.json({ error: 'Record not found' }, { status: 404 });
  }
  // Upstream get-one envelope, keyed dynamically by the object's singular name.
  return NextResponse.json({ data: { [resolved.nameSingular]: row } });
};

const update = async (
  request: NextRequest,
  context: RouteContext,
): Promise<Response> => {
  const { object, id } = await context.params;
  if (RESERVED_OBJECTS.has(object) || RESERVED_SUBRESOURCES.has(id)) {
    return proxy(request);
  }
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: `'${id}' is not a valid UUID` }, { status: 400 });
  }

  const ctx = await authOrResponse(request);
  if (ctx instanceof NextResponse) {
    return ctx;
  }

  let resolved;
  try {
    resolved = await resolveObject(ctx.workspaceId, object);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
  if (resolved.isSystem && resolved.nameSingular !== 'workspaceMember') {
    return proxy(request);
  }

  const denied = await permitOrResponse(ctx, resolved.nameSingular, 'update');
  if (denied) {
    return denied;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 });
  }

  const writableFields = await getWritableScalarFields(ctx.workspaceId, resolved.id);
  const returningColumns = await getObjectScalarColumns(ctx.workspaceId, resolved.id);
  try {
    const row = await updateRecord(
      ctx.databaseSchema,
      resolved.tableName,
      writableFields,
      id,
      body as Record<string, unknown>,
      returningColumns,
    );
    if (!row) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }
    return NextResponse.json({
      data: { [`update${capitalize(resolved.nameSingular)}`]: row },
    });
  } catch (error) {
    if (error instanceof WriteValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
};

export const PATCH = update;
export const PUT = update; // upstream keeps PUT as a PATCH alias

export const DELETE = async (
  request: NextRequest,
  context: RouteContext,
): Promise<Response> => {
  const { object, id } = await context.params;
  if (RESERVED_OBJECTS.has(object) || RESERVED_SUBRESOURCES.has(id)) {
    return proxy(request);
  }
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: `'${id}' is not a valid UUID` }, { status: 400 });
  }

  const ctx = await authOrResponse(request);
  if (ctx instanceof NextResponse) {
    return ctx;
  }

  let resolved;
  try {
    resolved = await resolveObject(ctx.workspaceId, object);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
  if (resolved.isSystem && resolved.nameSingular !== 'workspaceMember') {
    return proxy(request);
  }

  // Upstream: bare DELETE = hard destroy; ?soft_delete=true = soft delete.
  const soft = new URL(request.url).searchParams.get('soft_delete') === 'true';
  const denied = await permitOrResponse(
    ctx,
    resolved.nameSingular,
    soft ? 'softDelete' : 'destroy',
  );
  if (denied) {
    return denied;
  }

  const deleted = soft
    ? await softDeleteRecord(ctx.databaseSchema, resolved.tableName, id)
    : await destroyRecord(ctx.databaseSchema, resolved.tableName, id);
  if (!deleted) {
    return NextResponse.json({ error: 'Record not found' }, { status: 404 });
  }
  return NextResponse.json({
    data: { [`delete${capitalize(resolved.nameSingular)}`]: { id: deleted.id } },
  });
};

export const POST = proxy;
export const OPTIONS = proxy;
