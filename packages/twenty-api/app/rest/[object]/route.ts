import { NextResponse, type NextRequest } from 'next/server';

import { authOrResponse, permitOrResponse } from '../../lib/http';
import { proxyToLegacy } from '../../lib/proxy';
import {
  capitalize,
  createRecord,
  getObjectScalarColumns,
  getWritableScalarFields,
  listRecords,
  ObjectNotFoundError,
  resolveObject,
  WriteValidationError,
} from '../../lib/records';

// Generic metadata-driven collection handler: GET /rest/<anyObjectPlural> lists, POST creates — for any
// standard object (scalar fields). Other verbs (collection-level update/delete-many) + reserved
// segments proxy to legacy. The static /rest/companies + /rest/metadata routes take Next.js precedence
// over this dynamic segment.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ object: string }> };

// Single-segment /rest paths that are NOT objects -> proxy to legacy.
const RESERVED = new Set(['batch', 'restore', 'metadata', 'open-api']);

const proxy = (request: NextRequest): Promise<Response> =>
  proxyToLegacy(request, new URL(request.url).pathname);

export const GET = async (
  request: NextRequest,
  context: RouteContext,
): Promise<Response> => {
  const { object } = await context.params;
  if (RESERVED.has(object)) {
    return proxy(request);
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
  const rows = await listRecords(ctx.databaseSchema, resolved.tableName, columns);

  // Upstream list envelope, keyed dynamically by the object's plural name.
  return NextResponse.json({
    data: { [resolved.namePlural]: rows },
    totalCount: rows.length,
    pageInfo: { hasNextPage: false, startCursor: null, endCursor: null },
  });
};

export const POST = async (
  request: NextRequest,
  context: RouteContext,
): Promise<Response> => {
  const { object } = await context.params;
  if (RESERVED.has(object)) {
    return proxy(request);
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
  // System objects -> proxy generic writes to legacy.
  if (resolved.isSystem && resolved.nameSingular !== 'workspaceMember') {
    return proxy(request);
  }

  // create maps to the object's update flag (upstream has no separate create flag).
  const denied = await permitOrResponse(ctx, resolved.nameSingular, 'create');
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
    const row = await createRecord(
      ctx.databaseSchema,
      resolved.tableName,
      writableFields,
      body as Record<string, unknown>,
      returningColumns,
    );
    return NextResponse.json(
      { data: { [`create${capitalize(resolved.nameSingular)}`]: row } },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof WriteValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
};

// Collection-level update/delete-many stay proxied this slice.
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
