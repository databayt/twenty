import { type NextRequest } from 'next/server';

import { proxyToLegacy } from '../lib/proxy';

// Slice 0: GraphQL is PROXIED to the legacy twenty-server. Do NOT serve a partial schema here — the
// SPA's generated types expect the full schema, so a partial split would break the app. Native
// GraphQL (a graphql-yoga fetch handler in this route) is a dedicated milestone — see
// .claude/docs/VERCEL-BACKEND.md. This route exists explicitly (rather than via the catch-all) so
// that the cutover, when it happens, is a single-file change.
export const dynamic = 'force-dynamic';

const handler = (request: NextRequest): Promise<Response> =>
  proxyToLegacy(request, '/graphql');

export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;
