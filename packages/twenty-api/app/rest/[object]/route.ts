import { NextResponse, type NextRequest } from 'next/server';

import { authOrResponse, permitOrResponse } from '../../lib/http';
import { proxyToLegacy } from '../../lib/proxy';
import {
  getObjectScalarColumns,
  listRecords,
  ObjectNotFoundError,
  resolveObject,
} from '../../lib/records';

// Generic metadata-driven collection reader: GET /rest/<anyObjectPlural> serves a native list for any
// standard object (scalar fields). Non-GET verbs proxy to legacy so writes for arbitrary objects keep
// working (a GET-only native route would otherwise 405 instead of falling through). The static
// /rest/companies + /rest/metadata routes take Next.js precedence over this dynamic segment.
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

export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
