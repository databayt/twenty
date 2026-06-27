import { type NextRequest } from 'next/server';

import { proxyToLegacy } from '../lib/proxy';

// Catch-all strangler facade: any path not served by a native route (e.g. /healthz) or the explicit
// /graphql route falls through here and is proxied verbatim to the legacy twenty-server — /metadata,
// /rest/*, /files, /auth/*, webhooks, etc. Path-transparent, so the frontend can point
// REACT_APP_SERVER_BASE_URL at twenty-api with zero behavior change. As endpoints are ported, give
// them their own route file (specific routes take precedence over this catch-all) and register the
// prefix in lib/ported-routes.ts.
export const dynamic = 'force-dynamic';

const handler = (request: NextRequest): Promise<Response> => {
  const { pathname } = new URL(request.url);
  return proxyToLegacy(request, pathname);
};

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;
