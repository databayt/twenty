import { NextResponse, type NextRequest } from 'next/server';

import { authOrResponse, permitOrResponse } from '../../../lib/http';
import { proxyToLegacy } from '../../../lib/proxy';
import {
  getObjectScalarColumns,
  getRecord,
  ObjectNotFoundError,
  resolveObject,
} from '../../../lib/records';

// Generic metadata-driven single-record reader: GET /rest/<anyObjectPlural>/<id>. Non-GET verbs proxy
// to legacy (preserve writes). Static /rest/companies/[id] wins over this dynamic segment.
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

export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
