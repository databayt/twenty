import { NextResponse, type NextRequest } from 'next/server';

import {
  listWorkspaceCompanies,
  resolveWorkspaceSchema,
} from '../../lib/workspace';

// SLICE 1 — dev demonstration of the native data spine (NOT the production endpoint yet):
// Prisma typed read of core.workspace -> resolve the per-workspace schema -> raw search_path read of
// object data. Proves Prisma + the dynamic-schema spine end-to-end against real seeded data.
//
// Production /rest/* stays PROXIED + authenticated via the legacy server (the catch-all). This route
// lives under /native (not /rest) so it can't shadow or bypass auth on a real endpoint. Tenant comes
// from ?workspace=<subdomain> for now; deriving it from the request's auth token is Slice 2.
export const dynamic = 'force-dynamic';

export const GET = async (request: NextRequest): Promise<NextResponse> => {
  const subdomain =
    new URL(request.url).searchParams.get('workspace') ?? 'hogwarts';

  const workspace = await resolveWorkspaceSchema(subdomain);

  if (!workspace) {
    return NextResponse.json(
      { error: `No active workspace with data for subdomain "${subdomain}"` },
      { status: 404 },
    );
  }

  const companies = await listWorkspaceCompanies(workspace.databaseSchema);

  return NextResponse.json({
    workspace: {
      subdomain,
      id: workspace.id,
      displayName: workspace.displayName,
      schema: workspace.databaseSchema,
    },
    count: companies.length,
    companies,
    note: 'Slice 1 dev route — native Prisma read. Production /rest/* stays proxied + authed until ported with auth (Slice 2).',
  });
};
