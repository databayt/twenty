import { NextResponse } from 'next/server';

import { LEGACY_SERVER_URL } from '../lib/env';
import { NATIVE_ROUTE_PREFIXES } from '../lib/ported-routes';

// First native handler — proves twenty-api runs on Vercel before any backend module is ported.
export const dynamic = 'force-dynamic';

export const GET = (): NextResponse =>
  NextResponse.json({
    status: 'ok',
    service: 'twenty-api',
    mode: 'strangler-facade',
    slice: 0,
    nativeRoutes: NATIVE_ROUTE_PREFIXES,
    legacyServerUrl: LEGACY_SERVER_URL,
    note: 'Slice 0 — every route except the native ones proxies to the legacy twenty-server.',
  });
